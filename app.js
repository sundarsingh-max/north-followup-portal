let allCases = [];
const $ = id => document.getElementById(id);

function clean(v){ return String(v ?? "").trim(); }

function normalizeClient(v){
  const s = clean(v);
  if (!s) return "Unknown";
  return s.replace(/\s+/g," ").trim();
}

function normalizeStatus(v){
  const s = clean(v).toLowerCase().replace(/\s+/g," ");
  if (s === "inspectiondone" || s === "inspection done") return "Completed";
  if (s === "completed" || s === "complete") return "Completed";
  if (s === "cancelled" || s === "canceled") return "Cancelled";
  return clean(v) || "Pending";
}

/* Robustly parses common Google Sheets/CSV date representations.
   Returns a local-calendar Date at midnight, or null. */
function parseRequestDate(value){
  const s = clean(value);
  if (!s) return null;

  // yyyy-mm-dd (optionally with time)
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
  if (m) return new Date(Number(m[1]), Number(m[2])-1, Number(m[3]));

  // dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})(?:\s.*)?$/);
  if (m) return new Date(Number(m[3]), Number(m[2])-1, Number(m[1]));

  // Google Sheets serial number
  if (/^\d+(\.\d+)?$/.test(s)){
    const n = Number(s);
    if (n > 20000 && n < 80000){
      const epoch = new Date(1899,11,30);
      const d = new Date(epoch.getTime() + n*86400000);
      return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }
  }

  // Fallback for English month strings
  const d = new Date(s);
  if (!Number.isNaN(d.getTime()))
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());

  return null;
}

function dayKey(d){
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function formatDate(v){
  const d = parseRequestDate(v);
  return d ? d.toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"}) : (clean(v)||"NA");
}

function followStatus(v){
  if (!clean(v)) return "No Follow-up";
  const d = new Date(v);
  if (!Number.isNaN(d.getTime()) && d.getTime() <= Date.now()) return "Due";
  return "Upcoming";
}

function normalizedCase(c){
  return {
    ...c,
    "Client Name": normalizeClient(c["Client Name"]),
    "Status": normalizeStatus(c["Status"])
  };
}

async function load(){
  $("syncText").textContent = "Syncing...";
  try{
    const r = await fetch("/api/cases?ts="+Date.now());
    const j = await r.json();
    allCases = (j.cases || []).map(normalizedCase);
    $("syncText").textContent = j.lastSync ? "Live • "+new Date(j.lastSync).toLocaleTimeString() : "Live";
    populateFilters();
    render();
  }catch(e){
    $("syncText").textContent = "Connection error";
  }
}

function unique(field){
  return [...new Set(allCases.map(c=>clean(c[field])).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
}

function fillSelect(id, values){
  const el=$(id), old=el.value;
  const first=el.options[0];
  el.innerHTML="";
  el.appendChild(first);
  values.forEach(v=>{const o=document.createElement("option");o.value=v;o.textContent=v;el.appendChild(o)});
  if([...el.options].some(o=>o.value===old)) el.value=old;
}

function populateFilters(){
  fillSelect("client",unique("Client Name"));
  fillSelect("tpa",unique("TPA Name"));
  fillSelect("status",unique("Status"));
  fillSelect("state",unique("State"));
}

function filtered(){
  const q=clean($("search").value).toLowerCase();
  const client=$("client").value, tpa=$("tpa").value, status=$("status").value, state=$("state").value, follow=$("follow").value;
  const from=$("fromDate").value, to=$("toDate").value;
  const fromD=from ? new Date(from+"T00:00:00") : null;
  const toD=to ? new Date(to+"T23:59:59.999") : null;

  return allCases.filter(c=>{
    const hay=[c["Client Name"],c["Request Date"],c["Zone"],c["State"],c["City"],c["Vehicle Number"],c["TPA Name"],c["Remarks"],c["Status"],c["Source"]].join(" ").toLowerCase();
    if(q && !hay.includes(q)) return false;
    if(client && c["Client Name"]!==client) return false;
    if(tpa && clean(c["TPA Name"])!==tpa) return false;
    if(status && c["Status"]!==status) return false;
    if(state && clean(c["State"])!==state) return false;
    const fs=followStatus(c["Next Follow-up Time"]);
    if(follow && fs!==follow) return false;

    const rd=parseRequestDate(c["Request Date"]);
    if(fromD && (!rd || rd < new Date(fromD.getFullYear(),fromD.getMonth(),fromD.getDate()))) return false;
    if(toD && (!rd || rd > new Date(toD.getFullYear(),toD.getMonth(),toD.getDate()))) return false;
    return true;
  });
}

function render(){
  const rows=filtered();
  $("total").textContent=rows.length;
  $("due").textContent=rows.filter(c=>followStatus(c["Next Follow-up Time"])==="Due").length;
  $("pending").textContent=rows.filter(c=>normalizeStatus(c["Status"])==="Pending").length;
  $("completed").textContent=rows.filter(c=>normalizeStatus(c["Status"])==="Completed").length;
  $("cancelled").textContent=rows.filter(c=>normalizeStatus(c["Status"])==="Cancelled").length;

  const counts={};
  rows.forEach(c=>counts[c["Status"]]=(counts[c["Status"]]||0)+1);
  drawBars("statusChart",counts);

  const states={};
  rows.forEach(c=>states[clean(c["State"])||"NA"]=(states[clean(c["State"])||"NA"]||0)+1);
  drawBars("stateChart",states);

  $("tbody").innerHTML="";
  if(!rows.length){
    $("tbody").innerHTML='<tr><td colspan="9" class="empty">No cases found for the selected filters/date range.</td></tr>';
    return;
  }
  rows.forEach(c=>{
    const tr=document.createElement("tr");
    tr.innerHTML=`<td>${esc(c["Client Name"])}</td><td>${esc(c["State"])}</td><td>${esc(c["Vehicle Number"])}</td><td>${esc(c["TPA Name"])}</td><td><span class="pill">${esc(c["Status"])}</span></td><td>${esc(formatDate(c["Request Date"]))}</td><td>${esc(c["Remarks"])}</td><td>${esc(followStatus(c["Next Follow-up Time"]))}</td><td>${esc(c["Next Follow-up Time"]||"NA")}</td>`;
    $("tbody").appendChild(tr);
  });
}

function drawBars(id,obj){
  const el=$(id); el.innerHTML="";
  const vals=Object.entries(obj).sort((a,b)=>b[1]-a[1]).slice(0,12);
  if(!vals.length){el.innerHTML='<div class="empty">No data</div>';return}
  const max=Math.max(...vals.map(x=>x[1]),1);
  vals.forEach(([name,n])=>{
    const row=document.createElement("div");row.className="bar";
    row.innerHTML=`<label title="${esc(name)}">${esc(name)}</label><i style="width:${Math.max(2,n/max*62)}%"></i><b>${n}</b>`;
    el.appendChild(row);
  });
}

function esc(v){return String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]))}

["search","client","tpa","status","state","follow","fromDate","toDate"].forEach(id=>$(id).addEventListener(id==="search"?"input":"change",render));
$("clear").onclick=()=>{["search","client","tpa","status","state","follow","fromDate","toDate"].forEach(id=>$(id).value="");render()};
$("refresh").onclick=load;

$("download").onclick=()=>{
  const rows=filtered();
  const headers=["Client Name","State","Vehicle Number","TPA Name","Status","Request Date","Remarks","Follow-up","Next Follow-up"];
  const lines=[headers.join(",")].concat(rows.map(c=>[
    c["Client Name"],c["State"],c["Vehicle Number"],c["TPA Name"],c["Status"],formatDate(c["Request Date"]),c["Remarks"],followStatus(c["Next Follow-up Time"]),c["Next Follow-up Time"]||"NA"
  ].map(v=>`"${String(v??"").replace(/"/g,'""')}"`).join(",")));
  const blob=new Blob(["\ufeff"+lines.join("\r\n")],{type:"text/csv;charset=utf-8"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="North_Followup_Filtered_Cases.csv";a.click();
};

load();
setInterval(load,10000);
