// 著火的特效：球上的火光（createFireGlow），和掛在角色身上的一整組（attachFire）：
// 手上的球帶火光，全身包著往上竄的金色火焰氣場、腳下光圈、往上飄的火星。
// 氣場的做法和著色器搬自排球遊戲的 src/fx/powerAura.js（強力擊球的氣場），尺寸縮成這裡 1.70 m 的角色。
import * as THREE from 'three'

// ===== 可以調整的參數 =====
const BALL_GLOW = 0.75 // 球上火光的大小（公尺）
const FLICKER = 0.12 // 球上火光閃爍時大小變動的比例
const AURA_SCALE = 0.84 // 氣場的大小：1 是排球遊戲原本的尺寸（高 2.6 m），0.84 約高 2.2 m
const AURA_INTENSITY = 1.3 // 氣場全開的強度（越大火焰越猛；超過 OUTER_START 外層火焰才出現）
const AURA_RISE = 5 // 氣場出現、消失的快慢（越大越快）
const SPARKS = 28 // 往上飄的火星有幾顆
const SPARK_SIZE = 0.09 // 火星的大小（公尺）
// ==========================

// 火焰外殼的側面輪廓（半徑, 高度）：包住身體，頭頂收成火焰尖
const SHELL_PROFILE = [
  [0, -0.05], [0.38, 0], [0.5, 0.4], [0.52, 0.9], [0.5, 1.4], [0.45, 1.8], [0.3, 2.15], [0.12, 2.45], [0, 2.6],
].map(([r, y]) => new THREE.Vector2(r, y))

// 外層火焰：比內層大一圈，強度超過這個值才開始出現（火焰看起來一層層往上燒）
const OUTER_START = 0.8

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
`

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
`

function createShell(scale, phase) {
  const uniforms = {
    time: { value: 0 },
    intensity: { value: 0 },
    phase: { value: phase },
    colorLow: { value: new THREE.Color(0xff3c00) },
    colorHigh: { value: new THREE.Color(0xffc21a) },
  }
  const shell = new THREE.Mesh(
    new THREE.LatheGeometry(SHELL_PROFILE, 32),
    new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, transparent: true, depthWrite: false }),
  )
  shell.scale.set(scale, scale * 0.95 + 0.05, scale)
  shell.frustumCulled = false
  return { shell, uniforms }
}

// 往上飄的火星：一圈亮點從腳邊升到頭頂、越高越靠中間，升到頂就從下面再來
function createSparks() {
  const seeds = Array.from({ length: SPARKS }, () => ({ angle: Math.random() * Math.PI * 2, offset: Math.random(), speed: 0.5 + Math.random() * 0.6, radius: 0.3 + Math.random() * 0.3 }))
  const positions = new Float32Array(SPARKS * 3)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const material = new THREE.PointsMaterial({
    map: glowTexture(),
    color: 0xffd060,
    size: SPARK_SIZE,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  })
  const points = new THREE.Points(geometry, material)
  points.frustumCulled = false
  return {
    points,
    update(intensity, time) {
      for (let i = 0; i < SPARKS; i++) {
        const seed = seeds[i]
        const k = (seed.offset + time * seed.speed) % 1 // 0 在腳邊、1 在頭頂上方
        const r = seed.radius * (1 - 0.6 * k)
        const a = seed.angle + time * 1.5
        positions[i * 3] = Math.cos(a) * r
        positions[i * 3 + 1] = k * 2.4
        positions[i * 3 + 2] = Math.sin(a) * r
      }
      geometry.attributes.position.needsUpdate = true
      material.opacity = Math.min(1, intensity)
    },
  }
}

// 全身的氣場：內外兩層火焰外殼、腳下光圈、火星
function createAura() {
  const group = new THREE.Group()
  const inner = createShell(1, 0)
  const outer = createShell(1.18, 2.7)
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.45, 0.85, 40),
    new THREE.MeshBasicMaterial({ color: 0xffc23a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
  )
  ring.rotation.x = -Math.PI / 2
  ring.position.y = 0.03
  const sparks = createSparks()
  group.add(inner.shell, outer.shell, ring, sparks.points)
  group.scale.setScalar(AURA_SCALE)
  group.visible = false
  return {
    group,
    update(intensity, time) {
      group.visible = intensity > 0.01
      if (!group.visible) return
      inner.uniforms.intensity.value = intensity
      inner.uniforms.time.value = time
      const outerIntensity = Math.max(0, intensity - OUTER_START) * 1.4
      outer.shell.visible = outerIntensity > 0.01
      outer.uniforms.intensity.value = outerIntensity
      outer.uniforms.time.value = time * 1.2
      ring.material.opacity = Math.min(1, 0.6 * intensity * (0.75 + 0.25 * Math.sin(time * 10)))
      ring.scale.setScalar(1 + 0.08 * intensity * Math.sin(time * 8))
      sparks.update(intensity, time)
    },
  }
}

let texture = null
function glowTexture() {
  if (texture) return texture
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const g = canvas.getContext('2d')
  const grad = g.createRadialGradient(32, 32, 4, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,230,140,0.95)')
  grad.addColorStop(0.4, 'rgba(255,120,30,0.6)')
  grad.addColorStop(1, 'rgba(255,60,0,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  texture = new THREE.CanvasTexture(canvas)
  return texture
}

export function createFireGlow(size = BALL_GLOW, opacity = 1) {
  const material = new THREE.SpriteMaterial({
    map: glowTexture(),
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
    opacity,
  })
  const glow = new THREE.Sprite(material)
  glow.scale.setScalar(size)
  glow.visible = false
  return glow
}

// 在角色手上的球（ball，模型裡的球）掛火光，全身（root，角色的根節點）掛氣場。
// 回傳 update(on, time)：on 是不是著火，time 是秒數。氣場會漸漸燒起來、漸漸熄掉；球被隱藏時球上的火光跟著看不到
export function attachFire(ball, root) {
  const onBall = createFireGlow(BALL_GLOW)
  const aura = createAura()
  ball.add(onBall)
  root.add(aura.group)
  let level = 0
  let last = 0
  return function update(on, time) {
    const delta = Math.min(0.1, Math.max(0, time - last))
    last = time
    level = THREE.MathUtils.damp(level, on ? AURA_INTENSITY : 0, AURA_RISE, delta)
    aura.update(level, time)
    onBall.visible = on
    if (on) onBall.scale.setScalar(BALL_GLOW * (1 + FLICKER * Math.sin(time * 23) * Math.sin(time * 7.3)))
  }
}
