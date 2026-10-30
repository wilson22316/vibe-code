import * as THREE from 'three';
import { BALL, COURT, HUMAN_SIDES } from '../config.js';
import { input } from '../input/keyboard.js';
import { velocityToTarget } from './ballPhysics.js';

const SERVE_X = 1.5;
const SERVE_BEHIND = 0.8; // 站在底線後多遠
// 發球員站在球的左後方（以 home 視角），球在右手邊，鏡頭從後面看才不會被身體擋住
const SERVER_OFFSET_X = -0.45;
const SERVER_OFFSET_Z = 0.25;
const HOLD_HEIGHT = 1.2;
const HIT_HEIGHT = 2.6;
const CHARGE_TIME = 1.1; // 力道從 0 到滿的秒數，之後來回擺盪
const AIM_SPEED = 4;
const AIM_LIMIT = COURT.width / 2 + 1;

// AI 發球：等一下再發，大多落在界內，偶爾失誤
const AI_SERVE_DELAY = 1.2;
const AI_FAULT_RATE = 0.1;
const AI_AIM_LIMIT = 3.2;

// 發球：準備 → 蓄力 → 發出（之後交給 Rally）。AI 隊伍則自動發球。
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
    this.state = human ? 'ready' : 'ai';
    this.aiTimer = AI_SERVE_DELAY;
    this.charge = 0;
    this.ball.pos.set(this.spot.x, HOLD_HEIGHT, this.spot.z);
    this.ball.vel.set(0, 0, 0);
    this.hud.setPower(null);
    this.hud.showResult(null);
    this.aimMarker.visible = human;
  }

  update(dt) {
    if (this.state === 'ai') {
      this.aiTimer -= dt;
      if (this.aiTimer <= 0) this.aiServe();
      return;
    }

    if (this.state === 'ready' || this.state === 'charging') this.updateAim(dt);

    if (this.state === 'ready' && input.wasPressed('action')) {
      this.state = 'charging';
      this.chargeTime = 0;
    }

    if (this.state === 'charging') {
      this.chargeTime += dt;
      const phase = (this.chargeTime / CHARGE_TIME) % 2;
      this.charge = phase <= 1 ? phase : 2 - phase;
      this.hud.setPower(this.charge);
      if (input.wasReleased('action')) this.launch(this.charge);
    }
  }

  updateAim(dt) {
    const dir = (input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0);
    this.aimX = THREE.MathUtils.clamp(this.aimX + dir * AIM_SPEED * dt, -AIM_LIMIT, AIM_LIMIT);
    this.aimMarker.position.set(this.aimX, 0.02, -this.side * (COURT.length / 4));
  }

  // 力道約 0.33～0.67 會落在界內（見 launch 的換算）
  aiServe() {
    let power;
    if (Math.random() < AI_FAULT_RATE) power = Math.random() < 0.5 ? 0.1 + Math.random() * 0.15 : 0.72 + Math.random() * 0.18;
    else power = 0.38 + Math.random() * 0.26;
    this.aimX = (Math.random() * 2 - 1) * AI_AIM_LIMIT;
    this.launch(power);
  }

  launch(power) {
    // 力道小 → 落點近、弧度低（容易掛網）；力道太大 → 飛出底線
    const target = new THREE.Vector3(this.aimX, BALL.radius, -this.side * (1 + power * 10.5));
    const apex = 3 + power * 1.5;

    this.ball.pos.set(this.spot.x, HIT_HEIGHT, this.spot.z);
    velocityToTarget(this.ball.pos, target, apex, this.ball.vel);
    this.server.playAction('swing');

    this.state = 'served';
    this.hud.setPower(null);
    this.aimMarker.visible = false;
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
