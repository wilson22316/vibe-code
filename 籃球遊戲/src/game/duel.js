// 1 對 1：玩家和 AI 對手輪流進攻。街頭規則：三分線內進球 1 分、線外 2 分，先得 WIN_SCORE 分獲勝；進球後換對方進攻。
// 進球、出界、進攻超時後回到三分線弧頂重新開球。
// 防守籃板、抄截不停球：拿到球的人要先把球帶出三分線（清球）才能出手。球或運球的人過了邊線、底線算出界，換對方開球。
// 對手防守：站在玩家和籃框之間跟著滑步，玩家跳投時跳起來干擾，沒進的球去搶籃板。
// 對手進攻：運球找位置，有空檔就跳投、切入路線沒人就上籃或灌籃。玩家防守時可以抄球（D）、跳起來封蓋和搶籃板（空白鍵）。
// 玩家的操控在 practice.js，這裡用它的 rules 和 state() 接上；對手出手的球也交給它的物理和判定（foeShot）。
import * as THREE from 'three'
import { COURT } from './court.js'
import { MOVE_SPEEDS, NIGHT_BASKET_Z } from '../gallery/scene.js'
import { attachFire } from './fire.js'
import { DRIVES, DRIVE_BRAKE, DRIVE_TAKEOFF, JUMP_START as SHOT_START, LAYUP_ERROR, SHOOT_LENGTH, SHOOT_RELEASE } from './practice.js'

// ===== 可以調整的參數 =====
export const WIN_SCORE = 11
// 進攻時間（秒）：拿球後要在這之內出手，不然球權換給對方；搶到進攻籃板重新算
export const SHOT_CLOCK = 12
// 著火：連續進這麼多球（中間對手沒得分）就著火，出手誤差乘 FIRE_ERROR、判定區變寬、球和腳邊帶火光；對手一得分就熄掉
const FIRE_STREAK = 3
const FIRE_ERROR = 0.6
// 著火時玩家蓄力條的 PERFECT、GOOD 判定區變成幾倍寬（好抓很多）
const FIRE_ZONE = 1.6

// 難度：會隨難度變的參數。下面註解裡提到的 REACTION、RUN_SCALE 等就是這裡對應的項目——
//   reaction 對手看到的是玩家幾秒前的位置、runScale 追人和搶籃板的速度（Run 3.345 m/s 的幾倍）、
//   contestMax 對手干擾玩家出手的強度、reboundWait 球彈出來後對手隔幾秒才去搶、
//   foeSprint 對手運球的速度（Sprint 2.843 m/s 的幾倍）、think 對手每幾秒決定一次要做什麼、
//   shootChance 有空檔時每次決定跳投的機率、shotError 對手跳投的隨機誤差（標準差）、
//   stealChance 玩家抄球成功的機率、foeSteal 對手每次伸手抄到球的機率
export const LEVELS = {
  easy: { label: '簡單', reaction: 0.42, runScale: 0.95, contestMax: 1.5, reboundWait: 0.9, foeSprint: 0.85, think: 0.9, shootChance: 0.4, shotError: { speed: 0.04, side: 2.8 }, stealChance: 0.7, foeSteal: 0.05 },
  normal: { label: '普通', reaction: 0.3, runScale: 1.1, contestMax: 2.5, reboundWait: 0.6, foeSprint: 0.95, think: 0.7, shootChance: 0.5, shotError: { speed: 0.028, side: 2 }, stealChance: 0.55, foeSteal: 0.12 },
  hard: { label: '困難', reaction: 0.2, runScale: 1.3, contestMax: 4, reboundWait: 0.3, foeSprint: 1.15, think: 0.5, shootChance: 0.6, shotError: { speed: 0.018, side: 1.3 }, stealChance: 0.4, foeSteal: 0.2 },
}

// --- 對手防守 ---
// 防守位置：玩家往籃框方向 GUARD_GAP m；對手看到的是玩家 REACTION 秒前的位置（越大越容易被晃過）。
// 玩家移動時，對手預判他 LEAD 秒後的位置，並且每 1 m/s 多退 SAG m（退著防切入，所以急停跳投比較有空檔）
const GUARD_GAP = 1.2
const LEAD = 0.15
const SAG = 0.15
// 滑步最快是 DefenseSlide 原本速度（1.289 m/s）的幾倍；離防守位置超過 RECOVER_FROM m 就轉身跑回去，
// 跑的速度是 Run（3.345 m/s）的 RUN_SCALE 倍（玩家衝刺約 5 m/s）
const SLIDE_SCALE_MAX = 1.7
const RECOVER_FROM = 1.5
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
const CONTEST_JUMP = 0.3
// 球判定完（碰框彈出來）後，對手隔幾秒才去搶

// 對手抄球：玩家運球（不是突破中）時離他 FOE_STEAL_RANGE m 內，每 FOE_STEAL_EVERY 秒伸手一次（成功機率見 LEVELS 的 foeSteal）
const FOE_STEAL_RANGE = 1.0
const FOE_STEAL_EVERY = 1.2
const FOE_REACH = 0.35 // 伸手的動作多久（秒）
// 玩家搶到防守籃板或抄到球時，對手愣住幾秒才開始防守
const TURNOVER_STUN = 0.5

// --- 玩家防守 ---
// 抄球：對手運球中、離他 STEAL_RANGE m 內按 D，有 STEAL_CHANCE 的機率抄到
const STEAL_RANGE = 1.6
// 封蓋：對手出手那一刻玩家正在跳（從按下空白鍵到落地，約 0.67 秒）、在他前方 BLOCK_RANGE m 內就蓋掉
const BLOCK_RANGE = 1.8
// 玩家干擾對手出手的範圍和強度（同上面的 CONTEST_RANGE、CONTEST_MAX，放寬讓防守比較有用）
const GUARD_CONTEST_RANGE = 2.4
const GUARD_CONTEST_MAX = 5
// 玩家在對手到籃框的直線兩側這麼寬以內，對手就不切入（比玩家切入的 LANE_HALF_WIDTH 寬，站在前面就擋得住）
const GUARD_LANE_HALF_WIDTH = 1.0

// --- 對手進攻 ---
// 運球移動的速度是 Sprint（2.843 m/s）的幾倍；每 FOE_THINK 秒決定一次要做什麼
// 玩家離對手超過 FOE_OPEN m 算有空檔，離籃框 FOE_SHOT_RANGE m 內每次決定有 FOE_SHOOT_CHANCE 的機率跳投；
// 拿球超過 FOE_SHOT_CLOCK 秒就算沒空檔也出手
const FOE_OPEN = 1.6
const FOE_SHOT_RANGE = 7.2
const FOE_SHOT_CLOCK = 8
// 對手跳投的隨機誤差（標準差，同 practice.js 的 SHOT_ERROR）；沒被干擾時比玩家的 GOOD 差一些
// 對手離玩家超過這個距離時，切入有一半機率灌籃
const FOE_DUNK_CLEAR = 2.5

// 換球權後隔幾秒重新開球；進球後多等一下，讓慶祝動作做完
const NEXT_DELAY = 1.8
const SCORE_DELAY = 2.8
// =========================

// 固定鏡頭：在球場後上方往籃框看（跟拍的話攻守轉換時畫面一直轉，會暈）。
// CAMERA_BACK 鏡頭在籃框前方幾 m（越小越近、角色越大，太小的話三分線弧頂和兩側底角會跑出畫面）、
// CAMERA_HEIGHT 鏡頭高度（越高越俯視）、CAMERA_LOOK 鏡頭看向籃框前方幾 m 的地面附近（越小畫面越往籃框那邊移）
const CAMERA_BACK = 12
const CAMERA_HEIGHT = 4.5
const CAMERA_LOOK = 3
const CAMERA = {
  position: new THREE.Vector3(0, CAMERA_HEIGHT, NIGHT_BASKET_Z + CAMERA_BACK),
  target: new THREE.Vector3(0, 1, NIGHT_BASKET_Z + CAMERA_LOOK),
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

const newStats = () => ({ shots: 0, makes: 0, twos: 0, blocks: 0, steals: 0, rebounds: 0 })

// onScore({ you, foe, offense, fire: { you, foe } }) 分數、球權或著火狀態變了；onMessage(text) 要顯示的訊息（抄截、火鍋、籃板）；
// onMoment(kind) 值得做演出的瞬間（'block' 火鍋、'fire' 有人著火）；onSound(name, ...args) 要播音效；
// onEnd(winner, stats) 有人得到 WIN_SCORE 分（winner 是 'you' 或 'foe'；stats 是雙方的數據，見 newStats）
export function createDuel({
  onScore = () => {},
  onMessage = () => {},
  onMoment = () => {},
  onSound = () => {},
  onEnd = () => {},
} = {}) {
  let L = LEVELS.normal
  const stats = { you: newStats(), foe: newStats() }
  const streak = { you: 0, foe: 0 } // 連續進幾球（對手得分就歸零）
  let shotClock = SHOT_CLOCK
  let ticked = 0 // 進攻時間上次滴答是剩幾秒的時候
  let hadBall = true // 玩家上一格手上有沒有球
  let missed = false // 有一球沒進、還沒被撿走（算籃板用）
  let foeBallLow = false // 對手的球上一格是不是在地板附近（聽運球聲用）
  const ballWorld = new THREE.Vector3()
  const report = () => onScore({ ...score, offense, clear: needClear, fire: { you: streak.you >= FIRE_STREAK, foe: streak.foe >= FIRE_STREAK } })
  let foe = null
  let foeBall = null // 對手手上的球（模型裡的球）
  let foeFire = null // 對手著火時的火光
  let fireTime = 0
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
  let needClear = false // 進攻方還沒把球帶出三分線
  let stealWait = 0 // 對手多久後可以再伸手抄球
  let reachLeft = 0 // 對手伸手抄球的動作還剩幾秒
  let denied = 0 // 上次提醒「先清球」是什麼時候（免得一直跳訊息）
  let looseFor = 0 // 球判定完多久了
  let think = 0
  let clock = 0 // 對手這次拿球多久了
  let side = 1 // 對手運球往哪一邊繞
  let spotAngle = 0 // 對手要去的位置：以籃框為圓心的角度和半徑
  let spotRadius = 6.5
  let shot = null // 對手的投籃動作：{ kind, time, air, spot, released }
  const seen = new THREE.Vector3() // 對手看到的玩家位置（落後 L.reaction 秒）
  const seenBefore = new THREE.Vector3()
  const aim = new THREE.Vector3()
  const target = new THREE.Vector3()
  const to = new THREE.Vector3()
  const assist = new THREE.Vector3()

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
    foeFire = attachFire(foeBall, foe.root)
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
    shotClock = SHOT_CLOCK
    ticked = 0
    missed = false
    needClear = false
    stealWait = FOE_STEAL_EVERY
    hadBall = who === 'you'
    if (Math.max(score.you, score.foe) >= WIN_SCORE - 1) onSound('alert') // 賽末點
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
    report()
  }

  // 不停球的攻守轉換（防守籃板、抄截）：who 拿到球，要先帶出三分線才能出手
  function takeOver(who, message) {
    offense = who
    needClear = !beyondArc(who === 'you' ? controls.state().position : foe.root.position, rim)
    shotClock = SHOT_CLOCK
    ticked = 0
    missed = false
    jumped = false
    running = false
    looseFor = 0
    shot = null
    hadBall = who === 'you'
    if (who === 'you') {
      foeBall.visible = false
      mode = 'guard'
      stun = TURNOVER_STUN
      stealWait = FOE_STEAL_EVERY
      seen.copy(controls.state().position)
    } else {
      foeBall.visible = true
      mode = 'dribble'
      think = 0.4
      clock = 0
    }
    if (message) onMessage(message)
    report()
  }

  const outside = (p) => Math.abs(p.x) > COURT.HALF_WIDTH || p.z < BASELINE_Z

  // 死球：隔 delay 秒後由 who 重新開球；foeClip 是對手這段時間做的動作
  function deadBall(who, message, delay = NEXT_DELAY, foeClip = 'Idle') {
    phase = 'dead'
    next = who
    wait = delay
    mode = 'idle'
    foeBall.visible = false
    setClip(foeClip)
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
  function runTo(delta, name = 'Run', scale = L.runScale) {
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
  function contestBy(defender, from, jumping, range = CONTEST_RANGE, max = L.contestMax) {
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
    seen.lerp(player, Math.min(1, delta / L.reaction))
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
    // 玩家運球時貼得夠近就伸手抄球（突破中抄不到）
    stealWait -= delta
    if (state.hasBall && !state.shooting && !state.bursting && stealWait <= 0 && flat(player, p) < FOE_STEAL_RANGE) {
      stealWait = FOE_STEAL_EVERY
      clip = null
      setClip('Catch', 1, 2 / 24)
      if (Math.random() < L.foeSteal) {
        controls.loseBall()
        stats.foe.steals++
        onSound('steal')
        takeOver('foe', '被抄截了！')
      } else {
        mode = 'reach'
        reachLeft = FOE_REACH
      }
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

  // 球離手後去搶：判定完再等 L.reboundWait 秒才往球跑，到了腳邊就撿起來
  function chase(delta, state) {
    const ball = state.ball
    const p = foe.root.position
    looseFor = ball.judged ? looseFor + delta : 0
    target.set(ball.position.x + ball.velocity.x * 0.3, 0, ball.position.z + ball.velocity.z * 0.3)
    const d = flat(ball.position, p)
    if (looseFor > L.reboundWait && d > 0.4) runTo(delta)
    else {
      turnTowards(Math.atan2(ball.position.x - p.x, ball.position.z - p.z), delta)
      setClip('Defense')
    }
    keepApart(state.position)
    if (looseFor > L.reboundWait && !state.shooting && ball.position.y < PICKUP_HEIGHT && d < PICKUP_RADIUS) {
      controls.takeBall()
      if (missed) stats.foe.rebounds++
      missed = false
      if (offense === 'you') takeOver('foe', '對手搶到籃板！')
      else {
        // 進攻籃板：繼續進攻，進攻時間重新算
        shotClock = SHOT_CLOCK
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
    // 還沒清球：先往最近的三分線外跑
    if (needClear) {
      const angle = THREE.MathUtils.clamp(Math.atan2(p.x - rim.x, p.z - rim.z), -1, 1)
      const radius = COURT.THREE_RADIUS + 0.7
      target.set(rim.x + Math.sin(angle) * radius, 0, rim.z + Math.cos(angle) * radius)
      runTo(delta, 'Sprint', L.foeSprint)
      keepApart(state.position)
      return
    }
    think -= delta
    if (think <= 0) {
      think = L.think
      if (decide(state)) return
    }
    target.set(rim.x + Math.sin(spotAngle) * spotRadius, 0, rim.z + Math.cos(spotAngle) * spotRadius)
    if (flat(target, p) > 0.3) runTo(delta, 'Sprint', L.foeSprint)
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
    const open = dPlayer > FOE_OPEN && Math.random() < L.shootChance
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
      stats.you.blocks++
      onMessage('火鍋！')
      onSound('block')
      onMoment('block')
    } else if (shot.kind === 'Dunk') {
      velocity = new THREE.Vector3(Math.sin(heading) * 0.3, -2.5, Math.cos(heading) * 0.3)
      scored = true
    } else {
      const angle = controls.shotAngle(from)
      const ideal = physics.idealSpeed(from, angle) ?? 9
      const error = shot.kind === 'Layup' ? LAYUP_ERROR : L.shotError
      velocity = (shot.kind === 'Layup' && physics.bankShotVelocity(from)) || physics.launchVelocity(from, angle, ideal)
      const k = contest * rules.accuracy('foe')
      velocity.multiplyScalar(1 + gauss() * error.speed * k)
      velocity.applyAxisAngle(UP, THREE.MathUtils.degToRad(gauss() * error.side * k))
    }
    shot.released = true
    foeBall.visible = false
    looseFor = 0
    controls.foeShot({ kind: shot.kind, spot: shot.spot, from, velocity, scored })
  }

  // 玩家或對手每投一球的結果（practice.js 的 onResult）。回傳這球得幾分
  function result({ made, spot, by }) {
    if (phase !== 'play') return 0
    stats[by].shots++
    if (!made) {
      missed = true
      return 0
    }
    const other = by === 'you' ? 'foe' : 'you'
    const points = beyondArc(spot, rim) ? 2 : 1
    score[by] += points
    stats[by].makes++
    if (points === 2) stats[by].twos++
    streak[by]++
    streak[other] = 0
    if (streak[by] === FIRE_STREAK) {
      onSound('fire')
      onMoment('fire')
    }
    onSound(by === 'you' ? 'cheer' : 'groan')
    report()
    // 得分的人慶祝、被得分的人沮喪
    const foeClip = by === 'you' ? 'Frustrated' : 'Celebrate'
    controls.playEmote(by === 'you' ? 'Celebrate' : 'Frustrated')
    if (score[by] >= WIN_SCORE) {
      phase = 'over'
      mode = 'idle'
      foeBall.visible = false
      setClip(foeClip)
      onSound('buzzer')
      onSound(by === 'you' ? 'win' : 'lose')
      onEnd(by, stats)
    } else deadBall(other, null, SCORE_DELAY, foeClip)
    return points
  }

  // 進攻時間：進攻方拿著球時倒數（投籃動作中、球在空中不算），剩 3 秒起每秒滴答，歸零就換球權
  function runShotClock(delta, state) {
    const live = offense === 'you' ? state.hasBall && !state.shooting : mode === 'dribble'
    if (!live) return
    shotClock -= delta
    const left = Math.ceil(shotClock)
    if (left <= 3 && left >= 1 && left !== ticked) {
      ticked = left
      onSound('tick')
    }
    if (shotClock <= 0) {
      shotClock = 0
      onSound('buzzer')
      deadBall(offense === 'you' ? 'foe' : 'you', offense === 'you' ? '進攻超時，換對手進攻' : '對手進攻超時，換你進攻')
    }
  }

  // 對手的運球聲：手上的球掉到地板附近的那一格響一聲
  function listenDribble() {
    const low = foeBall.visible && foeBall.getWorldPosition(ballWorld).y < 0.18
    if (low && !foeBallLow) onSound('bounce', 0.6)
    foeBallLow = low
  }

  function update(delta, paused) {
    if (!foe || paused || delta <= 0) return
    delta = Math.min(delta, 0.1)
    fireTime += delta
    foeFire(streak.foe >= FIRE_STREAK, fireTime)
    if (phase === 'dead') {
      wait -= delta
      if (wait <= 0) begin(next)
      return
    }
    if (phase !== 'play') return
    const state = controls.state()
    listenDribble()
    // 玩家剛撿到沒進的球：算一個籃板；自己進攻時撿到的話進攻時間重新算
    if (state.hasBall && !hadBall) {
      if (missed) stats.you.rebounds++
      missed = false
      if (offense === 'you') shotClock = SHOT_CLOCK
    }
    hadBall = state.hasBall
    runShotClock(delta, state)
    if (phase !== 'play') return
    // 清球：拿球的人到了三分線外
    if (needClear && beyondArc(offense === 'you' ? state.position : foe.root.position, rim) && (offense === 'you' ? state.hasBall : mode === 'dribble')) {
      needClear = false
      report()
    }
    if (offense === 'you' && state.hasBall && !state.shooting && outside(state.position)) {
      onSound('whistle')
      deadBall('foe', '踩出界了，換對手進攻')
    } else if (offense === 'foe' && state.hasBall) {
      // 玩家拿到球了（搶到籃板；抄球在 rules.steal 已經處理）：不停球，換玩家進攻
      takeOver('you', '搶到籃板！')
    } else if (mode === 'guard') {
      // 玩家搶到進攻籃板：繼續防守，可以再跳一次
      if (state.hasBall && !state.shooting) jumped = false
      guard(delta, state)
    } else if (mode === 'contest') {
      if (foe.actionTime() >= CONTEST_TO) mode = 'guard'
    } else if (mode === 'dribble') dribble(delta, state)
    else if (mode === 'shot') updateShot(delta, state)
    else if (mode === 'loose' && state.ball) chase(delta, state)
    else if (mode === 'reach') {
      reachLeft -= delta
      if (reachLeft <= 0) mode = 'guard'
    }
  }

  // 重播用：記下對手這一格的位置、方向、動作、手上有沒有球；restore 擺回去（往下一格 b 內插 k，resume 之後照常播）
  function snapshot() {
    const p = foe.root.position
    return { x: p.x, z: p.z, turn: foe.root.rotation.y, clip, time: foe.actionTime(), ball: foeBall.visible }
  }

  function restore(a, b = a, k = 0, resume = false) {
    const same = b.clip === a.clip && b.time >= a.time
    foe.root.position.set(a.x + (b.x - a.x) * k, 0, a.z + (b.z - a.z) * k)
    foe.root.rotation.y = a.turn + wrapAngle(b.turn - a.turn) * k
    if (a.clip) foe.play(a.clip, 0, resume ? 1 : 0, same ? a.time + (b.time - a.time) * k : a.time)
    foeBall.visible = a.ball
  }

  // 再來一場
  function restart() {
    for (const who of ['you', 'foe']) {
      score[who] = 0
      streak[who] = 0
      stats[who] = newStats()
    }
    controls.rest()
    begin('you')
  }

  // 換難度（easy、normal、hard）；下一格就生效
  function setLevel(name) {
    L = LEVELS[name] ?? LEVELS.normal
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
      if (flat(controls.state().position, foe.root.position) > STEAL_RANGE || Math.random() > L.stealChance) return false
      stats.you.steals++
      onSound('steal')
      takeOver('you', '抄截成功！')
      return true
    },
    // 還沒清球不能出手；按了就提醒一次
    canShoot: () => !(offense === 'you' && needClear),
    onDenied() {
      if (performance.now() - denied < 1500) return
      denied = performance.now()
      onMessage('先把球帶出三分線')
    },
    // 出界：球過了邊線或底線，換出手那個人的對手開球
    bounds: true,
    onBallOut(by) {
      if (phase !== 'play') return
      onSound('whistle')
      controls.takeBall()
      deadBall(by === 'you' ? 'foe' : 'you', by === 'you' ? '球出界，換對手進攻' : '球出界，換你進攻')
    },
    stamina: true,
    // 著火的人出手比較準、球帶火光
    accuracy: (by) => (streak[by] >= FIRE_STREAK ? FIRE_ERROR : 1),
    onFire: (by) => streak[by] >= FIRE_STREAK,
    zoneScale: () => (streak.you >= FIRE_STREAK ? FIRE_ZONE : 1),
    defending: () => offense === 'foe',
    faceTarget: () => (offense === 'foe' && foe ? foe.root.position : null),
    // 防守輔助：對手拿球時，站在他往籃框方向 GUARD_GAP m 的地方
    guardSpot() {
      if (offense !== 'foe' || phase !== 'play' || (mode !== 'dribble' && mode !== 'shot')) return null
      const p = foe.root.position
      const d = flat(rim, p)
      return assist.set(p.x + ((rim.x - p.x) / d) * Math.min(GUARD_GAP, d * 0.5), 0, p.z + ((rim.z - p.z) / d) * Math.min(GUARD_GAP, d * 0.5))
    },
    fixedCamera: CAMERA,
  }

  return { start, update, result, restart, setLevel, snapshot, restore, rules, shotClock: () => shotClock }
}
