import * as THREE from 'three';
import { BALL, COURT } from '../config.js';
import { input } from '../input/keyboard.js';
import { velocityToTarget } from './ballPhysics.js';

const SERVE_SPOT = new THREE.Vector3(1.5, 0, COURT.length / 2 + 0.8);
// 發球員站在球的左後方，球在右手邊，鏡頭從後面看才不會被身體擋住
const SERVER_OFFSET_X = -0.45;
const SERVER_OFFSET_Z = 0.25;
const HOLD_HEIGHT = 1.2;
const HIT_HEIGHT = 2.6;
const CHARGE_TIME = 1.1; // 力道從 0 到滿的秒數，之後來回擺盪
const AIM_SPEED = 4;
const AIM_LIMIT = COURT.width / 2 + 1;

// 發球：準備 → 蓄力 → 發出（之後交給 Rally）。
export class ServeController {
  // onReset：每球重來時呼叫（讓其他角色回站位），在發球員就位之前執行
  // onServe：球發出後呼叫
  constructor(ball, hud, aimMarker, server, { onReset, onServe }) {
    this.ball = ball;
    this.hud = hud;
    this.aimMarker = aimMarker;
    this.server = server;
    this.onReset = onReset;
    this.onServe = onServe;
    this.aimX = 0;
    this.reset();
  }

  reset() {
    this.onReset();
    this.server.resetTo(SERVE_SPOT.x + SERVER_OFFSET_X, SERVE_SPOT.z + SERVER_OFFSET_Z);
    this.state = 'ready';
    this.charge = 0;
    this.ball.pos.set(SERVE_SPOT.x, HOLD_HEIGHT, SERVE_SPOT.z);
    this.ball.vel.set(0, 0, 0);
    this.hud.setPower(null);
    this.hud.showResult(null);
    this.aimMarker.visible = true;
  }

  update(dt) {
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
      if (input.wasReleased('action')) this.launch();
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
