import * as THREE from 'three';
import { COURT } from '../config.js';
import { addOutline, toonMaterial } from '../fx/toon.js';

const LINE_WIDTH = 0.08;
const POST_OFFSET = COURT.postOffset;
const NET_DEPTH = COURT.netDepth;
const MESH_SIZE = 0.1; // 網目 10 公分

export function createCourt() {
  const group = new THREE.Group();
  group.add(createLines(), createNet());
  return group;
}

function createLines() {
  const group = new THREE.Group();
  const material = toonMaterial({ color: 0x2f7bd9 });
  const halfL = COURT.length / 2;
  const halfW = COURT.width / 2;

  const addLine = (w, d, x, z) => {
    const line = new THREE.Mesh(new THREE.BoxGeometry(w, 0.02, d), material);
    line.position.set(x, 0.01, z);
    line.receiveShadow = true;
    group.add(line);
  };

  // 邊線（沿 z）與端線（沿 x）；沙灘排球沒有中線與攻擊線
  addLine(LINE_WIDTH, COURT.length + LINE_WIDTH, -halfW, 0);
  addLine(LINE_WIDTH, COURT.length + LINE_WIDTH, halfW, 0);
  addLine(COURT.width + LINE_WIDTH, LINE_WIDTH, 0, -halfL);
  addLine(COURT.width + LINE_WIDTH, LINE_WIDTH, 0, halfL);

  return group;
}

function createNet() {
  const group = new THREE.Group();
  const postX = COURT.width / 2 + POST_OFFSET;
  const top = COURT.netHeight;

  // 網柱與防護墊
  const postHeight = top + 0.2;
  const postMaterial = toonMaterial({ color: 0xf4f4f4 });
  const padMaterial = toonMaterial({ color: 0xff6b3d });
  for (const x of [-postX, postX]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, postHeight, 12), postMaterial);
    post.position.set(x, postHeight / 2, 0);
    post.castShadow = true;

    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.6, 10), padMaterial);
    pad.position.set(x, 0.8, 0);
    pad.castShadow = true;

    addOutline(post, { thickness: 2.9 });
    addOutline(pad, { thickness: 2.9 });
    group.add(post, pad);
  }

  // 網面：用重複貼圖畫網目
  const netWidth = postX * 2 - 0.12;
  const netMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(netWidth, NET_DEPTH),
    new THREE.MeshBasicMaterial({
      color: 0x1d2a3a,
      map: createMeshTexture(netWidth / MESH_SIZE, NET_DEPTH / MESH_SIZE),
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  netMesh.position.set(0, top - NET_DEPTH / 2, 0);
  group.add(netMesh);

  // 上下網帶
  const bandMaterial = toonMaterial({ color: 0xffffff });
  const topBand = new THREE.Mesh(new THREE.BoxGeometry(netWidth, 0.07, 0.02), bandMaterial);
  topBand.position.set(0, top - 0.035, 0);
  topBand.castShadow = true;
  const bottomBand = new THREE.Mesh(new THREE.BoxGeometry(netWidth, 0.04, 0.02), bandMaterial);
  bottomBand.position.set(0, top - NET_DEPTH + 0.02, 0);
  group.add(topBand, bottomBand);

  // 標誌桿：紅白相間，立在邊線正上方
  for (const x of [-COURT.width / 2, COURT.width / 2]) {
    group.add(createAntenna(x, top - NET_DEPTH));
  }

  return group;
}

function createAntenna(x, bottomY) {
  const group = new THREE.Group();
  const segment = 0.2;
  const count = 9; // 總長 1.8m，高出網頂 0.8m
  const red = toonMaterial({ color: 0xe8333a });
  const white = toonMaterial({ color: 0xffffff });
  const geometry = new THREE.CylinderGeometry(0.02, 0.02, segment, 8);
  for (let i = 0; i < count; i++) {
    const piece = new THREE.Mesh(geometry, i % 2 === 0 ? red : white);
    piece.position.set(x, bottomY + segment * (i + 0.5), 0);
    group.add(piece);
  }
  return group;
}

function createMeshTexture(repeatX, repeatY) {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, 3);
  ctx.fillRect(0, 0, 3, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.anisotropy = 8;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
