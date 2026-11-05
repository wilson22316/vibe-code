<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { createGallery } from './gallery/scene.js'

const stage = ref(null)
const status = ref('模型載入中…')
// 只放動作名稱字串；three.js 物件留在 scene.js
const clips = ref([])
const current = ref('')
const speed = ref(1)
let gallery = null

function select(name) {
  gallery.play(name)
  current.value = name
}

watch(speed, (value) => gallery.setSpeed(value))

const showSkeleton = ref(false)
watch(showSkeleton, (value) => gallery.setSkeletonVisible(value))

const showGrid = ref(false)
watch(showGrid, (value) => gallery.setGridVisible(value))

const movePush = ref(false)
watch(movePush, (value) => gallery.setMovePush(value))

onMounted(() => {
  gallery = createGallery(stage.value)
  gallery.ready.then(
    (info) => {
      status.value = ''
      clips.value = info.clips
      current.value = info.current
    },
    (err) => {
      status.value = `模型載入失敗：${err.message ?? err}`
      console.error(err)
    },
  )
})

onBeforeUnmount(() => {
  gallery?.dispose()
})
</script>

<template>
  <div ref="stage" class="stage"></div>
  <p v-if="status" class="status">{{ status }}</p>
  <nav v-if="clips.length" class="clips">
    <button
      v-for="name in clips"
      :key="name"
      type="button"
      :class="{ active: name === current }"
      :aria-pressed="name === current"
      @click="select(name)"
    >
      {{ name }}
    </button>
    <label class="speed">
      速度
      <input
        v-model.number="speed"
        type="range"
        min="0.1"
        max="2"
        step="0.1"
      />
      <span>{{ speed.toFixed(1) }}×</span>
    </label>
    <label class="toggle">
      <input v-model="showSkeleton" type="checkbox" />
      骨架
    </label>
    <label class="toggle">
      <input v-model="showGrid" type="checkbox" />
      格線
    </label>
    <label class="toggle">
      <input v-model="movePush" type="checkbox" />
      前進
    </label>
  </nav>
</template>

<style>
html,
body,
#app {
  margin: 0;
  height: 100%;
}

.stage {
  position: fixed;
  inset: 0;
  overflow: hidden;
}

.status {
  position: fixed;
  top: 16px;
  left: 16px;
  margin: 0;
  padding: 6px 12px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.85);
  color: #4a3326;
  font: 14px sans-serif;
}

.clips {
  position: fixed;
  top: 16px;
  left: 16px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.clips button {
  padding: 6px 14px;
  border: 1px solid #4a3326;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.85);
  color: #4a3326;
  font: 14px sans-serif;
  cursor: pointer;
}

.clips button.active {
  background: #6aa79c;
  color: #fff;
}

.speed,
.toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.85);
  color: #4a3326;
  font: 14px sans-serif;
}

.toggle {
  gap: 4px;
  cursor: pointer;
}

.speed span {
  min-width: 3ch;
  font-variant-numeric: tabular-nums;
}
</style>
