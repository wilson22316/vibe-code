import * as THREE from 'three';
import { PLAYER } from '../config.js';
import { buildCharacter, EYE_SCALE_Y, HIP_HEIGHT } from './characterModel.js';

const ARRIVE_RADIUS = 0.05;
const SLOW_RADIUS = 0.8; // 接近目標時減速，避免來回抖動
const ACTION_TIME = { swing: 0.35, bump: 0.35, set: 0.35 };

// 跳躍：先蹲一下再起跳，總長 JUMP_TIME。JUMP_PEAK 為起跳後幾秒到最高點（扣球用來對準觸球時間）
export const JUMP_TIME = 0.6;
const JUMP_CROUCH = 0.15; // 下蹲占整段跳躍的比例
export const JUMP_PEAK = JUMP_TIME * (JUMP_CROUCH + (1 - JUMP_CROUCH) / 2);
const JUMP_HEIGHT = 0.8;
const LAND_TIME = 0.15; // 落地壓扁的時間

const READY_CROUCH = 0.11; // 準備姿勢重心放低多少

// 撲救：撲出去 → 趴著 → 爬起來
const DIVE_TIME = 1.1;
const DIVE_LUNGE = 0.28;
const DIVE_GETUP = 0.7; // 從這個時間點開始爬起來
const DIVE_SPEED = 3.2;
const DIVE_TILT = 1.35; // 身體往前倒的角度

const HOP_HEIGHT = 0.16; // 慶祝時小跳
const HOP_SPEED = 9;
const HIGH_FIVE_DIST = 1.0; // 跟隊友這麼近就舉手擊掌
const BLINK_TIME = 0.12;

// 場上的球員：移動、轉向、動作與表情動畫。外觀見 characterModel.js
export class Player {
  constructor({ team, shirt, skin, hair, hairStyle, accessory, number, base }) {
    this.team = team;
    this.base = new THREE.Vector3(base[0], 0, base[1]);
    this.pos = this.base.clone();
    this.target = this.base.clone();
    this.heading = team.side > 0 ? Math.PI : 0; // 面向網子
    this.facing = null; // 停下來時要看的點；null 表示看向網子（來回中會是球的位置）
    this.runAmount = 0;
    this.readyAmount = 0;
    this.speedScale = 1; // 跑速倍率（電腦難度用）
    this.phase = 0;
    this.time = Math.random() * 10;
    this.action = null;
    this.actionTimer = 0;
    this.jumpTimer = 0;
    this.landTimer = 0;
    this.diveTimer = 0;
    this.diveDir = new THREE.Vector3();
    this.mood = null; // null | 'happy'（得分）| 'sad'（失分）
    this.buddy = null; // 慶祝時擊掌的隊友
    this.hopPhase = 0;
    this.blinkTimer = 0;
    this.nextBlink = 1 + Math.random() * 4;

    this.mesh = buildCharacter({ shirt, pattern: team.pattern, skin, hair, hairStyle, accessory, number });
    this.parts = this.mesh.userData.parts;
    this.syncMesh();
  }

  moveTo(x, z) {
    this.target.set(x, 0, z);
  }

  // 瞬間回到站位（每球開始前的鏡頭切換），表情和動作也一併歸零
  resetTo(x, z) {
    this.pos.set(x, 0, z);
    this.target.copy(this.pos);
    this.heading = this.team.side > 0 ? Math.PI : 0;
    this.runAmount = 0;
    this.readyAmount = 0;
    this.actionTimer = 0;
    this.jumpTimer = 0;
    this.landTimer = 0;
    this.diveTimer = 0;
    this.mood = null;
    this.buddy = null;
  }

  // 'swing' 揮臂（發球、扣球）、'bump' 墊球、'set' 舉球
  playAction(type) {
    this.action = type;
    this.actionTimer = ACTION_TIME[type];
  }

  playJump() {
    this.jumpTimer = JUMP_TIME;
  }

  // 往 (x, z) 撲過去救球
  playDive(x, z) {
    const dx = x - this.pos.x;
    const dz = z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.01) this.diveDir.set(dx / d, 0, dz / d);
    else this.diveDir.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    this.heading = Math.atan2(this.diveDir.x, this.diveDir.z);
    this.diveTimer = DIVE_TIME;
    this.jumpTimer = 0;
  }

  // 得分：跑去跟隊友擊掌、開心地跳
  celebrate(buddy) {
    this.mood = 'happy';
    this.buddy = buddy;
  }

  // 失分：垂頭喪氣
  mope() {
    this.mood = 'sad';
    this.buddy = null;
  }

  update(dt) {
    this.time += dt;
    const speed = this.diveTimer > 0 ? this.updateDive(dt) : this.updateMove(dt);

    this.runAmount = THREE.MathUtils.damp(this.runAmount, speed / PLAYER.speed, 10, dt);
    this.phase += dt * 13 * this.runAmount;
    this.actionTimer = Math.max(0, this.actionTimer - dt);
    if (this.jumpTimer > 0) {
      this.jumpTimer = Math.max(0, this.jumpTimer - dt);
      if (this.jumpTimer === 0) this.landTimer = LAND_TIME;
    } else {
      this.landTimer = Math.max(0, this.landTimer - dt);
    }

    // 準備姿勢：來回中盯著球、沒在跑也沒在撲救時
    const ready = this.facing && speed < 0.5 && !this.mood && this.diveTimer === 0 ? 1 : 0;
    this.readyAmount = THREE.MathUtils.damp(this.readyAmount, ready, 8, dt);
    this.hopPhase = this.mood === 'happy' && speed < 0.5 ? this.hopPhase + dt * HOP_SPEED : 0;

    this.updateFace(dt);
    this.animate();
    this.syncMesh();
  }

  // 走向目標並轉向；回傳這一幀的速度
  updateMove(dt) {
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

    // 跑步時面向移動方向；停下時看球、看擊掌的隊友，或看網子
    let desired;
    if (speed > 0.5) desired = Math.atan2(dx, dz);
    else if (this.facing) desired = Math.atan2(this.facing.x - this.pos.x, this.facing.z - this.pos.z);
    else if (this.mood === 'happy' && this.buddy) desired = Math.atan2(this.buddy.pos.x - this.pos.x, this.buddy.pos.z - this.pos.z);
    else desired = this.team.side > 0 ? Math.PI : 0;
    this.heading += wrapAngle(desired - this.heading) * Math.min(1, PLAYER.turnSpeed * dt);
    return speed;
  }

  // 撲救中：先往前衝一小段，之後趴著、爬起來，期間不能跑
  updateDive(dt) {
    const elapsed = DIVE_TIME - this.diveTimer;
    if (elapsed < DIVE_LUNGE) this.pos.addScaledVector(this.diveDir, DIVE_SPEED * dt);
    this.diveTimer = Math.max(0, this.diveTimer - dt);
    this.target.copy(this.pos); // 爬起來後從倒下的地方繼續，不要突然衝回原本的目標
    return 0;
  }

  updateFace(dt) {
    const { eyes, highlights, happyEyes, brows, mouth } = this.parts.face;
    this.nextBlink -= dt;
    if (this.nextBlink <= 0) {
      this.blinkTimer = BLINK_TIME;
      this.nextBlink = 2.5 + Math.random() * 3;
    }
    this.blinkTimer = Math.max(0, this.blinkTimer - dt);

    const happy = this.mood === 'happy';
    const sad = this.mood === 'sad';
    const blinking = this.blinkTimer > 0;
    const open = blinking ? 0.12 : sad ? 0.7 : 1; // 難過時眼睛半閉
    for (const e of eyes) {
      e.visible = !happy;
      e.scale.y = EYE_SCALE_Y * open;
    }
    for (const h of highlights) h.visible = !happy && !blinking;
    for (const h of happyEyes) h.visible = happy; // 開心時瞇成 ∩ 形

    // 眉毛：平常眉尾略垂；難過時眉頭明顯上揚；開心時眉毛上移、眉尾微翹
    brows.forEach((b, i) => {
      const side = i === 0 ? -1 : 1;
      b.rotation.z = Math.PI / 2 - side * (sad ? 0.4 : happy ? -0.05 : 0.12);
      b.position.y = happy ? 0.085 : 0.075;
    });
    mouth.rotation.z = sad ? 0 : Math.PI; // U 形微笑／∩ 形嘴角下垂
    mouth.scale.setScalar(happy ? 1.35 : sad ? 0.85 : 1);
  }

  animate() {
    const { legL, legR, armL, armR, body, head } = this.parts;
    const run = this.runAmount;
    const ready = this.readyAmount;
    const s = Math.sin(this.phase);

    // 跑步擺動＋準備姿勢（腳微張、雙手在前）
    legL.rotation.set(s * 0.9 * run, 0, 0.08 * ready);
    legR.rotation.set(-s * 0.9 * run, 0, -0.08 * ready);
    armL.rotation.set(-s * 0.8 * run - 0.8 * ready, 0, -0.2 * ready);
    armR.rotation.set(s * 0.8 * run - 0.8 * ready, 0, 0.2 * ready);
    head.rotation.x = 0;

    let lift = Math.abs(s) * 0.07 * run + Math.sin(this.time * 3) * 0.012; // 跑步彈跳＋待機呼吸
    let lean = run * 0.15 + ready * 0.18;
    let crouch = ready * READY_CROUCH;

    // 起跳前下蹲、落地緩衝
    const jt = this.jumpTimer > 0 ? 1 - this.jumpTimer / JUMP_TIME : -1;
    if (jt >= 0 && jt < JUMP_CROUCH) crouch += 0.14 * Math.sin((Math.PI * jt) / JUMP_CROUCH);
    if (this.landTimer > 0) crouch += 0.1 * Math.sin((Math.PI * this.landTimer) / LAND_TIME);

    if (this.actionTimer > 0) {
      const k = Math.sin((1 - this.actionTimer / ACTION_TIME[this.action]) * Math.PI);
      if (this.action === 'swing') {
        // 右手快速舉起再揮下
        armR.rotation.x = -Math.PI * 0.9 * k;
      } else if (this.action === 'bump') {
        // 雙手往前併攏
        armL.rotation.set(-1.2 * k, 0, -0.35 * k);
        armR.rotation.set(-1.2 * k, 0, 0.35 * k);
      } else if (this.action === 'set') {
        // 雙手舉過頭
        armL.rotation.x = armR.rotation.x = -2.7 * k;
      }
    }

    // Q 版手短頭大，手往正上舉會被頭擋住：擊掌改成往隊友方向斜上伸、歡呼時雙手張成 V 字
    if (this.mood === 'happy') {
      if (this.buddy && this.pos.distanceTo(this.buddy.pos) < HIGH_FIVE_DIST) {
        armR.rotation.set(-1.9, 0, 0.2); // 右手往前伸向隊友擊掌
        armL.rotation.set(0.1, 0, 0);
      } else {
        armL.rotation.set(-2.6, 0, 0.7); // 雙手張開高舉
        armR.rotation.set(-2.6, 0, -0.7);
      }
      lift += HOP_HEIGHT * Math.abs(Math.sin(this.hopPhase));
    } else if (this.mood === 'sad') {
      head.rotation.x = 0.35; // 低頭
      lean += 0.12;
      armL.rotation.set(0.1, 0, 0.05);
      armR.rotation.set(0.1, 0, -0.05);
    }

    // 撲救：整個人以腳為支點往前倒，雙手往前伸
    if (this.diveTimer > 0) {
      const e = DIVE_TIME - this.diveTimer;
      const k = e < DIVE_LUNGE ? e / DIVE_LUNGE : e < DIVE_GETUP ? 1 : 1 - (e - DIVE_GETUP) / (DIVE_TIME - DIVE_GETUP);
      lean = DIVE_TILT * k;
      lift = 0;
      crouch = 0;
      armL.rotation.set(-2.9 * k, 0, -0.2 * k);
      armR.rotation.set(-2.9 * k, 0, 0.2 * k);
      legL.rotation.set(0, 0, 0);
      legR.rotation.set(0, 0, 0);
    }

    body.position.y = lift - crouch;
    body.rotation.x = lean;
    // 重心放低時腿跟著縮短，腳才會留在地上（看起來像膝蓋彎曲）
    legL.scale.y = legR.scale.y = (HIP_HEIGHT - crouch) / HIP_HEIGHT;
  }

  syncMesh() {
    this.mesh.position.copy(this.pos);
    this.mesh.position.y = this.jumpHeight();
    this.mesh.rotation.y = this.heading;
    // 伸展與壓扁（體積不變）：蹲下時扁、離地瞬間拉長、落地再壓扁
    const st = this.stretch();
    const w = 1 / Math.sqrt(st);
    this.mesh.scale.set(w, st, w);
  }

  jumpHeight() {
    if (this.jumpTimer <= 0) return 0;
    const t = 1 - this.jumpTimer / JUMP_TIME;
    if (t < JUMP_CROUCH) return 0;
    return JUMP_HEIGHT * Math.sin((Math.PI * (t - JUMP_CROUCH)) / (1 - JUMP_CROUCH));
  }

  stretch() {
    if (this.landTimer > 0) return 1 - 0.12 * Math.sin((Math.PI * this.landTimer) / LAND_TIME);
    if (this.jumpTimer <= 0) return 1;
    const t = 1 - this.jumpTimer / JUMP_TIME;
    if (t < JUMP_CROUCH) return 1 - 0.08 * Math.sin((Math.PI * t) / JUMP_CROUCH);
    const air = (t - JUMP_CROUCH) / (1 - JUMP_CROUCH);
    return 1 + 0.1 * Math.max(0, 1 - air * 3);
  }
}

function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
