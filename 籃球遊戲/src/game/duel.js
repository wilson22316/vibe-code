// 1 對 1（第一階段）：玩家一直進攻，AI 對手只防守。
// 對手站在玩家和籃框之間、跟著滑步，玩家跳投時跳起來干擾，沒進的球去搶籃板；搶到就算防守成功、重新開球。
// 街頭規則：三分線內進球 1 分、線外 2 分，先得 WIN_SCORE 分結束。對手的進攻、攻守交換之後再做（見 TODO.md）。
// 玩家的操控沿用 practice.js，這裡用它的 rules（碰撞、切入路線、出手干擾）和 state() 接上。
import * as THREE from 'three'
import { COURT } from './court.js'
import { MOVE_SPEEDS, NIGHT_BASKET_Z } from '../gallery/scene.js'

// ===== 可以調整的參數 =====
export const WIN_SCORE = 11
// 防守位置：玩家往籃框方向 GUARD_GAP m；對手看到的是玩家 REACTION 秒前的位置（越大越容易被晃過）。
// 玩家移動時，對手預判他 LEAD 秒後的位置，並且每 1 m/s 多退 SAG m（退著防切入，所以急停跳投比較有空檔）
const GUARD_GAP = 1.1
const REACTION = 0.22
const LEAD = 0.25
const SAG = 0.15
// 滑步最快是 DefenseSlide 原本速度（1.289 m/s）的幾倍；離防守位置超過 RECOVER_FROM m 就轉身跑回去，
// 跑的速度是 Run（3.345 m/s）的 RUN_SCALE 倍
const SLIDE_SCALE_MAX = 2
const RECOVER_FROM = 1.5
const RUN_SCALE = 1.3
// 兩人中心最近的距離；切入路線（玩家到籃框的直線）兩側這麼寬以內有對手就算被擋住
const BODY_GAP = 0.6
const LANE_HALF_WIDTH = 0.75
// 出手干擾：對手在出手者前方 CONTEST_FULL m 內干擾最大、CONTEST_RANGE m 外沒有干擾；
// 干擾最大時出手的隨機誤差是原本的 1 + CONTEST_MAX 倍。對手跳起來時再往最大靠近 CONTEST_JUMP
const CONTEST_RANGE = 2.0
const CONTEST_FULL = 0.9
const CONTEST_MAX = 5
const CONTEST_JUMP = 0.3
// 進球或防守成功後，隔幾秒重新開球
const NEXT_DELAY = 1.8
// =========================

const BASELINE_Z = NIGHT_BASKET_Z - COURT.BASKET_TO_BASELINE
const MARGIN = 0.3
const TURN_SPEED = 10
const FADE = 0.2
const SLIDE_SPEED = MOVE_SPEEDS.DefenseSlide
// 干擾的跳躍借用 Rebound：從第 4 格（已屈膝）開始播，第 8 格起跳、第 20 格落地
const JUMP_START = 4 / 24
const JUMP_END = 20 / 24
// 撿球的範圍和玩家一樣（practice.js 的 PICKUP_RADIUS、PICKUP_HEIGHT）
const PICKUP_RADIUS = 0.7
const PICKUP_HEIGHT = 1.3

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a))

// 站在 position 出手算不算三分線外（街頭規則的 2 分）
export function beyondArc(position, rim) {
  return Math.hypot(position.x - rim.x, position.z - rim.z) > COURT.THREE_RADIUS || Math.abs(position.x) > COURT.THREE_SIDE
}

// onScore({ score, possession }) 分數或進攻次數變了；onStop() 對手搶到籃板；onWin({ score, possession }) 得到 WIN_SCORE 分
export function createDuel({ onScore = () => {}, onStop = () => {}, onWin = () => {} } = {}) {
  let foe = null
  let controls = null
  let rim = null
  let score = 0
  let possession = 1
  // guard 防守中、jump 跳起來干擾、dead 死球（等重新開球）、over 比賽結束
  let phase = 'guard'
  let clip = null
  let running = false // 防守位置被甩開，正在轉身跑回去
  let jumped = false // 這一球已經跳過了
  let wait = 0
  const seen = new THREE.Vector3() // 對手看到的玩家位置（落後 REACTION 秒）
  const seenBefore = new THREE.Vector3()
  const aim = new THREE.Vector3()
  const target = new THREE.Vector3()
  const to = new THREE.Vector3()

  function setClip(name, scale = 1, startAt = 0) {
    if (clip !== name) foe.play(name, FADE, scale, startAt)
    else foe.setTimeScale(scale)
    clip = name
  }

  function start(stage, playerControls, colors) {
    controls = playerControls
    rim = controls.rim
    foe = stage.addCharacter(colors)
    place()
  }

  // 重新開球時的站位：玩家和籃框之間
  function place() {
    const player = controls.state().position
    seen.copy(player)
    guardSpot(player, GUARD_GAP)
    foe.root.position.copy(target)
    foe.root.rotation.y = Math.atan2(player.x - target.x, player.z - target.z)
    running = false
    jumped = false
    clip = null
    setClip('Defense')
  }

  // 防守位置：從 player 往籃框 gap m（玩家已經在籃下的話就站在他和籃框中間）
  function guardSpot(player, gap) {
    to.set(rim.x - player.x, 0, rim.z - player.z)
    const d = to.length()
    target.copy(player).addScaledVector(to, Math.min(gap, d * 0.5) / Math.max(d, 1e-6))
    target.y = 0
  }

  function turnTowards(angle, delta) {
    const diff = wrapAngle(angle - foe.root.rotation.y)
    foe.root.rotation.y = wrapAngle(foe.root.rotation.y + Math.sign(diff) * Math.min(Math.abs(diff), TURN_SPEED * delta))
  }

  function moveBy(dx, dz) {
    const p = foe.root.position
    p.x = THREE.MathUtils.clamp(p.x + dx, -COURT.HALF_WIDTH + MARGIN, COURT.HALF_WIDTH - MARGIN)
    p.z = THREE.MathUtils.clamp(p.z + dz, BASELINE_Z + MARGIN, BASELINE_Z + COURT.HALF_LENGTH - MARGIN)
  }

  // 轉身往 target 跑（被甩開時追回去、搶籃板）
  function runTo(delta) {
    const p = foe.root.position
    turnTowards(Math.atan2(target.x - p.x, target.z - p.z), delta)
    setClip('Run', RUN_SCALE)
    const v = MOVE_SPEEDS.Run * RUN_SCALE
    const a = foe.root.rotation.y
    moveBy(Math.sin(a) * v * delta, Math.cos(a) * v * delta)
  }

  // 面向 face、用滑步往 target 移動；到位就站防守姿勢。
  // DefenseSlide 是往角色左邊滑，往右就倒著播（腳步一樣踩在地上）；前後的移動量小，直接平移
  function slideTo(face, delta) {
    const p = foe.root.position
    turnTowards(Math.atan2(face.x - p.x, face.z - p.z), delta)
    to.set(target.x - p.x, 0, target.z - p.z)
    const d = to.length()
    const v = Math.min(SLIDE_SPEED * SLIDE_SCALE_MAX, d / 0.15) // 快到位時慢下來，不會來回抖
    if (d > 1e-4) moveBy((to.x / d) * v * delta, (to.z / d) * v * delta)
    const a = foe.root.rotation.y
    const left = d > 1e-4 ? ((to.x * Math.cos(a) - to.z * Math.sin(a)) / d) * v : 0 // 往角色左邊（+X）的速度
    const sliding = Math.abs(left) > (clip === 'DefenseSlide' ? 0.15 : 0.4)
    if (sliding) setClip('DefenseSlide', left / SLIDE_SPEED)
    else setClip('Defense')
  }

  // 不和玩家重疊：靠太近就往外退
  function keepApart(player) {
    const p = foe.root.position
    to.set(p.x - player.x, 0, p.z - player.z)
    const d = to.length()
    if (d < BODY_GAP && d > 1e-6) p.addScaledVector(to, (BODY_GAP - d) / d)
  }

  function guard(delta, state) {
    const player = state.position
    seenBefore.copy(seen)
    seen.lerp(player, Math.min(1, delta / REACTION))
    const p = foe.root.position
    // 玩家跳投：夠近就跳起來干擾，每球一次
    if (state.shooting === 'jump' && !jumped && !state.ball && Math.hypot(player.x - p.x, player.z - p.z) < CONTEST_RANGE) {
      jumped = true
      phase = 'jump'
      clip = null
      setClip('Rebound', 1, JUMP_START)
      return
    }
    if (state.ball) {
      chase(delta, state)
      return
    }
    const speed = seen.distanceTo(seenBefore) / delta
    aim.copy(seen).addScaledVector(seenBefore.sub(seen), -LEAD / delta)
    guardSpot(aim, GUARD_GAP + SAG * speed)
    const d = Math.hypot(target.x - p.x, target.z - p.z)
    running = d > (running ? 0.6 : RECOVER_FROM)
    if (running) runTo(delta)
    else slideTo(player, delta)
    keepApart(player)
  }

  // 球離手後去搶：往球的方向跑，到了腳邊就撿起來
  function chase(delta, state) {
    const ball = state.ball
    const p = foe.root.position
    target.set(ball.position.x + ball.velocity.x * 0.3, 0, ball.position.z + ball.velocity.z * 0.3)
    const d = Math.hypot(ball.position.x - p.x, ball.position.z - p.z)
    if (d > 0.4) runTo(delta)
    else setClip('Defense')
    keepApart(state.position)
    if (ball.judged && !state.shooting && ball.position.y < PICKUP_HEIGHT && d < PICKUP_RADIUS) {
      controls.takeBall()
      deadBall()
      onStop()
    }
  }

  function deadBall() {
    phase = 'dead'
    wait = NEXT_DELAY
    setClip('Idle')
  }

  function nextPossession() {
    possession++
    controls.reset()
    place()
    phase = 'guard'
    onScore({ score, possession })
  }

  // 玩家每投一球的結果（practice.js 的 onResult）。回傳這球得幾分
  function result({ made, spot }) {
    if (!made || phase === 'over') return 0
    const points = beyondArc(spot, rim) ? 2 : 1
    score += points
    onScore({ score, possession })
    if (score >= WIN_SCORE) {
      phase = 'over'
      setClip('Frustrated')
      onWin({ score, possession })
    } else deadBall()
    return points
  }

  function update(delta, paused) {
    if (!foe || paused || delta <= 0) return
    delta = Math.min(delta, 0.1)
    const state = controls.state()
    if (phase === 'guard') {
      // 玩家搶到進攻籃板：繼續防守，可以再跳一次
      if (state.hasBall && !state.shooting) jumped = false
      guard(delta, state)
    } else if (phase === 'jump') {
      if (foe.actionTime() >= JUMP_END) phase = 'guard'
    } else if (phase === 'dead') {
      wait -= delta
      if (wait <= 0) nextPossession()
    }
  }

  // 再來一場
  function restart() {
    score = 0
    possession = 0
    nextPossession()
  }

  const rules = {
    // 玩家不能穿過對手：靠太近就推回去
    collide(position) {
      if (!foe) return
      const p = foe.root.position
      to.set(position.x - p.x, 0, position.z - p.z)
      const d = to.length()
      if (d < BODY_GAP && d > 1e-6) position.addScaledVector(to, (BODY_GAP - d) / d)
    },
    // 對手在玩家到籃框的直線附近（而且在玩家前方）就算擋住切入路線
    laneOpen() {
      const player = controls.state().position
      const p = foe.root.position
      const lx = rim.x - player.x
      const lz = rim.z - player.z
      const length = Math.hypot(lx, lz)
      const along = ((p.x - player.x) * lx + (p.z - player.z) * lz) / length
      if (along < 0 || along > length) return true
      const across = Math.abs((p.x - player.x) * lz - (p.z - player.z) * lx) / length
      return across > LANE_HALF_WIDTH
    },
    // 出手誤差的倍數：對手在出手者和籃框之間、越近越大
    contest(from) {
      const p = foe.root.position
      const d = Math.hypot(p.x - from.x, p.z - from.z)
      let k = THREE.MathUtils.clamp((CONTEST_RANGE - d) / (CONTEST_RANGE - CONTEST_FULL), 0, 1)
      const front = (p.x - from.x) * (rim.x - from.x) + (p.z - from.z) * (rim.z - from.z) > 0
      if (!front) k *= 0.3
      else if (phase === 'jump' && k > 0) k = Math.min(1, k + CONTEST_JUMP)
      return 1 + CONTEST_MAX * k
    },
  }

  return { start, update, result, restart, rules }
}
