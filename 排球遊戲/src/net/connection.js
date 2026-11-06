// 跟連線伺服器（server/lan.js）溝通的 WebSocket。連到「遊戲網頁所在路徑」底下的 lan：
// npm run lan 開的 http://IP:8090/ → /lan；Apache 的 http://網址/volleyball/ → /volleyball/lan（由 Apache 轉給 Node）
function socketUrl() {
  const url = new URL('lan', location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
}

export class Connection {
  // onMessage(msg)：收到對方的訊息（已解析的 JSON）；onClose()：連線斷了（對方離開或伺服器關閉）
  constructor({ onMessage = () => {}, onClose = () => {} } = {}) {
    this.onMessage = onMessage;
    this.onClose = onClose;
    this.ws = null;
    this.closed = false;
  }

  // role：'create'（建立房間）或 'join'（加入房間）。成功回傳伺服器的回覆，失敗丟出錯誤（訊息是給玩家看的中文）
  open(role) {
    return new Promise((resolve, reject) => {
      let ws;
      try {
        ws = new WebSocket(socketUrl());
      } catch {
        reject(new Error('連不上連線伺服器'));
        return;
      }
      this.ws = ws;
      let settled = false;
      ws.onopen = () => ws.send(JSON.stringify({ t: role }));
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (!settled) {
          settled = true;
          if (msg.t === 'error') {
            this.closed = true;
            ws.close();
            reject(new Error(msg.msg));
          } else {
            resolve(msg);
          }
          return;
        }
        this.onMessage(msg);
      };
      ws.onclose = () => {
        if (!settled) {
          settled = true;
          reject(new Error('連不上連線伺服器：請確認伺服器電腦有啟動連線伺服器'));
          return;
        }
        if (this.closed) return;
        this.closed = true;
        this.onClose();
      };
    });
  }

  send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  // 自己離開（不會觸發 onClose）
  close() {
    this.closed = true;
    this.ws?.close();
  }
}
