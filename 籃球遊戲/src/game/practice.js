// 練習模式的操控：方向鍵移動、按住 A 衝刺、按下空白鍵起跳、按住時力道上升、放開出手（衝向籃框時上籃、灌籃），投完空手走過去撿球；依移動狀態切換運球動作，鏡頭在角色背後跟拍、朝向籃框。
// 移動方向以鏡頭為準：↑ 是往籃框的方向，← → 繞著籃框橫移，↓ 往鏡頭走。
// 角色只往自己面向的方向前進（速度照各動作的 MOVE_SPEEDS，腳才不會打滑），轉向時邊走邊轉。
import * as THREE from 'three'
import { COURT } from './court.js'
import { BALL_RADIUS, createBallPhysics } from './ballPhysics.js'
import { MOVE_SPEEDS, NIGHT_BASKET_Z } from '../gallery/scene.js'

// ===== 可以調整的參數 =====
// 衝刺速度倍數：1 是動作原本的 2.843 m/s。推動速度和動作播放速度一起乘上這個倍數，腳才不會打滑
// （倍數太大時跑步動作會變得很急促）。
export const SPRINT_SPEED_SCALE = 1.5
// 運球走路的速度倍數：1 是動作原本的 0.979 m/s，和衝刺一樣連動作播放速度一起乘
export const WALK_SPEED_SCALE = 2
// 投籃：仰角（離籃框 2 m 內用 NEAR、6 m 外用 FAR，中間線性變化；近距離弧度太平的話球進框的角度太斜，
// 會一直彈框）、出手速度範圍（CLAUDE.md：4～13 m/s）、按下空白鍵後力道條從 0 加到滿的秒數
const SHOT_ANGLE_NEAR = 62
const SHOT_ANGLE_FAR = 52
const SHOT_SPEED_MIN = 4
const SHOT_SPEED_MAX = 13
const CHARGE_SECONDS = 0.8
// 蓄力條的判定區：以理想力道為中心，往左右各多寬（蓄力條全長是 1）。
// 能放開的時間是「寬度 × CHARGE_SECONDS」：PERFECT 0.05 約 ±40 毫秒、GOOD 0.15 約 ±120 毫秒
const PERFECT_ZONE = 0.05
const GOOD_ZONE = 0.15
// 出手的隨機誤差（標準差）：speed 是出手速度的比例、side 是左右偏差（度）。
// 越小越容易進；miss 是放在判定區外，速度還會照力道條的位置偏多或偏少
const SHOT_ERROR = {
  perfect: { speed: 0.004, side: 0.3 },
  good: { speed: 0.012, side: 1.0 },
  miss: { speed: 0.012, side: 1.0 },
}
// 移動中投籃：起跳後保留多少比例的移動速度往前飄、最多幾 m/s
const JUMP_DRIFT = 0.5
const JUMP_DRIFT_MAX = 1.8
// 切入：往籃框移動（方向差 DRIVE_ANGLE 度內）、離籃框 DRIVE_RANGE m 內按空白鍵，走路是上籃、按住 A 衝刺是灌籃。
// ↑ 是往籃框後方的點走，靠近籃框時和「朝籃框」差很多，所以角度放寬；出手前角色會直接轉向籃框
const DRIVE_RANGE = 6
const DRIVE_ANGLE = 75
// 上籃打板的隨機誤差（標準差，同 SHOT_ERROR）；目前約 85% 會進。灌籃一定進
const LAYUP_ERROR = { speed: 0.05, side: 3 }
// =========================

const BASELINE_Z = NIGHT_BASKET_Z - COURT.BASKET_TO_BASELINE
const MARGIN = 0.3 // 離邊線、底線、中線保留的距離
const START = new THREE.Vector3(0, 0, NIGHT_BASKET_Z + 6.5) // 三分線弧頂內側
// 鏡頭朝向的點：籃框正後方 6 m。直接朝籃框的話，角色走到籃框旁邊時方向一下轉很大，鏡頭會亂轉；
// 朝後方的點，籃下最多只偏四十幾度，在場上各處都看得到籃框。
const AIM = new THREE.Vector3(0, 0, NIGHT_BASKET_Z - 6)

// 動作：站著原地運球、走路運球、衝刺運球、投籃（上籃、灌籃見 DRIVES）；沒有球時站著、慢跑、衝刺
const CLIPS = { stand: 'Dribble', walk: 'DribbleWalk', sprint: 'Sprint', shoot: 'Shoot' }
const NO_BALL = { stand: 'Idle', walk: 'Jog', sprint: 'Run' }
const PICKUP_RADIUS = 0.7 // 球心離角色多近（水平）就撿起來
const PICKUP_HEIGHT = 1.3 // 球心低於這個高度才撿得到
const PICKUP_FADE = 0.15
const FADE = 0.25
const SHOOT_FADE = 0.15
const SHOOT_RELEASE = 18 / 24 // CLAUDE.md：Shoot 第 18 格出手
const SHOOT_TAKEOFF = 12 / 24 // 第 12 格起跳、第 24 格落地
const SHOOT_LAND = 24 / 24
const SHOOT_LENGTH = 36 / 24
// 一按空白鍵就從第 6 格（球收到胸前）開始播，0.25 秒後起跳。按住時力道一直上升；
// 到第 16 格（快到最高點）還按著的話動作放慢（在空中多停一下），到第 18 格（出手那一格）還沒放開就自動出手，算太晚。
// 早放開的話動作快轉，CATCH_UP 秒內到第 18 格出手
const JUMP_START = 6 / 24
const HANG_FROM = 16 / 24
const HANG_SCALE = 0.2
const CATCH_UP = 0.1
const MOVING_SPEED = 0.4 // 按空白鍵時速度超過這個值就算移動中投籃
const STOP_EASE = 0.08 // 起跳前、落地後減速的時間常數（秒）
// 上籃、灌籃（CLAUDE.md 動作規格）：從 Sprint 接起，第 11 格前以 Sprint 速度推動（腳在地上），
// 空中速度由遊戲決定（讓出手時球剛好到目標點），落地後 4 格降到 0。
// reach：出手時球離籃框中心多遠（上籃在籃框前方打板；灌籃球在籃框正上方）
const DRIVES = {
  Layup: { release: 17 / 24, land: 22 / 24, length: 30 / 24, reach: 0.7 },
  Dunk: { release: 25 / 24, land: 35 / 24, length: 46 / 24, reach: 0 },
}
const DRIVE_TAKEOFF = 11 / 24
const DRIVE_BRAKE = 4 / 24
const DRIVE_FADE = 0.12
const AIR_SPEED_MIN = 0.3 // 空中推動速度的範圍（m/s）：離籃框太近或太遠就調不到
const AIR_SPEED_MAX = 3.5
const TURN_SPEED = 10 // 每秒轉幾弧度
const SPEED_EASE = 0.15 // 速度跟上動作的時間常數（秒），和淡入淡出差不多

// 鏡頭：在角色背後（AIM → 角色的延長線上）偏上，看向角色前方
// shotLift：球在空中時看的高度往上加多少，球飛到最高點才不會跑出畫面
const CAMERA = { fov: 50, back: 4.2, height: 2.3, lookAhead: 2.0, lookHeight: 1.2, shotLift: 1.3, ease: 0.12 }

const ARROWS = { ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }
const KEYS = new Set([...Object.keys(ARROWS), 'KeyA', 'Space'])

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a))
const speedToPower = (v) => (v - SHOT_SPEED_MIN) / (SHOT_SPEED_MAX - SHOT_SPEED_MIN)
const powerToSpeed = (p) => SHOT_SPEED_MIN + p * (SHOT_SPEED_MAX - SHOT_SPEED_MIN)
// 平均 0、標準差 1 的常態分布亂數
const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random())

// 力道條位置 power 相對理想力道 ideal 的判定：perfect、good、miss
export function gradeShot(power, ideal) {
  if (ideal === null) return 'miss'
  const d = Math.abs(power - ideal)
  return d <= PERFECT_ZONE ? 'perfect' : d <= GOOD_ZONE ? 'good' : 'miss'
}

// 出手速度是「理想速度 × 這個比例」：判定區內只有隨機誤差；判定區外再照力道條的位置偏多或偏少
export function shotSpeedRatio(grade, power, ideal) {
  const base = grade === 'miss' && ideal !== null ? powerToSpeed(power) / powerToSpeed(ideal) : 1
  return base * (1 + gauss() * SHOT_ERROR[grade].speed)
}

// 左右偏差（弧度）
export const shotSideError = (grade) => THREE.MathUtils.degToRad(gauss() * SHOT_ERROR[grade].side)

// onCharge({ power, ideal, perfect, good }) 蓄力中每格呼叫，放開時傳 null；
// onShot(grade) 出手時呼叫（perfect、good、miss、late 太晚自動出手、layup、dunk）；
// onResult({ made, message, shots, makes }) 每球判定後呼叫
export function createPracticeControls({ onCharge = () => {}, onShot = () => {}, onResult = () => {} } = {}) {
  let stage = null
  let character = null
  const physics = createBallPhysics(NIGHT_BASKET_Z)
  const held = new Set()
  let clip = null
  let speed = 0
  let cameraYaw = 0 // 鏡頭往前的方向（繞 Y 軸，0 是往 -Z）
  const cameraPos = new THREE.Vector3()
  const look = new THREE.Vector3()
  const goal = new THREE.Vector3()
  const rollAxis = new THREE.Vector3()
  let lift = 0

  // 投籃狀態：free 自由移動、drive 按了空白鍵、還在往籃框跑（到了距離就自動上籃或灌籃）、
  // shoot 跳投（按住蓄力中也是）、上籃、灌籃動作中（動作做完前不能操控）
  let mode = 'free'
  let chargeTime = 0
  let power = 0
  let shotTime = 0
  let releaseLocal = null // Shoot 出手那一格球在角色座標的位置
  const driveLocal = {} // 上籃、灌籃出手那一格球在角色座標的位置
  let shot = null // { kind: 'jump' | 'Layup' | 'Dunk', ball, from, judged, judgedAt, ... }；球撿回來之前都留著
  let hasBall = true // 動作做完後球還在場上滾的話是 false，要走過去撿
  let freeBall = null
  let shots = 0
  let makes = 0

  function onKeyDown(event) {
    if (!KEYS.has(event.code)) return
    event.preventDefault()
    if (event.repeat) return
    held.add(event.code)
    if (event.code === 'Space' && mode === 'free' && hasBall) {
      if (driving()) {
        mode = 'drive'
        updateDrive()
      } else startShot()
    }
  }
  function onKeyUp(event) {
    held.delete(event.code)
    if (event.code === 'Space' && shot?.holding) letGo(false)
  }
  // 切到別的視窗時放開所有按鍵，免得角色一直走；蓄力中就直接出手、切入中就取消
  function onBlur() {
    held.clear()
    if (shot?.holding) letGo(false)
    if (mode === 'drive') mode = 'free'
  }

  function start(gallery) {
    stage = gallery
    character = stage.getCharacter()
    releaseLocal = stage.sampleBall(CLIPS.shoot, SHOOT_RELEASE)
    for (const [name, drive] of Object.entries(DRIVES)) driveLocal[name] = stage.sampleBall(name, drive.release)
    const ball = stage.getBall()
    freeBall = ball.clone()
    freeBall.visible = false
    ball.getWorldScale(freeBall.scale)
    stage.scene.add(freeBall)

    character.position.copy(START)
    character.rotation.y = Math.PI // 面向籃框（-Z）
    cameraYaw = yawToAim()
    placeCamera(1)
    stage.camera.fov = CAMERA.fov
    stage.camera.updateProjectionMatrix()
    setClip(CLIPS.stand, 0)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
  }

  function stop() {
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('blur', onBlur)
    held.clear()
  }

  // 推動速度和動作播放速度的倍數
  // （沒有球的衝刺 Run 也乘衝刺倍數；慢跑 Jog 本來就和調快後的運球走路差不多快，不乘）
  const speedScale = (name) =>
    name === CLIPS.sprint || name === NO_BALL.sprint ? SPRINT_SPEED_SCALE : name === CLIPS.walk ? WALK_SPEED_SCALE : 1

  function setClip(name, fade = FADE, startAt = 0) {
    if (clip === name) return
    clip = name
    stage.play(name, fade, speedScale(name), startAt)
  }

  // 從角色往 AIM 的水平方向角（0 是往 -Z、往 -X 為正）
  function yawToAim() {
    return Math.atan2(-(AIM.x - character.position.x), -(AIM.z - character.position.z))
  }

  // 角色面向籃框時的角度（面向 +Z 是 0）
  function facingRim() {
    const rim = physics.rim
    return Math.atan2(rim.x - character.position.x, rim.z - character.position.z)
  }

  // 方向鍵換算成世界座標的移動方向（以鏡頭為準）；沒按就回傳 null
  function inputDirection() {
    let right = 0
    let forward = 0
    for (const code of held) {
      const arrow = ARROWS[code]
      if (arrow) {
        right += arrow[0]
        forward += arrow[1]
      }
    }
    if (!right && !forward) return null
    const fx = -Math.sin(cameraYaw)
    const fz = -Math.cos(cameraYaw)
    return new THREE.Vector3(fx * forward - fz * right, 0, fz * forward + fx * right).normalize()
  }

  function turnTowards(angle, delta) {
    const diff = wrapAngle(angle - character.rotation.y)
    const turn = Math.sign(diff) * Math.min(Math.abs(diff), TURN_SPEED * delta)
    character.rotation.y = wrapAngle(character.rotation.y + turn)
  }

  // 自由移動和蓄力中：方向鍵移動、按住 A 衝刺（投籃動作中由 updateShot 移動）
  function move(delta) {
    const dir = inputDirection()
    const set = hasBall ? CLIPS : NO_BALL
    setClip(dir ? (held.has('KeyA') ? set.sprint : set.walk) : set.stand)
    // 角色面向 +Z 時 rotation.y = 0，所以面向 (x, z) 的角度是 atan2(x, z)
    if (dir) turnTowards(Math.atan2(dir.x, dir.z), delta)

    let target = MOVE_SPEEDS[clip] ?? 0
    if (typeof target !== 'number') target = 0
    target *= speedScale(clip)
    speed += (target - speed) * Math.min(1, delta / SPEED_EASE)
    const a = character.rotation.y
    moveBy(Math.sin(a) * speed * delta, Math.cos(a) * speed * delta)
  }

  // 移動角色，並留在半場內
  function moveBy(dx, dz) {
    const p = character.position
    p.x = THREE.MathUtils.clamp(p.x + dx, -COURT.HALF_WIDTH + MARGIN, COURT.HALF_WIDTH - MARGIN)
    p.z = THREE.MathUtils.clamp(p.z + dz, BASELINE_Z + MARGIN, BASELINE_Z + COURT.HALF_LENGTH - MARGIN)
  }

  // 角色面向籃框時，出手那一格球的世界座標
  function releasePoint() {
    const local = releaseLocal.clone().applyAxisAngle(THREE.Object3D.DEFAULT_UP, facingRim())
    return local.add(character.position)
  }

  // 從 from 出手的仰角（弧度）
  function shotAngle(from) {
    const d = Math.hypot(physics.rim.x - from.x, physics.rim.z - from.z)
    const k = THREE.MathUtils.clamp((d - 2) / 4, 0, 1)
    return THREE.MathUtils.degToRad(THREE.MathUtils.lerp(SHOT_ANGLE_NEAR, SHOT_ANGLE_FAR, k))
  }

  function idealPower() {
    const from = releasePoint()
    const v = physics.idealSpeed(from, shotAngle(from))
    return v === null ? null : speedToPower(v)
  }

  // 按下空白鍵：轉向籃框、馬上起跳，按住時力道從 0 往上加。移動中的話起跳後帶著一部分速度往前飄
  function startShot() {
    const heading = character.rotation.y
    const drift = speed > MOVING_SPEED ? Math.min(speed * JUMP_DRIFT, JUMP_DRIFT_MAX) : 0
    mode = 'shoot'
    shotTime = JUMP_START
    chargeTime = 0
    power = 0
    character.rotation.y = facingRim()
    shot = {
      kind: 'jump',
      holding: true,
      grade: null,
      ratio: 1,
      side: 0,
      velocity: new THREE.Vector3(Math.sin(heading) * speed, 0, Math.cos(heading) * speed),
      drift: new THREE.Vector3(Math.sin(heading) * drift, 0, Math.cos(heading) * drift),
      ball: null,
      from: null,
      judged: false,
      judgedAt: 0,
    }
    speed = 0
    setClip(CLIPS.shoot, SHOOT_FADE, shotTime)
    onCharge({ power, ideal: idealPower(), perfect: PERFECT_ZONE, good: GOOD_ZONE })
  }

  // 按住中：力道上升；快到最高點時動作放慢（在空中多停一下），到出手那一格還按著就自動出手（太晚）
  function updateHold(delta) {
    chargeTime += delta
    power = Math.min(1, chargeTime / CHARGE_SECONDS)
    onCharge({ power, ideal: idealPower(), perfect: PERFECT_ZONE, good: GOOD_ZONE })
    if (shotTime >= SHOOT_RELEASE) letGo(true)
    else stage.setTimeScale(shotTime >= HANG_FROM ? HANG_SCALE : 1)
  }

  // 放開空白鍵（late：按太久自動出手）：這時的力道決定 perfect／good／miss；還沒到出手那一格的話動作快轉過去
  function letGo(late) {
    const ideal = idealPower()
    const grade = late ? 'miss' : gradeShot(power, ideal)
    shot.holding = false
    shot.grade = grade
    shot.ratio = shotSpeedRatio(grade, power, ideal)
    shot.side = shotSideError(grade)
    onCharge(null)
    onShot(late ? 'late' : grade)
    const rest = SHOOT_RELEASE - shotTime
    stage.setTimeScale(rest > 0 ? Math.max(1, rest / CATCH_UP) : 1)
  }

  // 投籃動作中的移動：起跳前減速到飄移速度、空中維持、落地後停下
  function shotMove(delta) {
    const v = shot.velocity
    if (shotTime < SHOOT_TAKEOFF) v.lerp(shot.drift, Math.min(1, delta / STOP_EASE))
    else if (shotTime >= SHOOT_LAND) v.multiplyScalar(1 - Math.min(1, delta / STOP_EASE))
    moveBy(v.x * delta, v.z * delta)
  }

  // 正在往籃框切入嗎：在移動、面向籃框（差 DRIVE_ANGLE 度內）、離籃框 DRIVE_RANGE 內
  function driving() {
    const p = character.position
    const dist = Math.hypot(physics.rim.x - p.x, physics.rim.z - p.z)
    const off = Math.abs(wrapAngle(facingRim() - character.rotation.y))
    return speed > MOVING_SPEED && dist <= DRIVE_RANGE && off <= THREE.MathUtils.degToRad(DRIVE_ANGLE)
  }

  // 從現在的位置做上籃或灌籃的路線：出手那一格球要剛好在籃框前方 reach 的地方。
  // 回傳 { heading 角色方向, air 空中推動速度, start 從第幾秒開始播 }；還太遠回傳 'far'，太近回傳 'near'。
  // 太近時從後面的影格開始播（少跑幾步），最多跳過 8 格
  function drivePlan(name) {
    const drive = DRIVES[name]
    const b = driveLocal[name]
    const p = character.position
    const dx = physics.rim.x - p.x
    const dz = physics.rim.z - p.z
    const d = Math.hypot(dx, dz) - drive.reach
    if (d <= Math.abs(b.x) + 0.05) return 'near'
    const forward = Math.sqrt(d * d - b.x * b.x) // 出手時球在角色前進方向上要走到的距離
    const travel = forward - b.z // 角色要前進的距離
    const ground = MOVE_SPEEDS.Sprint
    const airTime = drive.release - DRIVE_TAKEOFF
    let start = 0
    let air = (travel - ground * DRIVE_TAKEOFF) / airTime
    if (air > AIR_SPEED_MAX) return 'far'
    if (air < AIR_SPEED_MIN) {
      air = AIR_SPEED_MIN
      start = DRIVE_TAKEOFF - (travel - air * airTime) / ground
      if (start > 8 / 24) return 'near'
    }
    return { heading: Math.atan2(dx, dz) - Math.atan2(b.x, forward), air, start }
  }

  // 切入中每格檢查：按住 A 是灌籃、沒按是上籃，跑到距離就出手；停下或轉開了就改成跳投（空白鍵還按著的話）
  function updateDrive() {
    let name = held.has('KeyA') ? 'Dunk' : 'Layup'
    let plan = driving() ? drivePlan(name) : 'stop'
    if (plan === 'near' && name === 'Dunk') {
      name = 'Layup'
      plan = drivePlan(name)
    }
    if (plan === 'far') return
    if (plan === 'near' || plan === 'stop') {
      if (held.has('Space')) startShot()
      else mode = 'free'
      return
    }
    mode = 'shoot'
    shotTime = plan.start
    character.rotation.y = plan.heading
    onShot(name === 'Dunk' ? 'dunk' : 'layup')
    shot = { kind: name, air: plan.air, ball: null, from: null, judged: false, judgedAt: 0 }
    speed = 0
    setClip(name, DRIVE_FADE, plan.start)
  }

  // 上籃、灌籃中的移動：起跳前 Sprint 速度、空中照路線算出的速度、落地後 4 格停下
  function driveMove(delta, drive) {
    let v = MOVE_SPEEDS.Sprint
    if (shotTime >= DRIVE_TAKEOFF) v = shot.air * Math.max(0, Math.min(1, 1 - (shotTime - drive.land) / DRIVE_BRAKE))
    const a = character.rotation.y
    moveBy(Math.sin(a) * v * delta, Math.cos(a) * v * delta)
  }

  // 上籃：找打板進球的速度再加上隨機誤差；灌籃：球從籃框往下塞，直接算進
  function releaseDrive() {
    const from = driveLocal[shot.kind].clone().applyAxisAngle(THREE.Object3D.DEFAULT_UP, character.rotation.y).add(character.position)
    let v
    if (shot.kind === 'Dunk') {
      v = new THREE.Vector3(Math.sin(character.rotation.y) * 0.3, -2.5, Math.cos(character.rotation.y) * 0.3)
    } else {
      const angle = shotAngle(from)
      v = physics.bankShotVelocity(from) ?? physics.launchVelocity(from, angle, physics.idealSpeed(from, angle) ?? SHOT_SPEED_MIN)
      v.multiplyScalar(1 + gauss() * LAYUP_ERROR.speed)
      v.applyAxisAngle(THREE.Object3D.DEFAULT_UP, THREE.MathUtils.degToRad(gauss() * LAYUP_ERROR.side))
    }
    launchBall(from, v)
    if (shot.kind === 'Dunk') shot.ball.scored = true
  }

  function release() {
    const from = releasePoint()
    const angle = shotAngle(from)
    const ideal = physics.idealSpeed(from, angle)
    const v = physics.launchVelocity(from, angle, (ideal ?? SHOT_SPEED_MAX) * shot.ratio)
    v.applyAxisAngle(THREE.Object3D.DEFAULT_UP, shot.side)
    launchBall(from, v)
  }

  // 球離手：換成場上的球交給物理計算
  function launchBall(from, v) {
    shot.from = from
    shot.ball = physics.launch(from, v)
    shot.spinAxis = new THREE.Vector3(v.x, 0, v.z).normalize().cross(THREE.Object3D.DEFAULT_UP)
    freeBall.position.copy(from)
    freeBall.visible = true
    shots++
  }

  function judge() {
    const b = shot.ball
    shot.judged = true
    shot.judgedAt = shotTime
    if (b.scored) makes++
    let message
    if (shot.kind === 'Dunk') message = '灌籃！'
    else if (shot.kind === 'Layup') message = b.scored ? '上籃進球！' : '上籃沒進'
    else message = b.scored ? (b.touchedRim || b.touchedBoard ? '進球！' : '空心進球！') : physics.missReason(b, shot.from)
    onResult({ made: b.scored, message, shots, makes })
  }

  function updateShot(delta) {
    const drive = DRIVES[shot.kind]
    if (drive) {
      shotTime += delta
      driveMove(delta, drive)
      if (!shot.ball && shotTime >= drive.release) releaseDrive()
    } else {
      shotTime = stage.actionTime() // 跳投的動作會放慢或快轉，直接看動作播到哪
      if (shot.holding) updateHold(delta)
      shotMove(delta)
      if (!shot.holding && !shot.ball && shotTime >= SHOOT_RELEASE) {
        release()
        stage.setTimeScale(1)
      }
    }
    // 動作做完就可以動了，空手去撿球
    if (shotTime >= (drive ? drive.length : SHOOT_LENGTH) - 1e-3) {
      mode = 'free'
      hasBall = false
    }
  }

  // 投出去的球：物理計算、判定，在地上滾的時候照速度轉動
  function updateLooseBall(delta) {
    const b = shot.ball
    physics.update(b, delta)
    keepInCourt(b)
    freeBall.position.copy(b.p)
    if (b.p.y <= BALL_RADIUS + 0.01) {
      const v = Math.hypot(b.v.x, b.v.z)
      if (v > 1e-3) freeBall.rotateOnWorldAxis(rollAxis.set(b.v.z / v, 0, -b.v.x / v), (v / BALL_RADIUS) * delta)
    } else {
      freeBall.rotateOnWorldAxis(shot.spinAxis, -delta * 9)
    }
    const rimY = physics.rim.y
    const done = b.scored || (b.crossed && b.p.y < rimY - 0.5) || b.age > 3.5 || (b.p.y < 1 && b.v.y < 0 && b.age > 0.6)
    if (!shot.judged && done) judge()
  }

  // 球場四周當成有圍欄：球滾出撿球範圍時彈回來
  function keepInCourt(b) {
    for (const [axis, lo, hi] of [
      ['x', -COURT.HALF_WIDTH + MARGIN, COURT.HALF_WIDTH - MARGIN],
      ['z', BASELINE_Z + MARGIN, BASELINE_Z + COURT.HALF_LENGTH - MARGIN],
    ]) {
      if (b.p[axis] < lo || b.p[axis] > hi) {
        b.p[axis] = THREE.MathUtils.clamp(b.p[axis], lo, hi)
        b.v[axis] *= -0.5
      }
    }
  }

  // 判定完、球夠低又在角色腳邊就撿起來，接著運球
  function tryPickup() {
    const b = shot.ball
    const p = character.position
    if (!shot.judged || b.p.y > PICKUP_HEIGHT || Math.hypot(b.p.x - p.x, b.p.z - p.z) > PICKUP_RADIUS) return
    freeBall.visible = false
    shot = null
    hasBall = true
    const dir = inputDirection()
    setClip(dir ? (held.has('KeyA') ? CLIPS.sprint : CLIPS.walk) : CLIPS.stand, PICKUP_FADE)
  }

  // k：這一格鏡頭往目標移動的比例（1 是直接到位）
  function placeCamera(k) {
    const p = character.position
    const fx = -Math.sin(cameraYaw)
    const fz = -Math.cos(cameraYaw)
    goal.set(p.x - fx * CAMERA.back, CAMERA.height, p.z - fz * CAMERA.back)
    cameraPos.lerp(goal, k)
    stage.camera.position.copy(cameraPos)
    lift += ((shot?.ball && !shot.judged ? CAMERA.shotLift : 0) - lift) * k * 0.5
    look.set(p.x + fx * CAMERA.lookAhead, CAMERA.lookHeight + lift, p.z + fz * CAMERA.lookAhead)
    stage.camera.lookAt(look)
  }

  function update(delta, paused) {
    if (!stage || paused) return
    delta = Math.min(delta, 0.1) // 分頁切回來時的第一格可能隔了很久
    if (mode !== 'shoot') move(delta)
    if (mode === 'drive') updateDrive()
    if (mode === 'shoot') updateShot(delta)
    if (shot?.ball) updateLooseBall(delta)
    if (!hasBall) {
      stage.getBall().visible = false // 沒持球時，動作裡的球（例如 Idle 放在腳邊的球）不顯示
      tryPickup()
    }
    const k = Math.min(1, delta / CAMERA.ease)
    cameraYaw = wrapAngle(cameraYaw + wrapAngle(yawToAim() - cameraYaw) * k)
    placeCamera(k)
  }

  return { start, stop, update }
}
