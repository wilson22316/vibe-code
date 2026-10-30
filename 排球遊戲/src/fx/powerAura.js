import * as THREE from 'three';

// 強力擊球的能量氣場：包住全身、往上竄的金色火焰外殼（內外兩層）＋腳下光圈。
// 往上飄的光點由 Effects.auraSparks 負責（粒子要放在世界座標）。
// 強度 intensity：小氣場約 0.7、全開 1.5（見 config 的 POWER.auraSmall／auraFull）

// 火焰外殼的側面輪廓（半徑, 高度）：包住身體，頭頂收成火焰尖
const SHELL_PROFILE = [
  [0, -0.05], [0.38, 0], [0.5, 0.4], [0.52, 0.9], [0.5, 1.4], [0.45, 1.8], [0.3, 2.15], [0.12, 2.45], [0, 2.6],
].map(([r, y]) => new THREE.Vector2(r, y));

// 外層火焰：比內層大一圈，強度超過這個值才開始出現（全開時才明顯，火焰看起來一層層往上燒）
const OUTER_START = 0.8;

const vertexShader = /* glsl */ `
  uniform float time;
  uniform float intensity;
  uniform float phase;
  varying vec3 vNormalV;
  varying vec3 vViewDir;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 pos = position;
    float around = atan(pos.z, pos.x);
    // 火焰邊緣往外一伸一縮
    float wave = sin(pos.y * 6.0 - time * 14.0 + around * 3.0 + phase) * 0.07;
    pos += normal * wave * intensity;
    // 上半部的火焰尖忽高忽低地往上竄
    float tip = smoothstep(0.55, 1.0, uv.y);
    pos.y += tip * (0.25 + 0.2 * sin(time * 11.0 + around * 2.0 + phase)) * intensity;
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    vViewDir = normalize(-mv.xyz);
    vNormalV = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float time;
  uniform float intensity;
  uniform float phase;
  uniform vec3 colorLow;
  uniform vec3 colorHigh;
  varying vec3 vNormalV;
  varying vec3 vViewDir;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  void main() {
    // 邊緣（側面看過去）最濃，正中間幾乎透明，角色才看得清楚
    float rim = pow(1.0 - abs(dot(vNormalV, vViewDir)), 1.4);
    // 往上竄的火舌：對比拉高，才會一條條分開，而不是一整片
    float speed = 3.5 + intensity * 1.5;
    vec2 uv = vec2(vUv.x + phase * 0.1, vUv.y);
    float n = noise(vec2(uv.x * 12.0, uv.y * 4.0 - time * speed)) * 0.65 + noise(vec2(uv.x * 28.0, uv.y * 8.0 - time * speed * 1.7)) * 0.35;
    float tongues = smoothstep(0.48, 0.78, n);
    float fadeTop = 1.0 - smoothstep(0.75, 1.0, vUv.y);
    float a = clamp((rim * 0.45 + tongues * (rim * 0.9 + 0.12)) * fadeTop * intensity, 0.0, 0.95);
    // 火的顏色：底部紅橘、火舌和上方偏黃（越熱越亮）
    vec3 color = mix(colorLow, colorHigh, clamp(tongues * 0.6 + vUv.y * 0.5, 0.0, 1.0));
    gl_FragColor = vec4(color, a);
    #include <colorspace_fragment>
  }
`;

function createShell(scale, phase) {
  const uniforms = {
    time: { value: 0 },
    intensity: { value: 0 },
    phase: { value: phase },
    colorLow: { value: new THREE.Color(0xff3c00) },
    colorHigh: { value: new THREE.Color(0xffc21a) },
  };
  // 用一般半透明混合（不用疊加光）：疊加在藍天上會變白，一般混合才看得出火的橘紅色
  const shell = new THREE.Mesh(
    new THREE.LatheGeometry(SHELL_PROFILE, 32),
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
    }),
  );
  shell.scale.set(scale, scale * 0.95 + 0.05, scale);
  return { shell, uniforms };
}

export function createPowerAura() {
  const group = new THREE.Group();
  const inner = createShell(1, 0);
  const outer = createShell(1.18, 2.7);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.45, 0.85, 40),
    new THREE.MeshBasicMaterial({ color: 0xffc23a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  group.add(inner.shell, outer.shell, ring);
  group.visible = false;

  return {
    group,
    update(intensity, time) {
      group.visible = intensity > 0.01;
      if (!group.visible) return;
      inner.uniforms.intensity.value = intensity;
      inner.uniforms.time.value = time;
      const outerIntensity = Math.max(0, intensity - OUTER_START) * 1.4;
      outer.shell.visible = outerIntensity > 0.01;
      outer.uniforms.intensity.value = outerIntensity;
      outer.uniforms.time.value = time * 1.2;
      ring.material.opacity = Math.min(1, 0.6 * intensity * (0.75 + 0.25 * Math.sin(time * 10)));
      ring.scale.setScalar(1 + 0.08 * intensity * Math.sin(time * 8));
    },
  };
}
