let allCases = [];
const PAGE_SIZE = 25;
let currentPage = 1;
const $ = id => document.getElementById(id);

function clean(v) {
  return String(v ?? "").replace(/^\uFEFF/, "").trim();
}

function normalizeClient(v, source = "") {
  const s = clean(v).replace(/\s+/g, " ");
  if (s) return s;
  // Vastu rows are intentionally sourced from the Vastu sheet and the
  // North Follow-up Dashboard uses this fixed client name for them.
  if (clean(source).toLowerCase() === "vastu data october") return "Vastu Finance Retail";
  return "Unknown";
}

function normalizeStatus(v) {
  const raw = clean(v);
  const s = raw.toLowerCase().replace(/\s+/g, "");
  if (["inspectiondone", "inspectioncomplete", "completed", "complete"].includes(s)) return "Completed";
  if (["cancelled", "canceled"].includes(s)) return "Cancelled";
  return raw || "Pending";
}

/* Parse Google Sheets / portal dates without timezone shifting. */
function parseRequestDate(value) {
  const s = clean(value);
  if (!s) return null;

  let m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})(?:[T\s].*)?$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));

  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})(?:\s.*)?$/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));

  // Handles values such as "1 October 2026", "30 September 2026"
  const monthDate = new Date(s);
  if (!Number.isNaN(monthDate.getTime())) {
    return new Date(monthDate.getFullYear(), monthDate.getMonth(), monthDate.getDate());
  }

  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 20000 && n < 80000) {
      const epoch = new Date(1899, 11, 30);
      const d = new Date(epoch.getTime() + n * 86400000);
      return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }
  }
  return null;
}

function parseDateInput(value) {
  const s = clean(value);
  if (!s) return null;
  // Native HTML date inputs return YYYY-MM-DD.
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  // Backward compatibility if a text date is ever supplied.
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const day = Number(m[1]), month = Number(m[2]), year = Number(m[3]);
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}

function formatDate(v) {
  const d = parseRequestDate(v);
  if (!d) return clean(v) || "NA";
  return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
}

function followStatus(v) {
  const s = clean(v);
  if (!s) return "No Follow-up";
  const d = new Date(s);
  if (!Number.isNaN(d.getTime()) && d.getTime() <= Date.now()) return "Due";
  return "Upcoming";
}

/*
  V5 API adapter.
  The deployed Render API currently returns camelCase rows such as:
  {clientName, requestDate, state, vehicleNumber, tpaName, ...}
  Older versions returned display-key cases such as:
  {"Client Name", "Request Date", ...}
  Accept both formats so a backend response shape cannot blank the portal.
*/
function normalizeApiRow(c) {
  const source = clean(c.source ?? c.Source);
  const client = c.clientName ?? c["Client Name"];
  const requestDate = c.requestDate ?? c["Request Date"];
  const zone = c.zone ?? c.Zone;
  const state = c.state ?? c.State;
  const city = c.city ?? c.City;
  const vehicleNumber = c.vehicleNumber ?? c["Vehicle Number"];
  const tpaName = c.tpaName ?? c["TPA Name"];
  const remarks = c.remarks ?? c.Remarks;
  const status = c.status ?? c.Status;
  const nextFollowUpTime = c.nextFollowUpTime ?? c["Next Follow-up Time"];

  return {
    "Client Name": normalizeClient(client, source),
    "Request Date": clean(requestDate),
    "Zone": clean(zone),
    "State": clean(state),
    "City": clean(city),
    "Vehicle Number": clean(vehicleNumber),
    "TPA Name": clean(tpaName),
    "Remarks": clean(remarks),
    "Status": normalizeStatus(status),
    "Next Follow-up Time": clean(nextFollowUpTime),
    "Source": source
  };
}

async function load() {
  $("syncText").textContent = "Syncing...";
  try {
    const r = await fetch("/api/cases?ts=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error("API " + r.status);
    const j = await r.json();

    // IMPORTANT: current deployed API returns `rows`; older API returned `cases`.
    const rawRows = Array.isArray(j.rows) ? j.rows : (Array.isArray(j.cases) ? j.cases : []);
    allCases = rawRows.map(normalizeApiRow);

    $("syncText").textContent = j.lastSync
      ? "Live • " + new Date(j.lastSync).toLocaleTimeString()
      : `Live • ${allCases.length} cases`;

    populateFilters();
    render();
  } catch (e) {
    console.error("Portal load error", e);
    $("syncText").textContent = "Connection error";
    allCases = [];
    populateFilters();
    render();
  }
}

function unique(field) {
  return [...new Set(
    allCases.map(c => clean(c[field])).filter(Boolean)
  )].sort((a,b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

function fillSelect(id, values) {
  const el = $(id);
  const old = el.value;
  const first = el.options[0];
  el.innerHTML = "";
  el.appendChild(first);
  values.forEach(v => {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = v;
    el.appendChild(o);
  });
  if ([...el.options].some(o => o.value === old)) el.value = old;
}

function populateFilters() {
  fillSelect("client", unique("Client Name"));
  fillSelect("tpa", unique("TPA Name"));
  fillSelect("status", unique("Status"));
  fillSelect("state", unique("State"));
}

function filtered() {
  const q = clean($("search").value).toLowerCase();
  const client = $("client").value;
  const tpa = $("tpa").value;
  const status = $("status").value;
  const state = $("state").value;
  const follow = $("follow").value;
  const fromD = parseDateInput($("fromDate").value);
  const toD = parseDateInput($("toDate").value);

  return allCases.filter(c => {
    const hay = [
      c["Client Name"], c["Request Date"], c["Zone"], c["State"], c["City"],
      c["Vehicle Number"], c["TPA Name"], c["Remarks"], c["Status"], c["Source"]
    ].join(" ").toLowerCase();

    if (q && !hay.includes(q)) return false;
    if (client && clean(c["Client Name"]) !== client) return false;
    if (tpa && clean(c["TPA Name"]) !== tpa) return false;
    if (status && normalizeStatus(c["Status"]) !== status) return false;
    if (state && clean(c["State"]) !== state) return false;

    const fs = followStatus(c["Next Follow-up Time"]);
    if (follow && fs !== follow) return false;

    const rd = parseRequestDate(c["Request Date"]);
    if (fromD && (!rd || rd < fromD)) return false;
    if (toD && (!rd || rd > toD)) return false;
    return true;
  });
}

function render() {
  const rows = filtered();

  $("total").textContent = rows.length;
  $("due").textContent = rows.filter(c => followStatus(c["Next Follow-up Time"]) === "Due").length;
  $("pending").textContent = rows.filter(c => normalizeStatus(c["Status"]) === "Pending").length;
  $("completed").textContent = rows.filter(c => normalizeStatus(c["Status"]) === "Completed").length;
  $("cancelled").textContent = rows.filter(c => normalizeStatus(c["Status"]) === "Cancelled").length;

  const counts = {};
  rows.forEach(c => {
    const s = normalizeStatus(c["Status"]);
    counts[s] = (counts[s] || 0) + 1;
  });
  drawBars("statusChart", counts);

  const states = {};
  rows.forEach(c => {
    const s = clean(c["State"]) || "NA";
    states[s] = (states[s] || 0) + 1;
  });
  drawBars("stateChart", states);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;

  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const pageRows = rows.slice(startIndex, startIndex + PAGE_SIZE);

  $("tbody").innerHTML = "";
  if (!pageRows.length) {
    $("tbody").innerHTML = '<tr><td colspan="9" class="empty">No cases found for the selected filters/date range.</td></tr>';
  } else {
    pageRows.forEach(c => {
      const tr = document.createElement("tr");
      tr.innerHTML =
        `<td>${esc(c["Client Name"])}</td>` +
        `<td>${esc(c["State"])}</td>` +
        `<td>${esc(c["Vehicle Number"])}</td>` +
        `<td>${esc(c["TPA Name"])}</td>` +
        `<td><span class="pill">${esc(normalizeStatus(c["Status"]))}</span></td>` +
        `<td>${esc(formatDate(c["Request Date"]))}</td>` +
        `<td>${esc(c["Remarks"])}</td>` +
        `<td>${esc(followStatus(c["Next Follow-up Time"]))}</td>` +
        `<td>${esc(c["Next Follow-up Time"] || "NA")}</td>`;
      $("tbody").appendChild(tr);
    });
  }

  renderPagination(rows.length, totalPages);
}

function renderPagination(totalRows, totalPages) {
  let box = $("pagination");

  if (!box) {
    box = document.createElement("div");
    box.id = "pagination";
    box.className = "pagination";
    const tablewrap = document.querySelector(".tablewrap");
    tablewrap.insertAdjacentElement("afterend", box);
  }

  if (totalRows <= PAGE_SIZE) {
    box.innerHTML = "";
    box.style.display = "none";
    return;
  }

  box.style.display = "flex";

  const start = (currentPage - 1) * PAGE_SIZE + 1;
  const end = Math.min(currentPage * PAGE_SIZE, totalRows);

  box.innerHTML =
    `<div class="pageinfo">Showing ${start}-${end} of ${totalRows} cases</div>` +
    `<div class="pagecontrols">` +
      `<button type="button" class="pagebtn" id="prevPage" ${currentPage === 1 ? "disabled" : ""}>← Previous</button>` +
      `<span class="pageindicator">Page ${currentPage} of ${totalPages}</span>` +
      `<button type="button" class="pagebtn" id="nextPage" ${currentPage === totalPages ? "disabled" : ""}>Next →</button>` +
    `</div>`;

  $("prevPage").onclick = () => {
    if (currentPage > 1) {
      currentPage--;
      render();
      document.querySelector(".tablecard").scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  $("nextPage").onclick = () => {
    if (currentPage < totalPages) {
      currentPage++;
      render();
      document.querySelector(".tablecard").scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };
}

function drawBars(id, obj) {
  const el = $(id);
  el.innerHTML = "";
  const vals = Object.entries(obj).sort((a,b) => b[1] - a[1]).slice(0, 12);
  if (!vals.length) {
    el.innerHTML = '<div class="empty">No data</div>';
    return;
  }
  const max = Math.max(...vals.map(x => x[1]), 1);
  vals.forEach(([name, n]) => {
    const row = document.createElement("div");
    row.className = "bar";
    row.innerHTML =
      `<label title="${esc(name)}">${esc(name)}</label>` +
      `<i style="width:${Math.max(2, n / max * 62)}%"></i>` +
      `<b>${n}</b>`;
    el.appendChild(row);
  });
}

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, m => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  }[m]));
}

function bindDateInput(id) {
  const el = $(id);
  // Native date picker supplies a calendar and stores the value as YYYY-MM-DD.
  el.addEventListener("change", () => { currentPage = 1; render(); });
}

["search","client","tpa","status","state","follow"].forEach(id => {
  $(id).addEventListener(id === "search" ? "input" : "change", () => {
    currentPage = 1;
    render();
  });
});

bindDateInput("fromDate");
bindDateInput("toDate");

$("clear").onclick = () => {
  ["search","client","tpa","status","state","follow","fromDate","toDate"].forEach(id => $(id).value = "");
  currentPage = 1;
  populateFilters();
  render();
};

$("refresh").onclick = () => { currentPage = 1; load(); };

$("download").onclick = () => {
  const rows = filtered();
  const headers = ["Client Name","State","Vehicle Number","TPA Name","Status","Request Date","Remarks","Follow-up","Next Follow-up"];
  const lines = [headers.join(",")].concat(
    rows.map(c => [
      c["Client Name"], c["State"], c["Vehicle Number"], c["TPA Name"],
      normalizeStatus(c["Status"]), formatDate(c["Request Date"]), c["Remarks"],
      followStatus(c["Next Follow-up Time"]), c["Next Follow-up Time"] || "NA"
    ].map(v => `"${String(v ?? "").replace(/"/g,'""')}"`).join(","))
  );
  const blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "North_Followup_Filtered_Cases.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

load();
setInterval(load, 10000);
