import * as THREE from 'three';
import { toonMaterial } from './toon.js';

const MAX = 360; // 同時存在的腳印上限（用完覆蓋最舊的）
const STRIDE = 0.42; // 每走這麼遠留一個腳印（左右腳交替）
const LIFE = 7; // 腳印幾秒後完全消失
const FOOT_OFFSET = 0.12; // 左右腳離身體中心
const TELEPORT = 2; // 一幀移動超過這麼遠是瞬間換位置（每球開始前），不留腳印
const FRESH = new THREE.Color(0xd2ae76); // 剛踩出來的顏色，比沙子深
const SAND = new THREE.Color(0xf2d6a2);

// 沙灘腳印：角色在地上走動時留下橢圓形的印子，慢慢變回沙子的顏色後消失。
// 全部腳印是一個 InstancedMesh（一次繪製）
export class Footprints {
  constructor(scene) {
    const geometry = new THREE.CircleGeometry(0.075, 12);
    geometry.scale(0.75, 1.35, 1); // 腳掌形狀：前後長
    geometry.rotateX(-Math.PI / 2); // 平躺，長邊沿 z
    const material = toonMaterial({ color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -2 });
    this.mesh = new THREE.InstancedMesh(geometry, material, MAX);
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.ages = new Float32Array(MAX).fill(LIFE); // 大於等於 LIFE 表示沒在用
    this.next = 0;
    this.tracks = new Map(); // 每個角色：{ last：上次留腳印的位置, foot：這次是左腳或右腳 }
    for (let i = 0; i < MAX; i++) {
      this.hide(i);
      this.mesh.setColorAt(i, SAND);
    }
    scene.add(this.mesh);
  }

  update(dt, players) {
    for (const p of players) this.track(p);
    const color = new THREE.Color();
    let changed = false;
    for (let i = 0; i < MAX; i++) {
      if (this.ages[i] >= LIFE) continue;
      this.ages[i] += dt;
      changed = true;
      if (this.ages[i] >= LIFE) this.hide(i);
      else this.mesh.setColorAt(i, color.lerpColors(FRESH, SAND, (this.ages[i] / LIFE) ** 2));
    }
    if (changed) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.instanceColor.needsUpdate = true;
    }
  }

  // 角色在地上走了一個步幅就蓋一個腳印；跳起來、撲救時不留
  track(player) {
    let track = this.tracks.get(player);
    if (!track) {
      track = { last: player.pos.clone(), foot: 1 };
      this.tracks.set(player, track);
    }
    const dx = player.pos.x - track.last.x;
    const dz = player.pos.z - track.last.z;
    const dist = Math.hypot(dx, dz);
    const onGround = player.jumpHeight() === 0 && player.diveTimer === 0;
    if (!onGround || dist > TELEPORT) {
      track.last.copy(player.pos);
      return;
    }
    if (dist < STRIDE) return;
    track.foot = -track.foot;
    const fx = dx / dist;
    const fz = dz / dist;
    // 往移動方向的右邊或左邊偏一點（右邊 = (fz, -fx)）
    this.stamp(player.pos.x + fz * FOOT_OFFSET * track.foot, player.pos.z - fx * FOOT_OFFSET * track.foot, Math.atan2(fx, fz));
    track.last.copy(player.pos);
  }

  stamp(x, z, angle) {
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    _dummy.position.set(x, 0.012, z);
    _dummy.rotation.set(0, angle, 0);
    _dummy.scale.setScalar(1);
    _dummy.updateMatrix();
    this.mesh.setMatrixAt(i, _dummy.matrix);
    this.mesh.setColorAt(i, FRESH);
    this.ages[i] = 0;
  }

  hide(i) {
    _dummy.scale.setScalar(0);
    _dummy.updateMatrix();
    this.mesh.setMatrixAt(i, _dummy.matrix);
  }
}

const _dummy = new THREE.Object3D();
