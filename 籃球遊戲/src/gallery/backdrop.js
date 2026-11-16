// 手繪動畫風背景：程式產生的藍天白雲（含遠方草坡）與腳下的草地圓盤。
// 沿用 reference/dribble_preview_r128.html 的畫法，改成新版 three.js 的色彩空間寫法。
import * as THREE from 'three'

// 固定種子的亂數，每次畫出來的雲和草都一樣
function seeded(seed) {
  return () => {
    seed = (seed * 9301 + 49297) % 233280
    return seed / 233280
  }
}

function canvasTexture(canvas) {
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

// 當 scene.background 用的天空貼圖
export function createSky() {
  const c = document.createElement('canvas')
  c.width = 1024
  c.height = 768
  const x = c.getContext('2d')

  const sky = x.createLinearGradient(0, 0, 0, c.height)
  sky.addColorStop(0, '#6fa9d8')
  sky.addColorStop(0.55, '#a9d1ea')
  sky.addColorStop(1, '#e7f2ec')
  x.fillStyle = sky
  x.fillRect(0, 0, c.width, c.height)

  const rnd = seeded(11)
  // 每朵雲由 9 個圓組成，先畫偏右下的淡藍陰影，再畫白色本體
  const cloud = (cx, cy, s) => {
    const blobs = Array.from({ length: 9 }, () => [
      (rnd() - 0.5) * 220 * s,
      (rnd() - 0.2) * 60 * s,
      (40 + rnd() * 50) * s,
    ])
    x.fillStyle = 'rgba(214,226,238,0.9)'
    for (const [ox, oy, r] of blobs) {
      x.beginPath()
      x.arc(cx + ox + 6 * s, cy + oy + 10 * s, r, 0, Math.PI * 2)
      x.fill()
    }
    x.fillStyle = 'rgba(255,255,255,0.96)'
    for (const [ox, oy, r] of blobs) {
      x.beginPath()
      x.arc(cx + ox, cy + oy, r, 0, Math.PI * 2)
      x.fill()
    }
  }
  cloud(250, 230, 1.0)
  cloud(760, 170, 0.8)
  cloud(560, 360, 0.55)
  cloud(110, 420, 0.45)

  // 遠方起伏的草坡
  const hill = x.createLinearGradient(0, 560, 0, 768)
  hill.addColorStop(0, '#9cc58a')
  hill.addColorStop(1, '#6f9e5d')
  x.fillStyle = hill
  x.beginPath()
  x.moveTo(0, 600)
  for (let i = 0; i <= 16; i++) x.lineTo(i * 64, 585 + Math.sin(i * 0.9) * 18 + rnd() * 10)
  x.lineTo(1024, 768)
  x.lineTo(0, 768)
  x.fill()

  return canvasTexture(c)
}

// 腳下半徑 2.8 m 的草地圓盤，邊緣漸淡融進背景
export function createGrass() {
  const c = document.createElement('canvas')
  c.width = c.height = 512
  const x = c.getContext('2d')

  const base = x.createRadialGradient(256, 256, 30, 256, 256, 256)
  base.addColorStop(0, '#93bf74')
  base.addColorStop(0.75, '#86b56a')
  base.addColorStop(1, 'rgba(134,181,106,0)')
  x.fillStyle = base
  x.fillRect(0, 0, 512, 512)

  // 900 根深淺交錯的短草
  const rnd = seeded(5)
  x.lineWidth = 2
  for (let i = 0; i < 900; i++) {
    const a = rnd() * Math.PI * 2
    const d = Math.sqrt(rnd()) * 220
    const px = 256 + Math.cos(a) * d
    const py = 256 + Math.sin(a) * d
    x.strokeStyle = rnd() > 0.5 ? 'rgba(92,140,72,0.55)' : 'rgba(176,206,128,0.55)'
    x.beginPath()
    x.moveTo(px, py)
    x.lineTo(px + (rnd() - 0.5) * 6, py - 6 - rnd() * 8)
    x.stroke()
  }

  const grass = new THREE.Mesh(
    new THREE.CircleGeometry(2.8, 64),
    new THREE.MeshBasicMaterial({ map: canvasTexture(c), transparent: true }),
  )
  grass.rotation.x = -Math.PI / 2
  grass.position.y = -0.003
  return grass
}

// 夜晚球場的地面霧色；天空球地平線以下也是這個顏色，遠處的地面才會融進去
export const NIGHT_GROUND = '#2e3440'

// 64×64 徑向星芒貼圖：中心極亮、往外指數衰減至透明，確保星點細緻不糊
function createStarTexture() {
  const size = 64
  const c = document.createElement('canvas')
  c.width = c.height = size
  const x = c.getContext('2d')
  const img = x.createImageData(size, size)
  const half = size / 2
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const d = Math.hypot(px + 0.5 - half, py + 0.5 - half) / half
      const alpha = d >= 1 ? 0 : Math.exp(-d * d * 3.8) * (1 - d * d)
      const i = (py * size + px) * 4
      img.data[i] = 255
      img.data[i + 1] = 255
      img.data[i + 2] = 255
      img.data[i + 3] = Math.round(alpha * 255)
    }
  }
  x.putImageData(img, 0, 0)
  return canvasTexture(c)
}

// 依仰角均勻撒在天球上半部的星點層，用 Points 畫出不會隨鏡頭仰角拉扁的細緻星空
function createStarLayer({ count, size, radius, minBright, maxBright, rnd, map }) {
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const palette = ['#fff3d9', '#ffffff', '#cfe0ff']
  const color = new THREE.Color()
  const minElev = THREE.MathUtils.degToRad(12)
  const maxElev = THREE.MathUtils.degToRad(86)

  for (let i = 0; i < count; i++) {
    const az = rnd() * Math.PI * 2
    const sinE = THREE.MathUtils.lerp(Math.sin(minElev), Math.sin(maxElev), rnd())
    const elev = Math.asin(sinE)
    const cosE = Math.cos(elev)
    positions[i * 3] = Math.cos(az) * cosE * radius
    positions[i * 3 + 1] = sinE * radius
    positions[i * 3 + 2] = Math.sin(az) * cosE * radius

    // 接近地平線時漸淡，避免和都市天際線重疊處顯得雜亂
    const horizonFade = THREE.MathUtils.smoothstep(elev, minElev, THREE.MathUtils.degToRad(26))
    const bright = (minBright + rnd() * (maxBright - minBright)) * (0.25 + 0.75 * horizonFade)
    color.set(palette[Math.floor(rnd() * palette.length)]).multiplyScalar(bright)
    color.toArray(colors, i * 3)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  const material = new THREE.PointsMaterial({
    size,
    sizeAttenuation: false,
    map,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    fog: false,
    blending: THREE.AdditiveBlending,
  })
  const points = new THREE.Points(geometry, material)
  points.renderOrder = -9
  points.frustumCulled = false
  return points
}

// 在天空貼圖上畫一朵水平展開的夜雲（處理左右接縫）
function drawCloudBand(x, width, cx, cy, blobs, fillStyle) {
  x.fillStyle = fillStyle
  for (const offset of [0, -width, width]) {
    for (const [ox, oy, rx, ry] of blobs) {
      const px = cx + ox + offset
      if (px + rx < 0 || px - rx > width) continue
      x.beginPath()
      x.ellipse(px, cy + oy, rx, ry, 0, 0, Math.PI * 2)
      x.fill()
    }
  }
}

// 地平線上方（0.55～0.90 * horizon）的 3 層柔和水平夜雲剪影
function drawNightClouds(x, width, horizon) {
  const rnd = seeded(37)
  const bands = [
    { count: 7, yMin: 0.56, yMax: 0.68, scale: 1.0, body: 'rgba(22,26,54,0.48)', rim: 'rgba(160,175,225,0.14)', city: null },
    { count: 8, yMin: 0.68, yMax: 0.80, scale: 1.15, body: 'rgba(22,26,54,0.55)', rim: 'rgba(160,175,225,0.12)', city: 'rgba(128,92,138,0.12)' },
    { count: 9, yMin: 0.79, yMax: 0.90, scale: 1.25, body: 'rgba(24,28,56,0.52)', rim: 'rgba(150,165,215,0.09)', city: 'rgba(135,96,142,0.16)' },
  ]
  for (const band of bands) {
    for (let i = 0; i < band.count; i++) {
      const cx = ((i + 0.15 + rnd() * 0.7) / band.count) * width
      const cy = THREE.MathUtils.lerp(band.yMin, band.yMax, rnd()) * horizon
      const blobs = Array.from({ length: 6 }, (_, k) => [
        (k - 2.5) * (34 + rnd() * 20) * band.scale,
        (rnd() - 0.5) * 8 * band.scale,
        (55 + rnd() * 65) * band.scale,
        (7 + rnd() * 8) * band.scale,
      ])
      if (band.city) drawCloudBand(x, width, cx, cy + 3, blobs, band.city)
      drawCloudBand(x, width, cx, cy - 2, blobs, band.rim)
      drawCloudBand(x, width, cx, cy, blobs, band.body)
    }
  }
}

// 夜晚的天空：一顆包住整個場景的球（從裡面看），貼上深邃夜空漸層、水平雲帶和月亮，並掛載不變形的 THREE.Points 星空；
// 地平線以下是地面霧色。radius 要比鏡頭看得到的最遠距離（scene.js 的相機 far）小。月亮在籃架後方偏右的天空
export function createNightDome(radius = 80) {
  const c = document.createElement('canvas')
  c.width = 2048
  c.height = 1024
  const x = c.getContext('2d')
  const HORIZON = c.height / 2 // 貼圖上半是天空（最上面是天頂）、下半是地面
  const sky = x.createLinearGradient(0, 0, 0, HORIZON)
  sky.addColorStop(0, '#080c1e')
  sky.addColorStop(0.24, '#111838')
  sky.addColorStop(0.48, '#1d2550')
  sky.addColorStop(0.72, '#2f3264')
  sky.addColorStop(0.89, '#4b3d6b')
  sky.addColorStop(1, '#6e4f73')
  x.fillStyle = sky
  x.fillRect(0, 0, c.width, HORIZON)
  x.fillStyle = NIGHT_GROUND
  x.fillRect(0, HORIZON, c.width, c.height - HORIZON)

  drawNightClouds(x, c.width, HORIZON)

  // 月亮：外層淡藍紫月暈＋內層暖白光暈＋帶柔和月海細節的月面。u = 0.71 是籃架後方（-Z）偏右，仰角約 30 度
  const mx = c.width * 0.71
  const my = HORIZON * (1 - 30 / 90)
  const outerGlow = x.createRadialGradient(mx, my, 16, mx, my, 140)
  outerGlow.addColorStop(0, 'rgba(175,195,255,0.20)')
  outerGlow.addColorStop(0.45, 'rgba(145,165,235,0.08)')
  outerGlow.addColorStop(1, 'rgba(145,165,235,0)')
  x.fillStyle = outerGlow
  x.fillRect(mx - 144, my - 144, 288, 288)

  const innerGlow = x.createRadialGradient(mx, my, 12, mx, my, 60)
  innerGlow.addColorStop(0, 'rgba(255,246,224,0.42)')
  innerGlow.addColorStop(0.45, 'rgba(255,240,205,0.14)')
  innerGlow.addColorStop(1, 'rgba(255,240,205,0)')
  x.fillStyle = innerGlow
  x.fillRect(mx - 64, my - 64, 128, 128)

  x.save()
  x.beginPath()
  x.arc(mx, my, 16, 0, Math.PI * 2)
  x.clip()
  x.fillStyle = '#fff8e7'
  x.fillRect(mx - 17, my - 17, 34, 34)
  // 淡淡的月海陰影與邊緣明暗，避免月面死白
  x.fillStyle = 'rgba(210,198,180,0.32)'
  for (const [ox, oy, r] of [[-4, -3, 5.5], [3, -5, 4], [-2, 5, 4.5], [6, 3, 3.5]]) {
    x.beginPath()
    x.arc(mx + ox, my + oy, r, 0, Math.PI * 2)
    x.fill()
  }
  const limb = x.createRadialGradient(mx - 4, my - 4, 4, mx, my, 17)
  limb.addColorStop(0, 'rgba(255,255,255,0)')
  limb.addColorStop(1, 'rgba(195,182,165,0.28)')
  x.fillStyle = limb
  x.fillRect(mx - 17, my - 17, 34, 34)
  x.restore()

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 48, 24),
    new THREE.MeshBasicMaterial({ map: canvasTexture(c), side: THREE.BackSide, fog: false, depthWrite: false }),
  )
  dome.renderOrder = -10 // 最先畫，其他東西都蓋在上面
  dome.frustumCulled = false

  const starMap = createStarTexture()
  const starRnd = seeded(23)
  const starRadius = radius * 0.96
  dome.add(
    createStarLayer({ count: 260, size: 2.2, radius: starRadius, minBright: 0.35, maxBright: 0.8, rnd: starRnd, map: starMap }),
    createStarLayer({ count: 35, size: 3.8, radius: starRadius, minBright: 0.85, maxBright: 1.0, rnd: starRnd, map: starMap }),
  )
  return dome
}

const CITY_LAYERS = [
  {
    radiusScale: 1.45,
    heightScale: 1.75,
    renderOrder: -6,
    seedOffset: 20,
    rotation: 0.42,
    minW: 6.5,
    maxW: 12.5,
    minH: 0.5,
    maxH: 0.92,
    gapChance: 0.12,
    bodies: ['#151b35', '#181f3b', '#1c2342'],
    side: '#10152b',
    rim: '#2b345c',
    winScale: 0.72,
    winAlpha: 0.65,
    setbackChance: 0.55,
    beaconChance: 0.35,
  },
  {
    radiusScale: 1.18,
    heightScale: 1.3,
    renderOrder: -5,
    seedOffset: 10,
    rotation: 1.15,
    minW: 5.5,
    maxW: 10.5,
    minH: 0.42,
    maxH: 0.9,
    gapChance: 0.16,
    bodies: ['#1a213f', '#1e2545', '#222a4d'],
    side: '#131830',
    rim: '#323d66',
    winScale: 0.86,
    winAlpha: 0.82,
    setbackChance: 0.38,
    beaconChance: 0.2,
  },
  {
    radiusScale: 1.0,
    heightScale: 1.0,
    renderOrder: -4,
    seedOffset: 0,
    rotation: 0,
    minW: 4.5,
    maxW: 9.0,
    minH: 0.36,
    maxH: 0.86,
    gapChance: 0.18,
    bodies: ['#1f2647', '#232b4f', '#283056'],
    side: '#161b36',
    rim: '#3c4878',
    winScale: 1.0,
    winAlpha: 0.95,
    setbackChance: 0.22,
    beaconChance: 0.08,
  },
]

// 繪製單一建築量體（正面＋假 3D 側面＋頂部受光邊線）
function drawBuildingBlock(x, { bx, w, top, height, bodyColor, sideColor, rimColor, sideOnRight }) {
  const sideW = w >= 48 ? Math.min(w - 28, Math.max(10, Math.round(w * 0.18))) : 0
  const frontW = w - sideW
  const frontX = sideOnRight ? bx : bx + sideW
  const sideX = sideOnRight ? bx + frontW : bx

  x.fillStyle = bodyColor
  x.fillRect(frontX, top, frontW + 0.5, height)
  if (sideW > 0) {
    x.fillStyle = sideColor
    x.fillRect(sideX, top, sideW + 0.5, height)
    x.fillStyle = 'rgba(255,255,255,0.04)'
    x.fillRect(sideOnRight ? sideX : frontX, top, 1, height)
  }
  x.fillStyle = rimColor
  x.fillRect(frontX, top, frontW, 2)
  if (sideW > 0) {
    x.fillStyle = 'rgba(180,195,240,0.12)'
    x.fillRect(sideX, top, sideW, 1.5)
  }
  return { frontX, frontW }
}

// 在建築正面繪製細膩窗戶：商辦橫帶窗／細格窗、住宅帶陽台橫欄格窗、低調暗棟
function drawWindows(x, { frontX, frontW, top, bottom, winScale, winAlpha, rnd }) {
  const usableTop = top + 10
  const usableBottom = bottom - 22
  if (frontW < 22 || usableBottom - usableTop < 18) return

  const styleRoll = rnd()
  const isOffice = styleRoll < 0.42
  const isDark = styleRoll >= 0.82
  const rowH = Math.max(9, Math.round((isOffice ? 14 : 16) * winScale))
  const winH = Math.max(3, Math.round((isOffice ? 5 : 7.5) * winScale))
  const winW = Math.max(3, Math.round((isOffice ? 9 : 5.5) * winScale))
  const stepX = Math.max(winW + 3, Math.round((isOffice ? 12 : 13) * winScale))
  const palette = isOffice ? ['#fff2d6', '#cfe2ff', '#ffd27d'] : ['#ffd484', '#f7ebd2', '#ffe09e']
  const marginX = Math.max(5, Math.round((frontW % stepX) / 2))
  const cols = Math.floor((frontW - marginX * 2 + (stepX - winW)) / stepX)
  if (cols <= 0) return

  x.save()
  for (let wy = usableTop; wy + winH <= usableBottom; wy += rowH) {
    const floorLit = isOffice ? rnd() < 0.52 : false
    let litStreak = 0
    for (let c = 0; c < cols; c++) {
      const wx = frontX + marginX + c * stepX
      let lit = false
      if (isOffice) {
        if (floorLit) {
          if (litStreak <= 0 && rnd() < 0.35) litStreak = 2 + Math.floor(rnd() * 4)
          lit = litStreak > 0
          litStreak--
        } else {
          lit = rnd() < 0.14
        }
      } else {
        lit = rnd() < (isDark ? 0.08 : 0.24)
      }

      if (lit) {
        x.globalAlpha = winAlpha * (0.72 + rnd() * 0.28)
        x.fillStyle = palette[Math.floor(rnd() * palette.length)]
        x.fillRect(wx, wy, winW, winH)
      } else {
        x.globalAlpha = 0.38
        x.fillStyle = '#090d1c'
        x.fillRect(wx, wy, winW, winH)
      }
    }
    // 住宅窗 row 下方加上細暗的陽台橫欄
    if (!isOffice && !isDark && cols >= 2) {
      x.globalAlpha = 0.45
      x.fillStyle = '#0c1022'
      x.fillRect(frontX + marginX - 1, wy + winH + 1, cols * stepX - (stepX - winW) + 2, 1.5)
    }
  }
  x.restore()
}

// 繪製屋頂機房、水塔與高樓航空障礙紅燈
function drawRoofDetails(x, { frontX, frontW, top, minTop, heightRatio, spec, sideOnRight, rnd }) {
  if (frontW < 28) return
  let crownTop = top

  // 較高大樓機率加上退縮塔樓
  if (heightRatio > 0.58 && rnd() < spec.setbackChance) {
    const setbackH = Math.min(Math.max(0, top - 16), Math.round((16 + rnd() * 26) * spec.heightScale))
    if (setbackH >= 12) {
      const setbackW = Math.max(24, Math.round(frontW * (0.52 + rnd() * 0.22)))
      const setbackX = frontX + Math.round((frontW - setbackW) * (0.25 + rnd() * 0.5))
      const sub = drawBuildingBlock(x, {
        bx: setbackX,
        w: setbackW,
        top: top - setbackH,
        height: setbackH + 2,
        bodyColor: spec.bodies[0],
        sideColor: spec.side,
        rimColor: spec.rim,
        sideOnRight,
      })
      drawWindows(x, { frontX: sub.frontX, frontW: sub.frontW, top: top - setbackH, bottom: top + 12, winScale: spec.winScale, winAlpha: spec.winAlpha, rnd })
      crownTop = top - setbackH
      frontX = sub.frontX
      frontW = sub.frontW
    }
  }

  // 頂樓機房或水塔箱體
  if (crownTop > minTop + 14 && rnd() < 0.72) {
    const count = frontW > 75 && rnd() < 0.45 ? 2 : 1
    for (let i = 0; i < count; i++) {
      const bw = Math.min(frontW * 0.36, 12 + rnd() * 24)
      const bh = Math.min(crownTop - minTop - 4, 7 + rnd() * 11)
      if (bh < 6) continue
      const rx = frontX + 6 + rnd() * Math.max(1, frontW - bw - 12)
      x.fillStyle = spec.side
      x.fillRect(rx, crownTop - bh, bw, bh + 1)
      x.fillStyle = spec.rim
      x.fillRect(rx, crownTop - bh, bw, 1.5)
    }
  }

  // 細天線與頂樓紅色航空障礙燈點
  if (heightRatio > 0.62 && crownTop > 22 && rnd() < spec.beaconChance) {
    const ax = Math.round(frontX + frontW * (0.3 + rnd() * 0.4))
    const ah = Math.min(crownTop - 8, Math.round(14 + rnd() * 24))
    if (ah >= 10) {
      x.fillStyle = spec.rim
      x.fillRect(ax, crownTop - ah, 1.5, ah)
      const by = crownTop - ah
      const glow = x.createRadialGradient(ax + 0.75, by, 0, ax + 0.75, by, 6)
      glow.addColorStop(0, 'rgba(255,88,88,0.55)')
      glow.addColorStop(1, 'rgba(255,88,88,0)')
      x.fillStyle = glow
      x.fillRect(ax - 6, by - 6, 14, 14)
      x.fillStyle = '#ff6464'
      x.beginPath()
      x.arc(ax + 0.75, by, 1.5, 0, Math.PI * 2)
      x.fill()
    }
  }
}

function createCityLayer({ radius, height, repeat, seed, spec }) {
  const PX = 32 // 每公尺 32 像素，兼顧解析度與記憶體
  const layerRadius = radius * spec.radiusScale
  const layerHeight = height * spec.heightScale
  const width = (2 * Math.PI * layerRadius) / repeat
  const c = document.createElement('canvas')
  c.width = Math.round(width * PX)
  c.height = Math.round(layerHeight * PX)
  const x = c.getContext('2d')
  const rnd = seeded(seed + spec.seedOffset)

  const minW = spec.minW * PX
  let bx = 0
  while (bx < c.width) {
    let w = (spec.minW + rnd() * (spec.maxW - spec.minW)) * PX
    // 剩餘寬度小於最小建築寬度時直接併入最後一棟，消除接縫處的細條建築
    if (c.width - (bx + w) < minW) w = c.width - bx

    // 偶爾留出窄巷空隙讓後方層次透出，但避免在接縫最後一塊切開
    if (bx > 0 && bx + w < c.width && w > minW * 1.15 && rnd() < spec.gapChance) {
      const gap = Math.min(w * 0.28, (1.2 + rnd() * 1.3) * PX)
      bx += gap
      w -= gap
    }

    const heightRatio = spec.minH + rnd() * (spec.maxH - spec.minH)
    const h = heightRatio * c.height
    const top = c.height - h
    const bodyColor = spec.bodies[Math.floor(rnd() * spec.bodies.length)]
    const sideOnRight = rnd() > 0.3

    const { frontX, frontW } = drawBuildingBlock(x, {
      bx,
      w,
      top,
      height: h,
      bodyColor,
      sideColor: spec.side,
      rimColor: spec.rim,
      sideOnRight,
    })
    drawWindows(x, { frontX, frontW, top, bottom: c.height, winScale: spec.winScale, winAlpha: spec.winAlpha, rnd })
    drawRoofDetails(x, { frontX, frontW, top, minTop: 8, heightRatio, spec, sideOnRight, rnd })
    bx += w
  }

  // 底部約 2.2 m 疊加城市街燈暖紫光暈，最底端約 0.8 m 漸層過渡至地面霧色 NIGHT_GROUND
  const glowTop = Math.max(0, c.height - 2.2 * PX)
  const blendStop = 1 - 0.8 / 2.2
  const bottomGrad = x.createLinearGradient(0, glowTop, 0, c.height)
  bottomGrad.addColorStop(0, 'rgba(115,86,132,0)')
  bottomGrad.addColorStop(blendStop * 0.65, 'rgba(115,86,132,0.24)')
  bottomGrad.addColorStop(blendStop, 'rgba(46,52,64,0.72)')
  bottomGrad.addColorStop(1, NIGHT_GROUND)
  x.globalCompositeOperation = 'source-atop'
  x.fillStyle = bottomGrad
  x.fillRect(0, glowTop, c.width, c.height - glowTop)
  x.globalCompositeOperation = 'source-over'

  const map = canvasTexture(c)
  map.wrapS = THREE.RepeatWrapping
  map.repeat.set(repeat, 1)
  map.anisotropy = 4
  const ring = new THREE.Mesh(
    new THREE.CylinderGeometry(layerRadius, layerRadius, layerHeight, 96, 1, true),
    new THREE.MeshBasicMaterial({ map, transparent: true, side: THREE.BackSide, fog: false, depthWrite: false }),
  )
  ring.position.y = layerHeight / 2
  ring.rotation.y = spec.rotation
  ring.renderOrder = spec.renderOrder
  return ring
}

// 球場外圍的三層立體視差都市天際線（遠／中／近三圈圓筒），繞一圈重複 repeat 次。
// 不受霧影響（遠處才不會變成一片灰），天際線以上是透明的。radius、height 為近景層的公尺數
export function createCityRing({ radius, height, repeat = 3, seed = 5 }) {
  const group = new THREE.Group()
  group.name = 'CityRing'
  for (const spec of CITY_LAYERS) {
    group.add(createCityLayer({ radius, height, repeat, seed, spec }))
  }
  return group
}

// 球場四角的照明燈柱，燈頭會發光（真正打光的燈在 scene.js）。material(hex) 由呼叫端提供。
export function createFloodlights({ positions, height = 8, material }) {
  const group = new THREE.Group()
  const glowCanvas = document.createElement('canvas')
  glowCanvas.width = glowCanvas.height = 128
  const g = glowCanvas.getContext('2d')
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grad.addColorStop(0, 'rgba(255,240,200,1)')
  grad.addColorStop(0.25, 'rgba(255,226,160,0.55)')
  grad.addColorStop(1, 'rgba(255,226,160,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 128, 128)
  const glowMap = canvasTexture(glowCanvas)

  for (const [px, pz] of positions) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, height, 12), material('#2f3a4a'))
    pole.position.set(px, height / 2, pz)
    pole.userData.outline = true
    group.add(pole)
    // 燈頭朝球場中央
    const head = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 0.25), new THREE.MeshBasicMaterial({ color: '#fff1c8' }))
    head.position.set(px, height + 0.1, pz)
    head.lookAt(0, 0, 0)
    head.userData.outline = true
    group.add(head)
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowMap, blending: THREE.AdditiveBlending, depthWrite: false }))
    glow.position.copy(head.position)
    glow.scale.setScalar(4)
    group.add(glow)
  }
  return group
}
