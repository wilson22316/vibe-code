import * as THREE from 'three';
import { BALL } from '../config.js';
import { addOutline, toonMaterial } from '../fx/toon.js';

export class Ball {
  constructor() {
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();

    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(BALL.radius, 24, 16), toonMaterial({ map: createBallTexture() }));
    this.mesh.castShadow = true;
    addOutline(this.mesh, { thickness: 2.9, color: new THREE.Color(0x1d2a4a) });

    // 強力球外層的能量光（描邊之後才加，所以不會被描邊）
    this.aura = new THREE.Mesh(
      new THREE.SphereGeometry(BALL.radius * 1.7, 20, 14),
      new THREE.MeshBasicMaterial({
        color: 0xffb02e,
        transparent: true,
        opacity: 0.45,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.aura.visible = false;
    this.mesh.add(this.aura);
    this.time = 0;
  }

  setPower(on) {
    this.aura.visible = on;
  }

  // 同步畫面：位置 + 依移動方向滾轉
  syncMesh(dt) {
    this.mesh.position.copy(this.pos);
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (speed > 0.01) {
      _axis.set(this.vel.z, 0, -this.vel.x).normalize();
      this.mesh.rotateOnWorldAxis(_axis, (speed / BALL.radius) * dt * 0.3);
    }
    this.time += dt;
    if (this.aura.visible) this.aura.scale.setScalar(1 + 0.15 * Math.sin(this.time * 25)); // 能量光脈動
  }
}

const _axis = new THREE.Vector3();

// 黃、藍、白相間的球皮
function createBallTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const colors = ['#ffd23f', '#2f7bd9', '#ffffff'];
  const stripes = 6;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect((i * canvas.width) / stripes, 0, canvas.width / stripes + 1, canvas.height);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// 時機提示：觸球點下方的固定圓環＋往內縮的外圈，外圈縮到跟內圈一樣大時按鍵就是 Perfect
const CUE_SHRINK = 2.5; // 每秒縮多少倍
export function createTimingCue() {
  const group = new THREE.Group();
  const ringMat = (color) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false });
  const inner = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.42, 32), ringMat(0xffe14d));
  const outer = new THREE.Mesh(new THREE.RingGeometry(0.36, 0.42, 32), ringMat(0xffffff));
  for (const ring of [inner, outer]) {
    ring.rotation.x = -Math.PI / 2;
    group.add(ring);
  }
  group.visible = false;
  group.userData.update = (x, z, timeToContact) => {
    group.position.set(x, 0.03, z);
    outer.scale.setScalar(1 + THREE.MathUtils.clamp(timeToContact, 0, 1.5) * CUE_SHRINK);
  };
  return group;
}

// 扣球瞄準標記：對方場地上的準星（圓環＋十字），方向鍵移動
export function createSpikeMarker() {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xff3d2e, transparent: true, opacity: 0.85, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.62, 32), mat);
  ring.rotation.x = -Math.PI / 2;
  group.add(ring);
  for (const angle of [0, Math.PI / 2]) {
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.08), mat);
    bar.rotation.set(-Math.PI / 2, 0, angle);
    group.add(bar);
  }
  group.visible = false;
  return group;
}

// 落點預測標記：地上的圓環，讓玩家知道球會掉在哪
export function createLandingMarker() {
  const marker = new THREE.Mesh(
    new THREE.RingGeometry(0.28, 0.4, 32),
    new THREE.MeshBasicMaterial({ color: 0xffe14d, transparent: true, opacity: 0.85, depthWrite: false }),
  );
  marker.rotation.x = -Math.PI / 2;
  marker.visible = false;
  return marker;
}
