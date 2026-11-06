<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { createGallery } from '../gallery/scene.js'
import { loadColors } from '../menu/teamColors.js'
import { createPracticeControls } from './practice.js'

// 練習模式：夜晚半場，方向鍵移動、按住 A 衝刺（見 practice.js）。Esc 暫停。
const emit = defineEmits(['exit'])

const stage = ref(null)
const status = ref('載入中…')
const paused = ref(false)
let court = null
const controls = createPracticeControls()

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
  window.removeEventListener('keydown', onKey)
  controls.stop()
  court?.dispose()
})
</script>

<template>
  <div ref="stage" class="stage"></div>
  <p v-if="status" class="status">{{ status }}</p>

  <div class="hint" aria-hidden="true">
    <span><kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> 移動</span>
    <span><kbd>A</kbd> 衝刺（按住）</span>
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
