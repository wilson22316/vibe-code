<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { createGallery } from '../gallery/scene.js'
import { createHighlightReel } from './highlightReel.js'
import { DEFAULT_COLORS, KITS, loadColors, saveColors } from './teamColors.js'

// 主畫面背景：夜晚球場的精華片段（見 highlightReel.js），鏡頭由導播控制；畫面中心往右移，左邊留給選單
const BACKDROP = { setting: 'night-court', clip: 'Crossover', viewShift: 0.16 }

// 比分看板：主隊每次灌籃 +2 反超；重播轉場時回到原本的比分
const START_SCORE = { home: 86, away: 87 }
const GAME_CLOCK = 120 // 第四節剩下的秒數，倒數到 0 再重來
const SHOT_CLOCK = 24

const emit = defineEmits(['start'])

// 選單項目：to 是要切到的畫面；play 是要開始的遊戲畫面；soon 表示還沒做好（顯示「即將推出」、不能點）
const MAIN_ITEMS = [
  { label: '開始遊戲', to: 'modes' },
  { label: '練習模式', play: 'practice' },
  { label: '教學模式', soon: true },
  { label: '隊伍配色', to: 'colors' },
  { label: '操作說明', to: 'controls' },
]
const MODES = [
  { label: '1 對 1', note: '半場', play: 'duel' },
  { label: '3 對 3', note: '半場', soon: true },
  { label: '5 對 5', note: '全場', soon: true },
]
// 按鍵配置；投籃、傳球還沒做好（見 TODO.md）
const KEYS = [
  ['方向鍵', '移動'],
  ['A', '突破（按著方向鍵時爆發加速）'],
  ['空白鍵', '投籃（按住蓄力、放開出手；衝到籃下自動上籃或灌籃）'],
  ['D', '請隊友傳球'],
  ['F', '傳球'],
  ['空白鍵（沒持球時）', '跳起封阻、搶籃板'],
  ['A（防守時）', '按住自動跟防（放開方向鍵）'],
  ['D（防守時）', '抄球'],
  ['V', '顯示／隱藏遊戲中的操作說明'],
  ['Esc', '暫停／返回'],
]

const stage = ref(null)
const status = ref('載入中…')
const screen = ref('main') // main | modes | colors | controls
const colors = ref(loadColors())
let backdrop = null

const score = ref({ ...START_SCORE })
const scored = ref(false) // 剛得分：比分跳一下
const gameClock = ref(GAME_CLOCK)
const shotClock = ref(SHOT_CLOCK)
const wipeKey = ref(0) // 每次重播轉場加 1，讓轉場動畫重新播放
let ticker = 0

// 客隊配色：和主隊不同的一套
const awayColor = computed(() => (colors.value.shirt === KITS[4].shirt ? KITS[1].shirt : KITS[4].shirt))
const clockText = computed(() => `${Math.floor(gameClock.value / 60)}:${String(gameClock.value % 60).padStart(2, '0')}`)

const reel = createHighlightReel({
  onScore() {
    score.value.home += 2
    shotClock.value = SHOT_CLOCK
    scored.value = false
    requestAnimationFrame(() => (scored.value = true))
  },
  onWipe() {
    wipeKey.value++
    setTimeout(() => {
      score.value = { ...START_SCORE }
      scored.value = false
    }, 400)
  },
})

function tick() {
  gameClock.value = gameClock.value > 0 ? gameClock.value - 1 : GAME_CLOCK
  shotClock.value = shotClock.value > 0 ? shotClock.value - 1 : SHOT_CLOCK
}

function open(item) {
  if (item.soon) return
  if (item.play) emit('start', item.play)
  else screen.value = item.to
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
  backdrop = createGallery(stage.value, { interactive: false, ...BACKDROP, onFrame: (delta) => reel.update(delta) })
  backdrop.setTeamColors(colors.value)
  backdrop.ready.then(
    () => {
      status.value = ''
      reel.start(backdrop)
    },
    (err) => {
      status.value = `模型載入失敗：${err.message ?? err}`
      console.error(err)
    },
  )
  window.addEventListener('keydown', onKey)
  ticker = setInterval(tick, 1000)
})

onBeforeUnmount(() => {
  clearInterval(ticker)
  window.removeEventListener('keydown', onKey)
  backdrop?.dispose()
})
</script>

<template>
  <div ref="stage" class="stage"></div>
  <p v-if="status" class="status">{{ status }}</p>

  <!-- 轉播畫面右上角的比分看板 -->
  <div class="scorebug" aria-hidden="true">
    <span class="live"><i></i>LIVE</span>
    <span class="team" :style="{ '--team': colors.shirt }">HOME</span>
    <b class="score" :class="{ pop: scored }">{{ score.home }}</b>
    <b class="score">{{ score.away }}</b>
    <span class="team" :style="{ '--team': awayColor }">AWAY</span>
    <span class="period">Q4</span>
    <span class="clock">{{ clockText }}</span>
    <span class="shot">{{ shotClock }}</span>
  </div>

  <!-- 重播轉場：斜切的色帶掃過畫面，蓋滿時鏡頭換回第一個畫面 -->
  <div v-if="wipeKey" :key="wipeKey" class="wipe" :style="{ '--team': colors.shirt }" aria-hidden="true">
    <span>REPLAY</span>
  </div>

  <main class="menu">
    <h1 class="title">バスケ！</h1>

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
        <button v-for="mode in MODES" :key="mode.label" type="button" class="item" :disabled="mode.soon" @click="open(mode)">
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
      <p class="note">目前練習模式可以移動、衝刺、跳投、上籃和灌籃，投完要自己走過去撿球；傳球之後加上。</p>
      <button type="button" class="back" @click="back">返回</button>
    </section>
  </main>
</template>

<style scoped>
.menu {
  position: fixed;
  top: 0;
  bottom: 0;
  left: max(16px, 5vw);
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 18px;
  width: min(360px, calc(100vw - 32px));
  color: #fcf9f2;
  font-family: sans-serif;
}

.title {
  margin: 0 0 6px;
  color: #ffd98a;
  font-size: clamp(44px, 9vw, 76px);
  font-style: italic;
  font-weight: 900;
  letter-spacing: 0.04em;
  -webkit-text-stroke: 3px #4a3326;
  paint-order: stroke fill;
  /* 夜色裡用橘色的立體陰影加暖光，深色描邊才不會被背景吃掉 */
  text-shadow:
    0 5px 0 #e0733f,
    0 8px 0 #4a3326,
    0 0 28px rgba(255, 190, 110, 0.55);
  animation: title-in 0.6s cubic-bezier(0.2, 1.6, 0.4, 1) both;
}

@keyframes title-in {
  from {
    opacity: 0;
    transform: translateX(-40px) skewX(-12deg);
  }
}

/* 轉播字卡風格：深色半透明底、左邊橘色色條、右下斜切 */
.panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 18px 26px 18px 20px;
  border-left: 6px solid #e0733f;
  background: linear-gradient(100deg, rgba(21, 27, 58, 0.9), rgba(21, 27, 58, 0.62));
  clip-path: polygon(0 0, 100% 0, calc(100% - 18px) 100%, 0 100%);
}

h2 {
  margin: 0;
  color: #ffd98a;
  font-size: 15px;
  font-style: italic;
  letter-spacing: 0.2em;
}

.items {
  display: flex;
  flex-direction: column;
  gap: 10px;
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
  padding: 11px 24px 11px 16px;
  border: none;
  background: #fcf9f2;
  color: #2b2f5e;
  font-size: 18px;
  font-style: italic;
  font-weight: 900;
  text-align: left;
  clip-path: polygon(0 0, 100% 0, calc(100% - 14px) 100%, 0 100%);
  transition:
    transform 0.15s,
    background 0.15s,
    color 0.15s;
  animation: slide-in 0.4s both;
}

.item:nth-child(2) {
  animation-delay: 0.05s;
}

.item:nth-child(3) {
  animation-delay: 0.1s;
}

.item:nth-child(4) {
  animation-delay: 0.15s;
}

.item:nth-child(5) {
  animation-delay: 0.2s;
}

@keyframes slide-in {
  from {
    opacity: 0;
    transform: translateX(-30px);
  }
}

.item:hover:not(:disabled),
.item:focus-visible {
  background: #e0733f;
  color: #fff;
  transform: translateX(10px);
}

.item:disabled {
  background: rgba(252, 249, 242, 0.22);
  color: rgba(252, 249, 242, 0.6);
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
  background: #e0733f;
  color: #fff;
  font-size: 12px;
  font-style: normal;
  font-weight: normal;
}

.back {
  padding: 8px 16px;
  border: 2px solid #fcf9f2;
  background: transparent;
  font-style: italic;
  font-weight: bold;
}

.back:hover,
.back:focus-visible {
  background: #fcf9f2;
  color: #2b2f5e;
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
  border-color: #ffd98a;
  background: rgba(252, 249, 242, 0.12);
}

.swatch {
  display: flex;
  flex-direction: column;
  width: 36px;
  border: 2px solid #fcf9f2;
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
  border: 2px solid #fcf9f2;
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
  border-bottom: 1px solid rgba(252, 249, 242, 0.2);
  text-align: left;
  vertical-align: top;
}

.keys th {
  padding-right: 12px;
  color: #ffd98a;
  white-space: nowrap;
}

.note {
  margin: 0;
  color: rgba(252, 249, 242, 0.7);
  font-size: 13px;
}

/* 比分看板 */
.scorebug {
  position: fixed;
  top: 16px;
  right: 16px;
  display: flex;
  align-items: stretch;
  height: 36px;
  border-bottom: 3px solid #e0733f;
  background: rgba(21, 27, 58, 0.9);
  color: #fcf9f2;
  font: italic 900 16px sans-serif;
  clip-path: polygon(12px 0, 100% 0, 100% 100%, 0 100%);
}

.scorebug > * {
  display: flex;
  align-items: center;
  padding: 0 10px;
}

.live {
  gap: 6px;
  padding-left: 20px !important;
  background: #c7384e;
  font-size: 12px;
  letter-spacing: 0.1em;
}

.live i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #fff;
  animation: blink 1s steps(2) infinite;
}

@keyframes blink {
  50% {
    opacity: 0.2;
  }
}

.team {
  border-left: 6px solid var(--team);
  font-size: 13px;
  letter-spacing: 0.1em;
}

.score {
  justify-content: center;
  min-width: 2.2ch;
  background: rgba(252, 249, 242, 0.1);
  font-size: 20px;
  font-variant-numeric: tabular-nums;
}

.score.pop {
  animation: pop 0.6s;
}

@keyframes pop {
  30% {
    color: #ffd98a;
    transform: scale(1.4);
  }
}

.period,
.clock {
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}

.shot {
  justify-content: center;
  min-width: 2ch;
  background: #e0733f;
  font-variant-numeric: tabular-nums;
}

/* 重播轉場：色帶從畫面外左邊掃到畫面外右邊，一半時間（0.4 s）時剛好蓋滿畫面（-35vw～135vw） */
.wipe {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  pointer-events: none;
}

.wipe::before {
  content: '';
  position: absolute;
  top: -10%;
  bottom: -10%;
  left: 0;
  width: 170vw;
  border-right: 14px solid #ffd98a;
  border-left: 14px solid #e0733f;
  background:
    repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.12) 0 18px, transparent 18px 46px),
    var(--team);
  transform: translateX(-200vw) skewX(-14deg);
  animation: wipe 0.8s ease-in-out forwards;
}

.wipe span {
  position: relative;
  color: #fcf9f2;
  font: italic 900 clamp(40px, 8vw, 72px) sans-serif;
  letter-spacing: 0.1em;
  -webkit-text-stroke: 3px #4a3326;
  paint-order: stroke fill;
  opacity: 0;
  animation: wipe-text 0.8s forwards;
}

@keyframes wipe {
  to {
    transform: translateX(130vw) skewX(-14deg);
  }
}

@keyframes wipe-text {
  35%,
  65% {
    opacity: 1;
  }
}
</style>
