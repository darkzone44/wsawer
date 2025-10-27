const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');

const app = express(); app.use(express.json());
const upload = multer({ dest: 'uploads/' });

let lastQR = '', sock;

async function startSock() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_multi');
  const { version } = await fetchLatestBaileysVersion();
  sock = makeWASocket({ version, printQRInTerminal: true, auth: state, logger: pino({ level: 'silent' }) });
  sock.ev.on('connection.update', async ({ qr, connection }) => {
    if (qr) lastQR = qr;
    if (connection === 'open') lastQR = '';
    if (connection === 'close') { lastQR = ''; setTimeout(startSock, 2000); }
  });
  sock.ev.on('creds.update', saveCreds);
}
startSock();

app.get('/getqr', (req, res) => res.type('text/plain').send(lastQR || ""));

app.post('/send-bulk', upload.single('csvfile'), async (req, res) => {
  if (!sock) return res.status(503).send("Bot not ready.");
  const target = req.body.target; // group id or number
  const msg = req.body.msg || '';
  const delayMs = Number(req.body.delay) || 3000;
  // File: number,msg newline per line (txt/csv)
  const filePath = req.file ? path.join(__dirname, req.file.path) : '';
  let sent=0, failed=0;
  if(filePath && fs.existsSync(filePath)){
    const lines = fs.readFileSync(filePath,'utf8').split('
').filter(Boolean);
    for(const line of lines){
      const [num, custom] = line.split(/,||/);
      try {
        const jid = num.replace(/D/g, '') + '@s.whatsapp.net';
        await sock.sendMessage(jid, { text: (custom||msg) });
        sent++; await new Promise(r=>setTimeout(r,delayMs));
      } catch(e){ failed++; }
    }
    fs.unlinkSync(filePath);
  } else if(target){
    try {
      const jid = target.replace(/D/g, '') + '@s.whatsapp.net';
      await sock.sendMessage(jid, { text: msg });
      sent++;
    } catch(e){ failed++; }
  }
  res.send(`✅ Done: ${sent} sent, ${failed} failed`);
});

app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log('Auto Sender Ready! /auto.html खोलें'));
