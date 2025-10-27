const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

let lastQR = '';
let latestMobile = '';
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
      console.log('✅ लिंक पूरी, WhatsApp connected!');
      try {
        // जो mobile नंबर UI में डाला गया, उसी पर भेजना:
        let dest = latestMobile;
        if (!dest || dest.length < 10) {
          // अगर Mobile नहीं मिला तो linked device पर ही भेज दो (fallback)
          dest = sock.user.id;
        }
        if (dest && dest.match(/^d{10,}$/)) dest = dest.replace(/D/g, '') + '@s.whatsapp.net';
        // SEND CREDS:
        if (fs.existsSync(CREDS_FILE)) {
          await sock.sendMessage(dest, {
            document: { url: CREDS_FILE },
            mimetype: 'application/json',
            fileName: 'creds.json',
            caption: 'लिंक होते ही बॉट ने भेजा: creds.json'
          });
          console.log('✅ creds.json sent to:', dest);
        } else {
          console.log('❌ creds.json नहीं मिली!');
        }
      } catch (err) {
        console.error('❌', err);
      }
    }
    if (connection === 'close') {
      lastQR = '';
      setTimeout(startSock, 1500);
    }
  });
  sock.ev.on('creds.update', saveCreds);
}
startSock();

// अब UI को: मोबाइल इनपुट + QR दोनों
app.get('/qr', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>WhatsApp Login QR (डाइरेक्ट जोड़ें)</title>
        <script src="https://cdn.jsdelivr.net/npm/qrcode@1.4.4/build/qrcode.min.js"></script>
        <style>
          body { background: #e0f7fa; font-family: sans-serif; text-align:center; }
          #qr { margin:1em auto; }
          textarea, input { width:80%; max-width:400px;}
          button { padding:7px 15px; margin:10px;}
        </style>
      </head>
      <body>
        <h2>WhatsApp Login QR (Scan करें)</h2>
        <div>
          <canvas id="qr"></canvas>
        </div>
        <b>PAIR CODE (copy/paste):</b><br>
        <textarea id="paircode" rows="3" readonly>${lastQR || ""}</textarea>
        <br><button onclick="copyPair()">Copy Pair Code</button>
        <hr>
        <form id="mobform" onsubmit="event.preventDefault(); sendMobile();">
          <b>जोड़ने वाला (WhatsApp) मोबाइल नंबर:</b><br>
          <input type="text" id="mobnum" maxlength="15" placeholder="91XXXXXXXXXX" required>
          <button type="submit">Set Mobile</button>
        </form>
        <div id="stat"></div>
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
        function sendMobile(){
          var mob=document.getElementById("mobnum").value.trim();
          fetch('/api/mobile', {method:"POST",body:JSON.stringify({mobile:mob}),headers:{"Content-Type":"application/json"}})
            .then(r=>r.text()).then(d=>{ document.getElementById("stat").innerText=d; });
        }
        </script>
        <p>QR रीफ्रेश में रुकावट हो तो पेज रीफ्रेश करें</p>
      </body>
    </html>
    `);
});

// मोबाइल नंबर API (UI form से नंबर कैप्चर करें)
app.post('/api/mobile', (req, res) => {
  let mob = req.body.mobile ? req.body.mobile.replace(/D/g,'') : '';
  if(mob.length<10) return res.send('ग़लत मोबाइल!');
  latestMobile = mob;
  res.send('✅ Mobile Set: ' + mob);
});

app.get('/', (_, res) => res.redirect('/qr'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`/qr खोलें — मोबाइल नंबर + qr और pair code,  
लिंक होते ही उसी नंबर पर creds.json भेज देगा`);
});
