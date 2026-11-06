<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { createGallery } from '../gallery/scene.js'
import { loadColors } from '../menu/teamColors.js'
import { createPracticeControls } from './practice.js'

// 練習模式：夜晚半場，方向鍵移動、按住 A 衝刺、按住空白鍵蓄力放開跳投（可以邊移動，見 practice.js）。Esc 暫停。
const emit = defineEmits(['exit'])

const stage = ref(null)
const status = ref('載入中…')
const paused = ref(false)
const charge = ref(null) // 蓄力中：{ power, ideal, perfect, good }（0～1）
const stats = ref({ shots: 0, makes: 0 })
const toast = ref(null) // { message, made }
const grade = ref(null) // 放開空白鍵時的判定：perfect、good、miss
let toastTimer = 0
let gradeTimer = 0
let court = null
const GRADE_LABELS = { perfect: 'PERFECT', good: 'GOOD', miss: 'MISS', layup: 'LAYUP', dunk: 'DUNK!' }
const controls = createPracticeControls({
  onCharge(value) {
    charge.value = value
  },
  onShot(value) {
    grade.value = value
    clearTimeout(gradeTimer)
    gradeTimer = setTimeout(() => (grade.value = null), 1200)
  },
  onResult({ made, message, shots, makes }) {
    stats.value = { shots, makes }
    toast.value = { message, made }
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => (toast.value = null), 1800)
  },
})

const percent = (x) => `${(x * 100).toFixed(1)}%`
// 判定區（以理想力道為中心、左右各 half 寬）在蓄力條上的位置
const zone = (ideal, half) => ({ left: percent(ideal - half), width: percent(half * 2) })

function setPaused(value) {
  paused.value = value
  court?.setSpeed(value ? 0 : 1)
}

function onKey(event) {
  if (event.key === 'Escape') setPaused(!paused.value)
}

onMounted(() => {
  court = createGallery(stage.value, {
    interactive: false,
    setting: 'night-court',
    clip: 'Dribble',
    onFrame: (delta) => controls.update(delta, paused.value),
  })
  court.setTeamColors(loadColors())
  court.ready.then(
    () => {
      status.value = ''
      controls.start(court)
    },
    (err) => {
      status.value = `模型載入失敗：${err.message ?? err}`
      console.error(err)
    },
  )
  window.addEventListener('keydown', onKey)
})

onBeforeUnmount(() => {
  clearTimeout(toastTimer)
  clearTimeout(gradeTimer)
  window.removeEventListener('keydown', onKey)
  controls.stop()
  court?.dispose()
})
</script>

<template>
  <div ref="stage" class="stage"></div>
  <p v-if="status" class="status">{{ status }}</p>

  <div class="stats">
    <span>投籃 <b>{{ stats.shots }}</b></span>
    <span>命中 <b>{{ stats.makes }}</b></span>
    <span>命中率 <b>{{ stats.shots ? `${Math.round((stats.makes / stats.shots) * 100)}%` : '—' }}</b></span>
  </div>

  <p v-if="toast" class="toast" :class="{ made: toast.made }">{{ toast.message }}</p>

  <!-- 蓄力條：顏色從綠到紅；亮框是 GOOD 區、中間的白色小區間是 PERFECT -->
  <div v-if="charge" class="meter" aria-hidden="true">
    <div class="fill" :style="{ clipPath: `inset(0 ${percent(1 - charge.power)} 0 0)` }"></div>
    <template v-if="charge.ideal !== null">
      <div class="zone good" :style="zone(charge.ideal, charge.good)"></div>
      <div class="zone perfect" :style="zone(charge.ideal, charge.perfect)"></div>
    </template>
  </div>
  <p v-if="grade" class="grade" :class="grade">{{ GRADE_LABELS[grade] }}</p>

  <div class="hint" aria-hidden="true">
    <span><kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> 移動</span>
    <span><kbd>A</kbd> 衝刺（按住）</span>
    <span><kbd>空白鍵</kbd> 按住蓄力、放開投籃（衝向籃框時上籃，加 <kbd>A</kbd> 灌籃）</span>
    <span><kbd>Esc</kbd> 暫停</span>
  </div>

  <div v-if="paused" class="pause">
    <section class="panel">
      <h2>暫停</h2>
      <button type="button" class="item" @click="setPaused(false)">繼續練習</button>
      <button type="button" class="item" @click="emit('exit')">回主畫面</button>
    </section>
  </div>
</template>

<style scoped>
.hint {
  position: fixed;
  left: 16px;
  bottom: 16px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  padding: 8px 14px;
  border-radius: 6px;
  background: rgba(21, 27, 58, 0.72);
  color: #fcf9f2;
  font: 14px sans-serif;
}

.stats {
  position: fixed;
  top: 16px;
  right: 16px;
  display: flex;
  gap: 16px;
  padding: 8px 14px;
  border-radius: 6px;
  background: rgba(21, 27, 58, 0.72);
  color: #fcf9f2;
  font: 14px sans-serif;
}

.stats b {
  margin-left: 4px;
  color: #ffd98a;
  font-size: 18px;
}

.toast {
  position: fixed;
  bottom: 140px;
  left: 50%;
  margin: 0;
  padding: 10px 22px;
  border-radius: 6px;
  background: rgba(21, 27, 58, 0.85);
  color: #fcf9f2;
  font: bold 22px sans-serif;
  transform: translateX(-50%);
}

.toast.made {
  background: #e0733f;
}

.meter {
  position: fixed;
  left: 50%;
  bottom: 72px;
  width: min(360px, 70vw);
  height: 16px;
  border: 2px solid #fcf9f2;
  border-radius: 4px;
  background: rgba(21, 27, 58, 0.72);
  transform: translateX(-50%);
}

.meter {
  overflow: hidden;
}

.meter .fill {
  height: 100%;
  background: linear-gradient(90deg, #4cc46a, #f2d64b 50%, #e04a3a);
}

.meter .zone {
  position: absolute;
  top: 0;
  bottom: 0;
}

.meter .good {
  border: 2px solid #fcf9f2;
  background: rgba(252, 249, 242, 0.25);
  box-sizing: border-box;
}

.meter .perfect {
  background: #fcf9f2;
}

.grade {
  position: fixed;
  left: 50%;
  bottom: 96px;
  margin: 0;
  color: #fcf9f2;
  font: italic bold 26px sans-serif;
  text-shadow: 2px 2px 0 #2b201b;
  transform: translateX(-50%);
}

.grade.perfect {
  color: #ffd98a;
}

.grade.miss {
  color: #c9c3d9;
}

kbd {
  display: inline-block;
  min-width: 1.4em;
  margin-right: 3px;
  padding: 1px 4px;
  border-radius: 4px;
  background: #fcf9f2;
  color: #2b201b;
  font: bold 12px sans-serif;
  text-align: center;
}

.pause {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgba(21, 27, 58, 0.55);
}

.panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 240px;
  padding: 20px 24px;
  border-radius: 8px;
  background: rgba(21, 27, 58, 0.9);
  color: #fcf9f2;
  font-family: sans-serif;
}

h2 {
  margin: 0 0 6px;
  font-size: 20px;
}

.item {
  padding: 10px 14px;
  border: 0;
  border-radius: 4px;
  background: #fcf9f2;
  color: #2b201b;
  font: bold 16px sans-serif;
  text-align: left;
  cursor: pointer;
}

.item:hover,
.item:focus-visible {
  background: #e0733f;
  color: #fcf9f2;
}
</style>
