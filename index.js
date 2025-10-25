/**
 * index.js
 * Full "original style" WhatsApp auto-sender with neon/hacker UI
 * - Uses `baileys` (official package)
 * - Multi-file auth (useMultiFileAuthState)
 * - Upload creds, start/stop sessions, status endpoint
 * - Number normalization (auto 91 for 10-digit Indian numbers)
 * - Social links appear in UI after successful connection
 *
 * Put this file in your project root and use the package.json below.
 */

const express = require("express");
const bodyParser = require("body-parser");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require("baileys");
const { Boom } = require("@hapi/boom");

const app = express();
const PORT = process.env.PORT || 10000;

// ---------- file upload setup ----------
const upload = multer({ dest: path.join(__dirname, "uploads/") });
if (!fs.existsSync(path.join(__dirname, "uploads"))) fs.mkdirSync(path.join(__dirname, "uploads"));

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use("/static", express.static(path.join(__dirname, "public"))); // optional static folder

// ---------- in-memory session registry ----------
const sessions = new Map(); // sessionKey -> { sock, running, connected }

// small helper
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

// ---------- helpers ----------
function normalizeTargets(raw) {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      // allow if they already included @ (jid)
      if (s.includes("@")) return s;
      // strip non-digits
      let n = s.replace(/\D/g, "");
      if (n.length === 10) return "91" + n;
      if (n.length === 11 && n.startsWith("0")) return "91" + n.slice(1);
      return n;
    })
    .filter(Boolean);
}

function toUserJid(n) {
  return n.includes("@") ? n : `${n}@s.whatsapp.net`;
}
function toGroupJid(g) {
  return g.includes("@") ? g : `${g}@g.us`;
}

// ---------- UI (neon hacker matrix style) ----------
app.get("/", (req, res) => {
  res.send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>YK TRICKS INDIA — Admin Panel</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    :root{
      --bg:#030405;
      --neon:#00ff9f;
      --neon-2:#a3ff7d;
      --muted:#b8f7d6;
      --panel:#071014;
    }
    html,body{height:100%;margin:0;background:linear-gradient(180deg,#000 0%,#00110a 60%);font-family: "Courier New", monospace;color:var(--neon);overflow:hidden}
    /* Matrix background */
    .matrix {
      position:fixed; inset:0; z-index:0; mix-blend-mode:screen;
      background: radial-gradient(circle at top left, rgba(0,255,159,0.03), transparent 10%), radial-gradient(circle at bottom right, rgba(163,255,125,0.02), transparent 10%);
      overflow:hidden;
    }
    .matrix:before{
      content:"";position:absolute;inset:0;background-image:linear-gradient(rgba(0,0,0,0.05), transparent 120%);pointer-events:none;
    }
    .center {
      position:relative; z-index:2; height:100vh; display:flex; align-items:center; justify-content:center;
    }
    .panel {
      width:920px; max-width:95%; background:linear-gradient(180deg, rgba(5,10,8,0.9), rgba(3,7,6,0.85));
      border-radius:12px; padding:28px; box-shadow: 0 20px 60px rgba(0,0,0,0.7); border:1px solid rgba(0,255,159,0.06);
      display:grid; grid-template-columns: 420px 1fr; gap:20px; align-items:start;
    }
    .left {
      padding:16px; background: rgba(0,0,0,0.15); border-radius:8px; border:1px solid rgba(0,255,159,0.03);
    }
    h1{margin:0;font-size:22px;color:var(--neon-2);text-shadow:0 0 8px rgba(0,255,159,0.08)}
    label{display:block;margin-top:12px;color:var(--muted);font-size:13px}
    input[type=text], textarea, select, input[type=number] {
      width:100%; padding:12px; margin-top:8px; border-radius:8px; background:var(--panel); color:var(--neon); border:1px solid rgba(0,255,159,0.06); font-family:monospace;
    }
    textarea{min-height:90px; resize:vertical}
    button { margin-top:12px; padding:12px 18px; border-radius:10px; background:linear-gradient(90deg,var(--neon),var(--neon-2)); color:#001; border:none; cursor:pointer; font-weight:700; }
    .muted { color:#8fd8b9; font-size:13px; margin-top:6px }
    .right {
      padding:18px; min-height:360px; border-radius:8px; background: linear-gradient(180deg, rgba(0,0,0,0.08), rgba(0,0,0,0.02));
      border:1px solid rgba(0,255,159,0.03);
    }
    .status { font-size:13px; color:var(--neon); margin-bottom:8px }
    .log { background:#00120c; color:var(--neon); padding:10px; border-radius:6px; height:220px; overflow:auto; font-family:monospace; border:1px solid rgba(0,255,159,0.04) }
    .socials { margin-top:12px; display:flex; gap:8px; flex-wrap:wrap; }
    .social { display:inline-flex; align-items:center; gap:8px; padding:8px 10px; background:rgba(0,0,0,0.12); border-radius:8px; border:1px solid rgba(0,255,159,0.03); opacity:0.2; transform:scale(0.98); transition:all .2s }
    .social.show { opacity:1; transform:scale(1); }
    .social a { color:var(--neon); text-decoration:none; font-weight:600; font-size:14px }
    .small { font-size:12px; color:#9adbb8 }
    .footer { margin-top:12px; font-size:12px; color:#8fd8b9 }
    /* animated title */
    .title-neon { font-size:30px; letter-spacing:2px; text-shadow:0 0 14px rgba(0,255,159,0.18) }
    @media(max-width:860px){ .panel{ grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <div class="matrix"></div>
  <div class="center">
    <div class="panel" role="main">
      <div class="left">
        <h1 class="title-neon">YK TRICKS INDIA — Admin</h1>
        <p class="muted">Full-screen hacker admin panel — large inputs, neon effects, matrix background.</p>

        <form id="sendForm">
          <label>Session Key / Folder Name</label>
          <input type="text" id="session" name="session" placeholder="session" required>

          <label>Target Option</label>
          <select id="targetOption" name="targetOption">
            <option value="1">Numbers</option>
            <option value="2">Groups</option>
          </select>

          <label>Target Numbers (comma separated) <span class="small">e.g. 919876543210,9876543210</span></label>
          <textarea id="numbers" name="numbers" placeholder="919876543210, 9876543210"></textarea>

          <label>Group IDs (comma separated)</label>
          <textarea id="groupUIDs" name="groupUIDs" placeholder="1203630XXXXXXXX@g.us"></textarea>

          <label>Messages (comma separated)</label>
          <textarea id="messages" name="messages" placeholder="Hello,How are you?,Good morning!"></textarea>

          <label>Prefix / Name (optional)</label>
          <input type="text" id="prefix" name="prefix" placeholder="YK TRICKS">

          <label>Interval (seconds)</label>
          <input type="number" id="interval" name="interval" value="5" min="1">

          <div style="display:flex;gap:8px">
            <button id="startBtn" type="button">🚀 Start</button>
            <button id="stopBtn" type="button" style="background:#111;color:var(--neon)">🛑 Stop</button>
          </div>
        </form>

        <div style="margin-top:14px">
          <form id="uploadForm" enctype="multipart/form-data">
            <label class="small">Upload creds.json / auth files to a session folder</label>
            <input type="text" id="uploadSession" placeholder="session to save into" />
            <input type="file" id="credsfile" />
            <button type="button" id="uploadBtn" style="background:#0a0">Upload creds</button>
          </form>
        </div>

        <div class="footer">Note: Scan QR in server logs to authenticate. Social links appear after connection.</div>
      </div>

      <div class="right">
        <div class="status">Status: <span id="connStatus">Not connected</span></div>
        <div class="log" id="logArea">Console logs will appear here...</div>

        <div class="socials" id="socials">
          <div class="social" id="facebook"><a href="https://facebook.com" target="_blank">Facebook</a></div>
          <div class="social" id="instagram"><a href="https://instagram.com" target="_blank">Instagram</a></div>
          <div class="social" id="twitter"><a href="https://twitter.com" target="_blank">Twitter</a></div>
          <div class="social" id="whatsapp"><a href="https://web.whatsapp.com" target="_blank">WhatsApp</a></div>
          <div class="social" id="telegram"><a href="https://telegram.org" target="_blank">Telegram</a></div>
        </div>
      </div>
    </div>
  </div>

<script>
(async function(){
  const log = (t) => {
    const area = document.getElementById("logArea");
    area.textContent = (new Date()).toLocaleTimeString() + " — " + t + "\\n" + area.textContent;
  };

  // poll status every 2s
  async function pollStatus(){
    try{
      const session = document.getElementById('session').value || 'session';
      const res = await fetch('/status?session='+encodeURIComponent(session));
      const j = await res.json();
      const cs = document.getElementById('connStatus');
      if(j && j.connected){
        cs.textContent = "Connected ("+ (j.session || session) +")";
        showSocials(true);
      } else {
        cs.textContent = "Not connected";
        showSocials(false);
      }
    }catch(e){
      // ignore
    }
  }

  function showSocials(show){
    document.querySelectorAll('.social').forEach(el=>{
      if(show) el.classList.add('show'); else el.classList.remove('show');
    });
  }

  setInterval(pollStatus,2000);
  pollStatus();

  // Start send
  document.getElementById('startBtn').addEventListener('click', async()=>{
    const payload = {
      session: document.getElementById('session').value || 'session',
      targetOption: document.getElementById('targetOption').value,
      numbers: document.getElementById('numbers').value,
      groupUIDsInput: document.getElementById('groupUIDs').value,
      messages: document.getElementById('messages').value,
      haterName: document.getElementById('prefix').value,
      intervalTime: document.getElementById('interval').value || 5
    };
    log("Sending start request...");
    const res = await fetch('/start',{method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)});
    const text = await res.text();
    log("Server: " + text);
  });

  document.getElementById('stopBtn').addEventListener('click', async()=>{
    const session = document.getElementById('session').value || 'session';
    const res = await fetch('/stop?session='+encodeURIComponent(session));
    const t = await res.text();
    log("Server: " + t);
  });

  // Upload creds
  document.getElementById('uploadBtn').addEventListener('click', async()=>{
    const session = document.getElementById('uploadSession').value || document.getElementById('session').value || 'session';
    const file = document.getElementById('credsfile').files[0];
    if(!file){ alert("Choose a file"); return; }
    const fd = new FormData();
    fd.append('session', session);
    fd.append('credsfile', file);
    log("Uploading creds to session: " + session);
    const res = await fetch('/upload-creds', { method: 'POST', body: fd });
    const t = await res.text();
    log("Upload: " + t);
  });

  // live log streaming (poll)
  setInterval(async ()=>{
    try{
      const session = document.getElementById('session').value || 'session';
      const res = await fetch('/logs?session='+encodeURIComponent(session));
      if(res.ok){
        const j = await res.json();
        if(j.logs && j.logs.length){
          j.logs.slice(0,30).reverse().forEach(l => log(l));
        }
      }
    }catch(e){}
  }, 4000);

})();
</script>
</body>
</html>`);
});

// ---------- backend: logs buffer for UI ----------
const logsBuffer = new Map(); // session -> [lines]
function pushLog(session, text){
  if(!logsBuffer.has(session)) logsBuffer.set(session, []);
  const arr = logsBuffer.get(session);
  arr.unshift(`[${new Date().toLocaleTimeString()}] ${text}`);
  if(arr.length > 200) arr.pop();
}

// endpoint for UI log polling
app.get("/logs", (req, res) => {
  const session = req.query.session || 'session';
  res.json({ logs: logsBuffer.get(session) || [] });
});

// ---------- upload creds endpoint ----------
app.post("/upload-creds", upload.single('credsfile'), (req, res) => {
  try {
    const session = (req.body.session || "session").trim();
    const destFolder = path.join(__dirname, session);
    if (!fs.existsSync(destFolder)) fs.mkdirSync(destFolder, { recursive: true });
    const file = req.file;
    if (!file) return res.status(400).send("No file uploaded.");
    const destPath = path.join(destFolder, file.originalname);
    fs.renameSync(file.path, destPath);
    pushLog(session, `creds uploaded: ${file.originalname}`);
    return res.send(`✅ File uploaded to session folder: ${session} as ${file.originalname}`);
  } catch (err) {
    pushLog('session', `upload error: ${err.message}`);
    return res.status(500).send("Upload failed: " + err.message);
  }
});

// ---------- status endpoint ----------
app.get("/status", (req, res) => {
  const session = (req.query.session || "session").trim();
  const s = sessions.get(session);
  if (!s) return res.json({ session, connected: false });
  return res.json({ session, connected: !!s.connected });
});

// ---------- start sending endpoint ----------
app.post("/start", async (req, res) => {
  try {
    const { session, targetOption, numbers, groupUIDsInput, messages, haterName, intervalTime } = req.body;
    const sessionKey = (session || "session").trim();
    const messagesArr = (messages || "").split(",").map(m => m.trim()).filter(Boolean);
    if (!messagesArr.length) return res.status(400).send("Please provide messages (comma separated).");
    let targets = [];
    let groups = [];
    if (targetOption === "1") targets = normalizeTargets(numbers || "");
    else groups = (groupUIDsInput || "").split(",").map(g => g.trim()).filter(Boolean);

    // start the session
    startSession(sessionKey, targets, groups, messagesArr, (haterName || "").trim(), parseInt(intervalTime) || 5);
    res.send(`✅ Session ${sessionKey} starting... check server logs for QR/status.`);
  } catch (err) {
    console.error("start error:", err);
    res.status(500).send("Start failed: " + err.message);
  }
});

// ---------- stop endpoint ----------
app.get("/stop", (req, res) => {
  const session = (req.query.session || "session").trim();
  const s = sessions.get(session);
  if (s) {
    s.running = false;
    try { if (s.sock) s.sock.logout(); } catch(e){}
    sessions.delete(session);
    pushLog(session, "Session stopped by user.");
    return res.send(`🛑 Session ${session} stopped.`);
  }
  return res.send(`No active session named ${session}.`);
});

// ---------- core: startSession ----------
async function startSession(sessionKey, targets = [], groups = [], messagesArr = [], prefix = "", interval = 5) {
  try {
    pushLog(sessionKey, `Initializing session "${sessionKey}"...`);
    const sessionFolder = path.join(__dirname, sessionKey);
    if (!fs.existsSync(sessionFolder)) fs.mkdirSync(sessionFolder, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);

    // create socket
    const sock = makeWASocket({
      printQRInTerminal: true,
      auth: state,
      browser: ["YK-TRICKS-ADMIN", "Chrome", "1.0"]
    });

    // save creds on update
    sock.ev.on("creds.update", saveCreds);

    // register in map
    sessions.set(sessionKey, { sock, running: true, connected: false });

    // connection updates
    sock.ev.on("connection.update", (update) => {
      try {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
          pushLog(sessionKey, "QR code received — scan in terminal or capture logs.");
        }
        if (connection === "open") {
          pushLog(sessionKey, "WhatsApp connected successfully.");
          const s = sessions.get(sessionKey); if (s) s.connected = true;
        }
        if (connection === "close") {
          const code = lastDisconnect?.error ? new Boom(lastDisconnect.error).output.statusCode : null;
          pushLog(sessionKey, `Connection closed. code=${code}`);
          const s = sessions.get(sessionKey); if (s) s.connected = false;
          // if not logged out, attempt reconnect
          if (code !== DisconnectReason.loggedOut) {
            pushLog(sessionKey, "Attempting reconnect in 5 seconds...");
            setTimeout(() => {
              // restart session if folder still exists
              if (fs.existsSync(sessionFolder)) {
                startSession(sessionKey, targets, groups, messagesArr, prefix, interval).catch(e => pushLog(sessionKey, "Reconnect failed: " + e.message));
              }
            }, 5000);
          } else {
            pushLog(sessionKey, "Session logged out. Remove session folder to re-authenticate if needed.");
          }
        }
      } catch (e) {
        pushLog(sessionKey, "connection.update handler error: " + e.message);
      }
    });

    // messages.upsert (incoming) — lightweight logging
    sock.ev.on("messages.upsert", (upsert) => {
      try {
        (upsert.messages || []).forEach(m => {
          if (m.key && m.key.remoteJid) {
            pushLog(sessionKey, `Incoming message from ${m.key.remoteJid} (id: ${m.key.id || ''})`);
          }
        });
      } catch (e) {}
    });

    // message updates (delivery/read)
    sock.ev.on("messages.update", (updates) => {
      try {
        (updates || []).forEach(u => {
          const rjid = u.key?.remoteJid;
          pushLog(sessionKey, `messages.update -> ${rjid} ${JSON.stringify(u.update || u)}`);
        });
      } catch (e) {}
    });

    // store logs
    pushLog(sessionKey, "Session started. Waiting for connection / QR scan (see server console).");

    // main sending loop
    let idx = 0;
    while (sessions.get(sessionKey)?.running) {
      try {
        const text = `${prefix} ${messagesArr[idx] || ""}`.trim();

        // send to users
        if (targets && targets.length) {
          for (const t of targets) {
            const jid = toUserJid(t);
            try {
              const res = await sock.sendMessage(jid, { text });
              pushLog(sessionKey, `Sent -> ${jid} (id: ${res?.key?.id || "no-id"})`);
            } catch (err) {
              pushLog(sessionKey, `Failed -> ${jid} | ${err?.message || JSON.stringify(err)}`);
            }
            await delay(450);
          }
        }

        // send to groups
        if (groups && groups.length) {
          for (const g of groups) {
            const gid = toGroupJid(g);
            try {
              const res = await sock.sendMessage(gid, { text });
              pushLog(sessionKey, `Group -> ${gid} (id: ${res?.key?.id || "no-id"})`);
            } catch (err) {
              pushLog(sessionKey, `Group fail -> ${gid} | ${err?.message || JSON.stringify(err)}`);
            }
            await delay(500);
          }
        }

        await delay(Math.max(1000, interval * 1000));
      } catch (loopErr) {
        pushLog(sessionKey, "Loop error: " + (loopErr?.message || JSON.stringify(loopErr)));
        await delay(5000);
      }
      idx++; if (idx >= messagesArr.length) idx = 0;
    }

    // cleanup
    try { await sock.logout(); } catch(e){}
    try { sock.close(); } catch(e){}
    sessions.delete(sessionKey);
    pushLog(sessionKey, "Session ended.");
  } catch (err) {
    pushLog(sessionKey, "Fatal startSession error: " + (err?.message || JSON.stringify(err)));
    console.error("startSession error:", err);
  }
}

// ---------- server start ----------
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} (or your Render URL).`);
});
