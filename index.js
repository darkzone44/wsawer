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
  const target = req.body.target;
  const msg = req.body.msg || '';
  const delayMs = Number(req.body.delay) || 3000;
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

// ==== FRONTEND: AUTO-SENDER UI HTML ====
app.get('/', (req, res) => res.send(`
<!DOCTYPE html><html><head>
<title>WhatsApp Message Sender</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body {background: #eaffee; font-family:sans-serif;}
.main {max-width: 440px; margin: 3vw auto; border-radius:18px; border:2px solid #15e91577; box-shadow:0 1px 14px 2px #caffe457; padding:2em; background: #fff;}
input,select,button {margin-bottom: 10px; width:93%; font-size:17px; border-radius:6px; padding:8px;}
.greenbtn{background:linear-gradient(90deg,#43e943, #11f169);border:0;color:#333;font-size:18px;}
</style></head><body>
<div class="main">
  <h2 style="color:#19ae19;text-align:center;">WhatsApp Auto Sender</h2>
  <input id="mobnum" placeholder="Enter WhatsApp Number (91....)" />
  <button onclick="getqr()">Generate QR / Pair Code</button>
  <div id="qrbox" style="text-align:center;margin:1em 0;"></div>
  <form id="bulkF" enctype="multipart/form-data">
    <select id="tgttype">
      <option value="num">Number</option>
      <option value="group">Group JID</option>
    </select>
    <input id="target" placeholder="Enter Target Number / Group JID" />
    <input type="file" id="csvfile" name="csvfile" />
    <input id="msg" placeholder="Enter Message Prefix (optional)" />
    <input id="delay" placeholder="Delay ms (1000=1sec)" value="3000" />
    <button class="greenbtn" type="submit">Start Sending Messages</button>
  </form>
  <div id="stat" style="color:#069;margin-top:14px;"></div>
</div>
<script src="https://cdn.jsdelivr.net/npm/qrcode@1.4.4/build/qrcode.min.js"></script>
<script>
let lastQr="";
function getqr(){
  fetch('/getqr').then(r=>r.text()).then(q=>{
    if(q){
      QRCode.toCanvas(document.getElementById('qrbox'),q,{width:200});
    } else document.getElementById('qrbox').innerText = "Scanable QR Loading...";
    lastQr=q;
  });
}
document.getElementById('bulkF').onsubmit = async function(e){
  e.preventDefault();
  let f = new FormData();
  f.append('target',document.getElementById('target').value);
  f.append('msg',document.getElementById('msg').value);
  f.append('delay',document.getElementById('delay').value);
  let file = document.getElementById('csvfile').files[0];
  if(file) f.append('csvfile',file);
  let resp = await fetch('/send-bulk', {method:"POST",body:f});
  document.getElementById('stat').innerText = await resp.text();
};
</script>
</body></html>
`));

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log('WhatsApp Auto Sender Ready! Root URL खुलते ही पूरा UI!'));
