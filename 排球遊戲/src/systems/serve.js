import * as THREE from 'three';
import { BALL, COURT, HUMAN_SIDES } from '../config.js';
import { JUMP_PEAK, jumpToReach } from '../entities/player.js';
import { inputFor } from '../input/keyboard.js';
import { aiServePower } from './ai.js';
import { velocityToTarget } from './ballPhysics.js';

const SERVE_X = 1.5;
const SERVE_BEHIND = 0.8; // 站在底線後多遠
// 發球員站在球的左後方（以 home 視角），球在右手邊，鏡頭從後面看才不會被身體擋住；
// 球在前方 0.6 公尺，起跳擊球時球在額頭前上方，不會貼到臉
const SERVER_OFFSET_X = -0.45;
const SERVER_OFFSET_Z = 0.6;
const HOLD_HEIGHT = 1.2;
const HIT_HEIGHT = 2.6;
const TOSS_LIFT = 0.5; // 拋球的弧度：球往上拋再落到擊球點
const CHARGE_TIME = 1.1; // 力道從 0 到滿的秒數，之後來回擺盪
const AIM_SPEED = 4;
const AIM_LIMIT = COURT.width / 2 + 1;

// AI 發球：等一下再發；力道（含失誤率）依難度
const AI_SERVE_DELAY = 1.2;
const AI_AIM_LIMIT = 3.2;

// 發球：準備 → 蓄力 → 拋球起跳 → 擊球（之後交給 Rally）。AI 隊伍則自動發球。
export class ServeController {
  // onReset：每球重來時呼叫（讓其他角色回站位），在發球員就位之前執行
  // onServe：球發出後呼叫
  constructor(ball, hud, aimMarker, { onReset, onServe }) {
    this.ball = ball;
    this.hud = hud;
    this.aimMarker = aimMarker;
    this.onReset = onReset;
    this.onServe = onServe;
    this.spot = new THREE.Vector3();
    this.tossFrom = new THREE.Vector3();
    this.contact = new THREE.Vector3();
    this.aimX = 0;
    this.state = 'idle';
  }

  reset(server) {
    const s = server.team.side;
    this.server = server;
    this.side = s;
    this.onReset();
    this.spot.set(s * SERVE_X, 0, s * (COURT.length / 2 + SERVE_BEHIND));
    server.resetTo(this.spot.x + s * SERVER_OFFSET_X, this.spot.z + s * SERVER_OFFSET_Z);

    const human = HUMAN_SIDES.includes(s);
    this.local = s === HUMAN_SIDES[0]; // 這台裝置的玩家發球：瞄準標記、力道條只給發球的人看
    this.state = human ? 'ready' : 'ai';
    this.aiTimer = AI_SERVE_DELAY;
    this.charge = 0;
    this.ball.pos.set(this.spot.x, HOLD_HEIGHT, this.spot.z);
    this.ball.vel.set(0, 0, 0);
    this.hud.setPower(null);
    this.hud.showResult(null);
    this.aimMarker.visible = this.local;
  }

  update(dt) {
    if (this.state === 'tossing') {
      this.updateToss(dt);
      return;
    }

    if (this.state === 'ai') {
      this.aiTimer -= dt;
      if (this.aiTimer <= 0) this.aiServe();
      return;
    }

    if (this.state === 'ready' || this.state === 'charging') this.updateAim(dt);

    const input = inputFor(this.side);
    if (this.state === 'ready' && input.wasPressed('action')) {
      this.state = 'charging';
      this.chargeTime = 0;
    }

    if (this.state === 'charging') {
      this.chargeTime += dt;
      const phase = (this.chargeTime / CHARGE_TIME) % 2;
      this.charge = phase <= 1 ? phase : 2 - phase;
      if (this.local) this.hud.setPower(this.charge);
      if (input.wasReleased('action')) this.launch(this.charge);
    }
  }

  // 這一球不用發球（練習扣球、攔網直接從舉球開始）：按空白鍵不會開始蓄力
  clear() {
    this.state = 'idle';
    this.aimMarker.visible = false;
    this.hud.setPower(null);
  }

  // 暫停時取消蓄力：暫停期間放開按鍵不會被偵測到，繼續後才不會莫名其妙發出去
  cancelCharge() {
    if (this.state !== 'charging') return;
    this.state = 'ready';
    this.hud.setPower(null);
  }

  // 鏡頭在自己那隊後面：-z 那隊看出去左右相反
  updateAim(dt) {
    const input = inputFor(this.side);
    const dir = this.side * ((input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0));
    this.aimX = THREE.MathUtils.clamp(this.aimX + dir * AIM_SPEED * dt, -AIM_LIMIT, AIM_LIMIT);
    this.aimMarker.position.set(this.aimX, 0.02, -this.side * (COURT.length / 4));
  }

  aiServe() {
    this.aimX = (Math.random() * 2 - 1) * AI_AIM_LIMIT;
    this.launch(aiServePower());
  }

  // 放開蓄力（或 AI 決定好）：先把球往上拋、發球員起跳，跳到最高點時剛好擊中球
  launch(power) {
    this.power = power;
    this.state = 'tossing';
    this.tossTime = 0;
    this.tossFrom.copy(this.ball.pos);
    this.contact.set(this.spot.x, HIT_HEIGHT, this.spot.z);
    this.server.playJump(jumpToReach(HIT_HEIGHT, 'serve'));
    this.hud.setPower(null);
    this.aimMarker.visible = false;
  }

  updateToss(dt) {
    this.tossTime += dt;
    const k = Math.min(1, this.tossTime / JUMP_PEAK);
    this.ball.pos.lerpVectors(this.tossFrom, this.contact, k);
    this.ball.pos.y += TOSS_LIFT * Math.sin(Math.PI * k);
    this.server.setReach('serve', this.ball.pos, k); // 球越接近擊球點，手越準確地伸向球
    if (k >= 1) this.hitServe();
  }

  hitServe() {
    // 力道小 → 落點近、弧度低（容易掛網）；力道太大 → 飛出底線
    const power = this.power;
    const target = new THREE.Vector3(this.aimX, BALL.radius, -this.side * (1 + power * 10.5));
    const apex = 3 + power * 1.5;
    velocityToTarget(this.ball.pos, target, apex, this.ball.vel);
    this.server.applyReach(); // 碰球這一刻手剛好在球上，揮臂動作從這個姿勢接下去
    this.server.playAction('spike');
    this.server.setReach(null);
    this.state = 'served';
    this.onServe(this.server);
  }
}

export function createAimMarker() {
  const marker = new THREE.Mesh(
    new THREE.RingGeometry(0.4, 0.6, 32),
    new THREE.MeshBasicMaterial({ color: 0xff5a3d, transparent: true, opacity: 0.9, depthWrite: false }),
  );
  marker.rotation.x = -Math.PI / 2;
  return marker;
}
