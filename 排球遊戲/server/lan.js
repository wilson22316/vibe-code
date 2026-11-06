// 連線對戰的伺服器：用 WebSocket（路徑 /lan）轉傳兩位玩家的訊息。
// 只有一個房間：先「建立房間」的是主機（跑整場比賽），之後「加入房間」的是客人。
// 比賽內容伺服器不看，只負責把一方的訊息原封不動轉給另一方。
// 兩種用法：
// - npm run lan：同時提供打包好的遊戲頁面（dist/），玩家直接開 http://IP:8090（沒有 Apache 時、測試用）
// - node server/lan.js --ws-only（啟動連線伺服器.bat、npm run lan:server）：只做轉傳，
//   遊戲頁面由 Apache 提供，Apache 把 /volleyball/lan 轉到這裡（見 部署說明.md）；開發模式也用這個（Vite 轉送 /lan）
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT) || 8090;
const DIST = resolve(fileURLToPath(new URL('../dist', import.meta.url)));
const WS_PATH = '/lan'; // 跟 src/net/connection.js 一致
const WS_ONLY = process.argv.includes('--ws-only');
const HEARTBEAT = 20000; // 毫秒：定時 ping，避免等待對手時 Apache 轉送因為太久沒資料而斷線（Apache 預設 60 秒）

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

if (!WS_ONLY && !existsSync(join(DIST, 'index.html'))) {
  console.error('找不到 dist/index.html，請先執行 npm run build（npm run lan 會自動先打包）');
  process.exit(1);
}

// 靜態檔案：只能讀 dist 裡面的檔案（--ws-only 時不提供）
const server = createServer((req, res) => {
  if (WS_ONLY) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('這是連線轉傳伺服器，遊戲頁面請從網站開');
    return;
  }
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = normalize(join(DIST, path));
  if (file !== DIST && !file.startsWith(DIST + sep)) {
    res.writeHead(403).end();
    return;
  }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('找不到檔案');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
  createReadStream(file).pipe(res);
});

// 本機的內網 IPv4 位址（給另一台裝置連進來用）
function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a.address);
}


const room = { host: null, guest: null };
const wss = new WebSocketServer({ server, path: WS_PATH });

const sendJson = (ws, msg) => ws && ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));

// 心跳：回應不了 ping 的連線（裝置斷網、瀏覽器關掉沒通知）當作離開
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) {
      ws.terminate();
      continue;
    }
    ws.alive = false;
    ws.ping();
  }
}, HEARTBEAT);
wss.on('close', () => clearInterval(heartbeat));

wss.on('connection', (ws) => {
  let role = null; // 'host' | 'guest'
  ws.alive = true;
  ws.on('pong', () => {
    ws.alive = true;
  });

  ws.on('message', (data, isBinary) => {
    if (role) {
      // 已經在房間裡：原封不動轉給對方
      const other = role === 'host' ? room.guest : room.host;
      if (other && other.readyState === other.OPEN) other.send(data, { binary: isBinary });
      return;
    }
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (msg.t === 'create') {
      if (room.host) {
        sendJson(ws, { t: 'error', msg: '已經有人建立房間了，請選「加入房間」' });
        return;
      }
      role = 'host';
      room.host = ws;
      sendJson(ws, { t: 'created', ips: lanAddresses() }); // 網頁用它組出給對手開的網址
      console.log('房間已建立，等待對手加入');
    } else if (msg.t === 'join') {
      if (!room.host) {
        sendJson(ws, { t: 'error', msg: '還沒有人建立房間' });
        return;
      }
      if (room.guest) {
        sendJson(ws, { t: 'error', msg: '房間已滿（目前只支援 1 對 1）' });
        return;
      }
      role = 'guest';
      room.guest = ws;
      sendJson(ws, { t: 'joined' });
      sendJson(room.host, { t: 'peer-joined' });
      console.log('對手已加入，比賽開始');
    }
  });

  // 任何一方離開：通知另一方，房間解散
  ws.on('close', () => {
    if (!role) return;
    const other = role === 'host' ? room.guest : room.host;
    room.host = null;
    room.guest = null;
    sendJson(other, { t: 'peer-left' });
    other?.close();
    console.log(role === 'host' ? '主機離開，房間解散' : '客人離開，房間解散');
  });
});

// 只做轉傳時只聽本機（Apache 從 127.0.0.1 轉過來），不用對外開這個埠號
server.listen(PORT, WS_ONLY ? '127.0.0.1' : undefined, () => {
  console.log('');
  if (WS_ONLY) {
    console.log('  ビーチバレー！連線轉傳伺服器已啟動（只做轉傳，遊戲頁面由 Apache 提供）');
    console.log(`  轉傳位址：ws://127.0.0.1:${PORT}${WS_PATH}`);
    console.log('  玩家照平常的遊戲網址開，選「多人連線」→ 一台「建立房間」、另一台「加入房間」');
  } else {
    console.log('  ビーチバレー！內網連線伺服器已啟動');
    console.log(`  這台電腦：http://localhost:${PORT}`);
    for (const ip of lanAddresses()) console.log(`  同一個網路的其他裝置：http://${ip}:${PORT}`);
    console.log('  兩台裝置都用瀏覽器打開網址 → 多人連線 → 一台「建立房間」、另一台「加入房間」');
  }
  console.log('  關掉這個視窗（或按 Ctrl+C）就會停止，正在進行的連線對戰會中斷');
  console.log('');
});
