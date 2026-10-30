import * as THREE from 'three';
import { BALL } from '../config.js';

export class Ball {
  constructor() {
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();

    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(BALL.radius, 24, 16),
      new THREE.MeshStandardMaterial({ map: createBallTexture(), roughness: 0.55 }),
    );
    this.mesh.castShadow = true;
  }

  // 同步畫面：位置 + 依移動方向滾轉
  syncMesh(dt) {
    this.mesh.position.copy(this.pos);
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (speed > 0.01) {
      _axis.set(this.vel.z, 0, -this.vel.x).normalize();
      this.mesh.rotateOnWorldAxis(_axis, (speed / BALL.radius) * dt * 0.3);
    }
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
