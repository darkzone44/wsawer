const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

const app = express();
let sock;
let AUTOSEND_TARGET = "9199xxxxxxxx@s.whatsapp.net"; // <--- अपना target mobile नंबर यहाँ डालें
let AUTOSEND_MSG = "WhatsApp बॉट सफलतापूर्वक डिवाइस से लिंक हो गया!"; // <--- ऑटो सेंड मैसेज

// QR-Page UI for scan from browser
app.get('/qr', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end(`<html>
    <body>
      <h2>WhatsApp Pair Code & QR</h2>
      <pre id="qrd"></pre>
      <script>
        fetch('/getqr').then(r => r.json()).then(r => {
          document.getElementById('qrd').innerText = r.qr || r.info || 'Already linked or waiting...';
        });
      </script>
    </body>
  </html>`);
});

// serve QR code for frontend polling
let lastQR = '';
app.get('/getqr', (req, res) => {
  res.json({ qr: lastQR });
});

async function startSock() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_multi');
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    printQRInTerminal: true,
    auth: state,
    logger: pino({ level: 'silent' }),
    getMessage: async (key) => ({ conversation: " " }),
  });

  sock.ev.on('connection.update', async ({ qr, connection }) => {
    if (qr) lastQR = qr;
    if (connection === 'open') {
      console.log('✅ WhatsApp Linked!');
      // creds.json जैसे ही बने - ऑटो मैसेज करो!
      try {
        await sock.sendMessage(AUTOSEND_TARGET, { text: AUTOSEND_MSG });
        console.log('✅ Auto message sent!');
      } catch (e) {
        console.log('❌ Auto message error:', e);
      }
    }
    if (connection === 'close') {
      lastQR = '';
      setTimeout(startSock, 3000); // Retry link on disconnect
    }
  });
  sock.ev.on('creds.update', saveCreds);
}
startSock();

app.get('/', (req, res) => {
  res.send(`<html>
    <body>
      <h2>WhatsApp Device Linking Demo</h2>
      <a href="/qr">QR/Pair Code Scan Page खोलें</a>
      <p>लिंक होते ही ${AUTOSEND_TARGET} पर मैसेज चला जायेगा।</p>
    </body>
  </html>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Server running on port', PORT);
});
