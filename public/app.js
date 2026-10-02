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

function normalizeClientName(v) {
  return cleanText(v);
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

function renderBars(targetId, counts) {
  const entries = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,10);
  const max = Math.max(1, ...entries.map(x=>x[1]));
  $(targetId).innerHTML = entries.length ? entries.map(([name,n]) =>
    `<div class="bar-row"><div title="${escapeHtml(name)}">${escapeHtml(name).slice(0,20)}</div><div class="bar-bg"><div class="bar-fill" style="width:${(n/max)*100}%"></div></div><strong>${n}</strong></div>`
  ).join("") : `<div class="empty">No data</div>`;
}

function render() {
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

  const statusCounts = {}, stateCounts = {};
  rows.forEach(r => {
    const displayStatus = normalizeStatus(r.status) || "Blank";
    statusCounts[displayStatus] = (statusCounts[displayStatus] || 0) + 1;
    stateCounts[r.state || "Blank"] = (stateCounts[r.state || "Blank"] || 0) + 1;
  });
  renderBars("statusChart", statusCounts);
  renderBars("stateChart", stateCounts);

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
      <td title="${escapeHtml(r.remarks || "NA")}">${escapeHtml(r.remarks || "NA").slice(0,35)}</td>
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
    const res = await fetch("/api/cases", {cache:"no-store"});
    const data = await res.json();
    if (!data.success) throw new Error(data.error || "Sync failed");
    allRows = (data.rows || []).map(r => ({...r, clientName: normalizeClientName(r.clientName), tpaName: cleanText(r.tpaName), state: cleanText(r.state), status: normalizeStatus(r.status)}));
    loadFilterOptions();
    render();
    $("syncDot").style.background = "#23c483";
    $("syncText").textContent = "Live";
    $("syncTime").textContent = data.lastSync ? `Last sync: ${new Date(data.lastSync).toLocaleTimeString("en-IN")}` : "Waiting";
  } catch (e) {
    $("syncDot").style.background = "#d92d20";
    $("syncText").textContent = "Sync error";
    $("syncTime").textContent = e.message;
  }
}

async function forceSync() {
  $("syncText").textContent = "Syncing...";
  try {
    const res = await fetch("/api/sync", {method:"POST"});
    const data = await res.json();
    if (!data.success) throw new Error(data.error || "Sync failed");
    allRows = (data.rows || []).map(r => ({...r, clientName: normalizeClientName(r.clientName), tpaName: cleanText(r.tpaName), state: cleanText(r.state), status: normalizeStatus(r.status)}));
    loadFilterOptions();
    render();
    $("syncDot").style.background = "#23c483";
    $("syncText").textContent = "Live";
    $("syncTime").textContent = `Last sync: ${new Date(data.lastSync).toLocaleTimeString("en-IN")}`;
  } catch(e) {
    $("syncDot").style.background = "#d92d20";
    $("syncText").textContent = "Sync error";
    $("syncTime").textContent = e.message;
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

["search","clientFilter","tpaFilter","statusFilter","stateFilter","followFilter","dateFrom","dateTo"].forEach(id => $(id).addEventListener("input", () => { currentPage = 1; render(); }));
$("refreshBtn").addEventListener("click", () => { currentPage = 1; forceSync(); });
$("exportBtn").addEventListener("click", exportCsv);
$("clearFilters").addEventListener("click", () => {
  ["search","dateFrom","dateTo"].forEach(id => $(id).value = "");
  ["clientFilter","tpaFilter","statusFilter","stateFilter","followFilter"].forEach(id => $(id).value = "");
  currentPage = 1;
  render();
});
$("prevPage").addEventListener("click", () => { if (currentPage > 1) { currentPage--; render(); } });
$("nextPage").addEventListener("click", () => { const maxPage = Math.max(1, Math.ceil(getFiltered().length / PAGE_SIZE)); if (currentPage < maxPage) { currentPage++; render(); } });

sync();
setInterval(sync, 10000);
