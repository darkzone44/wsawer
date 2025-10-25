const express = require("express");
const bodyParser = require("body-parser");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require("baileys");
const { Boom } = require("@hapi/boom");

const app = express();
const PORT = process.env.PORT || 10000;
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// ---- file upload setup ----
const upload = multer({ dest: "uploads/" });
if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");

const sessions = new Map();
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- helpers ----
const normalizeNumbers = (raw = "") =>
  raw
    .split(",")
    .map((n) => n.replace(/\D/g, ""))
    .filter(Boolean)
    .map((n) => (n.length === 10 ? "91" + n : n.startsWith("0") ? "91" + n.slice(1) : n));

const jidUser = (n) => (n.includes("@") ? n : `${n}@s.whatsapp.net`);
const jidGroup = (g) => (g.includes("@") ? g : `${g}@g.us`);

// ---- html form ----
app.get("/", (_, r) =>
  r.send(`
  <html><body style="background:#000;color:#0f0;font-family:monospace;text-align:center">
  <h2>WhatsApp Auto Sender ✅</h2>
  <form action="/start" method="post">
  <input name="session" placeholder="session" required><br>
  <select name="mode"><option value="user">Numbers</option><option value="group">Groups</option></select><br>
  <textarea name="targets" placeholder="9198...,1203...@g.us"></textarea><br>
  <textarea name="messages" placeholder="hi,hello"></textarea><br>
  <input name="prefix" placeholder="Prefix"><br>
  <input name="interval" type="number" value="5"><br>
  <button>Start</button>
  </form><br>
  <form action="/upload" enctype="multipart/form-data" method="post">
  <input name="session" placeholder="session" required><br>
  <input type="file" name="creds" required><br><button>Upload creds.json</button></form>
  </body></html>`)
);

// ---- creds upload ----
app.post("/upload", upload.single("creds"), (q, r) => {
  const folder = path.join(__dirname, q.body.session);
  if (!fs.existsSync(folder)) fs.mkdirSync(folder);
  fs.renameSync(q.file.path, path.join(folder, q.file.originalname));
  r.send("✅ creds uploaded");
});

// ---- start sending ----
app.post("/start", async (q, r) => {
  const s = q.body.session.trim();
  const msgs = (q.body.messages || "").split(",").map((m) => m.trim()).filter(Boolean);
  const prefix = q.body.prefix || "";
  const interval = parseInt(q.body.interval) || 5;
  const mode = q.body.mode;
  const targets =
    mode === "group"
      ? (q.body.targets || "").split(",").map((t) => t.trim()).filter(Boolean)
      : normalizeNumbers(q.body.targets);

  if (!msgs.length || !targets.length) return r.send("❌ Fill messages & targets");
  r.send("✅ Started — check logs");

  runSession(s, targets, msgs, prefix, interval, mode);
});

// ---- main loop ----
async function runSession(name, targets, msgs, prefix, interval, mode) {
  const folder = path.join(__dirname, name);
  if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(folder);
  const sock = makeWASocket({ printQRInTerminal: true, auth: state });
  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (u) => {
    const { connection, lastDisconnect } = u;
    if (connection === "close") {
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      console.log("⚠️ Connection closed", code);
      if (code !== DisconnectReason.loggedOut) runSession(name, targets, msgs, prefix, interval, mode);
    } else if (connection === "open") console.log("✅ WhatsApp connected!");
  });

  sessions.set(name, { sock, running: true });
  let i = 0;
  while (sessions.get(name)?.running) {
    const text = `${prefix} ${msgs[i]}`.trim();
    for (const t of targets) {
      const jid = mode === "group" ? jidGroup(t) : jidUser(t);
      try {
        const sent = await sock.sendMessage(jid, { text });
        console.log("✅ Sent to", jid, sent?.key?.id || "");
      } catch (e) {
        console.log("❌ Fail", jid, e.message);
      }
      await delay(600);
    }
    await delay(interval * 1000);
    i = (i + 1) % msgs.length;
  }
}

app.get("/stop", (_, r) => {
  sessions.forEach((s) => (s.running = false));
  r.send("🛑 stopped");
});

app.listen(PORT, () => console.log("Server live on port", PORT));
