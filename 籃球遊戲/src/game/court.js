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
  runoff: '#3a4652', // 界外
  court: '#4f6d8a',
  key: '#c7684e', // 禁區
  line: '#f4efe4',
  pole: '#2f5d62',
  board: '#fcf9f2',
  boardMark: '#c7684e',
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
  g.fillStyle = COLORS.court
  g.fillRect(px(-C.HALF_WIDTH), pz(baseline), m(2 * C.HALF_WIDTH), m(C.HALF_LENGTH))
  g.fillStyle = COLORS.key
  g.fillRect(px(-C.KEY_HALF_WIDTH), pz(baseline), m(2 * C.KEY_HALF_WIDTH), m(C.FREE_THROW))

  g.strokeStyle = COLORS.line
  g.lineWidth = m(LINE_WIDTH)
  const bx = px(0)
  const bz = pz(basketZ)
  // 外框（底線、邊線、中線）與禁區
  g.strokeRect(px(-C.HALF_WIDTH), pz(baseline), m(2 * C.HALF_WIDTH), m(C.HALF_LENGTH))
  g.strokeRect(px(-C.KEY_HALF_WIDTH), pz(baseline), m(2 * C.KEY_HALF_WIDTH), m(C.FREE_THROW))
  // 罰球圈
  g.beginPath()
  g.arc(bx, pz(baseline + C.FREE_THROW), m(C.CIRCLE_RADIUS), 0, Math.PI * 2)
  g.stroke()
  // 中圈（只有半個在半場內）
  g.beginPath()
  g.arc(bx, pz(baseline + C.HALF_LENGTH), m(C.CIRCLE_RADIUS), Math.PI, Math.PI * 2)
  g.stroke()
  // 合理衝撞區的半圓
  g.beginPath()
  g.arc(bx, bz, m(C.RESTRICTED_RADIUS), 0, Math.PI)
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

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  return { texture, width, length, center: new THREE.Vector3(0, 0, z0 + length / 2) }
}

// ===== 籃網的晃動可以調整的參數 =====
// 每個網結像掛在彈簧上：被球推開、拖著走，之後彈回原位。
const NET = {
  stiffness: 150, // 拉回原位的力道（越大彈回越快、晃得越急）
  soften: 0.6, // 越下面的網結越軟：最下面一圈的力道是最上面的 (1 - soften) 倍
  coupling: 260, // 相鄰網結互相帶動的力道（越大整張網越像一體，晃動會傳開）
  damping: 4.5, // 阻尼（越大越快停下來）
  drag: 0.55, // 被球碰到的網結跟著球走的程度（0 不跟、1 完全跟著球的速度）
  gap: 0.015, // 網結離球面多遠就算碰到（公尺）
  stretch: 0.2, // 最下面一圈的網結最多被拉離原位多遠（公尺）；越上面越少，最上面固定在籃框上。超過就從球旁邊滑開
  maxStep: 1 / 120, // 一次最多算多長的時間，再長就拆成幾次（免得彈簧算到爆掉）
}
// ====================================

// 籃網：上寬下窄的網子，用交錯的斜線編成菱形格。最上面一圈固定在籃框上，其他網結會被球推動、晃動。
// 回傳的 LineSegments 的 userData.step(delta, ball) 每格呼叫一次：ball 是場上的球 { p 球心世界座標, v 速度 }，沒有球就給 null
function createNet(material) {
  const strands = 12
  const rows = 5
  const top = COURT.RIM_RADIUS - 0.01
  const bottom = 0.09 // 網子下緣比球（半徑 0.12）窄，球穿過時一定會把網子撐開
  const depth = 0.4
  const index = (i, r) => r * strands + ((i % strands) + strands) % strands
  // 網結：rest 原位、p 現在的位置、v 速度（都是相對籃框中心）、soft 這個網結的彈簧力道
  const nodes = []
  for (let r = 0; r <= rows; r++) {
    for (let i = 0; i < strands; i++) {
      const k = r / rows
      const radius = top + (bottom - top) * k
      const angle = ((i + (r % 2) * 0.5) / strands) * Math.PI * 2
      const rest = new THREE.Vector3(Math.cos(angle) * radius, -depth * k, Math.sin(angle) * radius)
      nodes.push({ rest, p: rest.clone(), v: new THREE.Vector3(), fixed: r === 0, soft: NET.stiffness * (1 - NET.soften * k), reach: NET.stretch * k, near: [] })
    }
  }
  // 每條線接哪兩個網結。下一列錯開半格：偶數列往下接 i、i-1，奇數列接 i、i+1
  const links = []
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < strands; i++) {
      for (const j of [i, r % 2 === 0 ? i - 1 : i + 1]) {
        const a = index(i, r)
        const b = index(j, r + 1)
        links.push(a, b)
        nodes[a].near.push(nodes[b])
        nodes[b].near.push(nodes[a])
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
  let still = true
  function advance(dt, ball) {
    if (ball) local.copy(ball.p).sub(net.position) // 球心換成相對籃框中心
    let moving = false
    for (const node of nodes) {
      if (node.fixed) continue
      // 彈回原位＋被相鄰網結帶動（往鄰居們偏移量的平均靠）＋阻尼
      pull.set(0, 0, 0)
      for (const other of node.near) pull.add(other.p).sub(other.rest)
      pull.divideScalar(node.near.length).sub(node.p).add(node.rest).multiplyScalar(NET.coupling)
      pull.addScaledVector(push.copy(node.rest).sub(node.p), node.soft).addScaledVector(node.v, -NET.damping)
      node.v.addScaledVector(pull, dt)
      node.p.addScaledVector(node.v, dt)
      // 球碰到網結：推到球面外，並且跟著球走一點（球往下穿過時把網子往下、往外帶）
      if (ball) {
        push.copy(node.p).sub(local)
        const reach = ball.radius + NET.gap
        const d = push.length()
        if (d < reach) {
          if (d < 1e-5) push.set(node.rest.x, 0, node.rest.z).normalize()
          else push.divideScalar(d)
          node.p.copy(local).addScaledVector(push, reach)
          node.v.lerp(ball.v, NET.drag)
        }
      }
      // 網線有長度：拉離原位太遠就停在最遠的地方（球繼續往下，網結從旁邊滑開）
      push.copy(node.p).sub(node.rest)
      if (push.lengthSq() > node.reach * node.reach) {
        node.p.copy(node.rest).addScaledVector(push.normalize(), node.reach)
        node.v.multiplyScalar(0.6)
      }
      if (node.v.lengthSq() > 1e-5 || node.p.distanceToSquared(node.rest) > 1e-6) moving = true
    }
    return moving
  }
  net.userData.step = (delta, ball = null) => {
    if (still && !ball) return // 沒在晃、也沒有球，不用算
    const steps = Math.max(1, Math.ceil(delta / NET.maxStep))
    let moving = false
    for (let i = 0; i < steps; i++) moving = advance(delta / steps, ball)
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

// 圍欄：沿鋪面外緣的兩側和籃架後方，一根根柱子、上下橫桿、中間是半透明的鐵絲網
function createFence(floor, material) {
  const group = new THREE.Group()
  group.name = 'Fence'
  const x1 = floor.width / 2
  const z0 = floor.center.z - floor.length / 2
  const z1 = floor.center.z + floor.length / 2
  const frame = material(COLORS.fence)
  const mesh = createMeshTexture()
  // 每一段：[起點 x, z, 終點 x, z]
  for (const [ax, az, bx, bz] of [[-x1, z1, -x1, z0], [-x1, z0, x1, z0], [x1, z0, x1, z1]]) {
    const length = Math.hypot(bx - ax, bz - az)
    const angle = Math.atan2(bx - ax, bz - az)
    const mid = new THREE.Vector3((ax + bx) / 2, 0, (az + bz) / 2)
    const posts = Math.round(length / FENCE_POST_GAP)
    for (let i = 0; i <= posts; i++) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, FENCE_HEIGHT, 8), frame)
      post.position.set(ax + ((bx - ax) * i) / posts, FENCE_HEIGHT / 2, az + ((bz - az) * i) / posts)
      group.add(post)
    }
    for (const y of [0.05, FENCE_HEIGHT]) {
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

  const add = (geometry, hex, position, outline = true) => {
    const mesh = new THREE.Mesh(geometry, material(hex))
    mesh.position.copy(position)
    mesh.castShadow = true
    mesh.userData.outline = outline
    group.add(mesh)
    return mesh
  }

  const boardZ = basketZ - C.BOARD_OFFSET
  const boardY = C.BOARD_BOTTOM + C.BOARD_HEIGHT / 2
  const boardThick = 0.04
  // 籃板與板上的小框（框底和籃框同高，寬 0.59、高 0.45）
  add(new THREE.BoxGeometry(C.BOARD_WIDTH, C.BOARD_HEIGHT, boardThick), COLORS.board, new THREE.Vector3(0, boardY, boardZ - boardThick / 2))
  const mark = new THREE.Shape()
  mark.moveTo(-0.295, 0)
  mark.lineTo(0.295, 0)
  mark.lineTo(0.295, 0.45)
  mark.lineTo(-0.295, 0.45)
  mark.closePath()
  const hole = new THREE.Path()
  hole.moveTo(-0.245, 0.05)
  hole.lineTo(-0.245, 0.4)
  hole.lineTo(0.245, 0.4)
  hole.lineTo(0.245, 0.05)
  hole.closePath()
  mark.holes.push(hole)
  add(new THREE.ShapeGeometry(mark), COLORS.boardMark, new THREE.Vector3(0, C.RIM_HEIGHT, boardZ + 0.001), false)

  // 籃框與連接籃板的小鐵片
  const rim = add(new THREE.TorusGeometry(C.RIM_RADIUS, C.RIM_TUBE, 8, 32), COLORS.rim, new THREE.Vector3(0, C.RIM_HEIGHT, basketZ))
  rim.rotation.x = Math.PI / 2
  add(new THREE.BoxGeometry(0.12, 0.03, C.BOARD_OFFSET - C.RIM_RADIUS), COLORS.rim,
    new THREE.Vector3(0, C.RIM_HEIGHT - 0.01, boardZ + (C.BOARD_OFFSET - C.RIM_RADIUS) / 2))

  const net = createNet(new THREE.LineBasicMaterial({ color: COLORS.net }))
  net.position.set(0, C.RIM_HEIGHT, basketZ)
  net.name = 'Net'
  group.add(net)

  // 籃架：底線後方 1 m 的柱子，往前伸出橫臂撐住籃板
  const poleZ = basketZ - C.BASKET_TO_BASELINE - 1.0
  const poleHeight = boardY + 0.1
  add(new THREE.CylinderGeometry(0.09, 0.11, poleHeight, 16), COLORS.pole, new THREE.Vector3(0, poleHeight / 2, poleZ))
  const armLength = boardZ - boardThick - poleZ
  add(new THREE.BoxGeometry(0.12, 0.12, armLength), COLORS.pole, new THREE.Vector3(0, boardY, poleZ + armLength / 2))
  add(new THREE.BoxGeometry(0.5, 0.06, 0.06), COLORS.pole, new THREE.Vector3(0, boardY, boardZ - boardThick - 0.03))

  return group
}
