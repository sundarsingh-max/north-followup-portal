let allRows = [];

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

function unique(field) {
  return [...new Set(allRows.map(r => r[field]).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
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
    if (client && r.clientName !== client) return false;
    if (tpa && r.tpaName !== tpa) return false;
    if (status && r.status !== status) return false;
    if (state && r.state !== state) return false;
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
  const due = rows.filter(r => followStatus(r.nextFollowUpTime) === "Due").length;
  const pending = rows.filter(r => /pending/i.test(r.status)).length;
  const completed = rows.filter(r => /inspection\s*done|completed|complete|final/i.test(r.status)).length;
  const cancelled = rows.filter(r => /cancel/i.test(r.status)).length;

  $("total").textContent = rows.length;
  $("due").textContent = due;
  $("pending").textContent = pending;
  $("completed").textContent = completed;
  $("cancelled").textContent = cancelled;
  $("resultCount").textContent = `${rows.length} case${rows.length === 1 ? "" : "s"}`;

  const statusCounts = {};
  const stateCounts = {};
  rows.forEach(r => {
    statusCounts[r.status || "Blank"] = (statusCounts[r.status || "Blank"] || 0) + 1;
    stateCounts[r.state || "Blank"] = (stateCounts[r.state || "Blank"] || 0) + 1;
  });
  renderBars("statusChart", statusCounts);
  renderBars("stateChart", stateCounts);

  $("caseBody").innerHTML = rows.length ? rows.map(r => {
    const fs = followStatus(r.nextFollowUpTime);
    const cls = fs === "Due" ? "due" : fs === "Upcoming" ? "upcoming" : "no";
    return `<tr>
      <td>${escapeHtml(r.clientName)}</td>
      <td>${escapeHtml(r.state)}</td>
      <td><strong>${escapeHtml(r.vehicleNumber)}</strong></td>
      <td>${escapeHtml(r.tpaName)}</td>
      <td><span class="badge">${escapeHtml(r.status || "NA")}</span></td>
      <td>${escapeHtml(dateOnly(r.requestDate) || r.requestDate || "NA")}</td>
      <td>${escapeHtml(r.remarks || "NA")}</td>
      <td><span class="badge ${cls}">${fs}</span></td>
      <td>${escapeHtml(formatFollow(r.nextFollowUpTime))}</td>
    </tr>`;
  }).join("") : `<tr><td colspan="9" class="empty">No cases found for the selected filters.</td></tr>`;
}

async function sync() {
  try {
    const res = await fetch("/api/cases", {cache:"no-store"});
    const data = await res.json();
    if (!data.success) throw new Error(data.error || "Sync failed");
    allRows = data.rows || [];
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
    allRows = data.rows || [];
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

["search","clientFilter","tpaFilter","statusFilter","stateFilter","followFilter","dateFrom","dateTo"].forEach(id => $(id).addEventListener("input", render));
$("refreshBtn").addEventListener("click", forceSync);
$("exportBtn").addEventListener("click", exportCsv);
$("clearFilters").addEventListener("click", () => {
  ["search","dateFrom","dateTo"].forEach(id => $(id).value = "");
  ["clientFilter","tpaFilter","statusFilter","stateFilter","followFilter"].forEach(id => $(id).value = "");
  render();
});

sync();
setInterval(sync, 10000);
