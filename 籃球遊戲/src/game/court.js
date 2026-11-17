// 半場球場與籃架：地面畫線、籃框、籃板、籃網、籃架。主畫面背景與之後的練習模式共用。
// 座標：Y 朝上、公尺。籃框中心在 (0, RIM_HEIGHT, basketZ)，球場往 +Z 延伸（籃板在籃框的 -Z 那側）。
// 尺寸照 CLAUDE.md 的球場常數；地面畫線照 FIBA 規格。
import * as THREE from 'three'

export const COURT = {
  RIM_HEIGHT: 3.05,
  RIM_RADIUS: 0.225,
  RIM_TUBE: 0.012,
  BOARD_OFFSET: 0.375, // 籃板正面在籃框中心後方
  BOARD_WIDTH: 1.8,
  BOARD_HEIGHT: 1.05,
  BOARD_BOTTOM: 2.9,
  BASKET_TO_BASELINE: 1.575, // 籃框中心到底線
  HALF_LENGTH: 14, // 底線到中線
  HALF_WIDTH: 7.5,
  KEY_HALF_WIDTH: 2.45,
  FREE_THROW: 5.8, // 底線到罰球線
  THREE_RADIUS: 6.75,
  THREE_SIDE: 6.6, // 三分線兩側直線離中線的距離
  CIRCLE_RADIUS: 1.8, // 罰球圈、中圈
  RESTRICTED_RADIUS: 1.25,
}

// 手繪動畫風的球場配色（sRGB）
const COLORS = {
  runoff: '#343f4c', // 界外鋪面
  apron: '#2b3542', // 邊線外圍深色框帶
  court: '#4b6988', // 場內壓克力藍
  key: '#c66349', // 禁區磚紅
  line: '#f4efe4',
  pole: '#28464e', // 籃架鋼柱
  polePad: '#243242', // 立柱防撞護套
  padAccent: '#d96b43', // 籃板護墊與護套配色
  frame: '#2a3542', // 籃板金屬框
  rim: '#e0733f',
  net: '#fcf9f2',
  fence: '#55657a', // 圍欄的柱子、橫桿
  fenceMesh: '#aebccd', // 圍欄的鐵絲網
}

const LINE_WIDTH = 0.05
const RUNOFF = 3.0 // 球場外鋪面的寬度（公尺）；外緣是圍欄
// 圍欄：圍住兩側和籃架後方（中線那側不圍，鏡頭在那邊）。高度、柱子間距、鐵絲網菱形格的大小（公尺）
const FENCE_HEIGHT = 3
const FENCE_POST_GAP = 3
const FENCE_CELL = 0.3
const PX_PER_M = 120

function seeded(seed) {
  return () => {
    seed = (seed * 9301 + 49297) % 233280
    return seed / 233280
  }
}

// 2 m × 2 m 的壓克力鋪面細微顆粒與滾塗紋理貼圖，用來平鋪整張球場畫布
function createAcrylicPattern(g, seed = 19) {
  const size = 240
  const tile = document.createElement('canvas')
  tile.width = tile.height = size
  const t = tile.getContext('2d')
  const rnd = seeded(seed)
  for (let i = 0; i < 1100; i++) {
    t.fillStyle = rnd() > 0.5 ? `rgba(255,255,255,${0.015 + rnd() * 0.025})` : `rgba(12,18,28,${0.02 + rnd() * 0.03})`
    t.fillRect(rnd() * size, rnd() * size, 1 + rnd() * 1.5, 1 + rnd() * 1.5)
  }
  for (let i = 0; i < 24; i++) {
    t.fillStyle = `rgba(255,255,255,${0.01 + rnd() * 0.012})`
    t.fillRect(0, rnd() * size, size, 1 + rnd() * 2)
  }
  return g.createPattern(tile, 'repeat')
}

// 中圈極簡幾何籃球標誌（裁切在半場邊界內）
function drawCenterEmblem(g, cx, cy, m, courtBottom) {
  g.save()
  g.beginPath()
  g.rect(0, 0, g.canvas.width, courtBottom)
  g.clip()

  g.fillStyle = '#3f5b78'
  g.beginPath()
  g.arc(cx, cy, m(1.78), 0, Math.PI * 2)
  g.fill()

  g.strokeStyle = 'rgba(217,123,92,0.38)'
  g.lineWidth = m(0.08)
  g.beginPath()
  g.arc(cx, cy, m(1.22), 0, Math.PI * 2)
  g.stroke()

  const r = m(0.76)
  g.fillStyle = 'rgba(217,123,92,0.68)'
  g.beginPath()
  g.arc(cx, cy, r, 0, Math.PI * 2)
  g.fill()

  // 籃球縫線
  g.strokeStyle = 'rgba(244,239,228,0.65)'
  g.lineWidth = m(0.035)
  g.beginPath()
  g.moveTo(cx - r, cy)
  g.lineTo(cx + r, cy)
  g.moveTo(cx, cy - r)
  g.lineTo(cx, cy + r)
  g.stroke()
  g.beginPath()
  g.arc(cx - r * 0.72, cy, r * 0.78, -0.85, 0.85)
  g.stroke()
  g.beginPath()
  g.arc(cx + r * 0.72, cy, r * 0.78, Math.PI - 0.85, Math.PI + 0.85)
  g.stroke()
  g.restore()
}

// 地面貼圖：世界座標 (x, z) 畫到畫布上，畫布上緣是最靠籃架那側
function drawCourtTexture(basketZ) {
  const C = COURT
  const baseline = basketZ - C.BASKET_TO_BASELINE
  const x0 = -C.HALF_WIDTH - RUNOFF
  const z0 = baseline - RUNOFF
  const width = 2 * (C.HALF_WIDTH + RUNOFF)
  const length = C.HALF_LENGTH + 2 * RUNOFF
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * PX_PER_M)
  canvas.height = Math.round(length * PX_PER_M)
  const g = canvas.getContext('2d')
  const px = (x) => (x - x0) * PX_PER_M
  const pz = (z) => (z - z0) * PX_PER_M
  const m = (d) => d * PX_PER_M

  g.fillStyle = COLORS.runoff
  g.fillRect(0, 0, canvas.width, canvas.height)
  // 場線外圍 0.48 m 的深色邊框帶，框出球場輪廓
  const apron = 0.48
  g.fillStyle = COLORS.apron
  g.fillRect(px(-C.HALF_WIDTH - apron), pz(baseline - apron), m(2 * (C.HALF_WIDTH + apron)), m(C.HALF_LENGTH + 2 * apron))
  g.fillStyle = COLORS.court
  g.fillRect(px(-C.HALF_WIDTH), pz(baseline), m(2 * C.HALF_WIDTH), m(C.HALF_LENGTH))
  g.fillStyle = COLORS.key
  g.fillRect(px(-C.KEY_HALF_WIDTH), pz(baseline), m(2 * C.KEY_HALF_WIDTH), m(C.FREE_THROW))

  const bx = px(0)
  const bz = pz(basketZ)
  const courtBottom = pz(baseline + C.HALF_LENGTH)
  drawCenterEmblem(g, bx, courtBottom, m, courtBottom)

  // 壓克力細顆粒鋪面紋理
  const pattern = createAcrylicPattern(g)
  if (pattern) {
    g.fillStyle = pattern
    g.fillRect(0, 0, canvas.width, canvas.height)
  }

  // 鋪面伸縮縫（每隔約 3.75 m 的極淡接縫線）
  g.lineWidth = 1.5
  for (let x = -C.HALF_WIDTH; x <= C.HALF_WIDTH + 0.01; x += 3.75) {
    g.strokeStyle = 'rgba(18,24,34,0.20)'
    g.beginPath()
    g.moveTo(px(x), 0)
    g.lineTo(px(x), canvas.height)
    g.stroke()
  }
  for (let z = baseline; z <= baseline + C.HALF_LENGTH + 0.01; z += 3.5) {
    g.strokeStyle = 'rgba(18,24,34,0.20)'
    g.beginPath()
    g.moveTo(0, pz(z))
    g.lineTo(canvas.width, pz(z))
    g.stroke()
  }

  // 禁區、罰球線與弧頂附近淡淡的球鞋摩擦痕
  const rnd = seeded(41)
  g.lineCap = 'round'
  for (let i = 0; i < 42; i++) {
    const sx = (rnd() - 0.5) * (i < 28 ? 5.2 : 11.5)
    const sz = baseline + (i < 28 ? 0.8 + rnd() * 5.6 : 5.0 + rnd() * 4.5)
    const ang = rnd() * Math.PI * 2
    const span = 0.4 + rnd() * 0.5
    g.strokeStyle = `rgba(18,24,36,${0.05 + rnd() * 0.06})`
    g.lineWidth = 1.8 + rnd() * 1.5
    g.beginPath()
    g.arc(px(sx), pz(sz), m(0.25 + rnd() * 0.45), ang, ang + span)
    g.stroke()
  }

  g.strokeStyle = COLORS.line
  g.fillStyle = COLORS.line
  g.lineWidth = m(LINE_WIDTH)
  g.lineCap = 'butt'
  // 外框（底線、邊線、中線）與禁區
  g.strokeRect(px(-C.HALF_WIDTH), pz(baseline), m(2 * C.HALF_WIDTH), m(C.HALF_LENGTH))
  g.strokeRect(px(-C.KEY_HALF_WIDTH), pz(baseline), m(2 * C.KEY_HALF_WIDTH), m(C.FREE_THROW))

  // 禁區兩側搶籃板卡位刻度線（FIBA 標準間距：1.75 m、2.60～3.00 m 中立區方塊、3.85 m、4.70 m）
  for (const side of [-1, 1]) {
    const kx = px(side * C.KEY_HALF_WIDTH)
    const dir = side
    for (const d of [1.75, 3.85, 4.7]) {
      g.beginPath()
      g.moveTo(kx, pz(baseline + d))
      g.lineTo(kx + dir * m(0.1), pz(baseline + d))
      g.stroke()
    }
    const blockX = side > 0 ? kx : kx - m(0.1)
    g.fillRect(blockX, pz(baseline + 2.6), m(0.1), m(0.4))
    // 兩側邊線發球短線
    const sx = px(side * C.HALF_WIDTH)
    g.beginPath()
    g.moveTo(sx, pz(baseline + 8.325))
    g.lineTo(sx + dir * m(0.15), pz(baseline + 8.325))
    g.stroke()
  }

  // 罰球圈
  g.beginPath()
  g.arc(bx, pz(baseline + C.FREE_THROW), m(C.CIRCLE_RADIUS), 0, Math.PI * 2)
  g.stroke()
  // 中圈（只有半個在半場內）
  g.beginPath()
  g.arc(bx, courtBottom, m(C.CIRCLE_RADIUS), Math.PI, Math.PI * 2)
  g.stroke()
  // 合理衝撞區半圓＋往籃板方向的直線段
  const boardProjZ = pz(basketZ - C.BOARD_OFFSET)
  g.beginPath()
  g.moveTo(px(-C.RESTRICTED_RADIUS), boardProjZ)
  g.lineTo(px(-C.RESTRICTED_RADIUS), bz)
  g.arc(bx, bz, m(C.RESTRICTED_RADIUS), Math.PI, 0, true)
  g.lineTo(px(C.RESTRICTED_RADIUS), boardProjZ)
  g.stroke()
  // 三分線：兩側直線從底線到和弧線相接處，再接弧線
  const meet = Math.sqrt(C.THREE_RADIUS ** 2 - C.THREE_SIDE ** 2)
  const a = Math.atan2(meet, C.THREE_SIDE)
  g.beginPath()
  g.moveTo(px(C.THREE_SIDE), pz(baseline))
  g.lineTo(px(C.THREE_SIDE), pz(basketZ + meet))
  g.arc(bx, bz, m(C.THREE_RADIUS), a, Math.PI - a)
  g.lineTo(px(-C.THREE_SIDE), pz(baseline))
  g.stroke()

  // 球場中央微亮、四周界外漸暗，聚焦場上動作並融入夜晚霧色
  const lightGrad = g.createRadialGradient(bx, pz(basketZ + 4.8), m(3.2), bx, pz(basketZ + 4.8), m(14.5))
  lightGrad.addColorStop(0, 'rgba(255,245,225,0.04)')
  lightGrad.addColorStop(0.55, 'rgba(18,24,36,0)')
  lightGrad.addColorStop(1, 'rgba(18,24,36,0.34)')
  g.fillStyle = lightGrad
  g.fillRect(0, 0, canvas.width, canvas.height)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  return { texture, width, length, center: new THREE.Vector3(0, 0, z0 + length / 2) }
}

// ===== 籃網的晃動可以調整的參數 =====
// 每個網結依網線長度約束＋重力＋柔和回彈模擬真實尼龍網：進球撐開時會自然上翻並柔和擺動。
const NET = {
  strands: 12,
  rows: 6,
  top: COURT.RIM_RADIUS - 0.012,
  bottom: 0.095, // 網子下緣比球（半徑 0.12）窄，球穿過時會先把網子撐開再收束
  depth: 0.42,
  stiffnessH: 26, // 水平回彈力道（柔順不僵硬）
  stiffnessV: 10, // 垂直回彈力道（保留布料垂墜感）
  soften: 0.55, // 越下面的網結越柔軟
  coupling: 90, // 相鄰網結互相帶動的力道（波動傳開）
  damping: 3.4, // 空氣阻尼（越大越快停下來）
  gravity: 9.8, // 網線被撐高或甩開時回落的重力
  drag: 0.28, // 球滑過網線時帶動網結的切向摩擦比例
  gap: 0.014, // 網結離球面多遠就算碰到（公尺）
  slack: 1.05, // 網線相對於原長最多拉長比例（真實線長約束，取代僵硬的球形距離鎖）
  maxStep: 1 / 180, // 一次最多算多長的時間，拆細避免高速球穿過網結
}
// ====================================

// 籃網：上寬下窄的網子，用交錯的斜線編成菱形格。最上面一圈固定在籃框上，其他網結會被球撐開、上翻、擺動。
// 回傳的 LineSegments 的 userData.step(delta, ball) 每格呼叫一次：ball 是場上的球 { p 球心世界座標, v 速度 }，沒有球就給 null
function createNet(material) {
  const { strands, rows, top, bottom, depth } = NET
  const index = (i, r) => r * strands + ((i % strands) + strands) % strands
  // 網結：rest 原位、p 現在的位置、v 速度（都是相對籃框中心）
  const nodes = []
  for (let r = 0; r <= rows; r++) {
    for (let i = 0; i < strands; i++) {
      const k = r / rows
      const radius = top + (bottom - top) * Math.pow(k, 0.85)
      const angle = ((i + (r % 2) * 0.5) / strands) * Math.PI * 2
      const rest = new THREE.Vector3(Math.cos(angle) * radius, -depth * k, Math.sin(angle) * radius)
      nodes.push({
        rest,
        p: rest.clone(),
        v: new THREE.Vector3(),
        fixed: r === 0,
        softH: NET.stiffnessH * (1 - NET.soften * k),
        softV: NET.stiffnessV * (1 - NET.soften * k),
        near: [],
      })
    }
  }
  // 每條線接哪兩個網結。下一列錯開半格：偶數列往下接 i、i-1，奇數列接 i、i+1
  const links = []
  const segments = []
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < strands; i++) {
      for (const j of [i, r % 2 === 0 ? i - 1 : i + 1]) {
        const a = index(i, r)
        const b = index(j, r + 1)
        links.push(a, b)
        const na = nodes[a]
        const nb = nodes[b]
        na.near.push(nb)
        nb.near.push(na)
        segments.push([na, nb, na.rest.distanceTo(nb.rest) * NET.slack])
      }
    }
  }
  const positions = new Float32Array(links.length * 3)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const write = () => {
    for (let n = 0; n < links.length; n++) nodes[links[n]].p.toArray(positions, n * 3)
    geometry.attributes.position.needsUpdate = true
  }
  write()
  const net = new THREE.LineSegments(geometry, material)
  net.frustumCulled = false

  const local = new THREE.Vector3()
  const push = new THREE.Vector3()
  const pull = new THREE.Vector3()
  const prevBallPos = new THREE.Vector3()
  const sweepPos = new THREE.Vector3()
  let hasPrevBall = false
  let still = true

  function advance(dt, ballPos, ballVel, ballRadius) {
    if (ballPos) local.copy(ballPos).sub(net.position) // 球心換成相對籃框中心
    for (const node of nodes) {
      if (node.fixed) continue
      // 鄰居波動傳導＋水平／垂直柔和回彈＋被撐高時的重力＋空氣阻尼
      pull.set(0, 0, 0)
      for (const other of node.near) pull.add(other.p).sub(other.rest)
      pull.divideScalar(node.near.length).sub(node.p).add(node.rest).multiplyScalar(NET.coupling)
      pull.x += (node.rest.x - node.p.x) * node.softH
      pull.z += (node.rest.z - node.p.z) * node.softH
      pull.y += (node.rest.y - node.p.y) * node.softV
      if (node.p.y > node.rest.y) {
        pull.y -= NET.gravity * Math.min(1, (node.p.y - node.rest.y) / 0.08)
      }
      pull.addScaledVector(node.v, -NET.damping)
      node.v.addScaledVector(pull, dt)
      node.p.addScaledVector(node.v, dt)

      // 球碰到網結：沿球面法線推開，並帶入微弱切向滑動摩擦
      if (ballPos) {
        push.copy(node.p).sub(local)
        const reach = ballRadius + NET.gap
        const d = push.length()
        if (d < reach) {
          if (d < 1e-5) push.set(node.rest.x, 0, node.rest.z).normalize()
          else push.divideScalar(d)
          node.p.copy(local).addScaledVector(push, reach)
          const relN = (node.v.x - ballVel.x) * push.x + (node.v.y - ballVel.y) * push.y + (node.v.z - ballVel.z) * push.z
          if (relN < 0) node.v.addScaledVector(push, -1.05 * relN)
          node.v.lerp(ballVel, 1 - Math.exp(-12 * NET.drag * dt))
        }
      }
    }

    // 網線長度鬆弛約束（2 次疊代）：限制最大線長，讓網子撐開時自然向上翻起、穿過後向內收束擺動
    for (let iter = 0; iter < 2; iter++) {
      for (const [a, b, maxLen] of segments) {
        push.subVectors(b.p, a.p)
        const len = push.length()
        if (len <= maxLen || len < 1e-6) continue
        const dir = push.divideScalar(len)
        const excess = len - maxLen
        if (a.fixed) {
          b.p.addScaledVector(dir, -excess)
          const stretchV = b.v.dot(dir)
          if (stretchV > 0) b.v.addScaledVector(dir, -stretchV * 0.7)
        } else {
          a.p.addScaledVector(dir, excess * 0.45)
          b.p.addScaledVector(dir, -excess * 0.55)
          const relStretch = (b.v.x - a.v.x) * dir.x + (b.v.y - a.v.y) * dir.y + (b.v.z - a.v.z) * dir.z
          if (relStretch > 0) {
            a.v.addScaledVector(dir, relStretch * 0.35)
            b.v.addScaledVector(dir, -relStretch * 0.35)
          }
        }
      }
    }

    let moving = false
    for (const node of nodes) {
      if (node.fixed) continue
      if (node.p.y > 0.04) {
        node.p.y = 0.04
        if (node.v.y > 0) node.v.y *= 0.3
      }
      if (node.v.lengthSq() > 1e-5 || node.p.distanceToSquared(node.rest) > 1e-6) moving = true
    }
    return moving
  }

  net.userData.reset = () => {
    for (const node of nodes) {
      node.p.copy(node.rest)
      node.v.set(0, 0, 0)
    }
    hasPrevBall = false
    still = true
    write()
  }

  net.userData.step = (delta, ball = null) => {
    if (still && !ball) return // 沒在晃、也沒有球，不用算
    if (delta <= 0) return
    const steps = Math.max(1, Math.ceil(delta / NET.maxStep))
    const canSweep = Boolean(ball && hasPrevBall && prevBallPos.distanceToSquared(ball.p) < 0.64)
    let moving = false
    for (let i = 0; i < steps; i++) {
      let ballPos = null
      if (ball) {
        if (canSweep) ballPos = sweepPos.copy(prevBallPos).lerp(ball.p, (i + 1) / steps)
        else ballPos = ball.p
      }
      moving = advance(delta / steps, ballPos, ball?.v, ball?.radius ?? 0.12)
    }
    if (ball) {
      prevBallPos.copy(ball.p)
      hasPrevBall = true
    } else {
      hasPrevBall = false
    }
    still = !moving && !ball
    write()
  }
  return net
}

// 鐵絲網的貼圖：透明底、兩條斜線交叉成菱形格，重複鋪滿
function createMeshTexture() {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const g = canvas.getContext('2d')
  g.strokeStyle = COLORS.fenceMesh
  g.lineWidth = 5
  g.lineCap = 'square'
  g.beginPath()
  g.moveTo(0, 0)
  g.lineTo(size, size)
  g.moveTo(size, 0)
  g.lineTo(0, size)
  g.stroke()
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.anisotropy = 8
  return texture
}

// 圍欄：沿鋪面外緣的兩側和籃架後方，柱子＋頂帽、上中下三道橫桿與半透明鐵絲網，右側中場附近留一個出入口缺口
function createFence(floor, material) {
  const group = new THREE.Group()
  group.name = 'Fence'
  const x1 = floor.width / 2
  const z0 = floor.center.z - floor.length / 2
  const z1 = floor.center.z + floor.length / 2
  const frame = material(COLORS.fence)
  const capMat = material(COLORS.frame)
  const mesh = createMeshTexture()
  // 每一段：[起點 x, z, 終點 x, z]；右側邊線在 z1 - 5.2 ～ z1 - 3.4 留出 1.8 m 進出口
  const segments = [
    [-x1, z1, -x1, z0],
    [-x1, z0, x1, z0],
    [x1, z0, x1, z1 - 5.2],
    [x1, z1 - 3.4, x1, z1],
  ]
  for (const [ax, az, bx, bz] of segments) {
    const length = Math.hypot(bx - ax, bz - az)
    const angle = Math.atan2(bx - ax, bz - az)
    const mid = new THREE.Vector3((ax + bx) / 2, 0, (az + bz) / 2)
    const posts = Math.max(1, Math.round(length / FENCE_POST_GAP))
    for (let i = 0; i <= posts; i++) {
      const px = ax + ((bx - ax) * i) / posts
      const pz = az + ((bz - az) * i) / posts
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, FENCE_HEIGHT, 8), frame)
      post.position.set(px, FENCE_HEIGHT / 2, pz)
      group.add(post)
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.068, 0.04, 8), capMat)
      cap.position.set(px, FENCE_HEIGHT + 0.02, pz)
      group.add(cap)
    }
    for (const y of [0.05, FENCE_HEIGHT * 0.5, FENCE_HEIGHT]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, length), frame)
      rail.position.copy(mid).setY(y)
      rail.rotation.y = angle
      group.add(rail)
    }
    const map = mesh.clone()
    map.repeat.set(length / FENCE_CELL, FENCE_HEIGHT / FENCE_CELL)
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(length, FENCE_HEIGHT),
      new THREE.MeshBasicMaterial({ map, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }),
    )
    panel.position.copy(mid).setY(FENCE_HEIGHT / 2)
    panel.rotation.y = angle + Math.PI / 2
    group.add(panel)
  }
  mesh.dispose()
  return group
}

// 日系自動販賣機正面發光飲料櫥窗貼圖
function createVendingTexture() {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 144
  const g = c.getContext('2d')
  g.fillStyle = '#e8f1fa'
  g.fillRect(0, 0, 128, 144)

  const colors = ['#e05a47', '#4aa3d8', '#6ec478', '#f0b840', '#5c6bc0', '#e87ea1']
  for (let row = 0; row < 3; row++) {
    const sy = 14 + row * 40
    g.fillStyle = '#d3e1ef'
    g.fillRect(8, sy + 20, 112, 5)
    g.fillStyle = '#243244'
    g.fillRect(8, sy + 25, 112, 4)
    for (let col = 0; col < 6; col++) {
      g.fillStyle = colors[(row * 2 + col) % colors.length]
      g.fillRect(12 + col * 18, sy + 2, 11, 18)
      g.fillStyle = 'rgba(255,255,255,0.45)'
      g.fillRect(14 + col * 18, sy + 4, 3, 14)
    }
  }
  g.fillStyle = '#4e9be0'
  g.fillRect(12, 130, 104, 6)
  const texture = new THREE.CanvasTexture(c)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

// 場邊與圍欄外低干擾道具：休息長椅、置球架、垃圾桶、圍欄外發光販賣機與灌木叢
// 座標皆在球員最大活動範圍（|x| <= 8.3、z >= -6.575）與主畫面攝影機視線外
function createSidelineProps(floor, material) {
  const group = new THREE.Group()
  group.name = 'SidelineProps'
  const z0 = floor.center.z - floor.length / 2

  const place = (geometry, hex, x, y, z, outline = true) => {
    const mesh = new THREE.Mesh(geometry, material(hex))
    mesh.position.set(x, y, z)
    mesh.castShadow = true
    mesh.userData.outline = outline
    group.add(mesh)
    return mesh
  }

  // 長椅（長 2.2 m 沿 Z 軸）
  const addBench = (bx, bz) => {
    place(new THREE.BoxGeometry(0.46, 0.055, 2.2), '#b87c52', bx, 0.43, bz)
    for (const lz of [-0.82, 0.82]) {
      place(new THREE.BoxGeometry(0.42, 0.4, 0.07), COLORS.frame, bx, 0.2, bz + lz)
    }
    place(new THREE.BoxGeometry(0.06, 0.06, 1.65), COLORS.frame, bx, 0.14, bz, false)
  }

  // 左側邊線長椅＋水壺／毛巾（1 對 1、3 對 3 固定鏡頭可見）
  addBench(-9.45, -4.6)
  place(new THREE.BoxGeometry(0.28, 0.04, 0.42), '#fcf9f2', -9.43, 0.478, -3.92)
  place(new THREE.CylinderGeometry(0.042, 0.042, 0.22, 10), '#4a8ec7', -9.45, 0.565, -4.32)
  place(new THREE.CylinderGeometry(0.03, 0.03, 0.04, 10), '#fcf9f2', -9.45, 0.695, -4.32, false)

  // 右側邊線長椅＋運動包＋出入口旁垃圾桶（主畫面精華鏡頭與自由練習可見）
  addBench(9.45, 1.8)
  place(new THREE.BoxGeometry(0.3, 0.24, 0.54), '#2f5d62', 9.45, 0.12, 3.35)
  place(new THREE.BoxGeometry(0.31, 0.05, 0.2), COLORS.padAccent, 9.45, 0.25, 3.35, false)
  place(new THREE.CylinderGeometry(0.2, 0.17, 0.68, 12), '#334150', 9.85, 0.34, 5.1)
  place(new THREE.CylinderGeometry(0.215, 0.215, 0.07, 12), COLORS.frame, 9.85, 0.71, 5.1)

  // 右側邊線置球架＋3 顆備用籃球
  const rackX = 9.45
  const rackZ = -4.6
  for (const lz of [-0.56, 0.56]) {
    place(new THREE.BoxGeometry(0.42, 0.76, 0.06), COLORS.frame, rackX, 0.38, rackZ + lz)
  }
  for (const rx of [-0.11, 0.11]) {
    place(new THREE.BoxGeometry(0.035, 0.035, 1.18), COLORS.frame, rackX + rx, 0.72, rackZ)
    place(new THREE.BoxGeometry(0.035, 0.035, 1.18), COLORS.frame, rackX + rx, 0.24, rackZ, false)
  }
  for (const bz of [-0.34, 0, 0.34]) {
    place(new THREE.SphereGeometry(0.12, 14, 12), '#d9803f', rackX, 0.81, rackZ + bz)
  }

  // 圍欄內左後方自動販賣機（靠近左側長椅與底線角落，正面朝球場且在球員活動範圍外）
  const vx = -7.2
  const vz = z0 + 0.48
  place(new THREE.BoxGeometry(1.12, 1.95, 0.74), '#dce3eb', vx, 0.975, vz)
  place(new THREE.BoxGeometry(1.14, 0.22, 0.76), '#355682', vx, 1.86, vz)
  const display = new THREE.Mesh(
    new THREE.PlaneGeometry(0.84, 0.94),
    new THREE.MeshBasicMaterial({ map: createVendingTexture() }),
  )
  display.position.set(vx, 1.24, vz + 0.375)
  group.add(display)
  place(new THREE.BoxGeometry(0.78, 0.22, 0.04), '#1a222d', vx, 0.42, vz + 0.37, false)

  // 圍欄外側低矮公園灌木叢
  const bushes = [
    [-9.4, z0 - 0.65, 1.0],
    [-4.3, z0 - 0.6, 0.85],
    [4.9, z0 - 0.62, 0.95],
    [9.4, z0 - 0.65, 1.05],
    [-11.15, -2.5, 0.9],
    [11.15, -1.8, 0.9],
  ]
  const rnd = seeded(73)
  for (const [bx, bz, s] of bushes) {
    for (let i = 0; i < 3; i++) {
      const r = (0.42 + rnd() * 0.22) * s
      const ox = (i - 1) * 0.48 * s
      const oz = (rnd() - 0.5) * 0.25 * s
      place(new THREE.IcosahedronGeometry(r, 1), i === 1 ? '#2c4c46' : '#24403c', bx + ox, r * 0.72, bz + oz)
    }
  }

  return group
}

// 鋼化玻璃籃板貼圖：淡青藍半透明玻璃、手繪動畫感斜向反光條紋、白色外框與投籃方框
function createGlassTexture(boardW, boardH) {
  const pxPerM = 400
  const w = Math.round(boardW * pxPerM)
  const h = Math.round(boardH * pxPerM)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')

  g.fillStyle = 'rgba(176,216,240,0.22)'
  g.fillRect(0, 0, w, h)

  // 斜向高光條紋，在夜空背景下凸顯玻璃通透反光感
  g.save()
  g.fillStyle = 'rgba(255,255,255,0.13)'
  for (const [x0, barW] of [[w * 0.14, 34], [w * 0.22, 14], [w * 0.68, 22]]) {
    g.beginPath()
    g.moveTo(x0, 0)
    g.lineTo(x0 + barW, 0)
    g.lineTo(x0 + barW - h * 0.55, h)
    g.lineTo(x0 - h * 0.55, h)
    g.closePath()
    g.fill()
  }
  g.restore()

  // 外圍白邊與標準投籃方框（寬 0.59、高 0.45，底緣對齊籃框高度）
  const line = 0.04 * pxPerM
  g.strokeStyle = 'rgba(252,249,242,0.95)'
  g.lineWidth = line
  const inset = 0.045 * pxPerM
  g.strokeRect(inset, inset, w - inset * 2, h - inset * 2)

  const sqW = 0.59 * pxPerM - line
  const sqH = 0.45 * pxPerM - line
  const rimFromBottom = (COURT.RIM_HEIGHT - COURT.BOARD_BOTTOM) * pxPerM
  const sqBottom = h - rimFromBottom - line / 2
  g.strokeRect((w - sqW) / 2, sqBottom - sqH, sqW, sqH)

  const texture = new THREE.CanvasTexture(c)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

// 籃板頂部裝飾用 24 秒進攻計時器顯示面
function createShotClockTexture() {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 64
  const g = c.getContext('2d')
  g.fillStyle = '#12151c'
  g.fillRect(0, 0, 128, 64)
  g.strokeStyle = '#2d3644'
  g.lineWidth = 4
  g.strokeRect(4, 4, 120, 56)
  g.fillStyle = 'rgba(255,182,46,0.9)'
  g.font = 'bold 40px Consolas, monospace'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText('24', 64, 34)
  const texture = new THREE.CanvasTexture(c)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

// material(hex) 由呼叫端提供（卡通材質）；需要描邊的網格標上 userData.outline
export function createCourt({ basketZ = -4.2, material }) {
  const C = COURT
  const group = new THREE.Group()
  group.name = 'Court'

  const floor = drawCourtTexture(basketZ)
  const floorMaterial = material(0xffffff)
  floorMaterial.map = floor.texture
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(floor.width, floor.length), floorMaterial)
  ground.rotation.x = -Math.PI / 2
  ground.position.copy(floor.center)
  ground.receiveShadow = true
  group.add(ground)
  group.add(createFence(floor, material))
  group.add(createSidelineProps(floor, material))

  const add = (geometry, hex, position, outline = true) => {
    const mesh = new THREE.Mesh(geometry, material(hex))
    mesh.position.copy(position)
    mesh.castShadow = true
    mesh.userData.outline = outline
    group.add(mesh)
    return mesh
  }

  // 兩點之間的斜向方鋼支撐桿
  const addStrut = (a, b, w, h, hex) => {
    const dir = new THREE.Vector3().subVectors(b, a)
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, dir.length()), material(hex))
    mesh.position.copy(a).addScaledVector(dir, 0.5)
    mesh.lookAt(b)
    mesh.castShadow = true
    mesh.userData.outline = true
    group.add(mesh)
    return mesh
  }

  const boardZ = basketZ - C.BOARD_OFFSET
  const boardY = C.BOARD_BOTTOM + C.BOARD_HEIGHT / 2
  const boardThick = 0.03
  const boardCenterZ = boardZ - boardThick / 2

  // 鋼化玻璃籃板本體（正面仍在 z = boardZ，物理反彈不變）
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(C.BOARD_WIDTH - 0.06, C.BOARD_HEIGHT - 0.06, boardThick),
    new THREE.MeshBasicMaterial({ map: createGlassTexture(C.BOARD_WIDTH, C.BOARD_HEIGHT), transparent: true, depthWrite: false }),
  )
  glass.position.set(0, boardY, boardCenterZ)
  glass.renderOrder = 2
  group.add(glass)

  // 籃板金屬外框（四邊鋁合金邊條）與下緣橘紅防撞護墊
  const frameBar = 0.04
  const frameDepth = 0.048
  add(new THREE.BoxGeometry(C.BOARD_WIDTH, frameBar, frameDepth), COLORS.frame, new THREE.Vector3(0, C.BOARD_BOTTOM + C.BOARD_HEIGHT - frameBar / 2, boardCenterZ))
  add(new THREE.BoxGeometry(C.BOARD_WIDTH, frameBar, frameDepth), COLORS.frame, new THREE.Vector3(0, C.BOARD_BOTTOM + frameBar / 2, boardCenterZ))
  for (const side of [-1, 1]) {
    add(new THREE.BoxGeometry(frameBar, C.BOARD_HEIGHT - frameBar * 2, frameDepth), COLORS.frame, new THREE.Vector3(side * (C.BOARD_WIDTH / 2 - frameBar / 2), boardY, boardCenterZ))
  }
  add(new THREE.BoxGeometry(C.BOARD_WIDTH + 0.04, 0.075, 0.066), COLORS.padAccent, new THREE.Vector3(0, C.BOARD_BOTTOM + 0.02, boardCenterZ))
  for (const side of [-1, 1]) {
    add(new THREE.BoxGeometry(0.068, 0.25, 0.066), COLORS.padAccent, new THREE.Vector3(side * (C.BOARD_WIDTH / 2 - 0.014), C.BOARD_BOTTOM + 0.125, boardCenterZ))
  }

  // 籃板頂部迷你 24 秒進攻計時器外殼
  const clockY = C.BOARD_BOTTOM + C.BOARD_HEIGHT + 0.17
  add(new THREE.BoxGeometry(0.06, 0.11, 0.06), COLORS.frame, new THREE.Vector3(0, C.BOARD_BOTTOM + C.BOARD_HEIGHT + 0.04, boardCenterZ))
  add(new THREE.BoxGeometry(0.42, 0.21, 0.09), '#1b222c', new THREE.Vector3(0, clockY, boardCenterZ))
  const clockFace = new THREE.Mesh(
    new THREE.PlaneGeometry(0.36, 0.16),
    new THREE.MeshBasicMaterial({ map: createShotClockTexture() }),
  )
  clockFace.position.set(0, clockY, boardCenterZ + 0.046)
  group.add(clockFace)

  // 籃框、彈簧座板與雙側支撐角片
  const rim = add(new THREE.TorusGeometry(C.RIM_RADIUS, C.RIM_TUBE, 10, 36), COLORS.rim, new THREE.Vector3(0, C.RIM_HEIGHT, basketZ))
  rim.rotation.x = Math.PI / 2
  const neckLen = C.BOARD_OFFSET - C.RIM_RADIUS
  add(new THREE.BoxGeometry(0.16, 0.13, 0.02), COLORS.rim, new THREE.Vector3(0, C.RIM_HEIGHT - 0.01, boardZ + 0.01))
  add(new THREE.BoxGeometry(0.09, 0.035, neckLen), COLORS.rim, new THREE.Vector3(0, C.RIM_HEIGHT - 0.005, boardZ + neckLen / 2))
  add(new THREE.BoxGeometry(0.08, 0.055, 0.075), COLORS.frame, new THREE.Vector3(0, C.RIM_HEIGHT - 0.045, boardZ + 0.04))
  for (const side of [-1, 1]) {
    addStrut(
      new THREE.Vector3(side * 0.055, C.RIM_HEIGHT - 0.035, boardZ + 0.015),
      new THREE.Vector3(side * 0.09, C.RIM_HEIGHT - 0.004, basketZ - C.RIM_RADIUS + 0.025),
      0.018,
      0.018,
      COLORS.rim,
    )
  }

  const net = createNet(new THREE.LineBasicMaterial({ color: COLORS.net }))
  net.position.set(0, C.RIM_HEIGHT, basketZ)
  net.name = 'Net'
  group.add(net)

  // 重型固定式籃架：水泥底座＋方鋼立柱＋防撞護套＋斜伸懸臂與三角形斜撐＋籃板後方 H 型支撐架
  const poleZ = basketZ - C.BASKET_TO_BASELINE - 1.05
  const poleTopY = boardY + 0.18
  add(new THREE.BoxGeometry(0.54, 0.1, 0.54), '#4c5664', new THREE.Vector3(0, 0.05, poleZ))
  add(new THREE.BoxGeometry(0.3, 0.06, 0.3), COLORS.frame, new THREE.Vector3(0, 0.13, poleZ))
  add(new THREE.BoxGeometry(0.18, poleTopY, 0.18), COLORS.pole, new THREE.Vector3(0, poleTopY / 2, poleZ))

  // 立柱下段防撞護套與橘紅裝飾環
  add(new THREE.BoxGeometry(0.25, 1.95, 0.25), COLORS.polePad, new THREE.Vector3(0, 1.095, poleZ))
  for (const bandY of [0.24, 1.94]) {
    add(new THREE.BoxGeometry(0.262, 0.075, 0.262), COLORS.padAccent, new THREE.Vector3(0, bandY, poleZ), false)
  }

  // 斜伸懸臂與下方斜撐
  const bracketZ = boardZ - boardThick - 0.12
  addStrut(new THREE.Vector3(0, 3.12, poleZ), new THREE.Vector3(0, boardY, bracketZ), 0.13, 0.13, COLORS.pole)
  addStrut(new THREE.Vector3(0, 2.48, poleZ + 0.04), new THREE.Vector3(0, 3.26, (poleZ + bracketZ) * 0.5), 0.085, 0.085, COLORS.pole)

  // 籃板後方 H 型支架與四點鎖附拉桿（透過玻璃籃板隱約可見）
  add(new THREE.BoxGeometry(0.13, 0.44, 0.1), COLORS.frame, new THREE.Vector3(0, boardY, bracketZ))
  add(new THREE.BoxGeometry(0.84, 0.08, 0.08), COLORS.frame, new THREE.Vector3(0, boardY, bracketZ))
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const mount = new THREE.Vector3(sx * 0.56, boardY + sy * 0.36, boardZ - boardThick - 0.015)
      addStrut(new THREE.Vector3(sx * 0.38, boardY, bracketZ), mount, 0.048, 0.048, COLORS.frame)
      add(new THREE.BoxGeometry(0.08, 0.08, 0.03), COLORS.frame, mount)
    }
  }

  return group
}
