import * as THREE from 'three';
import { PLAYER } from '../config.js';
import { buildCharacter } from './characterModel.js';

const ARRIVE_RADIUS = 0.05;
const SLOW_RADIUS = 0.8; // 接近目標時減速，避免來回抖動
const ACTION_TIME = { swing: 0.35, bump: 0.35, set: 0.35 };
export const JUMP_TIME = 0.6;
const JUMP_HEIGHT = 0.8;

// 場上的球員：移動、轉向、動作動畫。外觀見 characterModel.js
export class Player {
  constructor({ team, shirt, skin, hair, hairStyle, accessory, number, base }) {
    this.team = team;
    this.base = new THREE.Vector3(base[0], 0, base[1]);
    this.pos = this.base.clone();
    this.target = this.base.clone();
    this.heading = team.side > 0 ? Math.PI : 0; // 面向網子
    this.facing = null; // 停下來時要看的點；null 表示看向網子
    this.runAmount = 0;
    this.speedScale = 1; // 跑速倍率（電腦難度用）
    this.phase = 0;
    this.time = Math.random() * 10;
    this.action = null;
    this.actionTimer = 0;
    this.jumpTimer = 0;

    this.mesh = buildCharacter({ shirt, pattern: team.pattern, skin, hair, hairStyle, accessory, number });
    this.parts = this.mesh.userData.parts;
    this.syncMesh();
  }

  moveTo(x, z) {
    this.target.set(x, 0, z);
  }

  // 瞬間回到站位（每球開始前的鏡頭切換）
  resetTo(x, z) {
    this.pos.set(x, 0, z);
    this.target.copy(this.pos);
    this.heading = this.team.side > 0 ? Math.PI : 0;
    this.runAmount = 0;
    this.actionTimer = 0;
    this.jumpTimer = 0;
  }

  // 'swing' 揮臂（發球、扣球）、'bump' 墊球、'set' 舉球
  playAction(type) {
    this.action = type;
    this.actionTimer = ACTION_TIME[type];
  }

  playJump() {
    this.jumpTimer = JUMP_TIME;
  }

  update(dt) {
    this.time += dt;
    const dx = this.target.x - this.pos.x;
    const dz = this.target.z - this.pos.z;
    const dist = Math.hypot(dx, dz);

    let speed = 0;
    if (dist > ARRIVE_RADIUS) {
      speed = PLAYER.speed * this.speedScale * Math.min(1, dist / SLOW_RADIUS);
      const step = Math.min(dist, speed * dt);
      this.pos.x += (dx / dist) * step;
      this.pos.z += (dz / dist) * step;
    }

    // 跑步時面向移動方向；停下時看指定點或網子
    let desired;
    if (speed > 0.5) desired = Math.atan2(dx, dz);
    else if (this.facing) desired = Math.atan2(this.facing.x - this.pos.x, this.facing.z - this.pos.z);
    else desired = this.team.side > 0 ? Math.PI : 0;
    this.heading += wrapAngle(desired - this.heading) * Math.min(1, PLAYER.turnSpeed * dt);

    this.runAmount = THREE.MathUtils.damp(this.runAmount, speed / PLAYER.speed, 10, dt);
    this.phase += dt * 13 * this.runAmount;
    this.actionTimer = Math.max(0, this.actionTimer - dt);
    this.jumpTimer = Math.max(0, this.jumpTimer - dt);

    this.animate();
    this.syncMesh();
  }

  animate() {
    const { legL, legR, armL, armR, body } = this.parts;
    const run = this.runAmount;
    const s = Math.sin(this.phase);

    legL.rotation.x = s * 0.9 * run;
    legR.rotation.x = -s * 0.9 * run;
    armL.rotation.x = -s * 0.8 * run;
    armR.rotation.x = s * 0.8 * run;

    // 跑步上下彈跳＋待機呼吸
    body.position.y = Math.abs(s) * 0.07 * run + Math.sin(this.time * 3) * 0.012;
    body.rotation.x = run * 0.15;

    armL.rotation.z = 0;
    armR.rotation.z = 0;
    if (this.actionTimer > 0) {
      const k = Math.sin((1 - this.actionTimer / ACTION_TIME[this.action]) * Math.PI);
      if (this.action === 'swing') {
        // 右手快速舉起再揮下
        armR.rotation.x = -Math.PI * 0.9 * k;
      } else if (this.action === 'bump') {
        // 雙手往前併攏
        armL.rotation.x = armR.rotation.x = -1.2 * k;
        armL.rotation.z = -0.35 * k;
        armR.rotation.z = 0.35 * k;
      } else if (this.action === 'set') {
        // 雙手舉過頭
        armL.rotation.x = armR.rotation.x = -2.7 * k;
      }
    }
  }

  syncMesh() {
    this.mesh.position.copy(this.pos);
    this.mesh.position.y = this.jumpTimer > 0 ? JUMP_HEIGHT * Math.sin((1 - this.jumpTimer / JUMP_TIME) * Math.PI) : 0;
    this.mesh.rotation.y = this.heading;
  }
}

function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
