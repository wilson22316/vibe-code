import * as THREE from 'three';
import { ParticleSystem } from './particles.js';

const SAND = ['#f2d6a2', '#e8c48a', '#fff1d6'];
const SPARK = ['#ffffff', '#fff6c8'];
const GOLD = ['#ffd23f', '#fff1a8', '#ffb800'];
const CONFETTI = ['#ff6b4a', '#ffd23f', '#5b6cff', '#2fbf4f', '#ff8ad8', '#ffffff'];

const SLOW_SCALE = 0.35; // 慢動作時間倍率
const SLOW_TIME = 0.45; // 慢動作持續（真實秒數）
const SHAKE_DECAY = 6;

// 畫面特效：粒子、鏡頭震動、慢動作。全部用真實時間更新，不受慢動作影響。
export class Effects {
  constructor(scene, camera) {
    this.camera = camera;
    this.cameraBase = camera.position.clone();
    this.dust = new ParticleSystem({ max: 300, size: 0.12, gravity: 9, drag: 0.2 });
    this.confetti = new ParticleSystem({ max: 400, size: 0.2, gravity: 1.6, drag: 0.15 });
    scene.add(this.dust.points, this.confetti.points);
    this.shakeAmount = 0;
    this.slowTimer = 0;
  }

  // 慢動作期間遊戲時間要乘上這個倍率
  get timeScale() {
    return this.slowTimer > 0 ? SLOW_SCALE : 1;
  }

  hit(pos, grade) {
    this.dust.emit(pos, { count: grade === 'perfect' ? 24 : 12, colors: grade === 'perfect' ? GOLD : SPARK, speed: 3, life: 0.45 });
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

  // 重新開局或回主畫面時，清掉還在飛的粒子、慢動作與震動
  reset() {
    this.dust.clear();
    this.confetti.clear();
    this.slowTimer = 0;
    this.shakeAmount = 0;
  }

  update(dt) {
    this.dust.update(dt);
    this.confetti.update(dt);
    this.slowTimer = Math.max(0, this.slowTimer - dt);

    this.shakeAmount *= Math.exp(-SHAKE_DECAY * dt);
    const a = this.shakeAmount;
    this.camera.position.set(
      this.cameraBase.x + (Math.random() - 0.5) * a,
      this.cameraBase.y + (Math.random() - 0.5) * a,
      this.cameraBase.z + (Math.random() - 0.5) * a,
    );
  }
}
