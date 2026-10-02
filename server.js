const express = require("express");
const cors = require("cors");
const path = require("path");
const https = require("https");

const app = express();
const PORT = process.env.PORT || 3000;
const SHEET_ID = process.env.GOOGLE_SHEET_ID || "1xXbamQZ1rsZAxK3bMu-9vXq__n1yYvLVrqVqRxCePNQ";
const SHEET_TAB = process.env.GOOGLE_SHEET_TAB || "Dashboard";
const SYNC_INTERVAL_MS = Number(process.env.SYNC_INTERVAL_MS || 10000);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function clean(v) {
  return String(v ?? "").replace(/^\uFEFF/, "").trim();
}
function normalizeSpaces(v) { return clean(v).replace(/\s+/g, " "); }
function normalizeStatus(v) {
  const raw = normalizeSpaces(v);
  const s = raw.toLowerCase().replace(/\s+/g, "");
  if (["inspectiondone", "inspectioncomplete", "completed", "complete"].includes(s)) return "Completed";
  if (["cancelled", "canceled"].includes(s)) return "Cancelled";
  return raw || "Pending";
}
function clientFromDashboard(rawClient, source) {
  const c = normalizeSpaces(rawClient);
  if (c) return c;
  if (normalizeSpaces(source).toLowerCase() === "vastu data october") return "Vastu Finance Retail";
  return "Unknown";
}

// CSV parser: supports quoted commas, quotes and embedded newlines.
function csvParse(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (c === '"' && quoted && n === '"') { cell += '"'; i++; continue; }
    if (c === '"') { quoted = !quoted; continue; }
    if (c === ',' && !quoted) { row.push(cell); cell = ""; continue; }
    if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && n === '\n') i++;
      row.push(cell); cell = "";
      if (row.some(v => clean(v) !== "")) rows.push(row);
      row = [];
      continue;
    }
    cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    if (row.some(v => clean(v) !== "")) rows.push(row);
  }
  return rows;
}

/*
  IMPORTANT: North Follow-up Dashboard is the ONLY portal source.
  The portal reads the Dashboard tab by fixed A:K positions:
  A Client Name
  B Request Date
  C Zone
  D State
  E City
  F Vehicle Number
  G TPA Name
  H Remarks
  I Status
  J Next Follow-up Time
  K Source

  We intentionally use positions instead of header-name matching because the
  user has merged the two source sheets into Column A and wants Dashboard to
  remain the single source of truth.
*/
function rowsToCases(rows) {
  if (!rows.length) return { cases: [], headers: [] };
  const headers = rows[0].map(clean);
  const cases = rows.slice(1).map((r, idx) => {
    const v = i => clean(r[i]);
    const source = v(10);
    return {
      id: `${idx + 1}-${v(5) || "case"}`,
      clientName: clientFromDashboard(v(0), source),
      requestDate: v(1),
      zone: v(2),
      state: v(3),
      city: v(4),
      vehicleNumber: v(5),
      tpaName: v(6),
      remarks: v(7),
      status: normalizeStatus(v(8)),
      nextFollowUpTime: v(9),
      source: source
    };
  });
  return { cases, headers };
}

function fetchSheet() {
  return new Promise((resolve, reject) => {
    // Google Sheets/GViz can otherwise return a display-formatted date such as
    // "30-Sep" even when the underlying cell is 30-Sep-2026. That loses the
    // year before it reaches the portal. Explicitly format the date columns in
    // the query so the API always sends the full year.
    const tq = "select A,B,C,D,E,F,G,H,I,J,K format B 'yyyy-MM-dd', J 'yyyy-MM-dd HH:mm:ss'";
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_TAB)}&tq=${encodeURIComponent(tq)}`;
    https.get(url, res => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", c => data += c);
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`Google Sheets HTTP ${res.statusCode}`));
        try { resolve(rowsToCases(csvParse(data))); }
        catch (e) { reject(e); }
      });
    }).on("error", reject);
  });
}

let cache = [];
let lastSync = null;
let syncError = null;
let sourceHeaders = [];

async function sync() {
  try {
    const result = await fetchSheet();
    cache = result.cases;
    sourceHeaders = result.headers;
    lastSync = new Date().toISOString();
    syncError = null;
    console.log(`Synced ${cache.length} cases from ${SHEET_TAB}`);
  } catch (e) {
    syncError = e.message;
    console.error("Sync error:", e.message);
  }
}

// Keep both names for compatibility with existing frontend versions.
app.get("/api/cases", (req, res) => {
  res.json({ success: true, rows: cache, cases: cache, lastSync, error: syncError });
});
app.post("/api/sync", async (req, res) => {
  await sync();
  res.json({ ok: !syncError, count: cache.length, lastSync, error: syncError });
});
app.get("/api/health", (req, res) => {
  res.json({ ok: !syncError, lastSync, rowCount: cache.length, error: syncError });
});
app.get("/api/debug", (req, res) => {
  res.json({
    sheetTab: SHEET_TAB,
    sourceHeaders,
    rowCount: cache.length,
    lastSync,
    error: syncError,
    sample: cache.slice(0, 5)
  });
});
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

sync();
setInterval(sync, SYNC_INTERVAL_MS);
app.listen(PORT, "0.0.0.0", () => console.log(`North Follow-up Portal V6 running on port ${PORT}`));
