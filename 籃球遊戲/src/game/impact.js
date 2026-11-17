// 場上接觸瞬間的手繪動畫風衝擊波與速度線特效（蓋火鍋、抄截、接球）。
import * as THREE from 'three'

const STYLES = {
  block: { color: '#ff9d47', core: '#fff5d6', spikes: 6, radius: 1.05, duration: 0.28 },
  steal: { color: '#64dcff', core: '#ffffff', spikes: 4, radius: 0.78, duration: 0.22 },
  catch: { color: '#fcf9f2', core: '#ffd98a', spikes: 0, radius: 0.42, duration: 0.18 },
}

// 單一衝擊波實例：一個外擴圓環＋中心閃光＋幾道放射狀速度尖刺
function createBurst(scene) {
  const group = new THREE.Group()
  group.visible = false
  group.renderOrder = 6

  const ringMat = new THREE.MeshBasicMaterial({
    color: '#ff9d47',
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  })
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.76, 1.0, 24), ringMat)
  group.add(ring)

  const coreMat = new THREE.MeshBasicMaterial({
    color: '#fff5d6',
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  })
  const core = new THREE.Mesh(new THREE.CircleGeometry(0.45, 20), coreMat)
  group.add(core)

  // 放射狀尖刺（手繪衝擊線）
  const spikeGeo = new THREE.BufferGeometry()
  spikeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.06, 0.55, 0, 0.06, 0.55, 0, 0, 1.35, 0]), 3))
  const spikeMat = new THREE.MeshBasicMaterial({
    color: '#fff5d6',
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  })
  const spikes = Array.from({ length: 6 }, (_, i) => {
    const spike = new THREE.Mesh(spikeGeo, spikeMat)
    spike.rotation.z = (i / 6) * Math.PI * 2
    group.add(spike)
    return spike
  })

  scene.add(group)
  return { group, ring, ringMat, core, coreMat, spikes, spikeMat, active: false, t: 0, style: STYLES.block }
}

export function createImpactEffects(scene) {
  const pool = Array.from({ length: 6 }, () => createBurst(scene))
  let nextIndex = 0

  function trigger(kind, position) {
    const style = STYLES[kind] ?? STYLES.catch
    const item = pool.find((b) => !b.active) ?? pool[nextIndex++ % pool.length]
    item.active = true
    item.t = 0
    item.style = style
    item.group.position.copy(position)
    item.group.visible = true
    item.ringMat.color.set(style.color)
    item.coreMat.color.set(style.core)
    item.spikeMat.color.set(style.core)
    const offset = Math.random() * Math.PI
    item.spikes.forEach((spike, i) => {
      spike.visible = i < style.spikes
      if (style.spikes > 0) spike.rotation.z = offset + (i / style.spikes) * Math.PI * 2
    })
  }

  function update(delta, camera) {
    for (const item of pool) {
      if (!item.active) continue
      item.t += delta
      const k = item.t / item.style.duration
      if (k >= 1) {
        item.active = false
        item.group.visible = false
        continue
      }
      const easeOut = 1 - (1 - k) ** 3
      item.group.quaternion.copy(camera.quaternion)
      item.ring.scale.setScalar(Math.max(0.15, item.style.radius * easeOut))
      item.ringMat.opacity = (1 - k) * 0.9
      item.core.scale.setScalar(Math.max(0.08, item.style.radius * 0.55 * (1 - k * 0.6)))
      item.coreMat.opacity = Math.max(0, 1 - k * 1.8) * 0.85
      if (item.style.spikes > 0) {
        const s = item.style.radius * (0.45 + 0.7 * easeOut)
        item.spikeMat.opacity = (1 - k) * 0.85
        for (const spike of item.spikes) {
          if (spike.visible) spike.scale.setScalar(s)
        }
      }
    }
  }

  return { trigger, update }
}
