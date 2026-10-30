import * as THREE from 'three';
import { COURT } from '../config.js';
import { addOutline, toonMaterial } from '../fx/toon.js';

const SKY_TOP = 0x3d9be9;
const SKY_HORIZON = 0xcdeeff;
const SAND = 0xf2d6a2;
const SHORE_Z = -28; // 海岸線位置（對手後方）

export function createEnvironment(scene) {
  scene.background = new THREE.Color(SKY_HORIZON);
  scene.fog = new THREE.Fog(SKY_HORIZON, 60, 220);

  const group = new THREE.Group();
  group.add(createSky(), createSand(), createSea(), createPalmTrees());
  return group;
}

function createSky() {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: false,
    uniforms: {
      topColor: { value: new THREE.Color(SKY_TOP) },
      horizonColor: { value: new THREE.Color(SKY_HORIZON) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y * 2.0, 0.0, 1.0);
        gl_FragColor = vec4(mix(horizonColor, topColor, h), 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), material);
}

function createSand() {
  const geometry = new THREE.PlaneGeometry(160, 100, 80, 50);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, 0, 20); // 覆蓋 z = -30 ~ 70

  const halfW = COURT.width / 2 + 3;
  const halfL = COURT.length / 2 + 3;
  const base = new THREE.Color(SAND);
  const colors = [];
  const pos = geometry.attributes.position;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);

    // 球場與周圍保持平坦，越往外沙丘起伏越明顯
    const outside = Math.max(Math.abs(x) - halfW, Math.abs(z) - halfL, 0);
    const dune = THREE.MathUtils.smoothstep(outside, 0, 8);
    let y = dune * (Math.sin(x * 0.35) * Math.cos(z * 0.28) * 0.5 + Math.sin(x * 0.9 + z * 0.6) * 0.15 + 0.3);

    // 靠近海岸逐漸沉入水面下
    y -= THREE.MathUtils.smoothstep(-z, -SHORE_Z - 8, -SHORE_Z) * 1.2;
    pos.setY(i, y);

    const shade = 1 - Math.random() * 0.06 - (y < 0 ? 0.12 : 0);
    colors.push(base.r * shade, base.g * shade, base.b * shade);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const sand = new THREE.Mesh(geometry, toonMaterial({ vertexColors: true }));
  sand.receiveShadow = true;
  return sand;
}

function createSea() {
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(800, 400),
    toonMaterial({ color: 0x2bb5d6 }),
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(0, -0.35, SHORE_Z - 196);
  return sea;
}

// 固定位置，避免每次重新整理場景都不同
const PALM_SPOTS = [
  [-14, -12, 6.5], [-17, 2, 7.5], [-13, 14, 6], [-20, -20, 8],
  [14, -10, 7], [18, 4, 6.5], [13, 16, 7.5], [21, -19, 8],
];

function createPalmTrees() {
  const group = new THREE.Group();
  PALM_SPOTS.forEach(([x, z, height], i) => {
    const tree = createPalmTree(height);
    tree.position.set(x, 0, z);
    tree.rotation.y = i * 1.7;
    group.add(tree);
  });
  return group;
}

function createPalmTree(height) {
  const tree = new THREE.Group();
  const trunkMaterial = toonMaterial({ color: 0x9a6b43 });
  const leafMaterial = toonMaterial({ color: 0x3fae55, side: THREE.DoubleSide });

  // 樹幹：一節一節往同一側微彎
  const segments = 6;
  const segH = height / segments;
  let top = new THREE.Vector3();
  for (let i = 0; i < segments; i++) {
    const r = 0.28 - i * 0.025;
    const piece = new THREE.Mesh(new THREE.CylinderGeometry(r - 0.02, r, segH, 7), trunkMaterial);
    const lean = (i / segments) ** 2 * 1.2;
    piece.position.set(lean, segH * (i + 0.5), 0);
    piece.rotation.z = -0.08 * i;
    piece.castShadow = true;
    tree.add(piece);
    top.set(lean, segH * (i + 1), 0);
  }

  // 葉子：扁平錐體向外下垂
  const leafCount = 7;
  for (let i = 0; i < leafCount; i++) {
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.45, 3, 4), leafMaterial);
    leaf.geometry.translate(0, 1.5, 0);
    leaf.scale.set(1, 1, 0.25);
    leaf.position.copy(top);
    leaf.rotation.order = 'YXZ';
    leaf.rotation.y = (i / leafCount) * Math.PI * 2;
    leaf.rotation.x = 1.15 + (i % 2) * 0.25;
    leaf.castShadow = true;
    tree.add(leaf);
  }

  return addOutline(tree, { thickness: 2.6 });
}
