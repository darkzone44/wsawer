/**
 * index.js
 * Full WhatsApp auto-sender server using Baileys (complete, original-style).
 *
 * Instructions:
 * 1. Place this file as index.js in your project.
 * 2. Ensure package.json includes dependencies:
 *    - @adiwajshing/baileys
 *    - express
 *    - body-parser
 *    - multer
 *    - @hapi/boom
 * 3. Run: npm install && node index.js
 * 4. Open http://localhost:3000 and use the form. For a session, either:
 *    - Create a folder named the session key (e.g. "session") and upload creds files there
 *    - Or use the upload creds endpoint to upload creds.json via the web UI
 *
 * Note: Always keep backups of your session credentials. If the session is logged out, delete folder and re-authenticate.
 */

const express = require("express");
const bodyParser = require("body-parser");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@adiwajshing/baileys");
const { Boom } = require("@hapi/boom");

const app = express();
const PORT = process.env.PORT || 3000;

// Multer setup for file uploads (upload creds.json)
const upload = multer({ dest: path.join(__dirname, "uploads/") });

// Ensure uploads folder exists
if (!fs.existsSync(path.join(__dirname, "uploads"))) {
  fs.mkdirSync(path.join(__dirname, "uploads"));
}

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

/**
 * activeSessions map:
 * key: sessionKey (string)
 * value: {
 *   sock: Baileys socket,
 *   running: boolean,
 *   targets: {numbers:[], groups:[]},
 *   config: { interval, prefix, messages, sessionKey }
 * }
 */
const activeSessions = new Map();

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Utility: normalizeTargetList
 * - Accepts comma-separated inputs of numbers or JIDs
 * - Cleans whitespace and non-digit characters (except @ and . and - and _)
 * - Auto-adds country code 91 for 10-digit Indian numbers
 * - Removes accidental double suffix additions later when building JID
 */
function normalizeTargetList(rawStr) {
  if (!rawStr) return [];
  return rawStr
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      // Allow numbers with +, spaces removed
      let x = s.replace(/\s+/g, "");
      // Remove characters except digits and @ . _ - + (for JIDs)
      x = x.replace(/[^0-9@._\-\+]/g, "");
      // If it's a plain number (no @) and length 10, assume India and add 91
      if (!x.includes("@")) {
        // remove leading plus if present
        let y = x.startsWith("+") ? x.slice(1) : x;
        if (y.length === 10) return "91" + y;
        if (y.length === 11 && y.startsWith("0")) return "91" + y.slice(1);
        return y; // could be already with country code
      }
      // If contains @ (user provided JID), return as is
      return x;
    })
    .filter(Boolean);
}

/**
 * Build proper JID for sending:
 * - For numbers (no '@'), append @s.whatsapp.net
 * - For group ids, ensure @g.us
 * - If user provided a full JID, keep it
 */
function buildJid(target, expectedType = "user") {
  // expectedType: 'user' or 'group'
  if (target.includes("@")) {
    // sanitize accidental double suffix by trimming spaces
    return target.trim();
  }
  if (expectedType === "group") return `${target}@g.us`;
  return `${target}@s.whatsapp.net`;
}

/**
 * Endpoint: Home page with full original-style form (no cut)
 * - Allows uploading session name, numbers/groups, messages, prefix, interval
 * - Also supports uploading a creds.json file via separate endpoint below
 */
app.get("/", (req, res) => {
  res.send(`
  <html>
  <head>
    <meta charset="utf-8" />
    <title>WhatsApp Auto Sender (Complete)</title>
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <style>
      body { background: #080808; color: #e6fffa; font-family: Arial, Helvetica, sans-serif; margin: 0; padding: 20px; }
      .container { max-width: 900px; margin: 0 auto; background: #0f1720; border-radius: 8px; padding: 20px; box-shadow: 0 6px 30px rgba(0,0,0,0.6); }
      h1 { text-align: center; color: #7ee7c7; }
      label { display:block; margin-top:12px; color:#cdeedd; }
      input[type="text"], textarea, select, input[type="number"] {
        width: 100%; padding: 10px; margin-top:6px; background: #071018; color: #e6fffa; border: 1px solid #123; border-radius: 4px;
      }
      button { margin-top: 14px; padding: 10px 16px; background: #16a34a; color: white; border: none; border-radius: 6px; cursor:pointer; }
      small { color:#9adbb8; }
      .row { display:flex; gap:10px; }
      .col { flex:1; }
      .note { background:#041018; padding:10px; border-radius:4px; color:#aee8cc; margin-top:12px; }
      .upload { background:#082124; padding:12px; border-radius:4px; margin-top: 10px; }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>WhatsApp Auto Sender — Full Edition</h1>

      <form action="/start" method="post" enctype="multipart/form-data">
        <label>Session Key / Folder Name (create a folder with this name and put your creds files there, or upload creds using the form below)</label>
        <input type="text" name="session" placeholder="session" required>

        <label>Target Option</label>
        <select name="targetOption">
          <option value="1">Numbers (comma separated)</option>
          <option value="2">Groups (Group IDs comma separated)</option>
        </select>

        <label>Target Numbers (comma separated). Examples: 919876543210, 9876543210</label>
        <textarea name="numbers" rows="2" placeholder="919876543210, 9876543210"></textarea>

        <label>Group IDs (comma separated). Example: 1203630XXXXXXXX@g.us</label>
        <textarea name="groupUIDsInput" rows="2" placeholder="1203630XXXXXXXX@g.us, 1203630YYYYYYYY@g.us"></textarea>

        <label>Messages (comma separated). Example: Hello,How are you?,Good morning</label>
        <textarea name="messages" rows="3" placeholder="Hello,How are you?,Good morning!"></textarea>

        <div class="row">
          <div class="col">
            <label>Prefix (optional)</label>
            <input type="text" name="haterName" placeholder="YourName: ">
          </div>
          <div class="col">
            <label>Interval between cycles (seconds)</label>
            <input type="number" name="intervalTime" value="5" min="1" />
          </div>
        </div>

        <button type="submit">Start Sending</button>
      </form>

      <div class="upload">
        <h3>Upload creds.json (Optional)</h3>
        <small>If you have a creds.json (or multi-file creds) you can upload it to a session folder using this form.</small>
        <form action="/upload-creds" enctype="multipart/form-data" method="post">
          <label>Session folder to save to</label>
          <input type="text" name="session" placeholder="session" required />
          <label>Choose file (select your creds.json or zipped creds)</label>
          <input type="file" name="credsfile" required />
          <button type="submit">Upload creds</button>
        </form>
        <div class="note">
          <strong>Important:</strong> Keep a backup of your session folder. If session gets logged out, remove folder and re-scan QR.
        </div>
      </div>

      <div class="note" style="margin-top:16px;">
        <strong>Logs/Status:</strong> After starting, open the terminal where node is running to view logs — connection status, sent success/failure, and message updates will be printed there.
      </div>
    </div>
  </body>
  </html>
  `);
});

/**
 * Endpoint: Upload creds file to a session folder
 * - Accepts file under 'credsfile' and 'session' name field
 * - Saves uploaded file into session folder (useful for Render where you can't manually upload)
 * - If zip file uploaded, don't auto-extract (user can extract manually). We keep it safe.
 */
app.post("/upload-creds", upload.single("credsfile"), async (req, res) => {
  try {
    const session = req.body.session || "session";
    const destFolder = path.join(__dirname, session);
    if (!fs.existsSync(destFolder)) {
      fs.mkdirSync(destFolder, { recursive: true });
    }
    const file = req.file;
    if (!file) return res.status(400).send("No file uploaded.");
    const destPath = path.join(destFolder, file.originalname);
    fs.renameSync(file.path, destPath);
    return res.send(`✅ File uploaded to session folder: ${session} as ${file.originalname}`);
  } catch (err) {
    console.error("Upload error:", err);
    return res.status(500).send("Upload failed: " + err.message);
  }
});

/**
 * Endpoint: Start sending
 * - Expects: session, targetOption, numbers, groupUIDsInput, messages, haterName, intervalTime
 * - Will spawn a session if not already started
 */
app.post("/start", async (req, res) => {
  try {
    const { session, numbers, groupUIDsInput, targetOption, messages, haterName, intervalTime } = req.body;
    const sessionKey = (session || "session").trim();
    if (!sessionKey) return res.status(400).send("Session key required.");

    if (activeSessions.has(sessionKey) && activeSessions.get(sessionKey).running) {
      return res.send(`⚠️ Session "${sessionKey}" is already running. Use /stop to stop it before starting again.`);
    }

    // Normalize messages
    const messageList = (messages || "")
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);

    if (!messageList.length) {
      return res.status(400).send("Please provide at least one message (comma separated).");
    }

    // Normalize targets
    let targetNumbers = [];
    let groupUIDs = [];
    if (targetOption === "1") {
      targetNumbers = normalizeTargetList(numbers || "");
    } else {
      groupUIDs = (groupUIDsInput || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }

    // Save config
    const config = {
      sessionKey,
      targetNumbers,
      groupUIDs,
      messages: messageList,
      prefix: haterName || "",
      interval: parseInt(intervalTime) || 5,
    };

    // Start session asynchronously (we won't wait for completion — but we will start it now)
    startSession(config).catch((e) => {
      console.error("Failed to start session:", e);
    });

    return res.send(`✅ Session "${sessionKey}" starting... Check server console logs for details.`);
  } catch (err) {
    console.error("Start error:", err);
    return res.status(500).send("Start failed: " + err.message);
  }
});

/**
 * Endpoint: Stop a session or all sessions
 * - /stop?session=sessionKey   -> stops specific session
 * - /stop                     -> stops all sessions
 */
app.get("/stop", (req, res) => {
  const sessionKey = req.query.session;
  if (sessionKey) {
    const s = activeSessions.get(sessionKey);
    if (!s) return res.send(`No active session named "${sessionKey}".`);
    s.running = false;
    activeSessions.delete(sessionKey);
    return res.send(`🛑 Session "${sessionKey}" stopped.`);
  } else {
    activeSessions.forEach((s, k) => {
      s.running = false;
      activeSessions.delete(k);
    });
    return res.send("🛑 All sessions stopped.");
  }
});

/**
 * Endpoint: Status - list active sessions and their basic info
 */
app.get("/status", (req, res) => {
  const out = [];
  activeSessions.forEach((val, key) => {
    out.push({
      sessionKey: key,
      running: val.running,
      targets: { numbers: val.targets?.numbers?.length || 0, groups: val.targets?.groups?.length || 0 },
      interval: val.config?.interval || null,
    });
  });
  res.json(out);
});

/**
 * Core: startSession
 * - Creates/uses auth state from session folder
 * - Boots Baileys socket
 * - Attaches event handlers for connection updates & message updates
 * - Starts the sending loop with robust try/catch and per-target logs
 */
async function startSession(config) {
  const { sessionKey, targetNumbers, groupUIDs, messages, prefix, interval } = {
    targetNumbers: [],
    groupUIDs: [],
    messages: [],
    prefix: "",
    interval: 5,
    ...config,
  };

  console.log(`\n[${new Date().toISOString()}] Starting session "${sessionKey}"`);
  console.log("Targets (numbers):", targetNumbers);
  console.log("Targets (groups):", groupUIDs);
  console.log("Messages:", messages);
  console.log("Prefix:", prefix);
  console.log("Interval (s):", interval);

  // prepare session folder for multi-file auth
  const sessionFolder = path.join(__dirname, sessionKey);
  if (!fs.existsSync(sessionFolder)) {
    fs.mkdirSync(sessionFolder, { recursive: true });
    console.log(`Created session folder: ${sessionFolder}`);
  }

  // Use multi-file auth state (safer; stores creds across multiple files)
  const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);

  const sock = makeWASocket({
    printQRInTerminal: true,
    auth: state,
    // browser id - helps WhatsApp identify the session
    browser: ["WhatsApp Auto Sender", "Safari", "1.0"],
    // You can add more options here if needed
  });

  // Save creds whenever updated
  sock.ev.on("creds.update", saveCreds);

  // Store session meta for control endpoints
  activeSessions.set(sessionKey, {
    sock,
    running: true,
    targets: { numbers: targetNumbers.slice(), groups: groupUIDs.slice() },
    config: { interval, prefix, messages, sessionKey },
  });

  // Listen for connection updates
  sock.ev.on("connection.update", (update) => {
    try {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        console.log(`[${sessionKey}] QR code received — scan it with WhatsApp Web to authenticate (terminal QR or printed).`);
      }
      if (connection) {
        console.log(`[${sessionKey}] Connection update: ${connection}`);
      }
      if (connection === "close") {
        // Try to get reason
        const reason = (lastDisconnect && lastDisconnect.error) ? new Boom(lastDisconnect.error).output.statusCode : null;
        console.log(`[${sessionKey}] Connection closed. Reason code: ${reason}`);
        // Logged out?
        if (lastDisconnect && lastDisconnect.error && lastDisconnect.error.output && lastDisconnect.error.output.payload) {
          // Detect logged out by examining the error payload message - but simpler: use DisconnectReason if available
        }
        // If not logged out then try to restart after small delay
        // NOTE: avoid infinite immediate restart — give a delay
        (async () => {
          // mark as not running
          const s = activeSessions.get(sessionKey);
          if (s) s.running = false;
          console.log(`[${sessionKey}] Attempting to reconnect in 5 seconds...`);
          await delay(5000);
          // restart if folder still exists (user didn't stop)
          if (fs.existsSync(sessionFolder)) {
            console.log(`[${sessionKey}] Reinitializing session...`);
            // Clean up old socket event listeners if any
            try { sock.end(); } catch (e) {}
            // start a new session (recursive)
            startSession(config).catch((e) => console.error(`[${sessionKey}] Re-start failed:`, e));
          } else {
            console.log(`[${sessionKey}] Session folder removed; not reconnecting.`);
          }
        })();
      } else if (connection === "open") {
        console.log(`[${sessionKey}] ✅ WhatsApp connection opened successfully.`);
      }
    } catch (err) {
      console.error(`[${sessionKey}] connection.update handler error:`, err);
    }
  });

  // Listen for message update events (delivered/read ack changes)
  sock.ev.on("messages.update", (updates) => {
    // updates is an array of update objects
    try {
      updates.forEach((u) => {
        // Example u: { key: { remoteJid, id, fromMe }, update: { status } }
        const key = u.key || {};
        const remote = key.remoteJid || "unknown";
        const id = key.id || "";
        // u.update can contain status, or message etc depending on event shape
        console.log(`[${sessionKey}] messages.update -> remote: ${remote} | id: ${id} | update: ${JSON.stringify(u.update)}`);
      });
    } catch (err) {
      console.error(`[${sessionKey}] messages.update error:`, err);
    }
  });

  // Also log incoming messages (useful for debugging)
  sock.ev.on("messages.upsert", (m) => {
    try {
      // m has shape { messages: [...], type: 'notify' }
      if (!m || !m.messages) return;
      m.messages.forEach((message) => {
        if (!message.key) return;
        const from = message.key.remoteJid;
        const isFromMe = message.key.fromMe;
        // Avoid logging protocol/BA messages
        if (message.message && message.message.protocolMessage) return;
        console.log(`[${sessionKey}] Incoming message from ${from} | fromMe: ${isFromMe} | message-id: ${message.key.id}`);
      });
    } catch (err) {
      console.error(`[${sessionKey}] messages.upsert error:`, err);
    }
  });

  // The sending loop — robust, per-target try/catch, logs
  (async () => {
    try {
      let index = 0;
      while (activeSessions.get(sessionKey) && activeSessions.get(sessionKey).running) {
        try {
          const currentMessages = messages.slice(); // copy
          const textToSend = `${prefix} ${currentMessages[index] || ""}`.trim();

          // Send to private numbers
          if (targetNumbers && targetNumbers.length) {
            for (const rawTarget of targetNumbers) {
              if (!activeSessions.get(sessionKey) || !activeSessions.get(sessionKey).running) break;
              // Build JID safely
              const jid = buildJid(rawTarget, "user");
              try {
                const res = await sock.sendMessage(jid, { text: textToSend });
                // res usually contains a key with id & remoteJid — log them
                console.log(`[${sessionKey}] ✅ Sent => ${jid} | id: ${res?.key?.id || "no-id"} | result: ${JSON.stringify(res?.key || res).slice(0, 200)}`);
              } catch (err) {
                // Many reasons: invalid JID, not registered, blocked, rate-limited
                console.log(`[${sessionKey}] ❌ Send failed => ${jid} | error: ${err?.toString?.() || JSON.stringify(err)}`);
              }
              // Small delay between each send to reduce rate-limit risk
              await delay(400);
            }
          }

          // Send to groups
          if (groupUIDs && groupUIDs.length) {
            for (const rawGroup of groupUIDs) {
              if (!activeSessions.get(sessionKey) || !activeSessions.get(sessionKey).running) break;
              const gid = buildJid(rawGroup, "group");
              try {
                const res = await sock.sendMessage(gid, { text: textToSend });
                console.log(`[${sessionKey}] ✅ Sent to group => ${gid} | id: ${res?.key?.id || "no-id"}`);
              } catch (err) {
                console.log(`[${sessionKey}] ❌ Send to group failed => ${gid} | error: ${err?.toString?.() || JSON.stringify(err)}`);
              }
              await delay(500);
            }
          }

          // Wait interval seconds before next message
          await delay(Math.max(1000, interval * 1000));
        } catch (loopErr) {
          console.error(`[${sessionKey}] Loop error:`, loopErr);
          // small pause then continue
          await delay(5000);
        }
        index++;
        if (index >= messages.length) index = 0;
      }
      console.log(`[${sessionKey}] Sending loop ended (session stopped).`);
    } catch (err) {
      console.error(`[${sessionKey}] Sending loop fatal error:`, err);
    } finally {
      // cleanup: close socket
      try {
        if (sock) await sock.logout();
      } catch (e) {}
      try { sock.close(); } catch (e) {}
      activeSessions.delete(sessionKey);
    }
  })().catch((e) => {
    console.error(`[${sessionKey}] Failed to start sending loop:`, e);
  });
}

// Start express server
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT} (PID: ${process.pid})`);
  console.log("Open the URL and start the session. Check your terminal for QR and logs.");
});
