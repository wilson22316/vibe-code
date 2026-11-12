// 遊戲音效：全部用 Web Audio 現場合成（不用音檔）。瀏覽器要等使用者按過鍵才准發聲，
// 所以第一次按鍵時才建立 AudioContext（unlock）；在那之前呼叫 play 沒有作用。
// 音量在 VOLUME，各個音效的音色在 SOUNDS。

const VOLUME = 0.5

let context = null
let master = null
let noiseBuffer = null

export function unlock() {
  if (context) {
    if (context.state === 'suspended') context.resume()
    return
  }
  const Ctor = window.AudioContext ?? window.webkitAudioContext
  if (!Ctor) return
  context = new Ctor()
  master = context.createGain()
  master.gain.value = VOLUME
  master.connect(context.destination)
  // 一秒的白噪音，刷網、歡呼、摩擦聲都從這裡濾出來
  noiseBuffer = context.createBuffer(1, context.sampleRate, context.sampleRate)
  const data = noiseBuffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
}

// 音量包絡：at 秒後開始，attack 秒升到 peak，再用 decay 秒降到幾乎沒聲音
function envelope(at, peak, attack, decay) {
  const gain = context.createGain()
  const t = context.currentTime + at
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(peak, t + attack)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay)
  gain.connect(master)
  return gain
}

// 一個音：type 波形、from→to 頻率在 decay 秒內滑過去
function tone({ type = 'sine', from, to = from, peak = 0.5, attack = 0.005, decay = 0.15, at = 0 }) {
  const osc = context.createOscillator()
  const t = context.currentTime + at
  osc.type = type
  osc.frequency.setValueAtTime(from, t)
  osc.frequency.exponentialRampToValueAtTime(to, t + attack + decay)
  osc.connect(envelope(at, peak, attack, decay))
  osc.start(t)
  osc.stop(t + attack + decay + 0.05)
}

// 一段濾過的噪音：filter 濾波器種類、from→to 濾波頻率
function noise({ filter = 'bandpass', from, to = from, q = 1, peak = 0.5, attack = 0.005, decay = 0.2, at = 0 }) {
  const source = context.createBufferSource()
  source.buffer = noiseBuffer
  source.loop = true
  const biquad = context.createBiquadFilter()
  const t = context.currentTime + at
  biquad.type = filter
  biquad.Q.value = q
  biquad.frequency.setValueAtTime(from, t)
  biquad.frequency.exponentialRampToValueAtTime(to, t + attack + decay)
  source.connect(biquad)
  biquad.connect(envelope(at, peak, attack, decay))
  source.start(t, Math.random())
  source.stop(t + attack + decay + 0.05)
}

const SOUNDS = {
  // 球拍地：低沉的「咚」加一點拍擊聲
  bounce(volume = 1) {
    tone({ from: 150, to: 55, peak: 0.7 * volume, decay: 0.12 })
    noise({ filter: 'lowpass', from: 900, to: 200, peak: 0.25 * volume, decay: 0.05 })
  },
  // 打框：金屬聲
  rim() {
    tone({ type: 'triangle', from: 520, to: 480, peak: 0.35, decay: 0.25 })
    tone({ type: 'square', from: 1310, to: 1250, peak: 0.08, decay: 0.12 })
  },
  // 打板：悶悶的一聲
  board() {
    tone({ from: 240, to: 120, peak: 0.5, decay: 0.08 })
    noise({ filter: 'lowpass', from: 1500, to: 400, peak: 0.2, decay: 0.05 })
  },
  // 刷網
  swish() {
    noise({ filter: 'bandpass', from: 5200, to: 1800, q: 0.8, peak: 0.5, attack: 0.02, decay: 0.3 })
  },
  // 灌籃：重重砸在框上
  dunk() {
    tone({ from: 110, to: 40, peak: 0.9, decay: 0.3 })
    SOUNDS.rim()
    SOUNDS.swish()
  },
  // 火鍋：手拍到球
  block() {
    noise({ filter: 'bandpass', from: 1400, to: 500, q: 0.7, peak: 0.8, decay: 0.09 })
    tone({ from: 200, to: 70, peak: 0.6, decay: 0.12 })
  },
  // 抄截：短促的一拍加往上的音
  steal() {
    noise({ filter: 'highpass', from: 2500, peak: 0.4, decay: 0.05 })
    tone({ type: 'triangle', from: 500, to: 900, peak: 0.3, decay: 0.12, at: 0.03 })
  },
  // 突破：球鞋摩擦地板
  squeak() {
    tone({ type: 'sawtooth', from: 1900, to: 2600, peak: 0.12, attack: 0.02, decay: 0.09 })
  },
  // 跳起來
  jump() {
    noise({ filter: 'bandpass', from: 500, to: 1400, q: 0.6, peak: 0.2, attack: 0.03, decay: 0.12 })
  },
  // 群眾歡呼：一大片噪音慢慢起來再散掉，加幾聲口哨
  cheer(volume = 1) {
    noise({ filter: 'bandpass', from: 900, to: 1500, q: 0.4, peak: 0.45 * volume, attack: 0.25, decay: 1.6 })
    noise({ filter: 'highpass', from: 3000, peak: 0.12 * volume, attack: 0.3, decay: 1.2 })
    tone({ from: 1700, to: 2300, peak: 0.07 * volume, attack: 0.08, decay: 0.35, at: 0.35 })
    tone({ from: 2000, to: 2600, peak: 0.05 * volume, attack: 0.08, decay: 0.3, at: 0.8 })
  },
  // 觀眾的嘆氣（對手得分）
  groan() {
    noise({ filter: 'bandpass', from: 700, to: 300, q: 0.5, peak: 0.3, attack: 0.15, decay: 0.9 })
  },
  // 進攻時間快到了
  tick() {
    tone({ type: 'square', from: 1000, peak: 0.15, decay: 0.05 })
  },
  // 進攻超時、比賽結束的蜂鳴器
  buzzer() {
    tone({ type: 'sawtooth', from: 220, peak: 0.35, attack: 0.01, decay: 0.9 })
    tone({ type: 'square', from: 223, peak: 0.2, attack: 0.01, decay: 0.9 })
  },
  // 出界的哨音
  whistle() {
    tone({ type: 'square', from: 2300, to: 2250, peak: 0.16, attack: 0.01, decay: 0.3 })
    tone({ type: 'sine', from: 2380, peak: 0.12, attack: 0.01, decay: 0.3 })
  },
  // 著火了：往上竄的音
  fire() {
    for (const [i, f] of [440, 554, 659, 880].entries()) tone({ type: 'triangle', from: f, peak: 0.25, decay: 0.18, at: i * 0.07 })
    noise({ filter: 'bandpass', from: 600, to: 3000, q: 0.5, peak: 0.25, attack: 0.2, decay: 0.4 })
  },
  // 賽末點
  alert() {
    tone({ type: 'square', from: 660, peak: 0.18, decay: 0.12 })
    tone({ type: 'square', from: 880, peak: 0.18, decay: 0.2, at: 0.14 })
  },
  // 獲勝、落敗的短旋律
  win() {
    for (const [i, f] of [523, 659, 784, 1047].entries()) tone({ type: 'triangle', from: f, peak: 0.3, decay: 0.3, at: i * 0.13 })
  },
  lose() {
    for (const [i, f] of [392, 330, 262].entries()) tone({ type: 'triangle', from: f, peak: 0.3, decay: 0.4, at: i * 0.2 })
  },
}

// 播一個音效；還沒 unlock、或沒有這個名字就不出聲
export function play(name, ...args) {
  if (!context || context.state !== 'running') return
  SOUNDS[name]?.(...args)
}
