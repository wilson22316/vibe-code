// 主畫面的精華片段（夜晚球場）：換手運球 → 胯下運球 → 衝刺 → 單手灌籃 → 慶祝，約 9 秒一輪。
// 鏡頭像體育轉播一樣切換：運球時繞著角色低角度環繞、切入時切到籃框下往上拍、慶祝時正面特寫，灌籃那一下畫面震動。
// 灌籃出手時球剛好在籃框正上方：載入後先量出 Dunk 出手那一格球在角色身上的位置，反推起跑點。
import * as THREE from 'three'
import { COURT } from '../game/court.js'
import { MOVE_SPEEDS, NIGHT_BASKET_Z } from '../gallery/scene.js'

const FPS = 24
const DUNK_RELEASE = 25 / FPS // CLAUDE.md：Dunk 第 25 格把球往下塞後放開
const DUNK_LENGTH = 46 / FPS
const SPRINT_START = 4
const SPRINT_TIME = 1.0 // Sprint 兩個循環；Dunk 要從 Sprint 第 0 格接起
const DUNK_START = SPRINT_START + SPRINT_TIME
const CELEBRATE_START = DUNK_START + DUNK_LENGTH
// 劇本：[開始秒數, 動作, 淡入秒數]
const SCRIPT = [
  [0, 'Crossover', 0],
  [2, 'BetweenLegs', 0.3],
  [SPRINT_START, 'Sprint', 0.25],
  [DUNK_START, 'Dunk', 0.12],
  [CELEBRATE_START, 'Celebrate', 0.25],
]
const WIPE_AT = CELEBRATE_START + 1.6 // 重播轉場開始
const WIPE_COVER = 0.4 // 轉場開始後多久蓋滿畫面，這時候換回第一個鏡頭
const SCORE_DELAY = 0.2 // 出手後多久球穿過籃網、記分

const BALL_RADIUS = 0.12
const GRAVITY = 9.8
const FLOOR_BOUNCE = 0.72
const RIM = new THREE.Vector3(0, COURT.RIM_HEIGHT, NIGHT_BASKET_Z)
const FACING = Math.PI // 角色面向 -Z（朝籃框）
const SHOT_FOV = 35
const SHOT_B_FOV = 52

const smooth = (a, b, x) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return k * k * (3 - 2 * k)
}

// Dunk 從第 0 格起往前推了多遠（照 MOVE_SPEEDS.Dunk 積分）
function dunkDistanceTable() {
  const step = 1 / 240
  const table = [0]
  for (let t = 0; t < DUNK_LENGTH + 0.1; t += step) table.push(table.at(-1) + MOVE_SPEEDS.Dunk(t) * step)
  return (t) => table[Math.min(table.length - 1, Math.max(0, Math.round(t / step)))]
}

export function createHighlightReel({ onScore = () => {}, onWipe = () => {} } = {}) {
  let stage = null
  let character = null
  let net = null
  let freeBall = null
  const freeVel = new THREE.Vector3()
  const dunkDistance = dunkDistanceTable()
  const sprintDistance = MOVE_SPEEDS.Sprint * SPRINT_TIME
  let releaseX = 0
  let startZ = 0
  let t = 0
  let next = 0 // 劇本下一個要播的動作
  let released = false
  let scored = false
  let wiped = false
  let shakeAt = -1

  function start(gallery) {
    stage = gallery
    character = stage.getCharacter()
    net = stage.scene.getObjectByName('Net')
    // 出手那一格球在角色座標的位置；角色轉向 -Z 後 x、z 反過來
    const local = stage.sampleBall('Dunk', DUNK_RELEASE)
    releaseX = RIM.x + local.x
    const releaseZ = RIM.z + local.z
    startZ = releaseZ + sprintDistance + dunkDistance(DUNK_RELEASE)
    character.rotation.y = FACING
    const ball = stage.getBall()
    freeBall = ball.clone()
    freeBall.visible = false
    ball.getWorldScale(freeBall.scale)
    stage.scene.add(freeBall)
    restart()
  }

  function restart() {
    t = 0
    next = 0
    released = scored = wiped = false
    shakeAt = -1
    freeBall.visible = false
    net.scale.set(1, 1, 1)
    net.rotation.set(0, 0, 0)
  }

  // 角色從起跑點往籃框（-Z）推進的距離
  function distance() {
    if (t < SPRINT_START) return 0
    if (t < DUNK_START) return MOVE_SPEEDS.Sprint * (t - SPRINT_START)
    const dunkTime = t < CELEBRATE_START ? stage.actionTime() : DUNK_LENGTH
    return sprintDistance + dunkDistance(dunkTime)
  }

  function updateBall(delta) {
    if (!freeBall.visible) return
    freeVel.y -= GRAVITY * delta
    freeBall.position.addScaledVector(freeVel, delta)
    if (freeBall.position.y < BALL_RADIUS) {
      freeBall.position.y = BALL_RADIUS
      freeVel.y = Math.abs(freeVel.y) * FLOOR_BOUNCE
      freeVel.x *= 0.9
      freeVel.z *= 0.9
    }
    freeBall.rotation.x -= freeVel.z * delta * 4
  }

  // 籃網被球穿過後上下晃動、慢慢停下來
  function updateNet() {
    if (!released) return
    const s = t - (DUNK_START + DUNK_RELEASE)
    const k = Math.exp(-s * 3.5)
    net.scale.y = 1 + 0.3 * k * Math.sin(s * 28)
    net.rotation.x = 0.12 * k * Math.sin(s * 19)
  }

  // 鏡頭：運球時低角度環繞 → 切入時籃框下往上拍 → 慶祝時正面特寫
  function updateCamera() {
    const cam = stage.camera
    const p = character.position
    const look = new THREE.Vector3()
    let fov = SHOT_FOV
    if (t < SPRINT_START) {
      const a = THREE.MathUtils.lerp(-0.6, 0.5, t / SPRINT_START)
      cam.position.set(p.x + Math.sin(a) * 4.3, 0.7, p.z - Math.cos(a) * 4.3)
      look.set(p.x, 0.95, p.z)
    } else if (t < CELEBRATE_START) {
      // 底線外低角度往上拍：籃框在畫面上方，角色從遠處衝過來；廣角一點才裝得下兩者
      fov = SHOT_B_FOV
      cam.position.set(2.4, 0.5, RIM.z - 2.2)
      const k = THREE.MathUtils.lerp(0.25, 0.55, smooth(SPRINT_START, DUNK_START + DUNK_RELEASE, t))
      look.set(p.x, 1.3, p.z).lerp(RIM, k)
    } else {
      const k = smooth(CELEBRATE_START, WIPE_AT, t)
      cam.position.set(p.x + 1.4 - 0.3 * k, 1.0 + 0.05 * k, p.z - 4.4 + 0.6 * k)
      look.set(p.x, 1.15, p.z)
    }
    if (shakeAt >= 0) {
      const amount = 0.07 * Math.exp(-(t - shakeAt) / 0.12)
      cam.position.x += (Math.random() - 0.5) * amount
      cam.position.y += (Math.random() - 0.5) * amount
    }
    cam.lookAt(look)
    if (cam.fov !== fov) {
      cam.fov = fov
      cam.updateProjectionMatrix()
    }
  }

  function update(delta) {
    if (!stage) return
    delta = Math.min(delta, 0.1) // 分頁切回來時的第一格可能隔了很久，不要一次跳太多
    t += delta
    while (next < SCRIPT.length && t >= SCRIPT[next][0]) {
      const [, name, fade] = SCRIPT[next]
      stage.play(name, fade)
      next++
    }
    character.position.set(releaseX, character.position.y, startZ - distance())

    if (!released && t >= DUNK_START + DUNK_RELEASE) {
      // 出手：換成場上的球，從籃框往下掉，落地後彈跳
      released = true
      shakeAt = t
      stage.getBall().getWorldPosition(freeBall.position)
      freeVel.set(-1.2, -2.5, -0.5) // 往角色右後方彈開，不擋住慶祝的正面鏡頭
      freeBall.visible = true
    }
    if (released && !scored && t >= DUNK_START + DUNK_RELEASE + SCORE_DELAY) {
      scored = true
      onScore()
    }
    if (!wiped && t >= WIPE_AT) {
      wiped = true
      onWipe()
    }
    if (t >= WIPE_AT + WIPE_COVER) restart()

    updateBall(delta)
    updateNet()
    updateCamera()
  }

  return { start, update }
}
