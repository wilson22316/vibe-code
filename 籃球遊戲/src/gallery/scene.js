// 動作展示館的 three.js 場景。Vue 只負責呼叫 createGallery／dispose，three.js 物件不放進 Vue 的響應式資料。
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { NIGHT_GROUND, createFloodlights, createGrass, createNightSky, createSky } from './backdrop.js'
import { createCourt } from '../game/court.js'

const MODEL_URL = `${import.meta.env.BASE_URL}models/athlete_game.glb`

// 鏡頭預設位置（沿用 reference/dribble_preview_r128.html）
const HOME_POS = new THREE.Vector3(-2.2, 1.35, 3.0)
const HOME_TGT = new THREE.Vector3(-0.1, 0.78, 0.1)

// r128 舊版燈光強度 × π ＝ 新版物理單位下的同等亮度（hemi 0.6、sun 0.7）。
const HEMI_INTENSITY = 0.6 * Math.PI
const SUN_INTENSITY = 0.7 * Math.PI

// 燈光顏色：r128 沒有色彩管理，十六進位色直接當線性值用；新版會把它當 sRGB 轉成線性，
// 色偏變重、地面色 #9A8FB0 也暗很多。照舊值當線性色設定，強度 × π，
// 卡通材質的上色就和 r128 原型逐像素相同（第 12 項用同一顆球在兩個版本各畫一次比對過）。
const linear = (hex) => new THREE.Color().setHex(hex, THREE.LinearSRGBColorSpace)
const SKY_COLOR = linear(0xfff3e0)
const GROUND_COLOR = linear(0x9a8fb0)
const SUN_COLOR = linear(0xfff0d6)

// 手繪動畫風：4 階色階貼圖（見 CLAUDE.md）
function createToonGradient() {
  const gradient = new THREE.DataTexture(new Uint8Array([120, 170, 215, 245]), 4, 1, THREE.RedFormat)
  gradient.minFilter = THREE.NearestFilter
  gradient.magFilter = THREE.NearestFilter
  gradient.generateMipmaps = false
  gradient.needsUpdate = true
  return gradient
}

// 換成卡通材質；顏色沿用 glb 裡的材質色（已是 CLAUDE.md 的配色），名稱保留給之後換隊伍配色用
function toToon(material, gradientMap) {
  const toon = new THREE.MeshToonMaterial({ color: material.color, gradientMap })
  toon.name = material.name
  material.dispose()
  return toon
}

// 描邊：背面放大法，沿法線外推後只畫背面（見 CLAUDE.md）。眼睛、嘴巴、球的接縫不加。
const OUTLINE_WIDTH = 0.0045
const OUTLINE_COLOR = 0x4a3326
const NO_OUTLINE = /Eye|Mouth|Ball_Seam/

function createOutlineMaterial() {
  const material = new THREE.MeshBasicMaterial({ color: OUTLINE_COLOR, side: THREE.BackSide })
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `vec3 transformed = vec3( position ) + normalize( normal ) * ${OUTLINE_WIDTH.toFixed(4)};`,
    )
  }
  return material
}

// 描邊網格掛在原網格底下（世界矩陣相同）；骨架網格要用 SkinnedMesh 綁同一副骨架才會跟著動
function createOutline(mesh, material) {
  let line
  if (mesh.isSkinnedMesh) {
    line = new THREE.SkinnedMesh(mesh.geometry, material)
    line.bind(mesh.skeleton, mesh.bindMatrix)
  } else {
    line = new THREE.Mesh(mesh.geometry, material)
  }
  line.frustumCulled = false
  line.renderOrder = -1
  return line
}

// glb 的關鍵影格從 Blender 第 1 格（1/24 s）開始，最後一格又等於第一格。
// 不平移的話 three.js 循環時第一格會停兩格、週期多一格，所以把時間平移到從 0 開始。
// GLTFLoader 讓共用同一組時間的軌道共用同一個 times 陣列，shift 會直接改陣列，所以每個陣列只能平移一次。
export function startClipsAtZero(clips) {
  const shifted = new Set()
  for (const clip of clips) {
    const start = Math.min(...clip.tracks.map((t) => t.times[0]))
    for (const track of clip.tracks) {
      if (shifted.has(track.times)) continue
      shifted.add(track.times)
      track.shift(-start)
    }
    clip.resetDuration()
  }
}

const BALL_NODE = 'Ball'
// 原地移動的動作，遊戲以這些速度（m/s）推動角色腳才不會打滑（見 CLAUDE.md；建置時印出的 move_speeds 為準）
// 值可以是固定速度，或「動作時間 → 速度」的函式（單次動作速度會變）。
export const MOVE_SPEEDS = {
  Sprint: 2.843,
  DribbleWalk: 0.979,
  Jog: 1.99,
  Run: 3.345,
  // 急停：第 8 格雙腳落地前維持 Sprint 速度，第 8～12 格線性降到 0（athlete_anims.py 的 STOP_LAND、STOP_BRAKE）
  StopJump: (t) => 2.843 * Math.min(1, Math.max(0, (12 / 24 - t) / (4 / 24))),
  // 上籃：第 11 格起跳前 Sprint 速度，空中 1.895，第 22 格落地後 4 格線性降到 0（athlete_anims.py 的 LAY）
  Layup: (t) => (t < 11 / 24 ? 2.843 : 1.895 * Math.min(1, Math.max(0, (26 / 24 - t) / (4 / 24)))),
  DefenseSlide: 1.289,
  // 灌籃：第 11 格起跳前 Sprint 速度，空中 1.516，第 35 格落地後 4 格線性降到 0（athlete_anims.py 的 DUNK）
  Dunk: (t) => (t < 11 / 24 ? 2.843 : 1.516 * Math.min(1, Math.max(0, (39 / 24 - t) / (4 / 24)))),
}
// 推動方向：預設往前（+Z）；列在這裡的往角色左邊（+X）
const SIDE_MOVES = new Set(['DefenseSlide'])
// 推動時在 -2～2 m 之間跑，跑出去就從另一端再進來
const RUN_HALF = 2
const DEFAULT_CLIP = 'Idle'
// 淡入淡出秒數，沿用 reference 原型的 0.35 s
const FADE_SECONDS = 0.35
const ONCE_CLIPS = new Set(['Shoot', 'StopJump', 'SetShot', 'Layup', 'Pass', 'Catch', 'Rebound', 'Dunk', 'Celebrate', 'Frustrated'])

// 隊伍配色會換的材質（見 CLAUDE.md）
const TEAM_MATERIALS = { shirt: 'Athlete_Shirt', shorts: 'Athlete_Shorts' }

// 夜晚球場（主畫面）：籃框在角色後方 4.2 m（罰球線附近），照明燈在球場四角
export const NIGHT_BASKET_Z = -4.2
const FLOODLIGHTS = [[-9.5, -7.5], [9.5, -7.5], [-9.5, 9], [9.5, 9]]
const NIGHT_HEMI = { sky: 0x6f78b8, ground: 0x2e3440, intensity: 0.45 * Math.PI }
const SPOT = { color: 0xffe2b0, intensity: 0.95 * Math.PI, position: [-4.5, 8, 7] }
const RIM_LIGHT = { color: 0x9fb4ff, intensity: 0.55 * Math.PI, position: [3, 5, -6] }

// 白天草地（展示館）：藍天白雲、草地圓盤、只顯示陰影的圓盤
function addMeadow(scene) {
  scene.background = createSky()
  scene.add(new THREE.HemisphereLight(SKY_COLOR, GROUND_COLOR, HEMI_INTENSITY))
  const sun = new THREE.DirectionalLight(SUN_COLOR, SUN_INTENSITY)
  sun.position.set(-2.5, 5, 3.5)
  sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024)
  Object.assign(sun.shadow.camera, { left: -2, right: 2, top: 2.5, bottom: -1 })
  sun.shadow.radius = 4
  scene.add(sun)

  scene.add(createGrass())

  const shadowCatcher = new THREE.Mesh(
    new THREE.CircleGeometry(2.4, 64),
    new THREE.ShadowMaterial({ opacity: 0.22 }),
  )
  shadowCatcher.rotation.x = -Math.PI / 2
  shadowCatcher.receiveShadow = true
  scene.add(shadowCatcher)
}

// 夜晚球場：夜空與城市剪影、半場球場與籃架、照明燈；主光從左前上方打下來，後方一道冷色輪廓光
function addNightCourt(scene, gradientMap, outline) {
  scene.background = createNightSky()
  scene.fog = new THREE.Fog(NIGHT_GROUND, 14, 34)
  const material = (hex) => new THREE.MeshToonMaterial({ color: hex, gradientMap })

  const ground = new THREE.Mesh(new THREE.CircleGeometry(40, 48), material(NIGHT_GROUND))
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -0.005
  scene.add(ground)
  const court = createCourt({ basketZ: NIGHT_BASKET_Z, material })
  const lights = createFloodlights({ positions: FLOODLIGHTS, material })
  for (const group of [court, lights]) {
    group.traverse((o) => o.isMesh && o.userData.outline && o.add(createOutline(o, outline)))
    scene.add(group)
  }

  scene.add(new THREE.HemisphereLight(linear(NIGHT_HEMI.sky), linear(NIGHT_HEMI.ground), NIGHT_HEMI.intensity))
  const spot = new THREE.SpotLight(linear(SPOT.color), SPOT.intensity, 0, 0.42, 0.5, 0)
  spot.position.set(...SPOT.position)
  spot.target.position.set(0, 0.8, -1)
  spot.castShadow = true
  spot.shadow.mapSize.set(2048, 2048)
  spot.shadow.radius = 4
  scene.add(spot, spot.target)
  const rim = new THREE.DirectionalLight(linear(RIM_LIGHT.color), RIM_LIGHT.intensity)
  rim.position.set(...RIM_LIGHT.position)
  scene.add(rim)
}

// options：interactive 是否能拖曳旋轉鏡頭；clip 一開始播的動作；view 鏡頭位置與注視點；
// setting 場景：'meadow' 白天草地（展示館）、'night-court' 夜晚球場（主畫面）；
// onFrame(delta) 每格呼叫一次：有的話由呼叫端（主畫面的導播）自己擺角色與鏡頭，展示館的「前進」不作用；
// viewShift 畫面中心往右移的比例（0～0.5），左邊留給選單
export function createGallery(
  container,
  { interactive = true, clip = DEFAULT_CLIP, view = null, setting = 'meadow', onFrame = null, viewShift = 0 } = {},
) {
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.shadowMap.enabled = true
  container.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  const gradientMap = createToonGradient()
  const outline = createOutlineMaterial()
  if (setting === 'night-court') addNightCourt(scene, gradientMap, outline)
  else addMeadow(scene)

  const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 100)
  camera.position.copy(view?.position ?? HOME_POS)

  // 拖曳旋轉、滾輪縮放、右鍵平移。最近 0.4 m 方便近看手指，鏡頭不會轉到地面以下。
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.target.copy(view?.target ?? HOME_TGT)
  controls.enabled = interactive
  controls.enableDamping = true
  controls.minDistance = 0.4
  controls.maxDistance = 9
  controls.maxPolarAngle = Math.PI * 0.495
  controls.update()

  // 地面格線：5 m 見方、每格 0.25 m，用來看腳有沒有打滑；預設隱藏
  const grid = new THREE.GridHelper(5, 20, 0x4a3326, 0x6f7f62)
  grid.position.y = 0.001
  grid.visible = false
  scene.add(grid)

  function resize() {
    const { clientWidth: w, clientHeight: h } = container
    if (!w || !h) return
    renderer.setSize(w, h)
    camera.aspect = w / h
    if (viewShift) camera.setViewOffset(w, h, -w * viewShift, 0, w, h)
    camera.updateProjectionMatrix()
    coverBackground(w / h)
  }

  // 背景貼圖像 CSS 的 object-fit: cover 一樣裁切，寬螢幕時月亮、雲才不會被拉扁
  function coverBackground(aspect) {
    const bg = scene.background
    const image = bg?.image
    if (!image?.width) return
    const ratio = image.width / image.height
    if (aspect > ratio) bg.repeat.set(1, ratio / aspect)
    else bg.repeat.set(aspect / ratio, 1)
    bg.offset.set((1 - bg.repeat.x) / 2, (1 - bg.repeat.y) / 2)
  }
  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(container)
  resize()

  let mixer = null
  let skeletonHelper = null
  const actions = {}
  let current = null
  const timer = new THREE.Timer()

  // 球的縮放軌道只用來表示「有球／沒球」。交給 mixer 淡入淡出的話，從 Shoot（球已消失）
  // 切到別的動作時，球會從 0 慢慢變大。所以把軌道拿出來，每格依目前（淡入中）的動作決定顯示或隱藏。
  let ball = null
  const ballScale = new Map()

  // 只在播移動動作時推動角色（往前 +Z，側滑往左 +X）；其他時候回到原點
  let character = null
  let movePush = false

  function setMovePush(on) {
    movePush = on
  }

  function updateMovePush(delta) {
    if (!character) return
    const name = current?.getClip().name
    const spec = movePush && MOVE_SPEEDS[name]
    if (spec) {
      const speed = typeof spec === 'function' ? spec(current.time) : spec
      const [axis, other] = SIDE_MOVES.has(name) ? ['x', 'z'] : ['z', 'x']
      character.position[axis] += speed * delta * mixer.timeScale
      if (character.position[axis] > RUN_HALF) character.position[axis] -= 2 * RUN_HALF
      character.position[other] = 0
    } else {
      character.position.set(0, character.position.y, 0)
    }
  }

  function takeBallScaleTrack(clip) {
    const i = clip.tracks.findIndex((t) => t.name === `${BALL_NODE}.scale`)
    if (i < 0) return
    ballScale.set(clip.name, clip.tracks[i].createInterpolant())
    clip.tracks.splice(i, 1)
  }

  function updateBallVisibility() {
    if (!current) return
    const scale = ballScale.get(current.getClip().name)
    ball.visible = !scale || scale.evaluate(current.time)[0] > 0.5
  }

  // 切換動作：新動作從頭播，和目前的動作淡入淡出（fade 秒）。再點同一個動作會直接從頭播。
  // timeScale 是這個動作自己的播放速度倍數（遊戲調快衝刺時，動作跟著加快腳才不會打滑）
  function play(name, fade = FADE_SECONDS, timeScale = 1) {
    const next = actions[name]
    if (!next) throw new Error(`模型裡找不到 ${name} 動作`)
    next.reset().setEffectiveTimeScale(timeScale).setEffectiveWeight(1).play()
    if (current && current !== next) {
      if (fade > 0) next.crossFadeFrom(current, fade, false)
      else current.stop()
    }
    current = next
  }

  // 動作 name 第 time 秒時，球心在角色座標裡的位置（角色在原點、面向 +Z）。播放中的動作會停掉，之後要重新 play
  function sampleBall(name, time) {
    mixer.stopAllAction()
    const action = actions[name]
    action.reset().play()
    action.time = time
    mixer.update(0)
    character.updateMatrixWorld(true)
    const p = character.worldToLocal(ball.getWorldPosition(new THREE.Vector3()))
    action.stop()
    current = null
    return p
  }

  // 播放速度倍數，作用在整個 mixer，切換動作後仍維持
  function setSpeed(speed) {
    if (mixer) mixer.timeScale = speed
  }

  function setSkeletonVisible(visible) {
    if (skeletonHelper) skeletonHelper.visible = visible
  }

  function setGridVisible(visible) {
    grid.visible = visible
  }

  // 隊伍配色：{ shirt, shorts } 的 sRGB 色碼。模型還沒載入時先記下來，載入後套用
  const teamMaterials = []
  let teamColors = null

  function setTeamColors(colors) {
    teamColors = { ...colors }
    for (const material of teamMaterials) {
      const part = Object.keys(TEAM_MATERIALS).find((k) => material.name.startsWith(TEAM_MATERIALS[k]))
      if (teamColors[part]) material.color.set(teamColors[part])
    }
  }

  // 載入角色並播放 Idle；失敗時 ready 會 reject，由畫面顯示錯誤
  const ready = new GLTFLoader().loadAsync(MODEL_URL).then((gltf) => {
    const root = gltf.scene
    // 先收集再處理，免得 traverse 走進剛加上的描邊網格
    const meshes = []
    root.traverse((o) => o.isMesh && meshes.push(o))
    for (const o of meshes) {
      o.material = toToon(o.material, gradientMap)
      if (Object.values(TEAM_MATERIALS).some((n) => o.material.name.startsWith(n))) teamMaterials.push(o.material)
      o.castShadow = true
      // 骨架網格與球的包圍盒不會跟著動作更新，關掉視錐剔除以免動作中途消失
      o.frustumCulled = false
      if (!NO_OUTLINE.test(o.material.name)) o.add(createOutline(o, outline))
    }
    scene.add(root)
    character = root

    // 骨架線不做深度測試，被身體擋住也看得到
    skeletonHelper = new THREE.SkeletonHelper(root)
    skeletonHelper.visible = false
    skeletonHelper.material.depthTest = false
    scene.add(skeletonHelper)

    mixer = new THREE.AnimationMixer(root)
    startClipsAtZero(gltf.animations)
    ball = root.getObjectByName(BALL_NODE)
    ball.scale.setScalar(1)
    for (const clip of gltf.animations) {
      takeBallScaleTrack(clip)
      const action = mixer.clipAction(clip)
      // 單次動作播完停在最後一格（見 CLAUDE.md 動作規格表）
      if (ONCE_CLIPS.has(clip.name)) {
        action.setLoop(THREE.LoopOnce, 1)
        action.clampWhenFinished = true
      }
      actions[clip.name] = action
    }
    if (teamColors) setTeamColors(teamColors)
    play(clip)

    return { clips: gltf.animations.map((c) => c.name), current: clip }
  })

  renderer.setAnimationLoop((time) => {
    timer.update(time)
    const delta = timer.getDelta()
    mixer?.update(delta)
    updateBallVisibility()
    if (onFrame) {
      if (character) onFrame(delta)
    } else {
      updateMovePush(delta)
    }
    if (interactive) controls.update()
    renderer.render(scene, camera)
  })

  return {
    scene,
    ready,
    play,
    setSpeed,
    setSkeletonVisible,
    setGridVisible,
    setMovePush,
    setTeamColors,
    sampleBall,
    camera,
    actionTime: () => current?.time ?? 0,
    getCharacter: () => character,
    getBall: () => ball,
    dispose() {
      renderer.setAnimationLoop(null)
      resizeObserver.disconnect()
      controls.dispose()
      scene.traverse((o) => {
        o.geometry?.dispose()
        o.material?.gradientMap?.dispose()
        o.material?.map?.dispose()
        o.material?.dispose()
      })
      scene.background.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}
