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
