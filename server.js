const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const session = require("express-session");
const {OAuth2Client} = require("google-auth-library");
const fs = require("fs");
const path = require("path");

dotenv.config();
const app = express();
// Render is behind a reverse proxy; trust it so secure session cookies work.
app.set("trust proxy", 1);
app.use(cors({origin:true, credentials:true}));
app.use(express.json({limit:"1mb"}));

// Serve the real public files. Cache-busting headers prevent Render/browser from
// continuing to show an older index.html/app.js/styles.css after deployment.
app.use(express.static(path.join(__dirname, "public"), {
  etag: false,
  setHeaders: (res, filePath) => {
    if (/\\.(html|js|css)$/.test(filePath)) res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    else res.setHeader("Cache-Control", "public, max-age=3600");
  }
}));

const PORT = Number(process.env.PORT || 3000);
const SHEET_ID = process.env.GOOGLE_SHEET_ID || "1xXbamQZ1rsZAxK3bMu-9vXq__n1yYvLVrqVqRxCePNQ";
const SHEET_TAB = process.env.GOOGLE_SHEET_TAB || "Dashboard";
const SYNC_INTERVAL_MS = Number(process.env.SYNC_INTERVAL_MS || 10000);
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "change-this-session-secret";
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "sundarmanral8505@gmail.com,sundar.singh@girnarsoft.com").split(",").map(x=>x.trim().toLowerCase()).filter(Boolean);
const ACCESS_FILE = process.env.ACCESS_FILE || path.join(__dirname,"data","users.json");

const oauthClient = new OAuth2Client(GOOGLE_CLIENT_ID);
const defaultUsers = {};
for(const email of ADMIN_EMAILS) defaultUsers[email] = {email, name:email, active:true, admin:true};

function ensureAccessFile(){
  fs.mkdirSync(path.dirname(ACCESS_FILE), {recursive:true});
  if(!fs.existsSync(ACCESS_FILE)) fs.writeFileSync(ACCESS_FILE, JSON.stringify(defaultUsers,null,2));
}
function readUsers(){
  ensureAccessFile();
  try { return JSON.parse(fs.readFileSync(ACCESS_FILE,"utf8")) || {}; }
  catch { return {...defaultUsers}; }
}
function writeUsers(users){
  ensureAccessFile();
  fs.writeFileSync(ACCESS_FILE, JSON.stringify(users,null,2));
}
function isAdmin(email){return ADMIN_EMAILS.includes(String(email||"").toLowerCase());}
function isActive(email){const u=readUsers()[String(email||"").toLowerCase()]; return !!(u && u.active);}
function authRequired(req,res,next){ if(!req.session.user) return res.status(401).json({success:false,error:"LOGIN_REQUIRED"}); if(!isAdmin(req.session.user.email) && !isActive(req.session.user.email)) return res.status(403).json({success:false,error:"ACCESS_DISABLED"}); next(); }
function adminRequired(req,res,next){ if(!req.session.user) return res.status(401).json({success:false,error:"LOGIN_REQUIRED"}); if(!isAdmin(req.session.user.email)) return res.status(403).json({success:false,error:"ADMIN_REQUIRED"}); next(); }

app.use(session({secret:SESSION_SECRET,resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",maxAge:8*60*60*1000},proxy:true}));

let cache = { rows: [], lastSync: null, error: null, syncing: false };
function csvRows(text) {
  const rows=[]; let row=[], cell="", quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i], n=text[i+1];
    if(c==='"'){ if(quoted && n==='"'){ cell+='"'; i++; } else quoted=!quoted; }
    else if(c===',' && !quoted){ row.push(cell); cell=""; }
    else if((c==='\n' || c==='\r') && !quoted){ if(c==='\r'&&n==='\n')i++; row.push(cell); cell=""; if(row.some(v=>v.trim()!==""))rows.push(row); row=[]; }
    else cell+=c;
  }
  if(cell!==""||row.length){row.push(cell);rows.push(row);} return rows;
}
function norm(h){return String(h||"").trim().toLowerCase().replace(/\s+/g," ");}
function idx(headers,name){return headers.indexOf(norm(name));}
function idxAny(headers,names,fallback=-1){
  for(const name of names){ const i=idx(headers,name); if(i>=0) return i; }
  return fallback;
}
function cell(row,i){ return i>=0 ? String(row[i]??"").trim() : ""; }
function normalize(values){
  if(values.length<2)return [];
  const h=values[0].map(norm);
  // Client Name is the first column in the North Follow-up Dashboard.
  // Use header aliases and finally column A as a safe fallback so a header
  // formatting change cannot make all client names disappear.
  const I={
    client:idxAny(h,["Client Name","Client","ClientName"],0),
    request:idxAny(h,["Request Date","Request date"],1),
    zone:idxAny(h,["Zone"],2),
    state:idxAny(h,["State"],3),
    city:idxAny(h,["City"],4),
    vehicle:idxAny(h,["Vehicle Number","Vehicle No","Registration Number","Reg"],5),
    tpa:idxAny(h,["TPA Name","TPA NAME","TPA"],6),
    remarks:idxAny(h,["Remarks","Remark"],7),
    status:idxAny(h,["Status"],8),
    follow:idxAny(h,["Next Follow-up Time","Next Follow-up","Next Followup Time","Follow-up Time"],9),
    source:idxAny(h,["Source"],10)
  };
  return values.slice(1).filter(r=>r.some(v=>String(v||"").trim()!=="")).map((r,n)=>({
    id:`${n+1}-${cell(r,I.vehicle)}-${cell(r,I.request)}`,
    clientName:cell(r,I.client),
    requestDate:cell(r,I.request),
    zone:cell(r,I.zone),
    state:cell(r,I.state),
    city:cell(r,I.city),
    vehicleNumber:cell(r,I.vehicle),
    tpaName:cell(r,I.tpa),
    remarks:cell(r,I.remarks),
    status:cell(r,I.status),
    nextFollowUpTime:cell(r,I.follow),
    source:cell(r,I.source)
  }));
}
async function sync(){
  if(cache.syncing)return; cache.syncing=true;
  try{ const url=`https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_TAB)}`; const res=await fetch(url); if(!res.ok)throw new Error(`Google Sheet returned HTTP ${res.status}`); cache.rows=normalize(csvRows(await res.text())); cache.lastSync=new Date().toISOString(); cache.error=null; }
  catch(e){cache.error=e.message||String(e);} finally{cache.syncing=false;}
}

app.post("/api/auth/google", async (req,res)=>{
  try{
    if(!GOOGLE_CLIENT_ID) return res.status(500).json({success:false,error:"GOOGLE_CLIENT_ID_NOT_CONFIGURED"});
    const ticket=await oauthClient.verifyIdToken({idToken:req.body.credential,audience:GOOGLE_CLIENT_ID});
    const p=ticket.getPayload();
    const email=String(p.email||"").toLowerCase();
    if(!email || !p.email_verified) return res.status(403).json({success:false,error:"GOOGLE_EMAIL_NOT_VERIFIED"});
    const users=readUsers();
    if(!users[email]) users[email]={email,name:p.name||email,active:false,admin:isAdmin(email),createdAt:new Date().toISOString()};
    users[email].name=p.name||users[email].name||email; users[email].picture=p.picture||users[email].picture||"";
    if(isAdmin(email)) users[email].active=true; writeUsers(users);
    if(!isAdmin(email) && !users[email].active) return res.status(403).json({success:false,error:"ACCESS_DISABLED",message:"Your Google account is registered but not activated by an admin."});
    req.session.user={email,name:users[email].name,picture:users[email].picture,admin:isAdmin(email)};
    res.json({success:true,user:req.session.user});
  }catch(e){res.status(401).json({success:false,error:"GOOGLE_LOGIN_FAILED",message:e.message});}
});
app.get("/api/auth/config",(req,res)=>res.json({success:true,clientId:GOOGLE_CLIENT_ID}));
app.get("/api/auth/me",(req,res)=>res.json({success:true,loggedIn:!!req.session.user,user:req.session.user||null}));
app.post("/api/auth/logout",(req,res)=>req.session.destroy(()=>res.json({success:true})));
app.get("/api/users",adminRequired,(req,res)=>{const users=readUsers(); res.json({success:true,users:Object.values(users).sort((a,b)=>a.email.localeCompare(b.email))});});
app.post("/api/users/toggle",adminRequired,(req,res)=>{const email=String(req.body.email||"").toLowerCase(); if(!email)return res.status(400).json({success:false,error:"EMAIL_REQUIRED"}); if(isAdmin(email))return res.status(400).json({success:false,error:"ADMIN_CANNOT_BE_DEACTIVATED"}); const users=readUsers(); users[email]=users[email]||{email,name:email,admin:false}; users[email].active=Boolean(req.body.active); users[email].updatedAt=new Date().toISOString(); writeUsers(users); res.json({success:true,user:users[email]});});

app.get("/api/cases",authRequired,(req,res)=>res.json({success:!cache.error,rows:cache.rows,lastSync:cache.lastSync,error:cache.error}));
app.post("/api/sync",authRequired,async(req,res)=>{await sync();res.json({success:!cache.error,rows:cache.rows,lastSync:cache.lastSync,error:cache.error})});
app.get("/api/health",(req,res)=>res.json({ok:true,lastSync:cache.lastSync,rowCount:cache.rows.length,error:cache.error}));
app.get("/admin",adminRequired,(req,res)=>res.sendFile(__dirname+"/public/index.html"));

app.get("*",(req,res)=>{
  res.setHeader("Cache-Control","no-store, no-cache, must-revalidate, proxy-revalidate");
  res.sendFile(path.join(__dirname,"public","index.html"));
});
ensureAccessFile(); sync(); setInterval(sync,SYNC_INTERVAL_MS);
app.listen(PORT,"0.0.0.0",()=>console.log(`North Follow-up Portal running on port ${PORT}`));
