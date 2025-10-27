const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason, makeInMemoryStore } = require('@whiskeysockets/baileys');
const pino = require('pino');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.json());

let sock; // Baileys socket

// QR वाला endpoint (Web Dashboard से Pair)
app.get('/qr', async (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end(`<html>
    <body>
      <h2>WhatsApp Pair Code / QR Scanner</h2>
      <div id="qrd"></div>
      <script>
        fetch('/getqr').then(r => r.json()).then(resp => {
          document.getElementById('qrd').innerText = resp.qr;
        });
      </script>
    </body></html>`);
});

// Route - Baileys से QR देना (automate करें)
app.get('/getqr', async (req, res) => {
  if (sock && sock.authState && sock.authState.creds) {
    res.json({ ready: true, qr: "Already paired" });
    return;
  }
  // QR generate करने के लिए socket connect
  setupSocket((qrCode) => {
    res.json({ qr: qrCode });
  });
});

async function setupSocket(qrCb) {
  const { state, saveCreds } = await useMultiFileAuthState('auth_multi');
  const { version } = await fetchLatestBaileysVersion();
  sock = makeWASocket({
    version,
    printQRInTerminal: true,
    auth: state,
    logger: pino({ level: 'silent' }),
    getMessage: async (key) => ({ conversation: " " }),
  });
  sock.ev.on('connection.update', ({ qr, connection, lastDisconnect }) => {
    if (qr) qrCb && qrCb(qr);
    if (connection === 'open') console.log('✅ WhatsApp connected!');
    if (connection === 'close' && lastDisconnect) {
      setupSocket(qrCb);
    }
  });
  sock.ev.on('creds.update', saveCreds);
}
setupSocket(); // App startup पर socket चला दो

// Dashboard (TXT upload Page)
app.get('/', (req, res) => {
  res.send(`
    <form id="uploadForm" enctype="multipart/form-data" method="POST" action="/upload">
      <input type="file" name="txtfile" accept=".txt" required />
      <button type="submit">Send All</button>
    </form>
    <div id="log"></div>
    <a href="/qr">Pair QR / Link Device</a>
    <script>
      const f = document.getElementById('uploadForm');
      f.onsubmit = async e => {
        e.preventDefault();
        const d = new FormData(f);
        const r = await fetch('/upload', { method: 'POST', body: d });
        document.getElementById('log').innerHTML += await r.text();
      }
    </script>
  `);
});

// TXT Bulk Upload और Bulk Send - Group/Number
app.post('/upload', upload.single('txtfile'), async (req, res) => {
  try {
    if (!sock) return res.send('❌ Bot Ready Nahi Hai.');
    const filePath = path.join(__dirname, req.file.path);
    const lines = fs.readFileSync(filePath, 'utf8').split('
').filter(Boolean);
    for (let line of lines) {
      const [num, msg, delayMs] = line.split('|');
      const chatId = num.includes('@g.us') ? num : num.replace(/D/g, '') + '@s.whatsapp.net';
      await sock.sendMessage(chatId, { text: msg });
      await new Promise(r => setTimeout(r, parseInt(delayMs) || 3000));
    }
    fs.unlinkSync(filePath);
    res.send('✅ Bulk Messages Sent!');
  } catch (e) {
    console.error(e);
    res.status(500).send('❌ Error processing!');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server on ' + PORT));
