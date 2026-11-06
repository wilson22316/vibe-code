// 投出去的球：重力、籃框（圓環）、籃板正面、地板反彈、籃網阻力，以及進球判定。
// 每秒計算 240 次；常數照 CLAUDE.md 的「球場與物理常數」，碰撞寫法沿用 reference/shoot_game_r128.html。
// 座標和 court.js 一樣：籃框中心 (0, RIM_HEIGHT, basketZ)，籃板在籃框的 -Z 那側。
import * as THREE from 'three'
import { COURT } from './court.js'

export const BALL_RADIUS = 0.12
export const GRAVITY = 9.8
const STEP = 1 / 240
const RIM_BOUNCE = 0.55
const BOARD_BOUNCE = 0.6
const FLOOR_BOUNCE = 0.72
const SETTLE_SPEED = 0.5 // 落地時往下的速度小於這個值就不再彈，改成在地上滾
const ROLL_DRAG = 0.8 // 在地上滾的減速（每秒速度乘 e^-ROLL_DRAG）
const NET_DEPTH = 0.4
const SCORE_MARGIN = 0.035 // 球心往下穿過籃框高度時，水平距離小於「籃框半徑 − 這個值」才算進

export function createBallPhysics(basketZ) {
  const rim = new THREE.Vector3(0, COURT.RIM_HEIGHT, basketZ)
  const boardZ = basketZ - COURT.BOARD_OFFSET
  const board = {
    x0: -COURT.BOARD_WIDTH / 2,
    x1: COURT.BOARD_WIDTH / 2,
    y0: COURT.BOARD_BOTTOM,
    y1: COURT.BOARD_BOTTOM + COURT.BOARD_HEIGHT,
  }
  const contact = new THREE.Vector3()
  const normal = new THREE.Vector3()

  // 一顆球的狀態：p 位置、v 速度；touchedRim、touchedBoard、scored、crossed（往下穿過籃框高度的位置）
  function launch(position, velocity) {
    return {
      p: position.clone(),
      v: velocity.clone(),
      age: 0,
      scored: false,
      crossed: null,
      touchedRim: false,
      touchedBoard: false,
      bounces: 0,
    }
  }

  function step(b, dt) {
    const prevY = b.p.y
    b.v.y -= GRAVITY * dt
    b.p.addScaledVector(b.v, dt)

    const hx = b.p.x - rim.x
    const hz = b.p.z - rim.z
    const hr = Math.hypot(hx, hz)
    // 籃網阻力：球在籃網裡時慢下來
    if (hr < COURT.RIM_RADIUS && b.p.y < rim.y && b.p.y > rim.y - NET_DEPTH) {
      b.v.x *= 0.985
      b.v.z *= 0.985
      b.v.y *= 0.997
    }
    // 籃板正面（球往 -Z 飛過去）
    const r = BALL_RADIUS * 0.5
    if (
      b.v.z < 0 &&
      b.p.x > board.x0 - r && b.p.x < board.x1 + r &&
      b.p.y > board.y0 - r && b.p.y < board.y1 + r &&
      b.p.z - BALL_RADIUS < boardZ && b.p.z > boardZ - 0.05
    ) {
      b.p.z = boardZ + BALL_RADIUS
      b.v.z *= -BOARD_BOUNCE
      b.v.x *= 0.9
      b.v.y *= 0.9
      b.touchedBoard = true
    }
    // 籃框：找圓環上離球最近的點，球心離它小於「球半徑 + 框管半徑」就彈開
    if (hr > 1e-6) {
      contact.set(rim.x + (hx / hr) * COURT.RIM_RADIUS, rim.y, rim.z + (hz / hr) * COURT.RIM_RADIUS)
      normal.subVectors(b.p, contact)
      const dist = normal.length()
      const minDist = BALL_RADIUS + COURT.RIM_TUBE
      if (dist < minDist && dist > 1e-6) {
        normal.divideScalar(dist)
        b.p.copy(contact).addScaledVector(normal, minDist)
        const vn = b.v.dot(normal)
        if (vn < 0) {
          b.v.addScaledVector(normal, -(1 + RIM_BOUNCE) * vn)
          b.v.multiplyScalar(0.94)
        }
        b.touchedRim = true
      }
    }
    // 地板：落地反彈時水平速度減一些；彈不起來之後就在地上滾，慢慢停下
    if (b.p.y < BALL_RADIUS) {
      b.p.y = BALL_RADIUS
      if (b.v.y < -SETTLE_SPEED) {
        b.v.y *= -FLOOR_BOUNCE
        b.v.x *= 0.9
        b.v.z *= 0.9
        b.bounces++
      } else {
        b.v.y = 0
        const k = Math.exp(-ROLL_DRAG * dt)
        b.v.x *= k
        b.v.z *= k
      }
    }
    // 進球判定：球心往下穿過籃框高度
    if (!b.crossed && prevY >= rim.y && b.p.y < rim.y) {
      b.crossed = { x: b.p.x, z: b.p.z }
      if (hr < COURT.RIM_RADIUS - SCORE_MARGIN) b.scored = true
    }
    b.age += dt
  }

  // 前進 delta 秒（拆成每步 1/240 秒）
  function update(b, delta) {
    const n = Math.max(1, Math.ceil(delta / STEP))
    for (let i = 0; i < n; i++) step(b, delta / n)
  }

  // 從 from 投向籃框中心偏後 4 cm（「理想力道」的瞄準點）時，仰角 angle 需要的出手速度；投不到就回傳 null
  function idealSpeed(from, angle) {
    const dir = new THREE.Vector3(rim.x - from.x, 0, rim.z - from.z).normalize()
    const aim = rim.clone().addScaledVector(dir, 0.04)
    const d = Math.hypot(aim.x - from.x, aim.z - from.z)
    const h = aim.y - from.y
    const den = 2 * Math.cos(angle) ** 2 * (d * Math.tan(angle) - h)
    return den > 0 ? Math.sqrt((GRAVITY * d * d) / den) : null
  }

  // 從 from 往籃框方向、仰角 angle、速度 speed 出手的速度向量
  function launchVelocity(from, angle, speed) {
    const dir = new THREE.Vector3(rim.x - from.x, 0, rim.z - from.z).normalize()
    return dir.multiplyScalar(Math.cos(angle) * speed).setY(Math.sin(angle) * speed)
  }

  // 上籃打板：找一個先打到籃板、再落進籃框的出手速度，找不到就回傳 null。
  // 打板點的左右位置照反彈算（籃板反彈時 z 方向速度乘 BOARD_BOUNCE、x 方向乘 0.9），
  // 高度和飛行時間逐一試算，挑球心最靠近籃框中心、沒碰到籃框的那一組。
  function bankShotVelocity(from) {
    const front = boardZ + BALL_RADIUS // 球碰到籃板時球心的 z
    const a = from.z - front
    const b = rim.z - front
    if (a < 0.2) return null
    const k = (0.9 / BOARD_BOUNCE) * (b / a)
    const tx = (rim.x + k * from.x) / (1 + k)
    const target = new THREE.Vector3()
    const v = new THREE.Vector3()
    let best = null
    let bestScore = Infinity
    for (let ty = rim.y + 0.1; ty <= rim.y + 0.7; ty += 0.05) {
      for (let t = 0.25; t <= 0.9; t += 0.05) {
        target.set(tx, ty, front)
        v.subVectors(target, from).divideScalar(t)
        v.y += (GRAVITY * t) / 2
        const ball = launch(from, v)
        while (!(ball.crossed && ball.p.y < rim.y - 0.3) && ball.age < 2) update(ball, 1 / 60)
        if (!ball.scored) continue
        const score = Math.hypot(ball.crossed.x - rim.x, ball.crossed.z - rim.z) + (ball.touchedRim ? 1 : 0) + (ball.touchedBoard ? 0 : 0.5)
        if (score < bestScore) {
          bestScore = score
          best = v.clone()
        }
      }
    }
    return best
  }

  // 沒進時的原因（從出手方向看太短或太長）
  function missReason(b, from) {
    const dir = new THREE.Vector3(rim.x - from.x, 0, rim.z - from.z).normalize()
    if (b.crossed) {
      const along = (b.crossed.x - rim.x) * dir.x + (b.crossed.z - rim.z) * dir.z
      return (b.touchedRim ? '打框沒進：' : '') + (along < 0 ? '太短了' : '太長了')
    }
    if (b.touchedBoard) return '打板沒進'
    return '太短了，沒碰到籃框'
  }

  return { rim, launch, update, idealSpeed, launchVelocity, bankShotVelocity, missReason }
}
