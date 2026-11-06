// 練習模式的操控：方向鍵移動、按住 A 衝刺；依移動狀態切換運球動作，鏡頭在角色背後跟拍、朝向籃框。
// 移動方向以鏡頭為準：↑ 是往籃框的方向，← → 繞著籃框橫移，↓ 往鏡頭走。
// 角色只往自己面向的方向前進（速度照各動作的 MOVE_SPEEDS，腳才不會打滑），轉向時邊走邊轉。
import * as THREE from 'three'
import { COURT } from './court.js'
import { MOVE_SPEEDS, NIGHT_BASKET_Z } from '../gallery/scene.js'

// 鏡頭朝向的點：籃框正後方 6 m。直接朝籃框的話，角色走到籃框旁邊時方向一下轉很大，鏡頭會亂轉；
// 朝後方的點，籃下最多只偏四十幾度，在場上各處都看得到籃框。
const AIM = new THREE.Vector3(0, 0, NIGHT_BASKET_Z - 6)
const BASELINE_Z = NIGHT_BASKET_Z - COURT.BASKET_TO_BASELINE
const MARGIN = 0.3 // 離邊線、底線、中線保留的距離
const START = new THREE.Vector3(0, 0, NIGHT_BASKET_Z + 6.5) // 三分線弧頂內側

// 動作：站著原地運球、走路運球、衝刺運球
const CLIPS = { stand: 'Dribble', walk: 'DribbleWalk', sprint: 'Sprint' }
const FADE = 0.25
const TURN_SPEED = 10 // 每秒轉幾弧度
const SPEED_EASE = 0.15 // 速度跟上動作的時間常數（秒），和淡入淡出差不多

// 鏡頭：在角色背後（籃框 → 角色的延長線上）偏上，看向角色前方
const CAMERA = { fov: 50, back: 4.2, height: 2.3, lookAhead: 2.0, lookHeight: 1.2, ease: 0.12 }

const ARROWS = { ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a))

export function createPracticeControls() {
  let stage = null
  let character = null
  const held = new Set()
  let clip = null
  let speed = 0
  let cameraYaw = 0 // 鏡頭從角色往籃框看的方向（繞 Y 軸，0 是往 -Z）
  const cameraPos = new THREE.Vector3()
  const look = new THREE.Vector3()
  const goal = new THREE.Vector3()

  function onKeyDown(event) {
    if (event.code in ARROWS || event.code === 'KeyA') {
      held.add(event.code)
      event.preventDefault()
    }
  }
  function onKeyUp(event) {
    held.delete(event.code)
  }
  // 切到別的視窗時放開所有按鍵，免得角色一直走
  function onBlur() {
    held.clear()
  }

  function start(gallery) {
    stage = gallery
    character = stage.getCharacter()
    character.position.copy(START)
    character.rotation.y = Math.PI // 面向籃框（-Z）
    cameraYaw = yawToBasket()
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
    stage.play(name, fade)
  }

  // 從角色往 AIM 的水平方向角（0 是往 -Z、往 -X 為正）
  function yawToBasket() {
    return Math.atan2(-(AIM.x - character.position.x), -(AIM.z - character.position.z))
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
    // 鏡頭往前（-Z 轉 cameraYaw）與往右的方向
    const fx = -Math.sin(cameraYaw)
    const fz = -Math.cos(cameraYaw)
    return new THREE.Vector3(fx * forward - fz * right, 0, fz * forward + fx * right).normalize()
  }

  function move(delta) {
    const dir = inputDirection()
    const sprint = held.has('KeyA')
    setClip(dir ? (sprint ? CLIPS.sprint : CLIPS.walk) : CLIPS.stand)

    if (dir) {
      // 角色面向 +Z 時 rotation.y = 0，所以面向 (x, z) 的角度是 atan2(x, z)
      const want = Math.atan2(dir.x, dir.z)
      const diff = wrapAngle(want - character.rotation.y)
      const turn = Math.sign(diff) * Math.min(Math.abs(diff), TURN_SPEED * delta)
      character.rotation.y = wrapAngle(character.rotation.y + turn)
    }

    const target = MOVE_SPEEDS[clip] ?? 0
    speed += (target - speed) * Math.min(1, delta / SPEED_EASE)
    const a = character.rotation.y
    const p = character.position
    p.x += Math.sin(a) * speed * delta
    p.z += Math.cos(a) * speed * delta
    // 留在半場內
    p.x = THREE.MathUtils.clamp(p.x, -COURT.HALF_WIDTH + MARGIN, COURT.HALF_WIDTH - MARGIN)
    p.z = THREE.MathUtils.clamp(p.z, BASELINE_Z + MARGIN, BASELINE_Z + COURT.HALF_LENGTH - MARGIN)
  }

  // k：這一格鏡頭往目標移動的比例（1 是直接到位）
  function placeCamera(k) {
    const p = character.position
    const fx = -Math.sin(cameraYaw)
    const fz = -Math.cos(cameraYaw)
    goal.set(p.x - fx * CAMERA.back, CAMERA.height, p.z - fz * CAMERA.back)
    cameraPos.lerp(goal, k)
    stage.camera.position.copy(cameraPos)
    look.set(p.x + fx * CAMERA.lookAhead, CAMERA.lookHeight, p.z + fz * CAMERA.lookAhead)
    stage.camera.lookAt(look)
  }

  function update(delta, paused) {
    if (!stage || paused) return
    delta = Math.min(delta, 0.1) // 分頁切回來時的第一格可能隔了很久
    move(delta)
    const k = Math.min(1, delta / CAMERA.ease)
    cameraYaw = wrapAngle(cameraYaw + wrapAngle(yawToBasket() - cameraYaw) * k)
    placeCamera(k)
  }

  return { start, stop, update }
}
