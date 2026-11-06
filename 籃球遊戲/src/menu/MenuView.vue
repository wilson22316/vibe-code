<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { createGallery } from '../gallery/scene.js'
import { DEFAULT_COLORS, KITS, loadColors, saveColors } from './teamColors.js'

// 主畫面背景：角色在畫面右側原地運球，鏡頭固定（不能拖曳）
const BACKDROP = {
  clip: 'Dribble',
  view: { position: { x: -0.35, y: 1.15, z: 3.6 }, target: { x: -0.75, y: 0.85, z: 0 } },
}

// 選單項目：to 是要切到的畫面；soon 表示還沒做好（顯示「即將推出」、不能點）
const MAIN_ITEMS = [
  { label: '開始遊戲', to: 'modes' },
  { label: '練習模式', soon: true },
  { label: '教學模式', soon: true },
  { label: '隊伍配色', to: 'colors' },
  { label: '操作說明', to: 'controls' },
]
const MODES = [
  { label: '1 對 1', note: '半場', soon: true },
  { label: '3 對 3', note: '半場', soon: true },
  { label: '5 對 5', note: '全場', soon: true },
]
// 暫定的按鍵配置，做練習模式時再確定
const KEYS = [
  ['W A S D／方向鍵', '移動'],
  ['Shift', '衝刺'],
  ['空白鍵', '投籃（按住蓄力、放開出手；衝到籃下自動上籃或灌籃）'],
  ['E', '傳球'],
  ['Q', '切換操控的球員'],
  ['空白鍵（防守時）', '跳起封阻、搶籃板'],
  ['Esc', '暫停／返回'],
]

const stage = ref(null)
const status = ref('載入中…')
const screen = ref('main') // main | modes | colors | controls
const colors = ref(loadColors())
let backdrop = null

function open(item) {
  if (!item.soon) screen.value = item.to
}

function back() {
  screen.value = 'main'
}

function pickKit(kit) {
  colors.value = { shirt: kit.shirt, shorts: kit.shorts }
}

function isKit(kit) {
  return kit.shirt === colors.value.shirt && kit.shorts === colors.value.shorts
}

watch(
  colors,
  (value) => {
    backdrop?.setTeamColors(value)
    saveColors(value)
  },
  { deep: true },
)

function onKey(event) {
  if (event.key === 'Escape' && screen.value !== 'main') back()
}

onMounted(() => {
  backdrop = createGallery(stage.value, { interactive: false, clip: BACKDROP.clip, view: BACKDROP.view })
  backdrop.setTeamColors(colors.value)
  backdrop.ready.then(
    () => {
      status.value = ''
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
  backdrop?.dispose()
})
</script>

<template>
  <div ref="stage" class="stage"></div>
  <p v-if="status" class="status">{{ status }}</p>

  <main class="menu">
    <h1 class="title">籃球遊戲</h1>

    <nav v-if="screen === 'main'" class="panel items">
      <button
        v-for="item in MAIN_ITEMS"
        :key="item.label"
        type="button"
        class="item"
        :disabled="item.soon"
        @click="open(item)"
      >
        {{ item.label }}
        <span v-if="item.soon" class="soon">即將推出</span>
      </button>
    </nav>

    <section v-else-if="screen === 'modes'" class="panel">
      <h2>選擇模式</h2>
      <div class="items">
        <button v-for="mode in MODES" :key="mode.label" type="button" class="item" :disabled="mode.soon">
          {{ mode.label }}
          <small>{{ mode.note }}</small>
          <span v-if="mode.soon" class="soon">即將推出</span>
        </button>
      </div>
      <button type="button" class="back" @click="back">返回</button>
    </section>

    <section v-else-if="screen === 'colors'" class="panel">
      <h2>隊伍配色</h2>
      <div class="kits">
        <button
          v-for="kit in KITS"
          :key="kit.name"
          type="button"
          class="kit"
          :class="{ active: isKit(kit) }"
          :aria-pressed="isKit(kit)"
          @click="pickKit(kit)"
        >
          <span class="swatch">
            <span :style="{ background: kit.shirt }"></span>
            <span :style="{ background: kit.shorts }"></span>
          </span>
          {{ kit.name }}
        </button>
      </div>
      <label class="custom">
        球衣
        <input v-model="colors.shirt" type="color" />
      </label>
      <label class="custom">
        短褲
        <input v-model="colors.shorts" type="color" />
      </label>
      <div class="row">
        <button type="button" class="back" @click="pickKit(DEFAULT_COLORS)">恢復預設</button>
        <button type="button" class="back" @click="back">返回</button>
      </div>
    </section>

    <section v-else-if="screen === 'controls'" class="panel">
      <h2>操作說明</h2>
      <table class="keys">
        <tr v-for="[key, action] in KEYS" :key="key">
          <th>{{ key }}</th>
          <td>{{ action }}</td>
        </tr>
      </table>
      <p class="note">按鍵配置是暫定的，做練習模式時再確定。</p>
      <button type="button" class="back" @click="back">返回</button>
    </section>
  </main>
</template>

<style scoped>
.menu {
  position: fixed;
  top: 0;
  bottom: 0;
  left: max(16px, 6vw);
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 20px;
  width: min(360px, calc(100vw - 32px));
  color: #4a3326;
  font-family: sans-serif;
}

.title {
  margin: 0;
  color: #fcf9f2;
  font-size: clamp(36px, 7vw, 56px);
  letter-spacing: 0.08em;
  -webkit-text-stroke: 2px #4a3326;
  paint-order: stroke fill;
  text-shadow: 0 4px 0 #4a3326;
}

.panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px;
  border: 2px solid #4a3326;
  border-radius: 14px;
  background: rgba(252, 249, 242, 0.92);
  box-shadow: 0 4px 0 #4a3326;
}

h2 {
  margin: 0;
  font-size: 20px;
}

.items {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

nav.items {
  padding: 20px;
}

button {
  font: inherit;
  color: inherit;
  cursor: pointer;
}

.item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 12px 16px;
  border: 2px solid #4a3326;
  border-radius: 10px;
  background: #6aa79c;
  color: #fff;
  font-size: 18px;
  font-weight: bold;
  text-align: left;
}

.item:hover:not(:disabled),
.item:focus-visible {
  background: #5a9488;
}

.item:disabled {
  background: #e4ddd0;
  color: #8a7a6c;
  cursor: not-allowed;
}

.item small {
  font-size: 14px;
  font-weight: normal;
}

.soon {
  margin-left: auto;
  padding: 2px 8px;
  border-radius: 999px;
  background: #d97b5c;
  color: #fff;
  font-size: 12px;
  font-weight: normal;
}

.back {
  padding: 8px 16px;
  border: 2px solid #4a3326;
  border-radius: 10px;
  background: #fcf9f2;
}

.row {
  display: flex;
  gap: 10px;
}

.kits {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.kit {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 4px;
  border: 2px solid transparent;
  border-radius: 10px;
  background: transparent;
  font-size: 14px;
}

.kit.active {
  border-color: #4a3326;
  background: #fff;
}

.swatch {
  display: flex;
  flex-direction: column;
  width: 36px;
  border: 2px solid #4a3326;
  border-radius: 6px;
  overflow: hidden;
}

.swatch span {
  height: 16px;
}

.custom {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.custom input {
  width: 56px;
  height: 32px;
  padding: 0;
  border: 2px solid #4a3326;
  border-radius: 6px;
  background: none;
  cursor: pointer;
}

.keys {
  border-collapse: collapse;
  font-size: 14px;
}

.keys th,
.keys td {
  padding: 6px 4px;
  border-bottom: 1px solid #d8cfc0;
  text-align: left;
  vertical-align: top;
}

.keys th {
  white-space: nowrap;
  padding-right: 12px;
}

.note {
  margin: 0;
  font-size: 13px;
  color: #8a7a6c;
}
</style>
