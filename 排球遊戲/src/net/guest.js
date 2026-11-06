import * as THREE from 'three';
import { stepBall } from '../systems/ballPhysics.js';

const SNAP_DIST = 1; // 球員位置跟主機差超過這個就直接跳過去（例如回站位）
const CORRECT = 0.35; // 每次收到狀態，球員位置往主機那邊拉近多少比例（其餘靠自己往目標跑，動畫才自然）

// 內網連線對戰的客人端：不跑比賽邏輯，只套用主機送來的狀態。
// 球用同一套物理自己往下算（兩次狀態之間也順），球員往主機給的目標跑，動作照主機的事件播
export class GuestSync {
  // players 的順序跟主機一致；step：物理固定步長
  constructor(players, ball, step) {
    this.players = players;
    this.ball = ball;
    this.step = step;
    this.state = null; // 最新的狀態
    this.fresh = false; // 上一幀之後有沒有收到新狀態
    this.events = [];
    this.accumulator = 0;
    this.energy = { 1: 0, [-1]: 0 };
    this.armed = { 1: false, [-1]: false };
  }

  receive(msg) {
    if (msg.t !== 's') return;
    this.state = msg;
    this.fresh = true;
    this.events.push(...msg.ev);
  }

  // 取出還沒處理的事件 [name, data]；data 裡的位置還原成 Vector3
  takeEvents() {
    const events = this.events;
    this.events = [];
    for (const [, data] of events) {
      for (const [k, v] of Object.entries(data)) if (v?.v3) data[k] = new THREE.Vector3(...v.v3);
    }
    return events;
  }

  // 照主機呼叫一次球員的動作方法
  playAnim({ i, name, args, reach }) {
    const p = this.players[i];
    if (name === 'playAction' && reach) {
      p.setReach(reach.kind, new THREE.Vector3(...reach.t), reach.w);
      p.applyReach();
    }
    p[name](...args.map((a) => (a && typeof a === 'object' ? this.players[a.p] : a)));
  }

  get live() {
    return this.state?.live ?? false;
  }

  get ballState() {
    return this.state?.bs ?? null;
  }

  get zoom() {
    return this.state?.zoom ?? 0;
  }

  // 時機提示圈 { x, z, timeLeft } 或 null
  get cue() {
    const c = this.state?.cue;
    return c ? { x: c[0], z: c[1], timeLeft: c[2] } : null;
  }

  // 扣球瞄準準星 { x, z } 或 null
  get spikeTarget() {
    const a = this.state?.aim;
    return a ? { x: a[0], z: a[1] } : null;
  }

  // 輪到客人發球時：{ aimX, charge }（charge 為 null 表示還沒蓄力）；不是就 null
  get serve() {
    const s = this.state?.sv;
    return s ? { aimX: s[0], charge: s[1] >= 0 ? s[1] : null } : null;
  }

  // 套用最新狀態（每幀呼叫，事件處理完之後）
  apply() {
    if (!this.fresh) return;
    this.fresh = false;
    const s = this.state;
    const b = s.b;
    this.ball.pos.set(b[0], b[1], b[2]);
    this.ball.vel.set(b[3], b[4], b[5]);
    this.ball.gravity = b[6];
    this.accumulator = 0;
    this.players.forEach((p, i) => {
      const [x, z, tx, tz, aura, reachKind, reachWeight] = s.p[i];
      const dx = x - p.pos.x;
      const dz = z - p.pos.z;
      if (Math.hypot(dx, dz) > SNAP_DIST) {
        p.pos.set(x, 0, z);
      } else {
        p.pos.x += dx * CORRECT;
        p.pos.z += dz * CORRECT;
      }
      p.target.set(tx, 0, tz);
      p.setAura(aura);
      if (reachKind) p.setReach(reachKind, this.ball.pos, reachWeight);
      else p.setReach(null);
    });
    this.energy[1] = s.en[0];
    this.energy[-1] = s.en[1];
    this.armed[1] = s.ar[0];
    this.armed[-1] = s.ar[1];
  }

  // 兩次狀態之間：球照物理往下飛（主機也在算的時候才算）；frozen：衝擊定格中
  stepBall(dt, frozen) {
    if (!this.state?.phys) {
      this.accumulator = 0;
      return;
    }
    this.accumulator += dt;
    while (this.accumulator >= this.step && !frozen) {
      stepBall(this.ball, this.step);
      this.accumulator -= this.step;
    }
  }
}
