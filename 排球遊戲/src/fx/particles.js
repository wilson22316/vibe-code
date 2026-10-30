import * as THREE from 'three';

// 簡單的粒子池：固定數量的點，用完就覆蓋最舊的。
export class ParticleSystem {
  constructor({ max, size, gravity, drag }) {
    this.max = max;
    this.gravity = gravity;
    this.drag = drag; // 每秒速度保留比例（越小越飄）
    this.next = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max); // 剩餘秒數，<= 0 表示沒在用
    this.colors = new Float32Array(max * 3);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        size,
        map: createDotTexture(),
        vertexColors: true,
        transparent: true,
        alphaTest: 0.3,
        depthWrite: false,
      }),
    );
    this.points.frustumCulled = false;
    this.hideAll();
  }

  hideAll() {
    for (let i = 0; i < this.max; i++) this.pos[i * 3 + 1] = -100;
  }

  // origin：Vector3；colors：色碼陣列（隨機挑）；speed：初速；up：額外往上的速度
  emit(origin, { count, colors, speed, up = 0, life = 0.6, spread = 0 }) {
    const color = new THREE.Color();
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % this.max;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);
      const s = speed * (0.4 + Math.random() * 0.6);
      this.pos.set([origin.x + (Math.random() - 0.5) * spread, origin.y, origin.z + (Math.random() - 0.5) * spread], i * 3);
      this.vel.set(
        [Math.sin(phi) * Math.cos(theta) * s, Math.abs(Math.cos(phi)) * s + up, Math.sin(phi) * Math.sin(theta) * s],
        i * 3,
      );
      this.life[i] = life * (0.6 + Math.random() * 0.4);
      color.set(colors[Math.floor(Math.random() * colors.length)]);
      this.colors.set([color.r, color.g, color.b], i * 3);
    }
    this.points.geometry.attributes.color.needsUpdate = true;
  }

  update(dt) {
    const keep = Math.pow(this.drag, dt);
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const k = i * 3;
      this.vel[k + 1] -= this.gravity * dt;
      for (let a = 0; a < 3; a++) {
        this.vel[k + a] *= keep;
        this.pos[k + a] += this.vel[k + a] * dt;
      }
      // 落到沙上或時間到就收起來
      if (this.life[i] <= 0 || this.pos[k + 1] < 0) {
        this.life[i] = 0;
        this.pos[k + 1] = -100;
      }
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}

function createDotTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(16, 16, 14, 0, Math.PI * 2);
  ctx.fill();
  return new THREE.CanvasTexture(canvas);
}
