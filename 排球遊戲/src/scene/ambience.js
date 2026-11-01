import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COURT } from '../config.js';
import { addOutline, toonMaterial } from '../fx/toon.js';
import { SHORE_Z } from './environment.js';

// ---- 觀眾席：球場左右兩側的階梯看台 ----
const STAND_X = COURT.width / 2 + 5.2; // 第一階的內緣離中線多遠
const TIER_DEPTH = 0.9;
const TIER_RISE = 0.4;
const TIERS = 4;
const STAND_LENGTH = 17;
const SEAT_SPACING = 0.75;
const SEAT_FILL = 0.8; // 有人坐的比例
const TIER_COLORS = [0xffffff, 0x9fd3ff];
const RAIL_COLOR = 0xff6b4a;

// 觀眾：坐著的身體＋頭＋兩隻手（簡單的剪影造型，不畫五官）
const CROWD_SHIRTS = [0xff6b4a, 0x5b6cff, 0xffd23f, 0x2fbf4f, 0xff70a6, 0x14b8a6, 0xffffff, 0xff9f1c];
const CROWD_SKINS = [0xffe0c4, 0xffd7b5, 0xf1c08f, 0xe7b48a, 0xc68642, 0x8d5524];
const BODY_Y = 0.36; // 身體中心離座位多高
const HEAD_Y = 0.86;
const SHOULDER_Y = 0.6;
const SHOULDER_X = 0.2;
const CHEER_TIME = 2.6; // 得分後歡呼幾秒
const CHEER_JUMP = 0.28;

// ---- 旗子：看台外的四個角落，風從 -x 吹向 +x ----
// 放在主畫面繞場鏡頭（半徑 15 公尺）的外面、避開椰子樹，鏡頭才不會從旗子旁邊擦過被整片擋住
const FLAG_SPOTS = [
  [-16, -15, 0x5b6cff], [16, -15, 0xffd23f], [-17, 12, 0xffd23f], [17, 13, 0xff6b4a],
];
const POLE_HEIGHT = 6;
const FLAG_W = 2;
const FLAG_H = 1.25;

// ---- 雲：遠方天空慢慢飄 ----
const CLOUD_COUNT = 12;
const CLOUD_DRIFT = 0.004; // 整片雲每秒繞場轉幾弧度

// 固定亂數：每次開啟看台的觀眾、雲的形狀都一樣
function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 場景氛圍：觀眾席與觀眾（得分時歡呼揮手）、旗子飄動、椰子樹擺動、雲、海浪
export class Ambience {
  // palms：environment.js 的椰子樹（userData.leaves 是葉子）
  constructor(scene, palms) {
    this.palms = palms;
    for (const tree of palms) for (const leaf of tree.userData.leaves) leaf.userData.baseX = leaf.rotation.x;
    this.time = 0;
    this.cheerTimer = 0;
    this.cheerStrength = 0;

    const random = seeded(7);
    this.seats = [];
    for (const side of [-1, 1]) {
      scene.add(createStand(side));
      this.seats.push(...createSeats(side, random));
    }
    this.crowd = createCrowd(this.seats, random);
    scene.add(this.crowd.body, this.crowd.head, this.crowd.arms);

    this.flags = FLAG_SPOTS.map(([x, z, color], i) => createFlag(x, z, color, i));
    for (const flag of this.flags) scene.add(flag.group);

    this.clouds = createClouds(seeded(21));
    scene.add(this.clouds);

    this.waves = createWaves();
    scene.add(this.waves.group);
  }

  // 得分時觀眾歡呼：strength 1 正常，大一點跳得更高（贏球）
  cheer(strength = 1) {
    this.cheerStrength = this.cheerTimer > 0 ? Math.max(this.cheerStrength, strength) : strength; // 還在歡呼就取比較大的
    this.cheerTimer = CHEER_TIME;
  }

  update(dt) {
    this.time += dt;
    const t = this.time;
    this.cheerTimer = Math.max(0, this.cheerTimer - dt);
    // 歡呼的強度：一開始全力，最後半秒慢慢停下來
    const cheer = this.cheerStrength * Math.min(1, this.cheerTimer / 0.5);
    if (this.cheerTimer === 0) this.cheerStrength = 0;

    this.updatePalms(t);
    for (const flag of this.flags) flag.update(t);
    this.clouds.rotation.y += dt * CLOUD_DRIFT;
    this.waves.update(t);
    this.updateCrowd(t, cheer);
  }

  // 椰子樹整棵輕輕擺、葉子抖動
  updatePalms(t) {
    this.palms.forEach((tree, i) => {
      tree.rotation.z = Math.sin(t * 0.8 + i) * 0.02;
      tree.rotation.x = Math.sin(t * 0.6 + i * 1.3) * 0.015;
      tree.userData.leaves.forEach((leaf, k) => {
        leaf.rotation.x = leaf.userData.baseX + Math.sin(t * 2.2 + k + i) * 0.05;
      });
    });
  }

  // 平常輕輕晃；歡呼時站起來跳、雙手舉高揮舞
  updateCrowd(t, cheer) {
    const { body, head, arms } = this.crowd;
    this.seats.forEach((s, i) => {
      const jump = cheer * CHEER_JUMP * Math.abs(Math.sin(t * 7 + s.phase));
      const y = s.y + Math.sin(t * 1.6 + s.phase) * 0.015 + jump;
      _dummy.rotation.set(0, s.facing, 0);
      _dummy.position.set(s.x, y + BODY_Y, s.z);
      _dummy.updateMatrix();
      body.setMatrixAt(i, _dummy.matrix);
      _dummy.position.y = y + HEAD_Y;
      _dummy.updateMatrix();
      head.setMatrixAt(i, _dummy.matrix);

      // 手：平常垂在身旁，歡呼時往兩側上方舉起揮動
      const raise = THREE.MathUtils.lerp(0.15, 2.6 + Math.sin(t * 12 + s.phase) * 0.3, Math.min(1, cheer * 1.5));
      for (const arm of [-1, 1]) {
        const ox = Math.cos(s.facing) * SHOULDER_X * arm;
        const oz = -Math.sin(s.facing) * SHOULDER_X * arm;
        _dummy.position.set(s.x + ox, y + SHOULDER_Y, s.z + oz);
        _dummy.rotation.set(0, s.facing, arm * raise, 'YXZ');
        _dummy.updateMatrix();
        arms.setMatrixAt(i * 2 + (arm > 0 ? 1 : 0), _dummy.matrix);
      }
    });
    body.instanceMatrix.needsUpdate = true;
    head.instanceMatrix.needsUpdate = true;
    arms.instanceMatrix.needsUpdate = true;
  }
}

const _dummy = new THREE.Object3D();

// side：+1 在 +x 那一側。每一階往外、往上一格，底下埋進沙裡蓋住地形起伏
function createStand(side) {
  const group = new THREE.Group();
  for (let k = 0; k < TIERS; k++) {
    const top = TIER_RISE * (k + 1);
    const height = top + 0.6;
    const tier = new THREE.Mesh(new THREE.BoxGeometry(TIER_DEPTH, height, STAND_LENGTH), toonMaterial({ color: TIER_COLORS[k % 2] }));
    tier.position.set(side * (STAND_X + (k + 0.5) * TIER_DEPTH), top - height / 2, 0);
    tier.castShadow = true;
    tier.receiveShadow = true;
    group.add(tier);
  }
  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.8, STAND_LENGTH), toonMaterial({ color: RAIL_COLOR }));
  rail.position.set(side * (STAND_X + TIERS * TIER_DEPTH - 0.04), TIER_RISE * TIERS + 0.4, 0);
  group.add(rail);
  return addOutline(group, { thickness: 2.4 });
}

// 每一階沿著看台排座位，隨機空出一些位子；觀眾面向球場
function createSeats(side, random) {
  const seats = [];
  const count = Math.floor((STAND_LENGTH - 1) / SEAT_SPACING);
  for (let k = 0; k < TIERS; k++) {
    for (let n = 0; n < count; n++) {
      if (random() > SEAT_FILL) continue;
      seats.push({
        x: side * (STAND_X + (k + 0.55) * TIER_DEPTH),
        y: TIER_RISE * (k + 1),
        z: -STAND_LENGTH / 2 + 0.5 + (n + 0.5) * SEAT_SPACING + (random() - 0.5) * 0.15,
        facing: side > 0 ? -Math.PI / 2 : Math.PI / 2,
        phase: random() * Math.PI * 2,
      });
    }
  }
  return seats;
}

// 全部觀眾用三個 InstancedMesh（身體、頭、手），三次繪製就畫完
function createCrowd(seats, random) {
  const n = seats.length;
  const material = toonMaterial({ color: 0xffffff });
  const body = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.17, 0.3, 4, 8), material, n);
  const head = new THREE.InstancedMesh(new THREE.SphereGeometry(0.15, 10, 8), material, n);
  const armGeometry = new THREE.CapsuleGeometry(0.05, 0.28, 3, 6);
  armGeometry.translate(0, -0.19, 0); // 支點在肩膀
  const arms = new THREE.InstancedMesh(armGeometry, material, n * 2);
  const color = new THREE.Color();
  for (let i = 0; i < n; i++) {
    body.setColorAt(i, color.set(CROWD_SHIRTS[Math.floor(random() * CROWD_SHIRTS.length)]));
    color.set(CROWD_SKINS[Math.floor(random() * CROWD_SKINS.length)]);
    head.setColorAt(i, color);
    arms.setColorAt(i * 2, color);
    arms.setColorAt(i * 2 + 1, color);
  }
  for (const mesh of [body, head, arms]) mesh.frustumCulled = false; // 每幀都會動，邊界球不準
  return { body, head, arms };
}

// 旗桿＋布：布的頂點每幀用正弦波往兩側擺，越靠外側擺越大
function createFlag(x, z, color, index) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  // 旗桿往下多插 1.5 公尺：那裡是起伏的沙丘，地面不一定在 0
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, POLE_HEIGHT + 1.5, 8), toonMaterial({ color: 0xf4f4f4 }));
  pole.position.y = (POLE_HEIGHT - 1.5) / 2;
  pole.castShadow = true;
  group.add(addOutline(pole, { thickness: 2.4 }));

  const geometry = new THREE.PlaneGeometry(FLAG_W, FLAG_H, 12, 6);
  geometry.translate(FLAG_W / 2, 0, 0); // 左邊緣綁在旗桿上
  const cloth = new THREE.Mesh(geometry, toonMaterial({ color, side: THREE.DoubleSide }));
  cloth.position.y = POLE_HEIGHT - FLAG_H / 2 - 0.1;
  cloth.castShadow = true;
  group.add(cloth);

  const position = geometry.attributes.position;
  const base = Float32Array.from(position.array);
  const phase = index * 1.7;
  return {
    group,
    update(t) {
      for (let i = 0; i < position.count; i++) {
        const px = base[i * 3];
        const py = base[i * 3 + 1];
        const wave = Math.sin(px * 3 - t * 6 + phase) * 0.14 + Math.sin(py * 2 + t * 3) * 0.02;
        position.setZ(i, wave * (px / FLAG_W));
      }
      position.needsUpdate = true;
      geometry.computeVertexNormals();
    },
  };
}

// 每朵雲是幾顆壓扁的球，散在遠方天空一圈；整片雲一起轉，所以全部合併成一個幾何（一次繪製）
function createClouds(random) {
  const material = toonMaterial({ color: 0xffffff, emissive: 0x5a6878 });
  material.fog = false; // 霧會把遠方的雲染成天空色，看不出是雲
  const puffs = [];
  const place = new THREE.Object3D();
  for (let i = 0; i < CLOUD_COUNT; i++) {
    const angle = (i / CLOUD_COUNT) * Math.PI * 2 + random() * 0.3;
    const dist = 120 + random() * 60;
    const height = 22 + random() * 22;
    place.position.set(Math.sin(angle) * dist, height, Math.cos(angle) * dist);
    place.lookAt(0, height, 0); // 長邊朝向球場
    place.updateMatrix();
    const count = 4 + Math.floor(random() * 3);
    for (let j = 0; j < count; j++) {
      const r = 3 + random() * 3;
      const puff = new THREE.SphereGeometry(r, 12, 8);
      puff.scale(1, 0.6, 1);
      puff.translate((j - count / 2) * 4 + random() * 2, random() * 1.5, random() * 2);
      puff.applyMatrix4(place.matrix);
      puffs.push(puff);
    }
  }
  return new THREE.Mesh(mergeGeometries(puffs), material);
}

// 海浪：海面上一層重複的白色浪紋往岸邊捲，加上岸邊幾條白色浪花來回拍打（被沙灘蓋住的地方自然看不到）
function createWaves() {
  const group = new THREE.Group();
  const texture = createWaveTexture();
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(60, 30);
  const lines = new THREE.Mesh(
    new THREE.PlaneGeometry(800, 400),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.6, depthWrite: false }),
  );
  lines.rotation.x = -Math.PI / 2;
  lines.position.set(0, -0.33, SHORE_Z - 196);
  group.add(lines);

  const foams = [0, 1, 2].map((k) => {
    const foam = new THREE.Mesh(
      new THREE.PlaneGeometry(260, 1.1),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false }),
    );
    foam.rotation.x = -Math.PI / 2;
    foam.position.y = -0.32;
    foam.userData.baseZ = SHORE_Z + 3.5 - k * 1.6;
    group.add(foam);
    return foam;
  });

  return {
    group,
    update(t) {
      texture.offset.y = (t * 0.05) % 1;
      foams.forEach((foam, k) => {
        const s = Math.sin(t * 0.7 + k * 2.1);
        foam.position.z = foam.userData.baseZ + s * 0.9;
        foam.material.opacity = 0.35 + 0.35 * (0.5 + 0.5 * s); // 往岸上推時比較白
      });
    },
  };
}

// 浪紋貼圖：透明底上幾道白色弧線
function createWaveTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  for (const [x, y] of [[20, 30], [80, 62], [36, 100]]) {
    ctx.beginPath();
    ctx.moveTo(x - 16, y);
    ctx.quadraticCurveTo(x, y - 8, x + 16, y);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
