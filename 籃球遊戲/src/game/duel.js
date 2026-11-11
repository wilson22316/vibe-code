// 1 對 1：玩家和 AI 對手輪流進攻。街頭規則：三分線內進球 1 分、線外 2 分，先得 WIN_SCORE 分獲勝；進球後換對方進攻。
// 每次換球權都回到三分線弧頂重新開球（出界、清球還沒做，見 TODO.md）。
// 對手防守：站在玩家和籃框之間跟著滑步，玩家跳投時跳起來干擾，沒進的球去搶籃板。
// 對手進攻：運球找位置，有空檔就跳投、切入路線沒人就上籃或灌籃。玩家防守時可以抄球（D）、跳起來封蓋和搶籃板（空白鍵）。
// 玩家的操控在 practice.js，這裡用它的 rules 和 state() 接上；對手出手的球也交給它的物理和判定（foeShot）。
import * as THREE from 'three'
import { COURT } from './court.js'
import { MOVE_SPEEDS, NIGHT_BASKET_Z } from '../gallery/scene.js'
import { DRIVES, DRIVE_BRAKE, DRIVE_TAKEOFF, JUMP_START as SHOT_START, LAYUP_ERROR, SHOOT_LENGTH, SHOOT_RELEASE } from './practice.js'

// ===== 可以調整的參數 =====
export const WIN_SCORE = 11

// --- 對手防守 ---
// 防守位置：玩家往籃框方向 GUARD_GAP m；對手看到的是玩家 REACTION 秒前的位置（越大越容易被晃過）。
// 玩家移動時，對手預判他 LEAD 秒後的位置，並且每 1 m/s 多退 SAG m（退著防切入，所以急停跳投比較有空檔）
const GUARD_GAP = 1.2
const REACTION = 0.3
const LEAD = 0.15
const SAG = 0.15
// 滑步最快是 DefenseSlide 原本速度（1.289 m/s）的幾倍；離防守位置超過 RECOVER_FROM m 就轉身跑回去，
// 跑的速度是 Run（3.345 m/s）的 RUN_SCALE 倍（玩家衝刺約 5 m/s）
const SLIDE_SCALE_MAX = 1.7
const RECOVER_FROM = 1.5
const RUN_SCALE = 1.1
// 玩家突破（A）時對手在 BURST_RANGE m 內的話，會愣住 BURST_STUN 秒才繼續跟
const BURST_RANGE = 2.5
const BURST_STUN = 0.6
// 兩人中心最近的距離；切入路線（到籃框的直線）兩側這麼寬以內有防守者就算被擋住
const BODY_GAP = 0.6
const LANE_HALF_WIDTH = 0.55
// 玩家切入時對手離他超過這個距離才灌籃，不然上籃
const DUNK_CLEAR = 1.5
// 出手干擾：防守者在出手者前方 CONTEST_FULL m 內干擾最大、CONTEST_RANGE m 外沒有干擾；
// 干擾最大時出手的隨機誤差是原本的 1 + CONTEST_MAX 倍。防守者跳起來時再往最大靠近 CONTEST_JUMP
const CONTEST_RANGE = 1.6
const CONTEST_FULL = 0.7
const CONTEST_MAX = 2.5
const CONTEST_JUMP = 0.3
// 球判定完（碰框彈出來）後，對手隔幾秒才去搶
const REBOUND_WAIT = 0.6

// --- 玩家防守 ---
// 抄球：對手運球中、離他 STEAL_RANGE m 內按 D，有 STEAL_CHANCE 的機率抄到
const STEAL_RANGE = 1.6
const STEAL_CHANCE = 0.55
// 封蓋：對手出手那一刻玩家正在跳（從按下空白鍵到落地，約 0.67 秒）、在他前方 BLOCK_RANGE m 內就蓋掉
const BLOCK_RANGE = 1.8
// 玩家干擾對手出手的範圍和強度（同上面的 CONTEST_RANGE、CONTEST_MAX，放寬讓防守比較有用）
const GUARD_CONTEST_RANGE = 2.4
const GUARD_CONTEST_MAX = 5
// 玩家在對手到籃框的直線兩側這麼寬以內，對手就不切入（比玩家切入的 LANE_HALF_WIDTH 寬，站在前面就擋得住）
const GUARD_LANE_HALF_WIDTH = 1.0

// --- 對手進攻 ---
// 運球移動的速度是 Sprint（2.843 m/s）的幾倍；每 FOE_THINK 秒決定一次要做什麼
const FOE_SPRINT_SCALE = 0.95
const FOE_THINK = 0.7
// 玩家離對手超過 FOE_OPEN m 算有空檔，離籃框 FOE_SHOT_RANGE m 內每次決定有 FOE_SHOOT_CHANCE 的機率跳投；
// 拿球超過 FOE_SHOT_CLOCK 秒就算沒空檔也出手
const FOE_OPEN = 1.6
const FOE_SHOT_RANGE = 7.2
const FOE_SHOOT_CHANCE = 0.5
const FOE_SHOT_CLOCK = 8
// 對手跳投的隨機誤差（標準差，同 practice.js 的 SHOT_ERROR）；沒被干擾時比玩家的 GOOD 差一些
const FOE_SHOT_ERROR = { speed: 0.028, side: 2 }
// 對手離玩家超過這個距離時，切入有一半機率灌籃
const FOE_DUNK_CLEAR = 2.5

// 進球或換球權後，隔幾秒重新開球
const NEXT_DELAY = 1.8
// =========================

// 固定鏡頭：在中線後上方往籃框看，整個半場都在畫面裡（跟拍的話攻守轉換時畫面一直轉，會暈）
const CAMERA = {
  position: new THREE.Vector3(0, 8.5, NIGHT_BASKET_Z + 17.5),
  target: new THREE.Vector3(0, 1, NIGHT_BASKET_Z + 3.5),
}
const BASELINE_Z = NIGHT_BASKET_Z - COURT.BASKET_TO_BASELINE
const MARGIN = 0.3
const START = new THREE.Vector3(0, 0, NIGHT_BASKET_Z + 6.5) // 開球位置，同 practice.js
const TURN_SPEED = 10
const FADE = 0.2
const SLIDE_SPEED = MOVE_SPEEDS.DefenseSlide
// 干擾的跳躍借用 Rebound：從第 4 格（已屈膝）開始播，第 8 格起跳、第 20 格落地
const CONTEST_FROM = 4 / 24
const CONTEST_TO = 20 / 24
// 撿球的範圍和玩家一樣（practice.js 的 PICKUP_RADIUS、PICKUP_HEIGHT）
const PICKUP_RADIUS = 0.7
const PICKUP_HEIGHT = 1.3
const UP = THREE.Object3D.DEFAULT_UP

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a))
const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random())
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z)

// 站在 position 出手算不算三分線外（街頭規則的 2 分）
export function beyondArc(position, rim) {
  return Math.hypot(position.x - rim.x, position.z - rim.z) > COURT.THREE_RADIUS || Math.abs(position.x) > COURT.THREE_SIDE
}

// onScore({ you, foe, offense }) 分數或球權變了；onMessage(text) 要顯示的訊息（抄截、火鍋、籃板）；
// onEnd(winner) 有人得到 WIN_SCORE 分（'you' 或 'foe'）
export function createDuel({ onScore = () => {}, onMessage = () => {}, onEnd = () => {} } = {}) {
  let foe = null
  let foeBall = null // 對手手上的球（模型裡的球）
  let controls = null
  let physics = null
  let rim = null
  let locals = null // 各種出手那一格球在角色座標的位置
  const score = { you: 0, foe: 0 }
  let offense = 'you'
  let phase = 'play' // play 進行中、dead 死球（等重新開球）、over 比賽結束
  let next = 'you'
  let wait = 0
  // 對手正在做什麼：guard 防守、contest 跳起來干擾、dribble 運球找機會、shot 投籃動作中（跳投、上籃、灌籃）、
  // loose 自己投完去搶籃板、idle 死球
  let mode = 'guard'
  let clip = null
  let running = false // 防守位置被甩開，正在轉身跑回去
  let jumped = false // 這一球已經跳過了
  let stun = 0 // 被突破晃到，還要愣幾秒
  let looseFor = 0 // 球判定完多久了
  let think = 0
  let clock = 0 // 對手這次拿球多久了
  let side = 1 // 對手運球往哪一邊繞
  let spotAngle = 0 // 對手要去的位置：以籃框為圓心的角度和半徑
  let spotRadius = 6.5
  let shot = null // 對手的投籃動作：{ kind, time, air, spot, released }
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
    physics = controls.physics
    rim = controls.rim
    locals = controls.releaseLocals()
    foe = stage.addCharacter(colors)
    foeBall = foe.root.getObjectByName('Ball')
    begin('you')
  }

  // 重新開球：進攻方在弧頂拿球，防守方站在他和籃框之間
  function begin(who) {
    offense = who
    phase = 'play'
    running = false
    jumped = false
    stun = 0
    looseFor = 0
    shot = null
    clip = null
    guardSpot(START, GUARD_GAP)
    if (who === 'you') {
      controls.reset()
      seen.copy(START)
      foe.root.position.copy(target)
      foe.root.rotation.y = Math.atan2(START.x - target.x, START.z - target.z)
      foeBall.visible = false
      mode = 'guard'
      setClip('Defense')
    } else {
      foe.root.position.copy(START)
      foe.root.rotation.y = Math.atan2(rim.x - START.x, rim.z - START.z)
      foeBall.visible = true
      controls.reset({ ball: false, position: target })
      mode = 'dribble'
      think = 1
      clock = 0
      side = Math.random() < 0.5 ? 1 : -1
      spotAngle = 0
      spotRadius = 6.5
      setClip('Dribble')
    }
    onScore({ ...score, offense })
  }

  function deadBall(who, message) {
    phase = 'dead'
    next = who
    wait = NEXT_DELAY
    mode = 'idle'
    foeBall.visible = false
    setClip('Idle')
    if (message) onMessage(message)
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

  const facingRim = () => Math.atan2(rim.x - foe.root.position.x, rim.z - foe.root.position.z)

  function moveBy(dx, dz) {
    const p = foe.root.position
    p.x = THREE.MathUtils.clamp(p.x + dx, -COURT.HALF_WIDTH + MARGIN, COURT.HALF_WIDTH - MARGIN)
    p.z = THREE.MathUtils.clamp(p.z + dz, BASELINE_Z + MARGIN, BASELINE_Z + COURT.HALF_LENGTH - MARGIN)
  }

  // 轉身往 target 跑：name 動作、scale 速度倍數（防守追人和搶籃板用 Run，運球用 Sprint）
  function runTo(delta, name = 'Run', scale = RUN_SCALE) {
    const p = foe.root.position
    turnTowards(Math.atan2(target.x - p.x, target.z - p.z), delta)
    setClip(name, scale)
    const v = MOVE_SPEEDS[name] * scale
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

  // from 到籃框的直線上（前方）有沒有 blocker 擋著
  function laneClear(from, blocker, halfWidth = LANE_HALF_WIDTH) {
    const lx = rim.x - from.x
    const lz = rim.z - from.z
    const length = Math.hypot(lx, lz)
    const along = ((blocker.x - from.x) * lx + (blocker.z - from.z) * lz) / length
    if (along < 0 || along > length) return true
    return Math.abs((blocker.x - from.x) * lz - (blocker.z - from.z) * lx) / length > halfWidth
  }

  // 出手誤差的倍數：防守者 defender 在出手點 from 和籃框之間、越近越大；jumping 防守者跳起來了
  function contestBy(defender, from, jumping, range = CONTEST_RANGE, max = CONTEST_MAX) {
    let k = THREE.MathUtils.clamp((range - flat(defender, from)) / (range - CONTEST_FULL), 0, 1)
    const front = (defender.x - from.x) * (rim.x - from.x) + (defender.z - from.z) * (rim.z - from.z) > 0
    if (!front) k *= 0.3
    else if (jumping && k > 0) k = Math.min(1, k + CONTEST_JUMP)
    return 1 + max * k
  }

  // ---------- 對手防守 ----------
  function guard(delta, state) {
    const player = state.position
    seenBefore.copy(seen)
    seen.lerp(player, Math.min(1, delta / REACTION))
    const p = foe.root.position
    if (state.ball) {
      chase(delta, state)
      return
    }
    // 被突破晃到：愣在原地
    if (stun > 0) {
      stun -= delta
      setClip('Defense')
      return
    }
    // 玩家跳投：夠近就跳起來干擾，每球一次
    if (state.shooting === 'jump' && !jumped && flat(player, p) < CONTEST_RANGE) {
      jumped = true
      mode = 'contest'
      clip = null
      setClip('Rebound', 1, CONTEST_FROM)
      return
    }
    const speed = seen.distanceTo(seenBefore) / delta
    aim.copy(seen).addScaledVector(seenBefore.sub(seen), -LEAD / delta)
    guardSpot(aim, GUARD_GAP + SAG * speed)
    running = flat(target, p) > (running ? 0.6 : RECOVER_FROM)
    if (running) runTo(delta)
    else slideTo(player, delta)
    keepApart(player)
  }

  // 球離手後去搶：判定完再等 REBOUND_WAIT 秒才往球跑，到了腳邊就撿起來
  function chase(delta, state) {
    const ball = state.ball
    const p = foe.root.position
    looseFor = ball.judged ? looseFor + delta : 0
    target.set(ball.position.x + ball.velocity.x * 0.3, 0, ball.position.z + ball.velocity.z * 0.3)
    const d = flat(ball.position, p)
    if (looseFor > REBOUND_WAIT && d > 0.4) runTo(delta)
    else {
      turnTowards(Math.atan2(ball.position.x - p.x, ball.position.z - p.z), delta)
      setClip('Defense')
    }
    keepApart(state.position)
    if (looseFor > REBOUND_WAIT && !state.shooting && ball.position.y < PICKUP_HEIGHT && d < PICKUP_RADIUS) {
      controls.takeBall()
      if (offense === 'you') deadBall('foe', '對手搶到籃板，換對手進攻')
      else {
        // 進攻籃板：繼續進攻
        foeBall.visible = true
        mode = 'dribble'
        think = 0.3
        clock = 0
        looseFor = 0
      }
    }
  }

  // ---------- 對手進攻 ----------
  function dribble(delta, state) {
    const p = foe.root.position
    clock += delta
    think -= delta
    if (think <= 0) {
      think = FOE_THINK
      if (decide(state)) return
    }
    target.set(rim.x + Math.sin(spotAngle) * spotRadius, 0, rim.z + Math.cos(spotAngle) * spotRadius)
    if (flat(target, p) > 0.3) runTo(delta, 'Sprint', FOE_SPRINT_SCALE)
    else {
      turnTowards(facingRim(), delta)
      setClip('Dribble')
    }
    keepApart(state.position)
  }

  // 決定下一步：切入、跳投，或換個位置繼續找機會。開始投籃動作了就回傳 true
  function decide(state) {
    const p = foe.root.position
    const player = state.position
    const dRim = flat(rim, p)
    const dPlayer = flat(player, p)
    if (dRim < 6 && dRim > 2.2 && laneClear(p, player, GUARD_LANE_HALF_WIDTH)) {
      let name = dPlayer > FOE_DUNK_CLEAR && Math.random() < 0.5 ? 'Dunk' : 'Layup'
      let plan = controls.drivePlan(name, p)
      if (plan === 'near' && name === 'Dunk') {
        name = 'Layup'
        plan = controls.drivePlan(name, p)
      }
      if (plan === 'far') {
        // 還太遠：直直往籃框跑，馬上再判斷
        spotAngle = Math.atan2(p.x - rim.x, p.z - rim.z)
        spotRadius = 1.5
        think = 0.1
        return false
      }
      if (plan !== 'near') {
        startShot(name, plan.start, plan.heading, plan.air)
        return true
      }
    }
    const open = dPlayer > FOE_OPEN && Math.random() < FOE_SHOOT_CHANCE
    if (dRim < FOE_SHOT_RANGE && (open || clock > FOE_SHOT_CLOCK || dRim <= 2.2)) {
      startShot('jump', SHOT_START, facingRim(), 0)
      return true
    }
    // 繼續繞：偶爾換邊，慢慢往裡面靠
    const angle = Math.atan2(p.x - rim.x, p.z - rim.z)
    if (Math.abs(angle) > 1) side = angle > 0 ? -1 : 1
    else if (Math.random() < 0.35) side = -side
    spotAngle = THREE.MathUtils.clamp(angle + side * (0.4 + Math.random() * 0.4), -1.1, 1.1)
    spotRadius = Math.max(4.2, Math.min(dRim, 6.5) - 0.6)
    return false
  }

  function startShot(kind, time, heading, air) {
    mode = 'shot'
    shot = { kind, time, air, spot: foe.root.position.clone(), released: false }
    foe.root.rotation.y = heading
    setClip(kind === 'jump' ? 'Shoot' : kind, 1, time)
  }

  // 投籃動作中：上籃、灌籃照 practice.js 的方式移動；到出手那一格把球交給物理，動作做完去搶籃板
  function updateShot(delta, state) {
    const drive = DRIVES[shot.kind]
    shot.time += delta
    if (drive) {
      let v = MOVE_SPEEDS.Sprint
      if (shot.time >= DRIVE_TAKEOFF) v = shot.air * THREE.MathUtils.clamp(1 - (shot.time - drive.land) / DRIVE_BRAKE, 0, 1)
      const a = foe.root.rotation.y
      moveBy(Math.sin(a) * v * delta, Math.cos(a) * v * delta)
    }
    if (!shot.released && shot.time >= (drive ? drive.release : SHOOT_RELEASE)) release(state)
    if (shot.time >= (drive ? drive.length : SHOOT_LENGTH) - 1e-3) {
      mode = 'loose'
      shot = null
    }
  }

  function release(state) {
    const p = foe.root.position
    const heading = foe.root.rotation.y
    const from = locals[shot.kind].clone().applyAxisAngle(UP, heading).add(p)
    const player = state.position
    const front = (player.x - p.x) * (rim.x - p.x) + (player.z - p.z) * (rim.z - p.z) > 0
    const contest = contestBy(player, from, state.jumping, GUARD_CONTEST_RANGE, GUARD_CONTEST_MAX)
    let velocity
    let scored = false
    if (state.jumping && front && flat(player, p) < BLOCK_RANGE) {
      // 火鍋：球往旁邊彈出去
      const a = heading + Math.PI + (Math.random() - 0.5) * 2
      velocity = new THREE.Vector3(Math.sin(a) * 3, 2, Math.cos(a) * 3)
      onMessage('火鍋！')
    } else if (shot.kind === 'Dunk') {
      velocity = new THREE.Vector3(Math.sin(heading) * 0.3, -2.5, Math.cos(heading) * 0.3)
      scored = true
    } else {
      const angle = controls.shotAngle(from)
      const ideal = physics.idealSpeed(from, angle) ?? 9
      const error = shot.kind === 'Layup' ? LAYUP_ERROR : FOE_SHOT_ERROR
      velocity = (shot.kind === 'Layup' && physics.bankShotVelocity(from)) || physics.launchVelocity(from, angle, ideal)
      velocity.multiplyScalar(1 + gauss() * error.speed * contest)
      velocity.applyAxisAngle(UP, THREE.MathUtils.degToRad(gauss() * error.side * contest))
    }
    shot.released = true
    foeBall.visible = false
    looseFor = 0
    controls.foeShot({ kind: shot.kind, spot: shot.spot, from, velocity, scored })
  }

  // 玩家或對手每投一球的結果（practice.js 的 onResult）。回傳這球得幾分
  function result({ made, spot, by }) {
    if (!made || phase !== 'play') return 0
    const points = beyondArc(spot, rim) ? 2 : 1
    score[by] += points
    onScore({ ...score, offense })
    if (score[by] >= WIN_SCORE) {
      phase = 'over'
      mode = 'idle'
      foeBall.visible = false
      setClip(by === 'you' ? 'Frustrated' : 'Celebrate')
      onEnd(by)
    } else deadBall(by === 'you' ? 'foe' : 'you')
    return points
  }

  function update(delta, paused) {
    if (!foe || paused || delta <= 0) return
    delta = Math.min(delta, 0.1)
    if (phase === 'dead') {
      wait -= delta
      if (wait <= 0) begin(next)
      return
    }
    if (phase !== 'play') return
    const state = controls.state()
    if (offense === 'foe' && state.hasBall) {
      // 玩家拿到球了（搶到籃板；抄球在 rules.steal 已經處理）
      deadBall('you', '搶到籃板，換你進攻')
    } else if (mode === 'guard') {
      // 玩家搶到進攻籃板：繼續防守，可以再跳一次
      if (state.hasBall && !state.shooting) jumped = false
      guard(delta, state)
    } else if (mode === 'contest') {
      if (foe.actionTime() >= CONTEST_TO) mode = 'guard'
    } else if (mode === 'dribble') dribble(delta, state)
    else if (mode === 'shot') updateShot(delta, state)
    else if (mode === 'loose' && state.ball) chase(delta, state)
  }

  // 再來一場
  function restart() {
    score.you = 0
    score.foe = 0
    begin('you')
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
    // 對手擋在玩家到籃框的直線上就不能上籃、灌籃
    laneOpen: () => laneClear(controls.state().position, foe.root.position),
    dunkOpen: () => flat(controls.state().position, foe.root.position) > DUNK_CLEAR,
    contest: (from) => contestBy(foe.root.position, from, mode === 'contest'),
    // 玩家突破：對手在附近就愣一下
    onBurst() {
      if (mode === 'guard' && flat(controls.state().position, foe.root.position) < BURST_RANGE) stun = BURST_STUN
    },
    // 玩家伸手抄球：對手運球中、夠近才有機會
    steal() {
      if (phase !== 'play' || mode !== 'dribble') return false
      if (flat(controls.state().position, foe.root.position) > STEAL_RANGE || Math.random() > STEAL_CHANCE) return false
      deadBall('you', '抄截成功！換你進攻')
      return true
    },
    defending: () => offense === 'foe',
    faceTarget: () => (offense === 'foe' && foe ? foe.root.position : null),
    fixedCamera: CAMERA,
  }

  return { start, update, result, restart, rules }
}
