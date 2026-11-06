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
export const SPRINT_SPEED_SCALE = 1.3
// 投籃：仰角、出手速度範圍（CLAUDE.md：4～13 m/s）、蓄力條從 0 到滿的秒數、力道的隨機誤差
const SHOT_ANGLE = THREE.MathUtils.degToRad(52)
const SHOT_SPEED_MIN = 4
const SHOT_SPEED_MAX = 13
const CHARGE_SECONDS = 1.8
const POWER_JITTER = 0.005
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
const SHOOT_LENGTH = 36 / 24
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

// onCharge({ power, ideal }) 蓄力中每格呼叫，放開時傳 null；onResult({ made, message, shots, makes }) 每球判定後呼叫
export function createPracticeControls({ onCharge = () => {}, onResult = () => {} } = {}) {
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

  // 投籃狀態：free 自由移動、charge 蓄力中、shoot 投籃動作中（球交回手上前不能動）
  let mode = 'free'
  let chargeTime = 0
  let power = 0
  let shotTime = 0
  let releaseLocal = null // Shoot 出手那一格球在角色座標的位置
  let shot = null // { ball, from, judged, judgedAt }
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

  function setClip(name, fade = FADE) {
    if (clip === name) return
    clip = name
    stage.play(name, fade, name === CLIPS.sprint ? SPRINT_SPEED_SCALE : 1)
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

  function move(delta) {
    let dir = null
    if (mode === 'free') {
      dir = inputDirection()
      setClip(dir ? (held.has('KeyA') ? CLIPS.sprint : CLIPS.walk) : CLIPS.stand)
      // 角色面向 +Z 時 rotation.y = 0，所以面向 (x, z) 的角度是 atan2(x, z)
      if (dir) turnTowards(Math.atan2(dir.x, dir.z), delta)
    } else if (mode === 'charge') {
      turnTowards(facingRim(), delta)
    }

    let target = MOVE_SPEEDS[clip] ?? 0
    if (typeof target !== 'number' || mode !== 'free') target = 0
    if (clip === CLIPS.sprint) target *= SPRINT_SPEED_SCALE
    speed += (target - speed) * Math.min(1, delta / SPEED_EASE)
    if (mode === 'shoot') speed = 0
    const a = character.rotation.y
    const p = character.position
    p.x += Math.sin(a) * speed * delta
    p.z += Math.cos(a) * speed * delta
    // 留在半場內
    p.x = THREE.MathUtils.clamp(p.x, -COURT.HALF_WIDTH + MARGIN, COURT.HALF_WIDTH - MARGIN)
    p.z = THREE.MathUtils.clamp(p.z, BASELINE_Z + MARGIN, BASELINE_Z + COURT.HALF_LENGTH - MARGIN)
  }

  // 角色面向籃框時，出手那一格球的世界座標
  function releasePoint() {
    const local = releaseLocal.clone().applyAxisAngle(THREE.Object3D.DEFAULT_UP, facingRim())
    return local.add(character.position)
  }

  function idealPower() {
    const v = physics.idealSpeed(releasePoint(), SHOT_ANGLE)
    return v === null ? null : speedToPower(v)
  }

  // 蓄力：力道在 0～1 之間來回擺動，放開空白鍵時的力道就是出手力道
  function startCharge() {
    mode = 'charge'
    chargeTime = 0
    power = 0
    setClip(CLIPS.stand)
  }

  function updateCharge(delta) {
    chargeTime += delta
    const c = (chargeTime / CHARGE_SECONDS) % 2
    power = c <= 1 ? c : 2 - c
    onCharge({ power, ideal: idealPower() })
  }

  function shoot() {
    mode = 'shoot'
    shotTime = 0
    onCharge(null)
    character.rotation.y = facingRim()
    const finalPower = THREE.MathUtils.clamp(power * (1 + (Math.random() * 2 - 1) * POWER_JITTER), 0, 1)
    shot = { power: finalPower, ball: null, from: null, judged: false, judgedAt: 0 }
    setClip(CLIPS.shoot, SHOOT_FADE)
  }

  function release() {
    const from = releasePoint()
    const v = physics.launchVelocity(from, SHOT_ANGLE, SHOT_SPEED_MIN + shot.power * (SHOT_SPEED_MAX - SHOT_SPEED_MIN))
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
    move(delta)
    if (mode === 'charge') updateCharge(delta)
    if (mode === 'shoot') updateShot(delta)
    const k = Math.min(1, delta / CAMERA.ease)
    cameraYaw = wrapAngle(cameraYaw + wrapAngle(yawToAim() - cameraYaw) * k)
    placeCamera(k)
  }

  return { start, stop, update }
}
