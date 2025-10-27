const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

const app = express();

let lastQR = '';
const AUTH_FOLDER = './auth_multi';
const CREDS_FILE = path.join(AUTH_FOLDER, 'creds.json');

async function startSock() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_multi');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    printQRInTerminal: true,
    auth: state,
    logger: pino({ level: 'silent' }),
  });

  sock.ev.on('connection.update', async ({ qr, connection }) => {
    if (qr) lastQR = qr;
    if (connection === 'open') {
      console.log('✅ डिवाइस लिंक हो गया!');
      // यहां आप creds.json भेज सकते हैं जैसा पहले कोड में बताया
    }
    if (connection === 'close') {
      lastQR = '';
      setTimeout(startSock, 2000);
    }
  });
  sock.ev.on('creds.update', saveCreds);
}

startSock();

app.get('/qr', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>WhatsApp QR / Pair Code</title>
        <script src="https://cdn.jsdelivr.net/npm/qrcode@1.4.4/build/qrcode.min.js"></script>
        <style>
          body { font-family: sans-serif; background: #e0f7fa; text-align: center;}
          #qr { margin: 2em auto; }
          textarea { width: 80%; }
          button {padding: 6px 13px; margin:10px;}
        </style>
      </head>
      <body>
        <h2>WhatsApp Login QR (इमेज स्कैन करें)</h2>
        <div>
          <canvas id="qr"></canvas>
        </div>
        <hr>
        <b>PAIR CODE (copy/paste):</b><br>
        <textarea id="paircode" rows="3" readonly>${lastQR || ""}</textarea>
        <br />
        <button onclick="copyPair()">Copy Pair Code</button>
        <script>
          var code = document.getElementById("paircode").value.trim();
          if (code) {
            QRCode.toCanvas(document.getElementById('qr'), code, {width: 256});
          }
          function copyPair() {
            document.getElementById("paircode").select();
            document.execCommand("copy");
            alert("Pair code copied!");
          }
        </script>
        <p>QR दिखने/refresh में रुकावट आये तो पेज रीफ्रेश करें</p>
      </body>
    </html>
  `);
});

app.get('/', (_, res) => res.redirect('/qr'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`/qr ओपन करें, QR image और pair code दोनों दिखेंगे (WhatsApp से स्कैन/पेस्ट कर सकते हैं)`);
});
