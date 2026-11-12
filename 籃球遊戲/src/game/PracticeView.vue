<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { createGallery } from '../gallery/scene.js'
import { KITS, loadColors } from '../menu/teamColors.js'
import { LEVELS, SHOT_CLOCK, WIN_SCORE, createDuel } from './duel.js'
import { createPracticeControls } from './practice.js'
import { loadRecords, recordGame, saveLevel } from './records.js'
import { play as playSound, unlock as unlockSound } from './sound.js'

// 練習模式：夜晚半場，方向鍵移動、按住 A 衝刺、按下空白鍵起跳、按住加力道、放開出手（見 practice.js）。Esc 暫停。
// mode 是 'duel' 時是 1 對 1：操控相同，場上多一個 AI 對手，輪流進攻、計分（見 duel.js）。
const props = defineProps({ mode: { type: String, default: 'practice' } })
const emit = defineEmits(['exit'])

const stage = ref(null)
const status = ref('載入中…')
const paused = ref(false)
const showHint = ref(true) // 左上角的操作說明，按 V 切換
const charge = ref(null) // 蓄力中：{ power, ideal, perfect, good }（0～1）
const stats = ref({ shots: 0, makes: 0 })
const toast = ref(null) // { message, made }
const grade = ref(null) // 放開空白鍵時的判定：perfect、good、miss
let toastTimer = 0
let gradeTimer = 0
let court = null
const GRADE_LABELS = { perfect: 'PERFECT', good: 'GOOD', miss: 'MISS', late: 'LATE', layup: 'LAYUP', dunk: 'DUNK!' }

function showToast(message, made) {
  toast.value = { message, made }
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = null), 1800)
}

// ===== 演出可以調整的參數 =====
// 慢動作：[播放速度, 持續幾秒（實際時間）]；震動：鏡頭晃動的幅度（公尺），每秒衰減到 e^-SHAKE_DECAY
const SLOW = { dunk: [0.35, 0.7], block: [0.3, 0.5], final: [0.25, 1.6] }
const SHAKE = { dunk: 0.22, block: 0.16, final: 0.3 }
const SHAKE_DECAY = 7
// 絕殺重播：最後一球進了、慢動作結束後，換個角度重播最後 seconds 秒（遊戲時間），播放速度 speed。
// 鏡頭在「得分的人 → 籃框」這條線的側面，同時拍到兩邊：離這條線至少 side m（線越長離越遠，乘 spread），
// 高 height m，看向線中點、高 look m 的地方。按空白鍵或 Enter 跳過
const REPLAY = { seconds: 3.2, speed: 0.55, side: 5, spread: 1.1, height: 2.6, look: 1.9 }
const FENCE_X = 9.5 // 重播鏡頭左右最遠到哪（再遠就在圍欄外了）
// ==============================

// 畫面中央的大字（GAME POINT、ON FIRE 等），過一下自己消失
const banner = ref(null)
let bannerTimer = 0
function showBanner(text, kind = '') {
  banner.value = { text, kind }
  clearTimeout(bannerTimer)
  bannerTimer = setTimeout(() => (banner.value = null), 1400)
}

// 慢動作和鏡頭震動（在 onFrame 裡套用）
let slowScale = 1
let slowLeft = 0
let shake = 0
function moment(kind) {
  ;[slowScale, slowLeft] = SLOW[kind]
  shake = Math.max(shake, SHAKE[kind])
}

// 1 對 1：分數、球權、著火、難度、結果
const match = ref({ you: 0, foe: 0, offense: 'you', fire: { you: false, foe: false } })
const winner = ref(null) // 'you' 或 'foe'（結果畫面跳出來時才設）
const level = ref(null) // 選好難度才開始；null 時顯示難度選單
const records = ref(loadRecords())
const summary = ref(null) // 賽後數據：{ stats, seconds, grade, records }
const shotClock = ref(SHOT_CLOCK)
const stamina = ref(1)
const tired = ref(false)
let ended = false // 最後一球進了（結果畫面還沒跳出來）
let endWinner = null
// 重播：tape 是最近幾秒每一格的紀錄（{ t 遊戲時間, you, foe }），replay 是正在重播的進度
let tape = []
let gameTime = 0
let replay = null // { t 播到的遊戲時間, i 目前在 tape 的第幾格 }
const replaying = ref(false)
// 計分板最下面那行：要清球時提醒，不然顯示賽末點或獲勝分數
const boardNote = computed(() => {
  if (match.value.clear) return match.value.offense === 'you' ? '帶出三分線！' : '對手清球中'
  return gamePoint.value ? 'GAME POINT' : `先得 ${WIN_SCORE} 分`
})
const gamePoint = computed(() => !winner.value && Math.max(match.value.you, match.value.foe) >= WIN_SCORE - 1)

// 評價：贏多少、命中率多高
function gradeGame(won, stats, margin) {
  const rate = stats.you.shots ? stats.you.makes / stats.you.shots : 0
  if (!won) return margin >= -3 ? 'C' : 'D'
  if (margin >= 6 && rate >= 0.6) return 'S'
  return margin >= 3 ? 'A' : 'B'
}

const duel =
  props.mode === 'duel'
    ? createDuel({
        onSound: playSound,
        onScore(value) {
          const wasPoint = gamePoint.value
          match.value = value
          if (gamePoint.value && !wasPoint) showBanner('GAME POINT', 'point')
        },
        onMessage: (message) => showToast(message, false),
        onMoment(kind) {
          if (kind === 'block') {
            moment('block')
            showBanner('BLOCK!')
          } else if (kind === 'fire') showBanner('ON FIRE!', 'fire')
        },
        onEnd(who, stats) {
          ended = true
          moment('final')
          showBanner(who === 'you' ? 'YOU WIN!' : 'GAME OVER', who === 'you' ? 'fire' : '')
          const won = who === 'you'
          summary.value = {
            stats: JSON.parse(JSON.stringify(stats)),
            seconds: elapsed.value,
            grade: gradeGame(won, stats, match.value.you - match.value.foe),
            records: recordGame(won, elapsed.value),
          }
          records.value = loadRecords()
          endWinner = who // 慢動作結束後開始重播，重播完才跳出結果（見 frame）
        },
      })
    : null

const controls = createPracticeControls({
  rules: duel?.rules,
  onSound: playSound,
  onCharge(value) {
    charge.value = value
  },
  onShot(value) {
    grade.value = value
    clearTimeout(gradeTimer)
    gradeTimer = setTimeout(() => (grade.value = null), 1200)
  },
  onResult(result) {
    const { made, message, shots, makes } = result
    stats.value = { shots, makes }
    const points = duel?.result(result)
    showToast(points ? `${message} +${points}` : message, made)
    if (made && result.kind === 'Dunk' && !ended) moment('dunk')
  },
})

// 對手的球衣：和玩家不同的一套（同主畫面的客隊配色）
function foeColors() {
  return loadColors().shirt === KITS[4].shirt ? KITS[1] : KITS[4]
}

// 選難度後開始（一開始，以及結果畫面的「再來一場」）
function startGame(name) {
  level.value = name
  saveLevel(name)
  duel.setLevel(name)
  winner.value = null
  summary.value = null
  ended = false
  endWinner = null
  replay = null
  replaying.value = false
  tape = []
  elapsed.value = 0
  duel.restart()
}

const playAgain = () => startGame(level.value)
const seconds = (s) => `${Math.floor(s / 60)}:${pad(Math.floor(s) % 60)}`
const rate = (s) => (s.shots ? `${Math.round((s.makes / s.shots) * 100)}%` : '—')

// 計分板的時間：這場比賽打了多久（1 對 1 沒有比賽時間限制，所以是往上數）
const elapsed = ref(0)
const pad = (n) => String(n).padStart(2, '0')
const clockText = computed(() => `${pad(Math.floor(elapsed.value / 60) % 100)}:${pad(Math.floor(elapsed.value) % 60)}`)

const percent = (x) => `${(x * 100).toFixed(1)}%`
// 判定區（以理想力道為中心、左右各 half 寬）在蓄力條上的位置
const zone = (ideal, half) => ({ left: percent(ideal - half), width: percent(half * 2) })

function setPaused(value) {
  paused.value = value
  court?.setSpeed(value ? 0 : 1)
}

// 記下這一格（重播用），只留最近 REPLAY.seconds 秒
function record(step) {
  gameTime += step
  tape.push({ t: gameTime, you: controls.snapshot(), foe: duel.snapshot() })
  while (tape[0].t < gameTime - REPLAY.seconds) tape.shift()
}

function startReplay() {
  // 鏡頭：從得分的人（重播開始時的位置）到籃框的線，往側面退開
  const rim = controls.rim
  const from = tape[0][endWinner]
  const dx = rim.x - from.x
  const dz = rim.z - from.z
  const length = Math.hypot(dx, dz) || 1
  const midX = (from.x + rim.x) / 2
  const midZ = (from.z + rim.z) / 2
  const away = Math.max(REPLAY.side, length * REPLAY.spread)
  const sign = midX > 2 ? -1 : 1 // 人在右邊就從左邊拍，鏡頭才不會跑到圍欄外
  // 線的垂直方向是 (dz, -dx)；挑 x 分量和 sign 同號的那一邊
  const flip = Math.sign(dz * sign) || 1
  const camera = [
    Math.max(-FENCE_X, Math.min(FENCE_X, midX + ((dz * flip) / length) * away)),
    REPLAY.height,
    midZ + ((-dx * flip) / length) * away,
  ]
  replay = { t: tape[0].t, i: 0, camera, look: [midX, REPLAY.look, midZ] }
  replaying.value = true
  court.setSpeed(1)
}

// 重播中的每一格：把雙方和球擺回紀錄的樣子（兩格之間內插），鏡頭換到籃框側前方
function runReplay(delta) {
  replay.t += delta * REPLAY.speed
  while (replay.i < tape.length - 2 && tape[replay.i + 1].t <= replay.t) replay.i++
  const a = tape[replay.i]
  const b = tape[replay.i + 1] ?? a
  const k = b.t > a.t ? Math.min(1, Math.max(0, (replay.t - a.t) / (b.t - a.t))) : 0
  controls.restore(a.you, b.you, k)
  duel.restore(a.foe, b.foe, k)
  court.camera.position.set(...replay.camera)
  court.camera.lookAt(...replay.look)
  if (replay.t >= tape[tape.length - 1].t) endReplay()
}

// 重播結束（或被跳過）：回到最後一格、動作照常繼續，跳出結果
function endReplay() {
  if (!replay) return
  const last = tape[tape.length - 1]
  controls.restore(last.you, last.you, 0, true)
  duel.restore(last.foe, last.foe, 0, true)
  replay = null
  replaying.value = false
  winner.value = endWinner
}

// 每一格：算慢動作的速度、更新玩家和對手、套用鏡頭震動、把進攻時間和體力更新到畫面
function frame(delta) {
  if (replay) {
    if (!paused.value) runReplay(delta)
    return
  }
  const waiting = paused.value || (duel && !level.value) // 暫停中，或還沒選難度
  let scale = 1
  if (slowLeft > 0 && !waiting) {
    slowLeft -= delta
    scale = slowScale
  }
  if (!paused.value) court.setSpeed(scale)
  const step = delta * scale
  controls.update(step, waiting)
  duel?.update(step, waiting)
  if (shake > 0.002) {
    const p = court.camera.position
    p.x += (Math.random() - 0.5) * shake
    p.y += (Math.random() - 0.5) * shake
    shake *= Math.exp(-SHAKE_DECAY * delta)
  }
  if (!duel || waiting) return
  if (!winner.value) record(step)
  if (endWinner && !winner.value && slowLeft <= 0) {
    startReplay()
    return
  }
  if (!ended) elapsed.value += Math.min(step, 0.1)
  const left = Math.ceil(duel.shotClock())
  if (left !== shotClock.value) shotClock.value = left
  const state = controls.state()
  if (Math.abs(state.stamina - stamina.value) > 0.01) stamina.value = state.stamina
  if (state.tired !== tired.value) tired.value = state.tired
}

function onKey(event) {
  unlockSound() // 瀏覽器要等按過鍵才准發聲
  if (event.code === 'KeyV' && !event.repeat) showHint.value = !showHint.value
  if (replay) {
    if (event.code === 'Space' || event.code === 'Enter') endReplay()
    return
  }
  if (event.key === 'Escape') setPaused(!paused.value)
}

onMounted(() => {
  court = createGallery(stage.value, {
    interactive: false,
    setting: 'night-court',
    clip: 'Dribble',
    onFrame: frame,
  })
  court.setTeamColors(loadColors())
  court.ready.then(
    () => {
      status.value = ''
      controls.start(court)
      duel?.start(court, controls, foeColors())
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
  clearTimeout(bannerTimer)
  window.removeEventListener('keydown', onKey)
  controls.stop()
  court?.dispose()
})
</script>

<template>
  <div ref="stage" class="stage"></div>
  <p v-if="status" class="status">{{ status }}</p>

  <!-- 1 對 1 的計分板：仿室內 LED 計分板（隊名、分數、球權箭頭、時間）；犯規、暫停、節次之後 5 對 5 再加 -->
  <div v-if="duel" class="board" :class="{ point: gamePoint }" aria-hidden="true">
    <div class="side">
      <span class="name" :class="{ fire: match.fire.you }">你</span>
      <span class="led score" data-ghost="88">{{ match.you }}</span>
    </div>
    <div class="middle">
      <span class="arrow" :class="match.offense">
        <i class="left">◀</i><i class="right">▶</i>
      </span>
      <span class="led clock" data-ghost="88:88">{{ clockText }}</span>
      <span class="led shot" :class="{ low: shotClock <= 3 }" data-ghost="88">{{ shotClock }}</span>
      <span class="goal" :class="{ clear: match.clear }">{{ boardNote }}</span>
    </div>
    <div class="side">
      <span class="name" :class="{ fire: match.fire.foe }">對手</span>
      <span class="led score" data-ghost="88">{{ match.foe }}</span>
    </div>
  </div>
  <div v-else class="stats">
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

  <!-- 操作說明：左上角、一個按鍵一列，按 V 顯示或隱藏（載入中的訊息也在左上角，那時先不顯示） -->
  <div v-if="showHint && !status" class="hint" aria-hidden="true">
    <span><kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> 移動</span>
    <span><kbd>A</kbd> 突破（加方向鍵）</span>
    <span><kbd>空白鍵</kbd> 按下起跳、按住加力道、放開出手</span>
    <span><kbd>空白鍵</kbd> 衝向籃框時上籃或灌籃</span>
    <span><kbd>空白鍵</kbd> 沒球時跳起來搶籃板<template v-if="duel">、封蓋</template></span>
    <span v-if="duel"><kbd>A</kbd> 防守時按住自動跟防</span>
    <span v-if="duel"><kbd>D</kbd> 抄球（防守時）</span>
    <span><kbd>Esc</kbd> 暫停</span>
    <span><kbd>V</kbd> 顯示／隱藏操作說明</span>
  </div>

  <p v-if="banner" class="banner" :class="banner.kind">{{ banner.text }}</p>
  <p v-if="replaying" class="replay">● REPLAY<small>空白鍵跳過</small></p>

  <!-- 體力條：突破、跳、抄球、切入會用掉，太低時變紅（跑不快、投不準、不能突破） -->
  <div v-if="duel && level" class="stamina" :class="{ tired }" aria-hidden="true">
    <span>體力</span>
    <div class="bar"><div class="fill" :style="{ width: percent(stamina) }"></div></div>
  </div>

  <!-- 開始前選難度 -->
  <div v-if="duel && !level && !status" class="pause">
    <section class="panel">
      <h2>選擇難度</h2>
      <button v-for="(spec, name) in LEVELS" :key="name" type="button" class="item" @click="startGame(name)">
        {{ spec.label }}<small v-if="name === records.level">上次選的</small>
      </button>
      <p class="summary">目前 {{ records.streak }} 連勝・最高 {{ records.best }} 連勝<template v-if="records.fastest !== null">・最快 {{ seconds(records.fastest) }} 獲勝</template></p>
      <button type="button" class="item" @click="emit('exit')">回主畫面</button>
    </section>
  </div>

  <!-- 比賽結果：比分、評價、雙方數據、紀錄 -->
  <div v-else-if="winner && summary" class="pause">
    <section class="panel">
      <h2>{{ winner === 'you' ? '獲勝！' : '落敗…' }}<b class="rank" :class="summary.grade">{{ summary.grade }}</b></h2>
      <p class="summary">你 {{ match.you }} : {{ match.foe }} 對手・{{ LEVELS[level].label }}・{{ seconds(summary.seconds) }}</p>
      <table class="numbers">
        <thead><tr><th></th><th>你</th><th>對手</th></tr></thead>
        <tbody>
          <tr><th>投籃</th><td>{{ summary.stats.you.makes }}/{{ summary.stats.you.shots }}</td><td>{{ summary.stats.foe.makes }}/{{ summary.stats.foe.shots }}</td></tr>
          <tr><th>命中率</th><td>{{ rate(summary.stats.you) }}</td><td>{{ rate(summary.stats.foe) }}</td></tr>
          <tr><th>三分線外</th><td>{{ summary.stats.you.twos }}</td><td>{{ summary.stats.foe.twos }}</td></tr>
          <tr><th>籃板</th><td>{{ summary.stats.you.rebounds }}</td><td>{{ summary.stats.foe.rebounds }}</td></tr>
          <tr><th>抄截</th><td>{{ summary.stats.you.steals }}</td><td>{{ summary.stats.foe.steals }}</td></tr>
          <tr><th>火鍋</th><td>{{ summary.stats.you.blocks }}</td><td>—</td></tr>
        </tbody>
      </table>
      <p class="summary">
        {{ summary.records.streak }} 連勝（最高 {{ summary.records.best }}）
        <b v-if="summary.records.newBest" class="new">新紀錄！</b>
        <b v-if="summary.records.newFastest" class="new">最快獲勝！</b>
      </p>
      <button type="button" class="item" @click="playAgain">再來一場</button>
      <button type="button" class="item" @click="level = null">換難度</button>
      <button type="button" class="item" @click="emit('exit')">回主畫面</button>
    </section>
  </div>
  <div v-else-if="paused" class="pause">
    <section class="panel">
      <h2>暫停</h2>
      <button type="button" class="item" @click="setPaused(false)">{{ duel ? '繼續比賽' : '繼續練習' }}</button>
      <button type="button" class="item" @click="emit('exit')">回主畫面</button>
    </section>
  </div>
</template>

<style scoped>
.hint {
  position: fixed;
  top: 16px;
  left: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 6px;
  background: rgba(21, 27, 58, 0.7);
  color: #fcf9f2;
  font: 13px sans-serif;
  pointer-events: none;
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

/* LED 計分板：深色面板、紅底隊名、琥珀色分數、紅色時間；每組數字後面有一層暗的 8 當作沒亮的燈 */
.board {
  position: fixed;
  top: 12px;
  right: 16px; /* 放右上角：放正中間會擋到籃板和飛向籃框的球 */
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 10px 14px;
  border: 3px solid #0b0b0d;
  border-radius: 6px;
  background: #2a2a2e;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5);
  pointer-events: none;
}

.board .side,
.board .middle {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.board .name {
  min-width: 84px;
  padding: 2px 8px;
  border: 1px solid #5a1a12;
  background: #3a0f0a;
  color: #ff5a36;
  font: bold 16px sans-serif;
  letter-spacing: 2px;
  text-align: center;
  text-shadow: 0 0 6px rgba(255, 90, 54, 0.8);
}

.board .led {
  position: relative;
  padding: 2px 8px;
  border: 1px solid #000;
  background: #111;
  font-family: Consolas, 'Courier New', monospace;
  font-weight: bold;
  line-height: 1;
  text-align: right;
}

/* 沒亮的燈：同一個位置疊一層暗色的 8，亮的數字蓋在上面 */
.board .led::before {
  content: attr(data-ghost);
  position: absolute;
  right: 8px;
  opacity: 0.12;
}

.board .score {
  min-width: 2ch;
  color: #ffb62e;
  font-size: 44px;
  text-shadow: 0 0 8px rgba(255, 170, 40, 0.85);
}

.board .clock {
  color: #ff3b30;
  font-size: 30px;
  text-shadow: 0 0 8px rgba(255, 59, 48, 0.85);
}

.board .arrow {
  display: flex;
  gap: 10px;
  font-size: 18px;
  line-height: 1;
}

.board .arrow i {
  color: #4a4032;
  font-style: normal;
}

.board .arrow.you .left,
.board .arrow.foe .right {
  color: #ffb62e;
  text-shadow: 0 0 8px rgba(255, 170, 40, 0.9);
}

.board .goal {
  color: #b9b4a8;
  font: 11px sans-serif;
}

/* 進攻時間：琥珀色，剩 3 秒變紅 */
.board .shot {
  color: #ffb62e;
  font-size: 24px;
  text-shadow: 0 0 8px rgba(255, 170, 40, 0.85);
}

.board .shot.low {
  color: #ff3b30;
  text-shadow: 0 0 8px rgba(255, 59, 48, 0.9);
}

/* 賽末點：外框閃爍 */
.board.point {
  animation: point-flash 0.8s steps(2, jump-none) infinite;
}

.board.point .goal {
  color: #ff5a36;
  font-weight: bold;
}

@keyframes point-flash {
  from {
    border-color: #0b0b0d;
  }
  to {
    border-color: #ff5a36;
  }
}

/* 著火：隊名變成亮橘色 */
.board .name.fire {
  border-color: #ff9a1f;
  background: #5a2a05;
  color: #ffd98a;
  text-shadow: 0 0 10px #ff7a1a;
}

.board .name.fire::after {
  content: ' 🔥';
}

.banner {
  position: fixed;
  top: 26%;
  left: 50%;
  margin: 0;
  color: #fcf9f2;
  font: italic 900 64px sans-serif;
  letter-spacing: 2px;
  text-shadow: 4px 4px 0 #2b201b;
  transform: translateX(-50%);
  animation: banner-in 0.25s ease-out;
  pointer-events: none;
  white-space: nowrap;
}

.replay {
  position: fixed;
  top: 20px;
  left: 50%;
  margin: 0;
  padding: 6px 16px;
  border-radius: 4px;
  background: #c8321e;
  color: #fcf9f2;
  font: italic 900 22px sans-serif;
  letter-spacing: 2px;
  transform: translateX(-50%);
}

.replay small {
  margin-left: 12px;
  font: normal 12px sans-serif;
  letter-spacing: 0;
  opacity: 0.85;
}

.board .goal.clear {
  color: #ffb62e;
  font-weight: bold;
}

.banner.fire {
  color: #ffb62e;
  text-shadow: 4px 4px 0 #8a2a05;
}

.banner.point {
  color: #ff5a36;
}

@keyframes banner-in {
  from {
    opacity: 0;
    transform: translateX(-50%) scale(1.6);
  }
}

.stamina {
  position: fixed;
  left: 16px;
  bottom: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 6px;
  background: rgba(21, 27, 58, 0.7);
  color: #fcf9f2;
  font: 13px sans-serif;
}

.stamina .bar {
  width: 160px;
  height: 10px;
  border-radius: 5px;
  background: rgba(252, 249, 242, 0.2);
  overflow: hidden;
}

.stamina .fill {
  height: 100%;
  background: #4cc46a;
}

.stamina.tired .fill {
  background: #e04a3a;
}

.rank {
  float: right;
  color: #ffd98a;
  font: italic 900 30px sans-serif;
  line-height: 1;
}

.rank.C,
.rank.D {
  color: #c9c3d9;
}

.numbers {
  border-collapse: collapse;
  font-size: 14px;
}

.numbers th,
.numbers td {
  padding: 3px 14px 3px 0;
  text-align: right;
}

.numbers tbody th {
  color: #c9c3d9;
  font-weight: normal;
  text-align: left;
}

.new {
  margin-left: 6px;
  color: #ffd98a;
}

.item small {
  float: right;
  font-weight: normal;
  opacity: 0.7;
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

.grade.miss,
.grade.late {
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

.summary {
  margin: 0 0 6px;
  font-size: 15px;
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
