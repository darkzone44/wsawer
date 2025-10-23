const express = require('express');
const fs = require('fs');
const pino = require('pino');
const path = require('path');
const crypto = require('crypto');
const { makeWASocket, useMultiFileAuthState, delay, DisconnectReason } = require("@whiskeysockets/baileys");
const multer = require('multer');

const app = express();
const port = 5000;

let messages = null;
let targetNumbers = [];
let groupUIDs = [];
let intervalTime = null;
let haterName = null;

const activeSessions = new Map(); // sessionKey => { running: true, ... }

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ======= Stylish HTML Route =======
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>😈𝗠𝗥 𝗡𝗜𝗜𝗧𝗘𝗦𝗛 𝗪𝗣 𝗟𝗢𝗗𝗘𝗥😈</title>
  <link href="https://fonts.googleapis.com/css?family=Poppins:wght@400;600&display=swap" rel="stylesheet">
  <style>
    body {
      min-height: 100vh;
      margin: 0;
      padding: 0;
      font-family: 'Poppins', Arial, sans-serif;
      background: linear-gradient(135deg, #1f1c2c 0%, #928dab 100%);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
    }
    .top-title {
      margin-top: 32px;
      font-size: 2.2rem;
      font-weight: bold;
      letter-spacing: 2px;
      color: #fff;
      text-shadow: 0 2px 8px #000, 0 0 5px #ffd200;
      text-align: center;
      background: linear-gradient(90deg, #ff00cc, #00ffd0 60%, #ff00cc);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      animation: shine 2.5s linear infinite;
    }
    @keyframes shine {
      0% { filter: brightness(1);}
      50% { filter: brightness(1.4);}
      100% { filter: brightness(1);}
    }
    .cred-link {
      margin: 18px 0 18px 0;
      font-size: 1.1rem;
      font-weight: 600;
      background: #fff;
      color: #222;
      padding: 10px 22px;
      border-radius: 16px;
      box-shadow: 0 2px 12px #0002;
      text-decoration: none;
      display: inline-block;
      transition: background 0.3s, color 0.3s;
    }
    .cred-link:hover {
      background: #ffd200;
      color: #0f2027;
    }
    .glass-box {
      background: linear-gradient(120deg,rgba(0,255,255,0.18),rgba(255,0,204,0.13));
      border-radius: 22px;
      box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.37);
      backdrop-filter: blur(12px);
      border: 2.5px solid #00ffd0aa;
      padding: 36px 24px 24px 24px;
      max-width: 420px;
      width: 98vw;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      align-items: center;
      animation: pop-in 0.7s cubic-bezier(.68,-0.55,.27,1.55);
    }
    @keyframes pop-in {
      0% { transform: scale(0.8); opacity: 0; }
      100% { transform: scale(1); opacity: 1; }
    }
    form {
      display: flex;
      flex-direction: column;
      gap: 14px;
      width: 100%;
    }
    label {
      color: #fff;
      font-weight: 500;
      margin-bottom: 3px;
      letter-spacing: 0.5px;
      font-size: 1rem;
    }
    input, select {
      padding: 11px;
      border-radius: 8px;
      border: 1.7px solid #ff00cc;
      background: rgba(16,16,16,0.85);
      color: #fff;
      font-size: 1rem;
      outline: none;
      transition: border 0.2s;
      width: 100%;
    }
    input:focus, select:focus {
      border: 1.7px solid #00ffd0;
    }
    input[type="file"] {
      background: transparent;
      color: #fff;
      border: none;
      padding-left: 0;
    }
    .btn {
      background: linear-gradient(90deg, #ff512f, #dd2476, #1fa2ff);
      color: #fff;
      border: none;
      border-radius: 11px;
      font-size: 1.11rem;
      font-weight: bold;
      padding: 13px 0;
      margin-top: 10px;
      box-shadow: 0 2px 8px #ff00cca0;
      cursor: pointer;
      transition: background 0.3s, box-shadow 0.3s, color 0.3s, transform 0.2s;
      letter-spacing: 1px;
      width: 100%;
    }
    .btn:hover {
      background: linear-gradient(90deg, #1fa2ff, #ff512f, #dd2476);
      color: #121212;
      box-shadow: 0 4px 16px #00ffd0a0;
      transform: scale(1.06);
    }
    @media (max-width: 600px) {
      .glass-box {
        padding: 14px 2vw 10px 2vw;
        max-width: 99vw;
      }
      .top-title {
        font-size: 1.3rem;
      }
    }
    .footer {
      margin-top: 38px;
      color: #fff;
      font-size: 1.1rem;
      font-weight: 600;
      text-align: center;
      letter-spacing: 1px;
      text-shadow: 0 0 8px #00ffd0;
    }
    .wp-logo {
      margin: 24px 0 10px 0;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .wp-logo-icon {
      width: 34px;
      height: 34px;
      background: #25D366;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-right: 12px;
      box-shadow: 0 2px 8px #0004;
    }
    .wp-logo-icon svg {
      width: 22px;
      height: 22px;
      fill: #fff;
    }
    .wp-number {
      font-size: 1.2rem;
      font-weight: bold;
      letter-spacing: 1px;
      color: #fff;
      text-shadow: 0 1px 4px #2228;
    }
  </style>
  <script>
    function toggleFields() {
      const targetOption = document.getElementById("targetOption").value;
      if (targetOption === "1") {
        document.getElementById("numbersField").style.display = "block";
        document.getElementById("groupUIDsField").style.display = "none";
      } else if (targetOption === "2") {
        document.getElementById("groupUIDsField").style.display = "block";
        document.getElementById("numbersField").style.display = "none";
      }
    }
    window.onload = function() { toggleFields(); }

    // AJAX for sending messages and showing session key
    function handleSendForm(e) {
      e.preventDefault();
      const form = document.getElementById('sendForm');
      const formData = new FormData(form);

      fetch('/send-messages', {
        method: 'POST',
        body: formData
      })
      .then(res => res.json())
      .then(data => {
        if(data.status === 'success') {
          document.getElementById('sessionKeyBox').style.display = 'block';
          document.getElementById('sessionKeyValue').innerText = data.sessionKey;
          document.getElementById('sendMsgResult').innerText = "Message sending started! Use session key below to stop.";
        } else {
          document.getElementById('sendMsgResult').innerText = data.message || "Error!";
        }
      })
      .catch(() => {
        document.getElementById('sendMsgResult').innerText = "Server error!";
      });
    }

    // AJAX for stopping messages
    function handleStopForm(e) {
      e.preventDefault();
      const form = document.getElementById('stopForm');
      const formData = new FormData(form);
      fetch('/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionKey: formData.get('sessionKey') })
      })
      .then(res => res.json())
      .then(data => {
        document.getElementById('stopMsgResult').innerText = data.message || "Stopped!";
      })
      .catch(() => {
        document.getElementById('stopMsgResult').innerText = "Server error!";
      });
    }
  </script>
</head>
<body>
  <div class="top-title">
    😈𝗠𝗥 𝗡𝗶𝗶𝘁𝗲𝘀𝗵 𝘅𝗗 𝗪𝗣 𝗟𝗢𝗗𝗘𝗥😈
  </div>
  <a class="cred-link" href="https://knight-bot-paircode.onrender.com/" target="_blank">
    CRED JSON DENE VALA LINK
  </a>
  <div class="glass-box">
    <form id="sendForm" onsubmit="handleSendForm(event)" enctype="multipart/form-data">
      <label for="creds">Upload creds.json:</label>
      <input type="file" id="creds" name="creds" accept=".json" required>
      <label for="targetOption">Select Target Option:</label>
      <select name="targetOption" id="targetOption" onchange="toggleFields()" required>
        <option value="1">Send to Target Number</option>
        <option value="2">Send to WhatsApp Group</option>
      </select>
      <div id="numbersField">
        <label for="numbers">Target Numbers (comma separated):</label>
        <input type="text" id="numbers" name="numbers" placeholder="e.g. 919999999999,918888888888">
      </div>
      <div id="groupUIDsField" style="display:none;">
        <label for="groupUIDsInput">Group UIDs (comma separated):</label>
        <input type="text" id="groupUIDsInput" name="groupUIDsInput" placeholder="e.g. 1203630xxxxx-123456@g.us">
      </div>
      <label for="messageFile">Upload Message File (.txt):</label>
      <input type="file" id="messageFile" name="messageFile" accept=".txt" required>
      <label for="haterNameInput">Enter Hater's Name:</label>
      <input type="text" id="haterNameInput" name="haterNameInput" placeholder="e.g. Mr. Nitesh xD" required>
      <label for="delayTime">Delay Between Messages (seconds):</label>
      <input type="number" id="delayTime" name="delayTime" min="1" value="2" required>
      <button class="btn" type="submit">🚀 Start Sending</button>
      <div id="sendMsgResult" style="color:#00ffd0;margin-top:10px;text-align:center;"></div>
    </form>
    <div class="session-key-box" id="sessionKeyBox" style="margin-top:18px;background:linear-gradient(90deg,#00ffd0cc,#ff00cccc 80%);color:#121212;border-radius:10px;padding:12px 10px;font-size:1.1rem;text-align:center;word-break:break-all;box-shadow:0 0 8px #ff00cca0;display:none;">
      <b>Session Key:</b>
      <div id="sessionKeyValue" style="font-size:1.2rem;margin:8px 0;"></div>
      <span style="font-size:0.95rem;">Copy this key to stop messages below.</span>
    </div>
    <form id="stopForm" class="stop-form" onsubmit="handleStopForm(event)">
      <label for="sessionKey">Enter Session Key to Stop:</label>
      <input type="text" id="sessionKey" name="sessionKey" placeholder="Paste session key here" required>
      <button class="btn" type="submit" style="background:linear-gradient(90deg,#00ffd0,#ff00cc 80%);color:#fff;">🛑 Stop Sending</button>
      <div id="stopMsgResult" style="color:#ff00cc;text-align:center;"></div>
    </form>
  </div>
  <div class="footer">
    😋 𝗠𝗔𝗗𝗘 𝗕𝗬 𝗡𝗶𝗶𝘁𝗲𝘀𝗵 𝘅𝗗 =𝟮𝟬𝟮𝟱
  </div>
  <div class="wp-logo">
    <span class="wp-logo-icon">
      <svg viewBox="0 0 32 32">
        <path d="M16 2.5C8.3 2.5 2 8.8 2 16.5c0 2.9 0.8 5.7 2.3 8.1L2 30l5.6-2.2c2.3 1.3 4.9 2 7.4 2 7.7 0 14-6.3 14-14S23.7 2.5 16 2.5zm0 25.5c-2.3 0-4.6-0.6-6.6-1.8l-0.5-0.3-3.3 1.3 0.7-3.4-0.3-0.5C4.9 20.1 4.2 18.3 4.2 16.5c0-6.5 5.3-11.8 11.8-11.8s11.8 5.3 11.8 11.8-5.3 11.8-11.8 11.8zm6.2-8.7c-0.3-0.2-1.6-0.8-1.8-0.9-0.2-0.1-0.4-0.2-0.6 0.2-0.2 0.3-0.7 0.9-0.9 1.1-0.2 0.2-0.3 0.2-0.6 0.1-0.3-0.2-1.2-0.4-2.2-1.1-0.8-0.7-1.3-1.5-1.5-1.7-0.2-0.3 0-0.4 0.1-0.6 0.1-0.1 0.2-0.3 0.3-0.4 0.1-0.1 0.1-0.2 0.2-0.3 0.1-0.1 0-0.2 0-0.3-0.1-0.2-0.6-1.5-0.8-2.1-0.2-0.5-0.4-0.5-0.6-0.5-0.2 0-0.4 0-0.6 0-0.2 0-0.5 0.1-0.7 0.3-0.2 0.2-0.7 0.7-0.7 1.7s0.7 2 0.8 2.1c0.1 0.1 1.4 2.2 3.5 3 0.5 0.2 0.9 0.3 1.2 0.4 0.5 0.1 0.9 0.1 1.2 0.1 0.4 0 1.2-0.2 1.4-0.6 0.2-0.3 0.2-0.7 0.1-0.8z"/>
      </svg>
    </span>
    <span class="wp-number">9779800640944</span>
  </div>
</body>
</html>
  `);
});

// ======= Main Message Sending Endpoint (with creds.json, session key) =======
app.post('/send-messages', upload.fields([
  { name: 'creds', maxCount: 1 },
  { name: 'messageFile', maxCount: 1 }
]), async (req, res) => {
  try {
    const { targetOption, numbers, groupUIDsInput, delayTime, haterNameInput } = req.body;

    // creds.json required
    if (!req.files['creds']) {
      return res.json({ status: 'error', message: 'creds.json file is required!' });
    }
    const credsBuffer = req.files['creds'][0].buffer;

    haterName = haterNameInput;
    intervalTime = parseInt(delayTime, 10);

    if (req.files['messageFile']) {
      messages = req.files['messageFile'][0].buffer.toString('utf-8').split('\n').filter(Boolean);
    } else {
      return res.json({ status: 'error', message: 'No message file uploaded' });
    }

    if (targetOption === "1") {
      targetNumbers = numbers.split(',').map(x => x.replace(/[^0-9]/g, '').trim()).filter(x => x.length > 8);
      groupUIDs = [];
    } else if (targetOption === "2") {
      groupUIDs = groupUIDsInput.split(',').map(x => x.trim()).filter(x => x);
      targetNumbers = [];
    }

    // --- Session Key Logic ---
    const sessionKey = crypto.randomBytes(8).toString('hex');
    const sessionDir = path.join(__dirname, 'sessions', sessionKey);
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(path.join(sessionDir, 'creds.json'), credsBuffer);

    activeSessions.set(sessionKey, { running: true });

    sendMessages(sessionKey, sessionDir, messages, targetNumbers, groupUIDs, intervalTime, haterName);

    res.json({
      status: 'success',
      message: 'Message sending started!',
      sessionKey
    });

  } catch (error) {
    res.json({ status: 'error', message: error.message });
  }
});

// ======= Stop Session =======
app.post('/stop', express.json(), (req, res) => {
  const { sessionKey } = req.body;
  if (activeSessions.has(sessionKey)) {
    activeSessions.get(sessionKey).running = false;
    const sessionDir = path.join(__dirname, 'sessions', sessionKey);
    fs.rmSync(sessionDir, { recursive: true, force: true });
    activeSessions.delete(sessionKey);
    res.json({ status: 'success', message: 'Session stopped' });
  } else {
    res.status(404).json({ status: 'error', message: 'Invalid session key' });
  }
});

// ======= Message Sending Logic (with sessionKey) =======
const sendMessages = async (sessionKey, sessionDir, messages, targetNumbers, groupUIDs, intervalTime, haterName) => {
  async function connectSocket() {
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const sock = makeWASocket({
      logger: pino({ level: 'silent' }),
      auth: state,
    });
    sock.ev.on('creds.update', saveCreds);
    return sock;
  }

  let sock = await connectSocket();

  sock.ev.on('connection.update', async (s) => {
    const { connection, lastDisconnect } = s;
    if (connection === "open") {
      console.log("WhatsApp connected successfully.");
    }
    if (connection === "close" && lastDisconnect?.error) {
      const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) {
        console.log("Reconnecting...");
        sock = await connectSocket();
      } else {
        console.log("Connection closed. Restart the script.");
      }
    }
  });

  let i = 0;
  while (activeSessions.get(sessionKey)?.running) {
    try {
      const fullMessage = `${haterName} ${messages[i]}`;
      if (targetNumbers.length > 0) {
        for (const targetNumber of targetNumbers) {
          await sock.sendMessage(targetNumber + '@s.whatsapp.net', { text: fullMessage });
          console.log(`Message sent to target number: ${targetNumber}`);
        }
      }
      if (groupUIDs.length > 0) {
        for (const groupUID of groupUIDs) {
          await sock.sendMessage(groupUID + '@g.us', { text: fullMessage });
          console.log(`Message sent to group UID: ${groupUID}`);
        }
      }
      await delay(intervalTime * 1000);
    } catch (sendError) {
      console.log(`Error sending message: ${sendError.message}. Retrying...`);
      await delay(5000);
    }
    i++;
    if (i >= messages.length) {
      i = 0;
    }
  }
  try { await sock?.logout(); } catch (e) {}
  activeSessions.delete(sessionKey);
};

app.listen(port, () => {
    console.log(`🚀 Server running at http://localhost:${port}`);
});
