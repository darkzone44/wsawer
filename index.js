const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

const app = express();

let lastQR = '';
let pairedJid = ''; // लिंक होते ही यहां नंबर आ जाएगा

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

  sock.ev.on('connection.update', async ({ qr, connection, lastDisconnect }) => {
    if (qr) lastQR = qr;
    if (connection === 'open') {
      console.log('✅ डिवाइस लिंक हो गया!');
      try {
        // अपनी खुद की JID लो (linked device का नंबर)
        pairedJid = sock.user.id;
        // भेजो creds.json file — अगर फाइल मिलती है तभी
        if (fs.existsSync(CREDS_FILE)) {
          await sock.sendMessage(
            pairedJid.includes(':') ? pairedJid.split(':')[0] + '@s.whatsapp.net' : pairedJid,
            {
              document: { url: CREDS_FILE },
              mimetype: 'application/json',
              fileName: 'creds.json',
              caption: 'डिवाइस लिंक होते ही ऑटो भेजा गया योर creds.json'
            }
          );
          console.log('✅ creds.json sent to linked device:', pairedJid);
        } else {
          console.log('❌ creds.json फाइल नहीं मिली!');
        }
      } catch (e) {
        console.log('❌ sendMessage error:', e);
      }
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
  res.send(`<html>
    <body>
      <h2>QR/Pair Code (स्कैन करें)</h2>
      <pre id="qrd">${lastQR ? lastQR : "QR बनने/refresh का इंतजार करें..."}</pre>
    </body>
  </html>`);
});
app.get('/', (_, res) => res.redirect('/qr'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server on port ${PORT}
/qr पर जायें और लिंक करें!`);
});
