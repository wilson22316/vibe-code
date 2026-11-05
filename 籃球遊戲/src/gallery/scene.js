// 動作展示館的 three.js 場景。Vue 只負責呼叫 createGallery／dispose，three.js 物件不放進 Vue 的響應式資料。
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

const MODEL_URL = `${import.meta.env.BASE_URL}models/athlete_game.glb`

// 鏡頭預設位置（沿用 reference/dribble_preview_r128.html）
const HOME_POS = new THREE.Vector3(-2.2, 1.35, 3.0)
const HOME_TGT = new THREE.Vector3(-0.1, 0.78, 0.1)

// r128 舊版燈光強度 × π ≈ 新版物理單位下的同等亮度（hemi 0.6、sun 0.7）。
// 最後要等角色換上卡通材質後再微調（TODO 第 12 項）。
const HEMI_INTENSITY = 0.6 * Math.PI
const SUN_INTENSITY = 0.7 * Math.PI

const DEFAULT_CLIP = 'Idle'
const ONCE_CLIPS = new Set(['Shoot'])

export function createGallery(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.shadowMap.enabled = true
  container.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  // 暫時的底色；藍天白雲背景在 TODO 第 14 項
  scene.background = new THREE.Color(0xa9d1ea)

  const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 100)
  camera.position.copy(HOME_POS)

  // 拖曳旋轉、滾輪縮放、右鍵平移。最近 0.4 m 方便近看手指，鏡頭不會轉到地面以下。
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.target.copy(HOME_TGT)
  controls.enableDamping = true
  controls.minDistance = 0.4
  controls.maxDistance = 9
  controls.maxPolarAngle = Math.PI * 0.495
  controls.update()

  scene.add(new THREE.HemisphereLight(0xfff3e0, 0x9a8fb0, HEMI_INTENSITY))
  const sun = new THREE.DirectionalLight(0xfff0d6, SUN_INTENSITY)
  sun.position.set(-2.5, 5, 3.5)
  sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024)
  Object.assign(sun.shadow.camera, { left: -2, right: 2, top: 2.5, bottom: -1 })
  sun.shadow.radius = 4
  scene.add(sun)

  // 地面：暫時用單色圓盤（草地貼圖在 TODO 第 14 項），上面疊一層只顯示陰影的圓盤
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(2.8, 64),
    new THREE.MeshBasicMaterial({ color: 0x93bf74 }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -0.003
  scene.add(ground)

  const shadowCatcher = new THREE.Mesh(
    new THREE.CircleGeometry(2.4, 64),
    new THREE.ShadowMaterial({ opacity: 0.22 }),
  )
  shadowCatcher.rotation.x = -Math.PI / 2
  shadowCatcher.receiveShadow = true
  scene.add(shadowCatcher)

  function resize() {
    const { clientWidth: w, clientHeight: h } = container
    if (!w || !h) return
    renderer.setSize(w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(container)
  resize()

  let mixer = null
  const actions = {}
  let current = null
  const timer = new THREE.Timer()

  // 直接切換動作（淡入淡出在 TODO 第 16 項）。再點同一個動作會從頭播。
  function play(name) {
    const action = actions[name]
    if (!action) throw new Error(`模型裡找不到 ${name} 動作`)
    current?.stop()
    current = action
    current.play()
  }

  // 播放速度倍數，作用在整個 mixer，切換動作後仍維持
  function setSpeed(speed) {
    if (mixer) mixer.timeScale = speed
  }

  // 載入角色並播放 Idle；失敗時 ready 會 reject，由畫面顯示錯誤
  const ready = new GLTFLoader().loadAsync(MODEL_URL).then((gltf) => {
    const root = gltf.scene
    root.traverse((o) => {
      if (!o.isMesh) return
      o.castShadow = true
      // 骨架網格與球的包圍盒不會跟著動作更新，關掉視錐剔除以免動作中途消失
      o.frustumCulled = false
    })
    scene.add(root)

    mixer = new THREE.AnimationMixer(root)
    for (const clip of gltf.animations) {
      const action = mixer.clipAction(clip)
      // 單次動作播完停在最後一格（見 CLAUDE.md 動作規格表）
      if (ONCE_CLIPS.has(clip.name)) {
        action.setLoop(THREE.LoopOnce, 1)
        action.clampWhenFinished = true
      }
      actions[clip.name] = action
    }
    play(DEFAULT_CLIP)

    return { clips: gltf.animations.map((c) => c.name), current: DEFAULT_CLIP }
  })

  renderer.setAnimationLoop((time) => {
    timer.update(time)
    mixer?.update(timer.getDelta())
    controls.update()
    renderer.render(scene, camera)
  })

  return {
    scene,
    ready,
    play,
    setSpeed,
    dispose() {
      renderer.setAnimationLoop(null)
      resizeObserver.disconnect()
      controls.dispose()
      scene.traverse((o) => {
        o.geometry?.dispose()
        o.material?.dispose()
      })
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}
