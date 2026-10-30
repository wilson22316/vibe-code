import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

// 卡通著色：受光只分三階（暗、中、亮），不做平滑漸層
const gradientMap = (() => {
  const steps = new Uint8Array([110, 190, 255]);
  const texture = new THREE.DataTexture(steps, steps.length, 1, THREE.RedFormat);
  texture.minFilter = texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
})();

export function toonMaterial(params) {
  return new THREE.MeshToonMaterial({ gradientMap, ...params });
}

// 描邊：在物件背後畫一層往外撐開的背面（inverted hull）。
// 粗細以螢幕像素計算（以 1080p 為基準），近的稍粗、遠的稍細。
const OUTLINE_DARKEN = 0.25; // 線條顏色 = 物件顏色 × 這個值
const FALLBACK_COLOR = new THREE.Color(0x2a2230);
const resolution = { value: new THREE.Vector2(1920, 1080) };
const geometryCache = new WeakMap();
const materialCache = new Map();

const vertexShader = /* glsl */ `
  #include <fog_pars_vertex>
  uniform vec2 resolution;
  uniform float thickness;
  const float REF_DEPTH = 20.0; // 這個距離時剛好是設定的粗細

  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vec4 clip = projectionMatrix * mvPosition;
    // 把法線方向投影到螢幕上，沿著它往外推固定像素
    vec4 clipN = projectionMatrix * modelViewMatrix * vec4(position + normal * 0.1, 1.0);
    vec2 d = (clipN.xy / clipN.w - clip.xy / clip.w) * resolution;
    float len = length(d);
    vec2 dir = len > 1e-6 ? d / len : vec2(0.0);
    float px = thickness * (resolution.y / 1080.0) * clamp(REF_DEPTH / clip.w, 0.6, 1.4);
    clip.xy += dir * (2.0 * px / resolution) * clip.w;
    gl_Position = clip;
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 color;
  #include <fog_pars_fragment>
  void main() {
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

// 視窗大小改變時呼叫（傳實際繪圖像素，含裝置像素比）
export function setOutlineResolution(width, height) {
  resolution.value.set(width, height);
}

// 幫 root 底下所有 mesh 加描邊；userData.noOutline 的 mesh 會跳過
export function addOutline(root, { thickness = 2, color } = {}) {
  const meshes = [];
  root.traverse((o) => {
    if (o.isMesh && !o.userData.noOutline && !o.userData.isOutline) meshes.push(o);
  });
  for (const mesh of meshes) {
    const lineColor = color ?? (mesh.material.color ? mesh.material.color.clone().multiplyScalar(OUTLINE_DARKEN) : FALLBACK_COLOR);
    const outline = new THREE.Mesh(outlineGeometry(mesh.geometry), outlineMaterial(lineColor, thickness));
    outline.userData.isOutline = true;
    mesh.add(outline);
  }
  return root;
}

// 法線全部平滑化：方塊、圓柱的稜角處往外推時才不會裂開
function outlineGeometry(geometry) {
  let result = geometryCache.get(geometry);
  if (!result) {
    result = toCreasedNormals(geometry, Math.PI);
    geometryCache.set(geometry, result);
  }
  return result;
}

function outlineMaterial(color, thickness) {
  const key = `${color.getHexString()}-${thickness}`;
  let material = materialCache.get(key);
  if (!material) {
    material = new THREE.ShaderMaterial({
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        resolution, // 所有描邊共用同一個，視窗縮放時一起更新
        thickness: { value: thickness },
        color: { value: color },
      },
      vertexShader,
      fragmentShader,
      side: THREE.BackSide,
      fog: true,
    });
    materialCache.set(key, material);
  }
  return material;
}
