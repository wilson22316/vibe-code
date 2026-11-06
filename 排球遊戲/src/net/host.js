// 內網連線對戰的主機端：整場比賽（物理、判定、計分）都在這台跑，
// 每幀把客人畫面需要的狀態，連同這一幀發生的事件（擊球、得分、球員動作…）送過去
const GUEST_SIDE = -1;
const SEND_INTERVAL = 15; // 毫秒：最多每秒約 60 次；有事件時馬上送
// 會改變球員動畫的方法：主機呼叫時記下來，客人照著呼叫一次
const ANIMS = ['resetTo', 'playJump', 'playAction', 'playDive', 'celebrate', 'mope'];

const r3 = (v) => Math.round(v * 1000) / 1000;

export class HostSync {
  // conn：Connection；deps：{ players, ball, rally, serve }（players 的順序兩邊一致）
  constructor(conn, { players, ball, rally, serve }) {
    this.conn = conn;
    this.players = players;
    this.ball = ball;
    this.rally = rally;
    this.serve = serve;
    this.events = [];
    this.lastSend = 0;
  }

  // 攔截球員的動作方法（包一層記錄事件），release() 拿掉
  capture() {
    this.players.forEach((p, i) => {
      for (const name of ANIMS) {
        const original = p[name];
        p[name] = (...args) => {
          // 球員參數（擊掌的隊友）換成編號；揮臂動作要從碰球那一刻的伸手姿勢接下去，一起帶上
          const data = { i, name, args: args.map((a) => (a && typeof a === 'object' ? { p: this.players.indexOf(a) } : a)) };
          if (name === 'playAction' && p.reach) {
            const { kind, target, weight } = p.reach;
            data.reach = { kind, t: [r3(target.x), r3(target.y), r3(target.z)], w: weight };
          }
          this.events.push(['anim', data]);
          return original.apply(p, args);
        };
      }
    });
  }

  release() {
    for (const p of this.players) for (const name of ANIMS) delete p[name];
  }

  // 比賽事件（Rally 的擊球、得分…）；資料裡的 Vector3 轉成陣列、球員物件拿掉
  event(name, data = {}) {
    const packed = {};
    for (const [k, v] of Object.entries(data)) {
      if (v?.isVector3) packed[k] = { v3: [r3(v.x), r3(v.y), r3(v.z)] };
      else if (v === null || typeof v !== 'object' || !('team' in v)) packed[k] = v;
    }
    this.events.push([name, packed]);
  }

  // 每幀呼叫（所有更新做完之後）；zoom：鏡頭推近程度
  send(zoom) {
    const now = performance.now();
    if (!this.events.length && now - this.lastSend < SEND_INTERVAL) return;
    this.lastSend = now;
    const { ball, rally, serve } = this;
    const cue = rally.getCue(GUEST_SIDE);
    const aim = rally.getSpikeTarget(GUEST_SIDE);
    const serving = serve.side === GUEST_SIDE && (serve.state === 'ready' || serve.state === 'charging');
    this.conn.send({
      t: 's',
      b: [ball.pos.x, ball.pos.y, ball.pos.z, ball.vel.x, ball.vel.y, ball.vel.z, ball.gravity].map(r3),
      phys: rally.state !== 'idle', // 客人要不要自己往下算球的物理（發球拋球時球是直接擺位置的）
      live: rally.state === 'live',
      bs: rally.ballState,
      p: this.players.map((p) => [
        r3(p.pos.x),
        r3(p.pos.z),
        r3(p.target.x),
        r3(p.target.z),
        r3(p.auraTarget),
        p.reach ? p.reach.kind : 0,
        p.reach ? r3(p.reach.weight) : 0,
      ]),
      cue: cue && [r3(cue.x), r3(cue.z), r3(cue.timeLeft)],
      aim: aim && [aim.x, aim.z],
      sv: serving ? [r3(serve.aimX), serve.state === 'charging' ? r3(serve.charge) : -1] : null,
      en: [rally.energy[1], rally.energy[-1]],
      ar: [rally.armed[1], rally.armed[-1]],
      zoom,
      ev: this.events,
    });
    this.events = [];
  }
}
