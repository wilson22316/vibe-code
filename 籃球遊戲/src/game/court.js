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
}

const LINE_WIDTH = 0.05
const RUNOFF = 1.0 // 球場外留的空地（公尺）
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

// 籃網：上寬下窄的網子，用交錯的斜線編成菱形格
function createNet(material) {
  const strands = 12
  const rows = 4
  const top = COURT.RIM_RADIUS - 0.01
  const bottom = 0.14
  const depth = 0.4
  const points = []
  const at = (i, r) => {
    const k = r / rows
    const radius = top + (bottom - top) * k
    const angle = ((i + (r % 2) * 0.5) / strands) * Math.PI * 2
    return new THREE.Vector3(Math.cos(angle) * radius, -depth * k, Math.sin(angle) * radius)
  }
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < strands; i++) {
      const p = at(i, r)
      // 下一列錯開半格：偶數列往下接 i、i-1，奇數列接 i、i+1
      points.push(p, at(i, r + 1), p, at(r % 2 === 0 ? i - 1 : i + 1, r + 1))
    }
  }
  return new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), material)
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
