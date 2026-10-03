const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();
const app = express();
app.use(cors());
app.use(express.static(__dirname + "/public"));

const PORT = Number(process.env.PORT || 3000);
const SHEET_ID = process.env.GOOGLE_SHEET_ID || "1xXbamQZ1rsZAxK3bMu-9vXq__n1yYvLVrqVqRxCePNQ";
const SHEET_TAB = process.env.GOOGLE_SHEET_TAB || "Dashboard";
const SYNC_INTERVAL_MS = Number(process.env.SYNC_INTERVAL_MS || 10000);

let cache = { rows: [], lastSync: null, error: null, syncing: false };

function csvRows(text) {
  const rows=[]; let row=[], cell="", quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i], n=text[i+1];
    if(c==='"'){
      if(quoted && n==='"'){ cell+='"'; i++; }
      else quoted=!quoted;
    } else if(c===',' && !quoted){ row.push(cell); cell=""; }
    else if((c==='\n' || c==='\r') && !quoted){
      if(c==='\r' && n==='\n') i++;
      row.push(cell); cell="";
      if(row.some(v=>v.trim()!=="")) rows.push(row);
      row=[];
    } else cell+=c;
  }
  if(cell!=="" || row.length){ row.push(cell); rows.push(row); }
  return rows;
}
function norm(h){return String(h||"").trim().toLowerCase().replace(/\s+/g," ");}
function idx(headers,name){return headers.indexOf(norm(name));}
function normalize(values){
  if(values.length<2) return [];
  const h=values[0].map(norm);
  const I={
    client:idx(h,"Client Name"), request:idx(h,"Request Date"), zone:idx(h,"Zone"),
    state:idx(h,"State"), city:idx(h,"City"), vehicle:idx(h,"Vehicle Number"),
    tpa:idx(h,"TPA Name"), remarks:idx(h,"Remarks"), status:idx(h,"Status"),
    follow:idx(h,"Next Follow-up Time"), source:idx(h,"Source")
  };
  return values.slice(1).filter(r=>r.some(v=>String(v||"").trim()!=="")).map((r,n)=>({
    id:`${n+1}-${r[I.vehicle]||""}-${r[I.request]||""}`,
    clientName:String(r[I.client]??"").trim(), requestDate:String(r[I.request]??"").trim(),
    zone:String(r[I.zone]??"").trim(), state:String(r[I.state]??"").trim(),
    city:String(r[I.city]??"").trim(), vehicleNumber:String(r[I.vehicle]??"").trim(),
    tpaName:String(r[I.tpa]??"").trim(), remarks:String(r[I.remarks]??"").trim(),
    status:String(r[I.status]??"").trim(), nextFollowUpTime:String(r[I.follow]??"").trim(),
    source:String(r[I.source]??"").trim()
  }));
}
async function sync(){
  if(cache.syncing)return;
  cache.syncing=true;
  try{
    const url=`https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_TAB)}`;
    const res=await fetch(url);
    if(!res.ok) throw new Error(`Google Sheet returned HTTP ${res.status}`);
    const csv=await res.text();
    cache.rows=normalize(csvRows(csv));
    cache.lastSync=new Date().toISOString();
    cache.error=null;
  }catch(e){cache.error=e.message||String(e);}
  finally{cache.syncing=false;}
}
app.get("/api/cases",(req,res)=>res.json({success:!cache.error,rows:cache.rows,lastSync:cache.lastSync,error:cache.error}));
app.post("/api/sync",async(req,res)=>{await sync();res.json({success:!cache.error,rows:cache.rows,lastSync:cache.lastSync,error:cache.error})});
app.get("/api/health",(req,res)=>res.json({ok:true,lastSync:cache.lastSync,rowCount:cache.rows.length,error:cache.error}));
app.get("*",(req,res)=>res.sendFile(__dirname+"/public/index.html"));
sync(); setInterval(sync,SYNC_INTERVAL_MS);
app.listen(PORT,"0.0.0.0",()=>console.log(`North Follow-up Portal running on http://localhost:${PORT}`));
