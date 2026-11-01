import * as THREE from 'three';
import { addOutline, toonMaterial } from '../fx/toon.js';

// 可選的髮型與配件（2-5 角色自訂會用到）
export const HAIR_STYLES = ['short', 'spiky', 'ponytail', 'bun', 'bob'];
export const ACCESSORIES = ['none', 'headband', 'sunglasses'];

const OUTLINE_THICKNESS = 3.5;
export const HIP_HEIGHT = 0.62; // 髖關節高度：腿的支點，也就是腿長
export const SHOULDER_HEIGHT = 1.1; // 肩膀（手臂支點）高度
export const ARM_LENGTH = 0.43; // 肩膀到手掌中心的距離
export const HAND_RADIUS = 0.072;
const HEAD_RADIUS = 0.3;
const HAIR_RADIUS = 0.318;
const HAIRLINE_TILT = -0.55; // 頭髮往後蓋：額頭露出來、後腦杓蓋住
const SHORTS_COLOR = 0x2a3550;
const SHOE_COLOR = 0xffffff;
const FACE_DARK = 0x1a1a1a;
const CHEEK_COLOR = 0xff9a8a;
const ACCENT_COLOR = 0xffffff; // 頭帶、髮圈
const LENS_COLOR = 0x1f2a44;

// 軀幹側面輪廓（半徑, 高度），繞 y 軸轉一圈：胸口略寬、腰略收、肩膀圓
const TORSO_PROFILE = [
  [0, -0.21], [0.16, -0.21], [0.205, -0.15], [0.215, -0.05], [0.222, 0.05],
  [0.215, 0.13], [0.185, 0.2], [0.12, 0.25], [0, 0.27],
].map(([r, y]) => new THREE.Vector2(r, y));
const TORSO_DEPTH = 0.82; // 前後比左右扁一點

const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);

// Q 版角色：大頭、短身。原點在腳底，預設面向 +z（角色的右手在 -x）。
// look：{ skin, hair, hairStyle, accessory, shirt, pattern, number }
export function buildCharacter(look) {
  const root = new THREE.Group();
  const body = new THREE.Group(); // 腳以上全部掛在這裡，方便做彈跳
  root.add(body);

  const m = {
    skin: toonMaterial({ color: look.skin }),
    shirt: toonMaterial({ color: look.shirt }),
    shorts: toonMaterial({ color: SHORTS_COLOR }),
    shoe: toonMaterial({ color: SHOE_COLOR }),
    hair: toonMaterial({ color: look.hair }),
    accent: toonMaterial({ color: ACCENT_COLOR }),
    dark: new THREE.MeshBasicMaterial({ color: FACE_DARK }),
  };

  const legL = buildLeg(body, m, 0.12);
  const legR = buildLeg(body, m, -0.12);
  buildTorso(body, m, look);
  const armL = buildArm(body, m, 0.3);
  const armR = buildArm(body, m, -0.3);
  const { head, face } = buildHead(body, m, look);

  addOutline(root, { thickness: OUTLINE_THICKNESS });
  root.userData.parts = { legL, legR, armL, armR, body, head, face };
  return root;
}

// 換外觀時丟掉舊模型：幾何、材質、球衣貼圖都是這個角色自己的；描邊材質是全部共用的快取，不能丟
export function disposeCharacter(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.dispose();
    if (o.userData.isOutline) return;
    o.material.map?.dispose();
    o.material.dispose();
  });
}

// 建一個零件掛到 parent。small：五官這類小零件，不描邊（會糊成一團）也不投影
function part(parent, geometry, material, x, y, z, { small = false } = {}) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = !small;
  if (small) mesh.userData.noOutline = true;
  parent.add(mesh);
  return mesh;
}

// 頭部表面的方向：az 從正面往 +x 繞、el 為仰角
function headDir(az, el) {
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
}

function buildLeg(body, m, x) {
  const pivot = new THREE.Group(); // 以髖關節為支點
  pivot.position.set(x, HIP_HEIGHT, 0);
  part(pivot, new THREE.CapsuleGeometry(0.085, 0.34, 4, 10), m.skin, 0, -0.29, 0);
  const shoe = part(pivot, new THREE.SphereGeometry(0.1, 14, 10), m.shoe, 0, -0.58, 0.035);
  shoe.scale.set(0.85, 0.55, 1.25);
  body.add(pivot); // 跟著身體彈跳，跑步時腳會短暫離地
  return pivot;
}

function buildTorso(body, m, look) {
  const shorts = part(body, new THREE.CylinderGeometry(0.215, 0.235, 0.2, 20), m.shorts, 0, 0.66, 0);
  shorts.scale.z = TORSO_DEPTH + 0.03;

  const torso = part(body, new THREE.LatheGeometry(TORSO_PROFILE, 24), toonMaterial({ map: createShirtTexture(look) }), 0, 0.92, 0);
  torso.scale.z = TORSO_DEPTH;
  // 球衣顏色在貼圖裡（材質本身是白色），描邊顏色另外指定
  torso.userData.outlineColor = new THREE.Color(look.shirt).multiplyScalar(0.25);

  part(body, new THREE.CylinderGeometry(0.065, 0.075, 0.12, 12), m.skin, 0, 1.22, 0); // 脖子
}

function buildArm(body, m, x) {
  const pivot = new THREE.Group(); // 以肩膀為支點
  pivot.position.set(x, SHOULDER_HEIGHT, 0);
  part(pivot, new THREE.SphereGeometry(0.095, 12, 10), m.shirt, 0, -0.02, 0); // 袖子
  part(pivot, new THREE.CapsuleGeometry(0.062, 0.28, 4, 10), m.skin, 0, -0.22, 0);
  part(pivot, new THREE.SphereGeometry(HAND_RADIUS, 12, 10), m.skin, 0, -ARM_LENGTH, 0); // 手掌
  body.add(pivot);
  return pivot;
}

function buildHead(body, m, look) {
  const head = new THREE.Group();
  head.position.set(0, 1.48, 0);
  body.add(head);

  part(head, new THREE.SphereGeometry(HEAD_RADIUS, 28, 20), m.skin, 0, 0, 0);
  for (const side of [-1, 1]) {
    const ear = part(head, new THREE.SphereGeometry(0.055, 10, 8), m.skin, side * 0.292, -0.03, 0);
    ear.scale.set(0.55, 1, 0.8);
  }
  const face = buildFace(head, m, look);
  HAIR[look.hairStyle](head, m);
  if (look.accessory === 'headband') buildHeadband(head, m);
  else if (look.accessory === 'sunglasses') buildSunglasses(head);
  return { head, face };
}

export const EYE_SCALE_Y = 1.3;

// 回傳會動的五官（表情用）；陣列順序都是 [角色右邊, 角色左邊]
function buildFace(head, m, look) {
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const brow = new THREE.MeshBasicMaterial({ color: new THREE.Color(look.hair).multiplyScalar(0.45) });
  const cheek = toonMaterial({ color: CHEEK_COLOR });
  const face = { eyes: [], highlights: [], happyEyes: [], brows: [] };

  for (const side of [-1, 1]) {
    const x = side * 0.1;
    // 眼睛：扁橢圓貼著臉，順著頭的弧度轉
    const eye = part(head, new THREE.SphereGeometry(0.042, 14, 12), m.dark, x, -0.01, 0.282, { small: true });
    eye.scale.set(0.8, EYE_SCALE_Y, 0.45);
    eye.rotation.y = side * 0.33;
    face.eyes.push(eye);
    face.highlights.push(part(head, new THREE.SphereGeometry(0.013, 8, 6), white, x + 0.012, 0.022, 0.3, { small: true }));

    // 開心時瞇成 ∩ 形的眼睛，平常藏起來
    const happy = part(head, new THREE.TorusGeometry(0.03, 0.009, 6, 10, Math.PI), m.dark, x, -0.015, 0.288, { small: true });
    happy.rotation.y = side * 0.33;
    happy.visible = false;
    face.happyEyes.push(happy);

    // 眉毛：橫放的小膠囊，眉尾略下垂、往後順著頭彎
    const b = part(head, new THREE.CapsuleGeometry(0.011, 0.055, 2, 6), brow, x, 0.075, 0.287, { small: true });
    b.rotation.set(0, side * 0.35, Math.PI / 2 - side * 0.12);
    face.brows.push(b);

    const c = part(head, new THREE.SphereGeometry(0.045, 10, 8), cheek, side * 0.165, -0.085, 0.235, { small: true });
    c.scale.set(1, 0.55, 0.4);
    c.rotation.y = side * 0.6;
  }

  // 嘴巴：半圈圓環翻成 U 形微笑，再順著臉往下傾（不翻就是 ∩ 形的嘴角下垂）
  face.mouth = part(head, new THREE.TorusGeometry(0.032, 0.008, 6, 12, Math.PI), m.dark, 0, -0.105, 0.282, { small: true });
  face.mouth.rotation.set(0.34, 0, Math.PI);
  return face;
}

// ---- 髮型 ----

function hairCap(head, m) {
  const cap = part(head, new THREE.SphereGeometry(HAIR_RADIUS, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), m.hair, 0, 0.01, 0);
  cap.rotation.x = HAIRLINE_TILT;
}

// 瀏海：髮際線上幾個扁扁的髮尖，讓邊緣不是一條直線
function fringe(head, m) {
  for (const az of [-0.45, -0.15, 0.15, 0.45]) {
    const dir = headDir(az, 0.4);
    const tip = part(head, new THREE.SphereGeometry(0.07, 12, 8), m.hair, 0, 0, 0);
    tip.position.copy(dir).multiplyScalar(HEAD_RADIUS);
    tip.quaternion.setFromUnitVectors(FORWARD, dir);
    tip.scale.set(1, 0.7, 0.5);
  }
}

const SPIKES = [
  [0, 0.5], [0.5, 0.45], [-0.5, 0.45], [0.25, 0.95], [-0.25, 0.95],
  [1.1, 0.7], [-1.1, 0.7], [2.0, 0.6], [-2.0, 0.6], [Math.PI, 0.7],
];

const HAIR = {
  short(head, m) {
    hairCap(head, m);
    fringe(head, m);
  },

  spiky(head, m) {
    hairCap(head, m);
    for (const [az, el] of SPIKES) {
      const dir = headDir(az, el);
      const spike = part(head, new THREE.ConeGeometry(0.075, 0.22, 7), m.hair, 0, 0, 0);
      spike.position.copy(dir).multiplyScalar(HAIR_RADIUS + 0.04);
      spike.quaternion.setFromUnitVectors(UP, dir);
    }
  },

  ponytail(head, m) {
    hairCap(head, m);
    fringe(head, m);
    part(head, new THREE.SphereGeometry(0.05, 10, 8), m.accent, 0, 0, -0.31); // 髮圈
    const tail = part(head, new THREE.CapsuleGeometry(0.075, 0.26, 4, 10), m.hair, 0, -0.15, -0.38);
    tail.rotation.x = 0.45; // 往後垂
    tail.scale.set(0.9, 1, 0.8);
  },

  bun(head, m) {
    hairCap(head, m);
    fringe(head, m);
    const pos = new THREE.Vector3(0, 0.26, -0.14);
    part(head, new THREE.SphereGeometry(0.13, 16, 12), m.hair, pos.x, pos.y, pos.z);
    const ring = part(head, new THREE.TorusGeometry(0.075, 0.02, 6, 16), m.accent, 0, 0.215, -0.115); // 髮圈
    ring.quaternion.setFromUnitVectors(FORWARD, pos.normalize());
  },

  bob(head, m) {
    hairCap(head, m);
    fringe(head, m);
    // 兩側和後面垂到下巴，正面留空
    part(
      head,
      new THREE.SphereGeometry(HAIR_RADIUS + 0.006, 28, 12, Math.PI / 2 + 0.9, Math.PI * 2 - 1.8, Math.PI * 0.3, Math.PI * 0.42),
      m.hair,
      0,
      0,
      0,
    );
  },
};

// ---- 配件 ----

function buildHeadband(head, m) {
  const band = part(head, new THREE.TorusGeometry(0.312, 0.028, 8, 36), m.accent, 0, 0.06, 0);
  band.rotation.x = Math.PI / 2 - 0.4; // 平躺後再往前抬，前高後低
}

// 太陽眼鏡推到頭頂上，不擋住眼睛
function buildSunglasses(head) {
  const glasses = new THREE.Group();
  glasses.position.copy(headDir(0, 0.75)).multiplyScalar(HAIR_RADIUS + 0.01);
  glasses.rotation.x = -0.75; // 鏡片朝外貼著頭頂
  head.add(glasses);
  const lens = toonMaterial({ color: LENS_COLOR });
  for (const side of [-1, 1]) {
    const l = part(glasses, new THREE.CylinderGeometry(0.068, 0.068, 0.025, 18), lens, side * 0.085, 0, 0);
    l.rotation.x = Math.PI / 2;
  }
  part(glasses, new THREE.BoxGeometry(0.05, 0.016, 0.016), lens, 0, 0.01, 0); // 鼻橋
}

// ---- 球衣 ----

// 貼在車床軀幹上：u 繞身體一圈（0.5 是背後正中央）、v 由下到上
function createShirtTexture({ shirt, pattern, number }) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const base = new THREE.Color(shirt);

  ctx.fillStyle = `#${base.getHexString()}`;
  ctx.fillRect(0, 0, 512, 256);
  ctx.fillStyle = '#ffffff';
  if (pattern === 'stripes') {
    for (const u of [0.25, 0.75]) ctx.fillRect(u * 512 - 22, 0, 44, 256); // 兩側直條
  } else if (pattern === 'band') {
    ctx.fillRect(0, 92, 512, 30); // 胸口橫條
  }
  ctx.fillRect(0, 0, 512, 18); // 領口

  // 背號：白字、外框用球衣的深色
  const text = String(number);
  ctx.font = 'bold 84px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 10;
  ctx.strokeStyle = `#${base.clone().multiplyScalar(0.45).getHexString()}`;
  ctx.strokeText(text, 256, 130);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, 256, 130);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
