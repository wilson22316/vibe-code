// 練習模式的操控：方向鍵移動、按住 A 衝刺、按住空白鍵蓄力放開投籃；依移動狀態切換運球動作，鏡頭在角色背後跟拍、朝向籃框。
// 移動方向以鏡頭為準：↑ 是往籃框的方向，← → 繞著籃框橫移，↓ 往鏡頭走。
// 角色只往自己面向的方向前進（速度照各動作的 MOVE_SPEEDS，腳才不會打滑），轉向時邊走邊轉。
import * as THREE from 'three'
import { COURT } from './court.js'
import { createBallPhysics } from './ballPhysics.js'
import { MOVE_SPEEDS, NIGHT_BASKET_Z } from '../gallery/scene.js'

// ===== 可以調整的參數 =====
// 衝刺速度倍數：1 是動作原本的 2.843 m/s。推動速度和動作播放速度一起乘上這個倍數，腳才不會打滑
// （倍數太大時跑步動作會變得很急促）。
export const SPRINT_SPEED_SCALE = 1.5
// 運球走路的速度倍數：1 是動作原本的 0.979 m/s，和衝刺一樣連動作播放速度一起乘
export const WALK_SPEED_SCALE = 2
// 投籃：仰角（離籃框 2 m 內用 NEAR、6 m 外用 FAR，中間線性變化；近距離弧度太平的話球進框的角度太斜，
// 會一直彈框）、出手速度範圍（CLAUDE.md：4～13 m/s）、蓄力條從 0 到滿的秒數
const SHOT_ANGLE_NEAR = 62
const SHOT_ANGLE_FAR = 52
const SHOT_SPEED_MIN = 4
const SHOT_SPEED_MAX = 13
const CHARGE_SECONDS = 1.8
// 蓄力條的判定區：以理想力道為中心，往左右各多寬（蓄力條全長是 1）
const PERFECT_ZONE = 0.025
const GOOD_ZONE = 0.09
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
// =========================

const BASELINE_Z = NIGHT_BASKET_Z - COURT.BASKET_TO_BASELINE
const MARGIN = 0.3 // 離邊線、底線、中線保留的距離
const START = new THREE.Vector3(0, 0, NIGHT_BASKET_Z + 6.5) // 三分線弧頂內側
// 鏡頭朝向的點：籃框正後方 6 m。直接朝籃框的話，角色走到籃框旁邊時方向一下轉很大，鏡頭會亂轉；
// 朝後方的點，籃下最多只偏四十幾度，在場上各處都看得到籃框。
const AIM = new THREE.Vector3(0, 0, NIGHT_BASKET_Z - 6)

// 動作：站著原地運球、走路運球、衝刺運球、投籃
const CLIPS = { stand: 'Dribble', walk: 'DribbleWalk', sprint: 'Sprint', shoot: 'Shoot' }
const FADE = 0.25
const SHOOT_FADE = 0.15
const SHOOT_RELEASE = 18 / 24 // CLAUDE.md：Shoot 第 18 格出手
const SHOOT_TAKEOFF = 12 / 24 // 第 12 格起跳、第 24 格落地
const SHOOT_LAND = 24 / 24
const SHOOT_LENGTH = 36 / 24
const MOVING_SHOT_START = 9 / 24 // 移動中投籃從第 9 格（屈膝）開始播，跳過收球站穩
const MOVING_SPEED = 0.4 // 放開空白鍵時速度超過這個值就算移動中投籃
const STOP_EASE = 0.08 // 起跳前、落地後減速的時間常數（秒）
const BALL_BACK_DELAY = 1.0 // 判定完多久把球交回角色手上（還沒有撿球動作）
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

// onCharge({ power, ideal, perfect, good }) 蓄力中每格呼叫，放開時傳 null；onShot(grade) 放開空白鍵時呼叫；
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
  let lift = 0

  // 投籃狀態：free 自由移動、charge 蓄力中（可以邊移動）、shoot 投籃動作中（球交回手上前不能操控）
  let mode = 'free'
  let chargeTime = 0
  let power = 0
  let shotTime = 0
  let releaseLocal = null // Shoot 出手那一格球在角色座標的位置
  let shot = null // { grade, ratio, side, velocity, ball, from, judged, judgedAt }
  let freeBall = null
  let shots = 0
  let makes = 0

  function onKeyDown(event) {
    if (!KEYS.has(event.code)) return
    event.preventDefault()
    if (event.repeat) return
    held.add(event.code)
    if (event.code === 'Space' && mode === 'free') startCharge()
  }
  function onKeyUp(event) {
    held.delete(event.code)
    if (event.code === 'Space' && mode === 'charge') shoot()
  }
  // 切到別的視窗時放開所有按鍵，免得角色一直走；蓄力中就直接取消
  function onBlur() {
    held.clear()
    if (mode === 'charge') {
      mode = 'free'
      onCharge(null)
    }
  }

  function start(gallery) {
    stage = gallery
    character = stage.getCharacter()
    releaseLocal = stage.sampleBall(CLIPS.shoot, SHOOT_RELEASE)
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
  const speedScale = (name) => (name === CLIPS.sprint ? SPRINT_SPEED_SCALE : name === CLIPS.walk ? WALK_SPEED_SCALE : 1)

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
    setClip(dir ? (held.has('KeyA') ? CLIPS.sprint : CLIPS.walk) : CLIPS.stand)
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

  // 蓄力：力道在 0～1 之間來回擺動，放開空白鍵時力道條的位置決定 perfect／good／miss。蓄力中可以繼續移動
  function startCharge() {
    mode = 'charge'
    chargeTime = 0
    power = 0
  }

  function updateCharge(delta) {
    chargeTime += delta
    const c = (chargeTime / CHARGE_SECONDS) % 2
    power = c <= 1 ? c : 2 - c
    onCharge({ power, ideal: idealPower(), perfect: PERFECT_ZONE, good: GOOD_ZONE })
  }

  // 放開空白鍵：轉向籃框跳投。移動中的話跳過收球站穩、起跳後帶著一部分速度往前飄
  function shoot() {
    const ideal = idealPower()
    const grade = gradeShot(power, ideal)
    const heading = character.rotation.y
    const moving = speed > MOVING_SPEED
    const drift = Math.min(speed * JUMP_DRIFT, JUMP_DRIFT_MAX)
    mode = 'shoot'
    shotTime = moving ? MOVING_SHOT_START : 0
    onCharge(null)
    onShot(grade)
    character.rotation.y = facingRim()
    shot = {
      grade,
      ratio: shotSpeedRatio(grade, power, ideal),
      side: shotSideError(grade),
      velocity: new THREE.Vector3(Math.sin(heading) * speed, 0, Math.cos(heading) * speed),
      drift: new THREE.Vector3(Math.sin(heading) * drift, 0, Math.cos(heading) * drift),
      ball: null,
      from: null,
      judged: false,
      judgedAt: 0,
    }
    speed = 0
    setClip(CLIPS.shoot, SHOOT_FADE, shotTime)
  }

  // 投籃動作中的移動：起跳前減速到飄移速度、空中維持、落地後停下
  function shotMove(delta) {
    const v = shot.velocity
    if (shotTime < SHOOT_TAKEOFF) v.lerp(shot.drift, Math.min(1, delta / STOP_EASE))
    else if (shotTime >= SHOOT_LAND) v.multiplyScalar(1 - Math.min(1, delta / STOP_EASE))
    moveBy(v.x * delta, v.z * delta)
  }

  function release() {
    const from = releasePoint()
    const angle = shotAngle(from)
    const ideal = physics.idealSpeed(from, angle)
    const v = physics.launchVelocity(from, angle, (ideal ?? SHOT_SPEED_MAX) * shot.ratio)
    v.applyAxisAngle(THREE.Object3D.DEFAULT_UP, shot.side)
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
    const message = b.scored
      ? b.touchedRim || b.touchedBoard ? '進球！' : '空心進球！'
      : physics.missReason(b, shot.from)
    onResult({ made: b.scored, message, shots, makes })
  }

  function updateShot(delta) {
    shotTime += delta
    shotMove(delta)
    if (!shot.ball && shotTime >= SHOOT_RELEASE) release()
    const b = shot.ball
    if (b) {
      physics.update(b, delta)
      freeBall.position.copy(b.p)
      freeBall.rotateOnWorldAxis(shot.spinAxis, -delta * 9)
      const rimY = physics.rim.y
      const done = b.scored || (b.crossed && b.p.y < rimY - 0.5) || b.age > 3.5 || (b.p.y < 1 && b.v.y < 0 && b.age > 0.6)
      if (!shot.judged && done) judge()
    }
    // 投籃動作做完、判定完一段時間後，把球交回角色手上
    if (shot.judged && shotTime >= SHOOT_LENGTH && shotTime >= shot.judgedAt + BALL_BACK_DELAY) {
      freeBall.visible = false
      shot = null
      mode = 'free'
      setClip(CLIPS.stand)
    }
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
    if (mode === 'charge') updateCharge(delta)
    if (mode === 'shoot') updateShot(delta)
    const k = Math.min(1, delta / CAMERA.ease)
    cameraYaw = wrapAngle(cameraYaw + wrapAngle(yawToAim() - cameraYaw) * k)
    placeCamera(k)
  }

  return { start, stop, update }
}
