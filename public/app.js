let allRows = [];
let currentPage = 1;
const PAGE_SIZE = 25;

const $ = id => document.getElementById(id);

function dateOnly(v) {
  if (!v) return "";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v).slice(0,10) : d.toISOString().slice(0,10);
}

function followStatus(v) {
  if (!v) return "No Follow-up";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "No Follow-up";
  return d.getTime() <= Date.now() ? "Due" : "Upcoming";
}

function formatFollow(v) {
  if (!v) return "NA";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString("en-IN", {day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"});
}

function cleanText(v) {
  return String(v ?? "").trim().replace(/\s+/g, " ");
}

function normalizeState(v) {
  const s = cleanText(v);
  const key = s.toLowerCase().replace(/[\s._-]+/g, "");
  if (key === "uttarpradesh") return "Uttar Pradesh";
  return s;
}

function normalizeClientName(v) {
  return cleanText(v);
}

function canonicalizeRow(r) {
  const get = (aliases, fallback) => {
    for (const k of aliases) {
      if (r && Object.prototype.hasOwnProperty.call(r, k) && cleanText(r[k])) return cleanText(r[k]);
    }
    return fallback ?? "";
  };
  return {
    ...r,
    clientName: normalizeClientName(get(["clientName","Client Name","Client","ClientName","client"], r?.clientName)),
    tpaName: cleanText(get(["tpaName","TPA Name","TPA NAME","TPA"], r?.tpaName)),
    state: normalizeState(get(["state","State"], r?.state)),
    status: normalizeStatus(get(["status","Status"], r?.status)),
    remarks: cleanText(get(["remarks","Remarks","Remark"], r?.remarks)),
    requestDate: get(["requestDate","Request Date","Request date"], r?.requestDate),
    zone: cleanText(get(["zone","Zone"], r?.zone)),
    city: cleanText(get(["city","City"], r?.city)),
    vehicleNumber: cleanText(get(["vehicleNumber","Vehicle Number","Vehicle No","Reg"], r?.vehicleNumber)),
    nextFollowUpTime: get(["nextFollowUpTime","Next Follow-up Time","Next Follow-up"], r?.nextFollowUpTime),
    source: cleanText(get(["source","Source"], r?.source))
  };
}

function normalizeStatus(v) {
  const s = cleanText(v);
  if (/^inspection\s*done$/i.test(s)) return "Completed";
  if (/^complete(?:d)?$/i.test(s) || /^closed$/i.test(s)) return "Completed";
  if (/^cancel(?:led|ed)?$/i.test(s)) return "Cancelled";
  return s;
}

function isCompletedStatus(v) {
  return /^completed?$/i.test(normalizeStatus(v)) || /^closed$/i.test(normalizeStatus(v));
}

function isCancelledStatus(v) {
  return /^cancelled$/i.test(normalizeStatus(v));
}

function unique(field) {
  const seen = new Map();
  allRows.map(r => cleanText(r[field])).filter(Boolean).forEach(v => {
    const key = v.toLowerCase();
    if (!seen.has(key)) seen.set(key, v);
  });
  return [...seen.values()].sort((a,b)=>a.localeCompare(b));
}

function fillSelect(id, values, first) {
  const el = $(id);
  const old = el.value;
  el.innerHTML = `<option value="">${first}</option>` + values.map(v => `<option>${escapeHtml(v)}</option>`).join("");
  if (values.includes(old)) el.value = old;
}

function escapeHtml(v) {
  return String(v ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}

function loadFilterOptions() {
  fillSelect("clientFilter", unique("clientName"), "All Clients");
  fillSelect("tpaFilter", unique("tpaName"), "All TPA");
  fillSelect("statusFilter", unique("status"), "All Status");
  fillSelect("stateFilter", unique("state"), "All States");
}

function getFiltered() {
  const q = $("search").value.trim().toLowerCase();
  const client = $("clientFilter").value;
  const tpa = $("tpaFilter").value;
  const status = $("statusFilter").value;
  const state = $("stateFilter").value;
  const follow = $("followFilter").value;
  const from = $("dateFrom").value;
  const to = $("dateTo").value;

  return allRows.filter(r => {
    const hay = [r.clientName,r.vehicleNumber,r.tpaName,r.state,r.city,r.status,r.remarks,r.source].join(" ").toLowerCase();
    if (q && !hay.includes(q)) return false;
    if (client && normalizeClientName(r.clientName).toLowerCase() !== normalizeClientName(client).toLowerCase()) return false;
    if (tpa && cleanText(r.tpaName).toLowerCase() !== cleanText(tpa).toLowerCase()) return false;
    if (status && normalizeStatus(r.status) !== status) return false;
    if (state && cleanText(r.state).toLowerCase() !== cleanText(state).toLowerCase()) return false;
    if (follow && followStatus(r.nextFollowUpTime) !== follow) return false;
    const rd = dateOnly(r.requestDate);
    if (from && rd < from) return false;
    if (to && rd > to) return false;
    return true;
  });
}

function donutGradient(entries, colors) {
  const total = entries.reduce((sum, [,n]) => sum + n, 0);
  if (!total) return "#edf2f7 0 100%";
  let cursor = 0;
  const stops = entries.map(([name,n], i) => {
    const start = cursor;
    cursor += (n / total) * 100;
    return `${colors[i % colors.length]} ${start}% ${cursor}%`;
  });
  return stops.join(", ");
}

function pct(n, total) {
  return total ? Math.round((n / total) * 100) : 0;
}

function renderAnalyticsCard(targetId, title, icon, entries, emptyLabel, clickableField) {
  const target = $(targetId);
  const total = entries.reduce((sum, [,n]) => sum + n, 0);
  if (!target) return;
  if (!total) {
    target.innerHTML = `<div class="analytics-head"><div class="analytics-title"><span class="analytics-icon">${icon}</span>${escapeHtml(title)}</div><span class="analytics-total">Total Cases 0</span></div><div class="analytics-empty">${escapeHtml(emptyLabel)}</div>`;
    return;
  }

  const colors = clickableField === "status"
    ? ["#20b978", "#f6b11b", "#ef4b4b"]
    : ["#1987e8", "#ff8b18", "#22b77a", "#8d4ee8", "#13a6c7", "#7d91aa", "#ef6c91", "#4c78d0", "#a67c52", "#6b7280"];
  const gradient = donutGradient(entries, colors);
  const legend = entries.map(([name,n], i) => {
    const value = String(name);
    return `<button class="legend-item" type="button" data-analytics-field="${escapeHtml(clickableField)}" data-analytics-value="${escapeHtml(value)}" title="Click to filter by ${escapeHtml(value)}">
      <span class="legend-dot" style="background:${colors[i % colors.length]}"></span>
      <span class="legend-name">${escapeHtml(value)}</span>
      <span class="legend-count">${n}</span>
      <span class="legend-pct">${pct(n,total)}%</span>
    </button>`;
  }).join("");

  target.innerHTML = `
    <div class="analytics-head">
      <div class="analytics-title"><span class="analytics-icon">${icon}</span>${escapeHtml(title)}</div>
      <span class="analytics-total">Total Cases&nbsp; <b>${total}</b></span>
    </div>
    <div class="analytics-body">
      <div class="donut" style="background:conic-gradient(${gradient})">
        <div class="donut-center"><strong>${total}</strong><span>Total Cases</span></div>
      </div>
      <div class="legend-list">${legend}</div>
    </div>
    <div class="analytics-hint"><b>Click any item</b> to filter the dashboard. Other filters remain active.</div>
  `;

  target.querySelectorAll(".legend-item").forEach(btn => btn.addEventListener("click", () => {
    const field = btn.dataset.analyticsField;
    const value = btn.dataset.analyticsValue;
    const selectId = field === "status" ? "statusFilter" : field === "state" ? "stateFilter" : "clientFilter";
    const select = $(selectId);
    if (!select) return;
    const option = [...select.options].find(o => o.value.toLowerCase() === value.toLowerCase() || o.textContent.toLowerCase() === value.toLowerCase());
    if (option) {
      select.value = option.value;
      currentPage = 1;
      render();
    }
  }));
}

function renderAnalytics(rows) {
  const completed = rows.filter(r => isCompletedStatus(r.status)).length;
  const cancelled = rows.filter(r => isCancelledStatus(r.status)).length;
  const pending = rows.filter(r => !isCompletedStatus(r.status) && !isCancelledStatus(r.status) && normalizeStatus(r.status)).length;

  const statusEntries = [
    ["Completed", completed],
    ["Pending", pending],
    ["Cancelled", cancelled]
  ].filter(([,n]) => n > 0);

  const stateCounts = {};
  const clientCounts = {};
  rows.forEach(r => {
    const state = normalizeState(r.state) || "NA";
    const client = normalizeClientName(r.clientName) || "NA";
    stateCounts[state] = (stateCounts[state] || 0) + 1;
    clientCounts[client] = (clientCounts[client] || 0) + 1;
  });

  const stateEntries = Object.entries(stateCounts).sort((a,b) => b[1] - a[1]);
  const clientEntries = Object.entries(clientCounts).sort((a,b) => b[1] - a[1]);

  renderAnalyticsCard("statusWiseCard", "Status Wise", "◔", statusEntries, "No status data", "status");
  renderAnalyticsCard("stateWiseCard", "State Wise", "●", stateEntries, "No state data", "state");
  renderAnalyticsCard("clientWiseCard", "Client Wise", "♣", clientEntries, "No client data", "client");
}

function render() {
  // Rebuild filter options on every render so Client/TPA/State never remain blank
  // even if data arrives after the initial page load.
  loadFilterOptions();
  const rows = getFiltered();
  const due = rows.filter(r => followStatus(r.nextFollowUpTime) === "Due" && !isCompletedStatus(r.status) && !isCancelledStatus(r.status)).length;
  const completed = rows.filter(r => isCompletedStatus(r.status)).length;
  const cancelled = rows.filter(r => isCancelledStatus(r.status)).length;
  const pending = rows.filter(r => !isCompletedStatus(r.status) && !isCancelledStatus(r.status) && normalizeStatus(r.status)).length;

  $("total").textContent = rows.length;
  $("pending").textContent = pending;
  $("due").textContent = due;
  $("completedKpi").textContent = completed;
  $("cancelledKpi").textContent = cancelled;
  $("resultCount").textContent = `Showing ${rows.length ? ((currentPage-1)*PAGE_SIZE)+1 : 0} to ${Math.min(currentPage*PAGE_SIZE, rows.length)} of ${rows.length} cases`;

  const maxPage = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  if (currentPage > maxPage) currentPage = maxPage;
  const pageRows = rows.slice((currentPage-1)*PAGE_SIZE, currentPage*PAGE_SIZE);

  renderAnalytics(rows);

  $("caseBody").innerHTML = pageRows.length ? pageRows.map(r => {
    const fs = followStatus(r.nextFollowUpTime);
    const cls = fs === "Due" ? "due" : fs === "Upcoming" ? "upcoming" : "no";
    return `<tr>
      <td>${escapeHtml(r.clientName || "NA")}</td>
      <td>${escapeHtml(dateOnly(r.requestDate) || r.requestDate || "NA")}</td>
      <td>${escapeHtml(r.zone || "NA")}</td>
      <td>${escapeHtml(r.state || "NA")}</td>
      <td>${escapeHtml(r.city || "NA")}</td>
      <td><strong>${escapeHtml(r.vehicleNumber || "NA")}</strong></td>
      <td>${escapeHtml(r.tpaName || "NA")}</td>
      <td><span class="badge">${escapeHtml(normalizeStatus(r.status) || "NA")}</span></td>
      <td class="remarks-cell" title="${escapeHtml(r.remarks || "NA")}">${escapeHtml(r.remarks || "NA")}</td>
      <td><span class="badge ${cls}">${escapeHtml(formatFollow(r.nextFollowUpTime))}</span></td>
    </tr>`;
  }).join("") : `<tr><td colspan="10" class="empty">No cases found for the selected filters.</td></tr>`;

  const pages = [];
  for (let p=1; p<=maxPage; p++) pages.push(`<button class="page-number ${p===currentPage?'active':''}" data-page="${p}">${p}</button>`);
  $("pageNumbers").innerHTML = pages.join("");
  $("prevPage").disabled = currentPage === 1;
  $("nextPage").disabled = currentPage === maxPage;
  document.querySelectorAll(".page-number").forEach(btn => btn.addEventListener("click", () => { currentPage = Number(btn.dataset.page); render(); }));
}

async function sync() {
  try {
    const res = await fetch("/api/cases", {cache:"no-store", credentials:"same-origin"});
    const data = await res.json().catch(()=>({}));
    if (res.status === 401 || res.status === 403) {
      currentUser = null;
      showLogin("Your portal session expired. Please sign in again.");
      initGoogleLogin();
      return false;
    }
    if (!res.ok || !data.success) throw new Error(data.error || "Sync failed");
    allRows = (data.rows || []).map(canonicalizeRow);
    loadFilterOptions();
    render();
    $("syncDot").style.background = "#23c483";
    $("syncText").textContent = "Live";
    $("syncTime").textContent = data.lastSync ? `Last sync: ${new Date(data.lastSync).toLocaleTimeString("en-IN")}` : "Waiting";
    return true;
  } catch (e) {
    $("syncDot").style.background = "#d92d20";
    $("syncText").textContent = "Sync error";
    $("syncTime").textContent = e.message;
    return false;
  }
}

async function forceSync() {
  $("syncText").textContent = "Syncing...";
  try {
    const res = await fetch("/api/sync", {method:"POST", credentials:"same-origin"});
    const data = await res.json().catch(()=>({}));
    if (res.status === 401 || res.status === 403) {
      currentUser = null;
      showLogin("Your portal session expired. Please sign in again.");
      initGoogleLogin();
      return false;
    }
    if (!res.ok || !data.success) throw new Error(data.error || "Sync failed");
    allRows = (data.rows || []).map(canonicalizeRow);
    loadFilterOptions();
    render();
    $("syncDot").style.background = "#23c483";
    $("syncText").textContent = "Live";
    $("syncTime").textContent = `Last sync: ${new Date(data.lastSync).toLocaleTimeString("en-IN")}`;
    return true;
  } catch(e) {
    $("syncDot").style.background = "#d92d20";
    $("syncText").textContent = "Sync error";
    $("syncTime").textContent = e.message;
    return false;
  }
}

function exportCsv() {
  const rows = getFiltered();
  const headers = ["Client Name","Request Date","Zone","State","City","Vehicle Number","TPA Name","Remarks","Status","Next Follow-up Time","Source"];
  const keys = ["clientName","requestDate","zone","state","city","vehicleNumber","tpaName","remarks","status","nextFollowUpTime","source"];
  const csv = [
    headers,
    ...rows.map(r => keys.map(k => r[k] ?? ""))
  ].map(row => row.map(v => `"${String(v).replace(/"/g,'""')}"`).join(",")).join("\r\n");
  const blob = new Blob(["\ufeff" + csv], {type:"text/csv;charset=utf-8"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "North_Followup_Filtered_Cases.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

["search","clientFilter","tpaFilter","statusFilter","stateFilter","followFilter","dateFrom","dateTo"].forEach(id => {
  const el=$(id);
  if(el) el.addEventListener("input", () => { currentPage = 1; render(); });
});
$("applyFilters")?.addEventListener("click", () => { currentPage = 1; render(); });
$("filterRefresh")?.addEventListener("click", () => { currentPage = 1; forceSync(); });
$("exportBtn").addEventListener("click", exportCsv);
$("clearFilters").addEventListener("click", () => {
  ["search","dateFrom","dateTo"].forEach(id => $(id).value = "");
  ["clientFilter","tpaFilter","statusFilter","stateFilter","followFilter"].forEach(id => $(id).value = "");
  currentPage = 1;
  render();
});
$("prevPage").addEventListener("click", () => { if (currentPage > 1) { currentPage--; render(); } });
$("nextPage").addEventListener("click", () => { const maxPage = Math.max(1, Math.ceil(getFiltered().length / PAGE_SIZE)); if (currentPage < maxPage) { currentPage++; render(); } });

setInterval(()=>{ if(currentUser) sync(); }, 10000);

// --- Google login + admin access control ---
let currentUser = null;
function showLogin(message=""){
  $("loginGate").style.display = "grid";
  $("loginMessage").textContent = message;
  document.querySelector(".main").style.visibility = "hidden";
  document.querySelector(".sidebar").style.visibility = "hidden";
}
function hideLogin(){
  $("loginGate").style.display = "none";
  document.querySelector(".main").style.visibility = "visible";
  document.querySelector(".sidebar").style.visibility = "visible";
}
function setUser(user){
  currentUser=user;
  $("userName").textContent=user.name||user.email;
  $("userRole").textContent=user.admin ? "Administrator" : "Coordinator";
  if(user.picture){$("userAvatar").innerHTML=`<img src="${escapeHtml(user.picture)}" alt="" style="width:38px;height:38px;border-radius:50%;object-fit:cover">`;}
  $("adminBtn").hidden=true;
  $("userManagementNav").hidden=!user.admin;
}
async function initGoogleLogin(){
  try{
    const cfg=await fetch("/api/auth/config",{cache:"no-store"}).then(r=>r.json());
    if(!cfg.clientId){showLogin("Google login is not configured yet. Admin needs to add GOOGLE_CLIENT_ID in Render.");return;}
    const wait=()=>{
      if(window.google?.accounts?.id){
        google.accounts.id.initialize({client_id:cfg.clientId,callback:handleGoogleCredential,auto_select:false});
        google.accounts.id.renderButton($("googleButton"),{theme:"outline",size:"large",shape:"rectangular",text:"signin_with",logo_alignment:"left",width:320});
      } else setTimeout(wait,250);
    }; wait();
  }catch(e){showLogin("Unable to load Google sign-in.");}
}
async function handleGoogleCredential(response){
  $("loginMessage").textContent="Signing in...";
  try{
    const res=await fetch("/api/auth/google",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({credential:response.credential})});
    const data=await res.json();
    if(!res.ok||!data.success) throw new Error(data.message || (data.error==="ACCESS_DISABLED"?"Your access is not active. Contact an admin.":"Google login failed."));
    setUser(data.user); hideLogin(); await sync();
  }catch(e){$("loginMessage").textContent=e.message;}
}
async function checkSession(){
  try{
    const data=await fetch("/api/auth/me",{cache:"no-store"}).then(r=>r.json());
    if(data.loggedIn && data.user){setUser(data.user);hideLogin();await sync();}
    else {showLogin();initGoogleLogin();}
  }catch(e){showLogin("Unable to connect to portal server.");}
}
async function logout(){
  await fetch("/api/auth/logout",{method:"POST"});
  currentUser=null; location.reload();
}
async function openAdmin(){
  if(!currentUser?.admin)return;
  $("adminModal").hidden=false;
  await loadUsers();
}
function renderUsers(users){
  $("userList").innerHTML=users.map(u=>{
    const admin=!!u.admin;
    const active=!!u.active;
    return `<div class="user-row"><div class="user-meta"><strong>${escapeHtml(u.name||u.email)}</strong><span>${escapeHtml(u.email)}</span><span class="access-badge ${active?'active':'inactive'}">${active?'Active':'Deactive'}${admin?' • Admin':''}</span></div><button class="toggle-access ${active?'deactivate':'activate'}" data-email="${escapeHtml(u.email)}" data-active="${active}" ${admin?'disabled':''}>${admin?'Admin':active?'Deactivate':'Activate'}</button></div>`;
  }).join("") || '<div class="empty">No users yet.</div>';
  document.querySelectorAll(".toggle-access:not([disabled])").forEach(btn=>btn.addEventListener("click",()=>toggleUser(btn.dataset.email,btn.dataset.active!=="true")));
}
async function loadUsers(){
  try{const data=await fetch("/api/users",{cache:"no-store"}).then(r=>r.json()); if(!data.success)throw new Error(data.error); renderUsers(data.users||[]);}catch(e){$("userList").innerHTML=`<div class="empty">Unable to load users: ${escapeHtml(e.message)}</div>`;}
}
async function toggleUser(email,active){
  if(!confirm(`${active?'Activate':'Deactivate'} ${email}?`))return;
  const res=await fetch("/api/users/toggle",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,active})});
  const data=await res.json(); if(!data.success){alert(data.message||data.error||"Unable to update user");return;} await loadUsers();
}

$("manualRefresh")?.addEventListener("click",()=>{currentPage=1;forceSync();});
$("logoutBtn")?.addEventListener("click",logout);
$("adminBtn")?.addEventListener("click",openAdmin);
$("userManagementNav")?.addEventListener("click",(e)=>{e.preventDefault();openAdmin();});
$("closeAdmin")?.addEventListener("click",(e)=>{e.preventDefault();e.stopPropagation();$("adminModal").hidden=true;});
$("adminModal")?.addEventListener("click",e=>{if(e.target.id==="adminModal")$("adminModal").hidden=true;});
checkSession();
