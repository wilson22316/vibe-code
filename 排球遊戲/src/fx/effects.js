import * as THREE from 'three';
import { ParticleSystem } from './particles.js';

const SAND = ['#f2d6a2', '#e8c48a', '#fff1d6'];
const SPARK = ['#ffffff', '#fff6c8'];
const GOLD = ['#ffd23f', '#fff1a8', '#ffb800'];
const CONFETTI = ['#ff6b4a', '#ffd23f', '#5b6cff', '#2fbf4f', '#ff8ad8', '#ffffff'];
const TRAIL = ['#ffffff', '#e8f4ff'];
const POWER_TRAIL = ['#ffb02e', '#ff6b2e', '#fff1a8'];
const AURA_SPARK = ['#ffd23f', '#fff2a0', '#ff9a2e'];

const SLOW_SCALE = 0.35; // 慢動作時間倍率
const SLOW_TIME = 0.45; // 慢動作持續（真實秒數）
const SHAKE_DECAY = 6;
const WAVE_TIME = 0.45; // 衝擊波擴散的秒數
const WAVE_GROWTH = 12; // 衝擊波每秒放大幾倍

// 畫面特效：粒子、鏡頭震動、慢動作、定格、衝擊波。全部用真實時間更新，不受慢動作影響。
// 震動只算出位移（shakeOffset），由鏡頭控制疊加，不直接改鏡頭位置
export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.shakeOffset = new THREE.Vector3();
    this.dust = new ParticleSystem({ max: 300, size: 0.12, gravity: 9, drag: 0.2 });
    this.confetti = new ParticleSystem({ max: 400, size: 0.2, gravity: 1.6, drag: 0.15 });
    this.trailDots = new ParticleSystem({ max: 240, size: 0.16, gravity: 0, drag: 1 }); // 留在原地的點，連起來像拖尾
    this.sparks = new ParticleSystem({ max: 300, size: 0.1, gravity: -3, drag: 0.5 }); // 氣場往上飄的光點（負重力＝往上加速）
    scene.add(this.dust.points, this.confetti.points, this.trailDots.points, this.sparks.points);
    this.shakeAmount = 0;
    this.slowTimer = 0;
    this.freezeTimer = 0;
    this.slowAfterFreeze = false;
    this.waves = [];
  }

  // 遊戲時間要乘上這個倍率：定格時 0、慢動作時 0.35
  get timeScale() {
    if (this.freezeTimer > 0) return 0;
    return this.slowTimer > 0 ? SLOW_SCALE : 1;
  }

  get frozen() {
    return this.freezeTimer > 0;
  }

  hit(pos, grade) {
    this.dust.emit(pos, { count: grade === 'perfect' ? 24 : 12, colors: grade === 'perfect' ? GOLD : SPARK, speed: 3, life: 0.45 });
  }

  // 扣球的拖尾：每幀在球的位置留一個會消失的點；強力球是金色、比較長
  trail(pos, power) {
    this.trailDots.emit(pos, { count: power ? 2 : 1, colors: power ? POWER_TRAIL : TRAIL, speed: power ? 0.4 : 0, life: power ? 0.35 : 0.2 });
  }

  // 氣場的光點：在角色身邊隨機冒出、往上飄；氣場越強冒越多、飄越快
  auraSparks(pos, intensity) {
    const origin = new THREE.Vector3(pos.x, 0.3 + Math.random() * 1.3, pos.z);
    this.sparks.emit(origin, {
      count: Math.max(1, Math.round(intensity * 2)),
      colors: AURA_SPARK,
      speed: 0.6 * intensity,
      up: 1.2 * intensity,
      life: 0.6,
      spread: 0.9,
    });
  }

  // 衝擊波：在 pos 出現一個面向 facePoint（鏡頭位置）、快速擴散變淡的光環
  shockwave(pos, facePoint) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.25, 0.36, 48),
      new THREE.MeshBasicMaterial({
        color: 0xfff1a8,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    );
    ring.position.copy(pos);
    ring.lookAt(facePoint);
    this.scene.add(ring);
    this.waves.push({ ring, t: 0 });
  }

  sand(pos, strength = 1) {
    this.dust.emit(new THREE.Vector3(pos.x, 0.05, pos.z), { count: Math.round(18 * strength), colors: SAND, speed: 2.2 * strength, up: 1.5, life: 0.7, spread: 0.3 });
  }

  celebrate(pos, big = false) {
    const origin = new THREE.Vector3(pos.x, big ? 4 : 2.5, pos.z);
    this.confetti.emit(origin, { count: big ? 300 : 80, colors: CONFETTI, speed: big ? 9 : 6, up: 3, life: big ? 3.5 : 2, spread: big ? 6 : 1 });
  }

  shake(amount) {
    this.shakeAmount = Math.max(this.shakeAmount, amount);
  }

  slowMo() {
    this.slowTimer = SLOW_TIME;
  }

  // 定格 seconds 秒（遊戲時間完全停住），結束後接一段慢動作
  freeze(seconds) {
    this.freezeTimer = seconds;
    this.slowAfterFreeze = true;
  }

  // 重新開局或回主畫面時，清掉還在飛的粒子、慢動作、定格與震動
  reset() {
    this.dust.clear();
    this.confetti.clear();
    this.trailDots.clear();
    this.sparks.clear();
    this.slowTimer = 0;
    this.freezeTimer = 0;
    this.slowAfterFreeze = false;
    this.shakeAmount = 0;
    this.shakeOffset.set(0, 0, 0);
    for (const w of this.waves) this.removeWave(w);
    this.waves = [];
  }

  update(dt) {
    this.dust.update(dt);
    this.confetti.update(dt);
    this.trailDots.update(dt);
    this.sparks.update(dt);

    if (this.freezeTimer > 0) {
      this.freezeTimer = Math.max(0, this.freezeTimer - dt);
      if (this.freezeTimer === 0 && this.slowAfterFreeze) {
        this.slowAfterFreeze = false;
        this.slowTimer = SLOW_TIME;
      }
    } else {
      this.slowTimer = Math.max(0, this.slowTimer - dt);
    }

    this.waves = this.waves.filter((w) => {
      w.t += dt;
      if (w.t >= WAVE_TIME) {
        this.removeWave(w);
        return false;
      }
      w.ring.scale.setScalar(1 + w.t * WAVE_GROWTH);
      w.ring.material.opacity = 0.9 * (1 - w.t / WAVE_TIME);
      return true;
    });

    this.shakeAmount *= Math.exp(-SHAKE_DECAY * dt);
    const a = this.shakeAmount;
    this.shakeOffset.set((Math.random() - 0.5) * a, (Math.random() - 0.5) * a, (Math.random() - 0.5) * a);
  }

  removeWave(w) {
    this.scene.remove(w.ring);
    w.ring.geometry.dispose();
    w.ring.material.dispose();
  }
}
