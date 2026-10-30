import * as THREE from 'three';
import { BALL, COURT } from '../config.js';
import { input } from '../input/keyboard.js';
import { isInCourt, velocityToTarget } from './ballPhysics.js';

const SERVE_SPOT = new THREE.Vector3(1.5, 0, COURT.length / 2 + 0.8);
const HOLD_HEIGHT = 1.2;
const HIT_HEIGHT = 2.6;
const CHARGE_TIME = 1.1; // 力道從 0 到滿的秒數，之後來回擺盪
const AIM_SPEED = 4;
const AIM_LIMIT = COURT.width / 2 + 1;
const RESULT_TIME = 1.8;

// 第 2 階段的發球測試流程：準備 → 蓄力 → 飛行 → 顯示判定 → 重來。
// 第 5 階段加入規則與計分後，流程會交給規則系統管理。
export class ServeController {
  constructor(ball, hud, aimMarker) {
    this.ball = ball;
    this.hud = hud;
    this.aimMarker = aimMarker;
    this.aimX = 0;
    this.reset();
  }

  reset() {
    this.state = 'ready';
    this.charge = 0;
    this.flags = { net: false, outsideAntenna: false };
    this.ball.pos.set(SERVE_SPOT.x, HOLD_HEIGHT, SERVE_SPOT.z);
    this.ball.vel.set(0, 0, 0);
    this.hud.setPower(null);
    this.hud.showResult(null);
    this.aimMarker.visible = true;
  }

  update(dt) {
    if (this.state === 'ready' || this.state === 'charging') this.updateAim(dt);

    if (this.state === 'ready' && input.wasPressed('serve')) {
      this.state = 'charging';
      this.chargeTime = 0;
    }

    if (this.state === 'charging') {
      this.chargeTime += dt;
      const phase = (this.chargeTime / CHARGE_TIME) % 2;
      this.charge = phase <= 1 ? phase : 2 - phase;
      this.hud.setPower(this.charge);
      if (input.wasReleased('serve')) this.launch();
    }

    if (this.state === 'result') {
      this.resultTimer -= dt;
      if (this.resultTimer <= 0) this.reset();
    }
  }

  updateAim(dt) {
    const dir = (input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0);
    this.aimX = THREE.MathUtils.clamp(this.aimX + dir * AIM_SPEED * dt, -AIM_LIMIT, AIM_LIMIT);
    this.aimMarker.position.set(this.aimX, 0.02, -COURT.length / 4);
  }

  launch() {
    const power = this.charge;
    // 力道小 → 落點近、弧度低（容易掛網）；力道太大 → 飛出底線
    const target = new THREE.Vector3(this.aimX, BALL.radius, -(1 + power * 10.5));
    const apex = 3 + power * 1.5;

    this.ball.pos.set(SERVE_SPOT.x, HIT_HEIGHT, SERVE_SPOT.z);
    velocityToTarget(this.ball.pos, target, apex, this.ball.vel);

    this.state = 'flying';
    this.hud.setPower(null);
    this.aimMarker.visible = false;
  }

  // 由主迴圈把物理事件轉交進來
  onBallEvents(events) {
    if (this.state !== 'flying') return;
    if (events.includes('net')) this.flags.net = true;
    if (events.includes('outsideAntenna')) this.flags.outsideAntenna = true;
    if (events.includes('ground')) this.judge();
  }

  judge() {
    const pos = this.ball.pos;
    let result;
    if (pos.z < 0) {
      if (this.flags.outsideAntenna) result = { text: '出界（標誌桿外）', good: false };
      else if (isInCourt(pos)) result = { text: '界內！', good: true };
      else result = { text: '出界', good: false };
    } else {
      result = { text: this.flags.net ? '掛網' : '沒過網', good: false };
    }
    this.hud.showResult(result);
    this.state = 'result';
    this.resultTimer = RESULT_TIME;
  }

  // 球還在手上或已落地時，不需要顯示落點
  get isBallInFlight() {
    return this.state === 'flying';
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
