// 全部用 Web Audio 即時合成，不需要音檔。
// 瀏覽器要求使用者互動後才能出聲，所以 AudioContext 在第一次播放時才建立。
let ctx = null;
let master = null;
let noiseBuffer = null;
let muted = false;

// 設定頁的音效、音樂開關，記在瀏覽器裡
const STORAGE = { sfx: 'volleyball.sfx', music: 'volleyball.music' };
let sfxOn = loadFlag(STORAGE.sfx);
let musicOn = loadFlag(STORAGE.music);

// 背景音樂要等使用者第一次按鍵或點擊後才能開始（瀏覽器規定）
let unlocked = false;
for (const type of ['pointerdown', 'keydown']) {
  window.addEventListener(type, () => {
    unlocked = true;
  }, { once: true });
}

function init() {
  if (ctx) return true;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return false;
  ctx = new AudioCtx();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  // 一秒的白噪音，打擊聲、沙聲、歡呼聲共用
  noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return true;
}

// 音高從 freq 滑到 to，音量快速起音後衰減；out：接到哪裡（預設總音量，背景音樂接自己的音量）
function tone({ freq, to = freq, dur, type = 'sine', vol = 0.3, delay = 0, out = master }) {
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(out);
  osc.start(t);
  osc.stop(t + dur + 0.05);
  return osc;
}

// 濾波後的噪音；attack 為起音秒數（歡呼聲用比較慢的起音）
function noise({ dur, filter = 'lowpass', freq = 1000, vol = 0.3, attack = 0.005, delay = 0, out = master }) {
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  const biquad = ctx.createBiquadFilter();
  biquad.type = filter;
  biquad.frequency.value = freq;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(biquad).connect(gain).connect(out);
  src.start(t);
  src.stop(t + dur + 0.05);
}

const SOUNDS = {
  serve: () => {
    tone({ freq: 320, to: 140, dur: 0.12, vol: 0.35 });
    noise({ dur: 0.08, freq: 2500, vol: 0.2 });
  },
  bump: () => {
    tone({ freq: 190, to: 90, dur: 0.14, vol: 0.4 });
    noise({ dur: 0.06, freq: 900, vol: 0.2 });
  },
  set: () => tone({ freq: 560, to: 420, dur: 0.09, type: 'triangle', vol: 0.3 }),
  spike: () => {
    noise({ dur: 0.16, filter: 'highpass', freq: 1500, vol: 0.4 });
    tone({ freq: 240, to: 70, dur: 0.15, type: 'square', vol: 0.18 });
  },
  block: () => {
    tone({ freq: 170, to: 110, dur: 0.18, type: 'square', vol: 0.2 });
    noise({ dur: 0.12, freq: 1800, vol: 0.3 });
  },
  // 強力扣球：高頻爆裂＋低音重擊＋往下掃的音
  power: () => {
    noise({ dur: 0.3, filter: 'highpass', freq: 1200, vol: 0.5 });
    tone({ freq: 140, to: 40, dur: 0.35, type: 'sawtooth', vol: 0.25 });
    tone({ freq: 900, to: 200, dur: 0.25, type: 'square', vol: 0.12 });
  },
  // 能量集滿、按 A 開啟：往上爬的音階
  charge: () => {
    [523, 784, 1047].forEach((f, i) => tone({ freq: f, dur: 0.12, type: 'square', vol: 0.1, delay: i * 0.06 }));
  },
  // 取消強力擊球：往下降的音階
  uncharge: () => {
    [1047, 784, 523].forEach((f, i) => tone({ freq: f, dur: 0.1, type: 'square', vol: 0.08, delay: i * 0.05 }));
  },
  net: () => noise({ dur: 0.3, filter: 'bandpass', freq: 450, vol: 0.25 }),
  land: () => noise({ dur: 0.22, freq: 380, vol: 0.4 }),
  perfect: () => {
    tone({ freq: 1320, dur: 0.12, type: 'triangle', vol: 0.15 });
    tone({ freq: 1760, dur: 0.2, type: 'triangle', vol: 0.15, delay: 0.06 });
  },
  whistle: () => {
    // 兩個略微走音的高頻 + 顫音，模擬哨子
    for (const f of [2700, 2760]) {
      const osc = tone({ freq: f, dur: 0.4, vol: 0.08 });
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = 28;
      depth.gain.value = 60;
      lfo.connect(depth).connect(osc.frequency);
      lfo.start();
      lfo.stop(ctx.currentTime + 0.45);
    }
  },
  cheer: () => noise({ dur: 1.4, filter: 'bandpass', freq: 1100, vol: 0.18, attack: 0.25 }),
  win: () => {
    [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, dur: 0.3, type: 'triangle', vol: 0.2, delay: i * 0.12 }));
  },
  lose: () => {
    [392, 330, 262].forEach((f, i) => tone({ freq: f, dur: 0.35, type: 'triangle', vol: 0.18, delay: i * 0.18 }));
  },
  ui: () => tone({ freq: 880, dur: 0.05, type: 'triangle', vol: 0.15 }),
  // 練習成功：往上跳的兩個音
  success: () => {
    [1047, 1568].forEach((f, i) => tone({ freq: f, dur: 0.16, type: 'triangle', vol: 0.15, delay: i * 0.08 }));
  },
  // 選到還沒開放的項目：低沉的兩聲
  deny: () => {
    [220, 165].forEach((f, i) => tone({ freq: f, dur: 0.08, type: 'square', vol: 0.08, delay: i * 0.09 }));
  },
};

// ---- 背景音樂：輕快的沙灘風，C – Am – F – G 四和弦循環（8 小節），全部即時合成 ----
const BPM = 112;
const EIGHTH = 60 / BPM / 2;
const LOOP_STEPS = 64; // 8 小節 × 8 個八分音符
const LOOKAHEAD = 0.25; // 先排好接下來幾秒的音符，畫面卡一下也不會斷
const MUSIC_VOLUME = 0.3;
const CHORDS = [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]]; // MIDI 音高
const BASS = [48, 45, 41, 43];
const BASS_PATTERN = { 0: 0, 3: 0, 4: 7, 6: 12 }; // 小節內第幾個八分音符 → 比根音高幾個半音
// 旋律（木琴音色）：[第幾個八分音符, 音高, 長度（八分音符數）]
const MELODY = [
  [0, 79, 1], [1, 76, 1], [2, 79, 1], [3, 81, 2], [5, 79, 1], [6, 76, 2],
  [8, 72, 1], [9, 74, 1], [10, 76, 2], [12, 74, 1], [13, 72, 1], [14, 69, 2],
  [16, 69, 1], [17, 72, 1], [18, 74, 1], [19, 76, 2], [21, 74, 1], [22, 72, 2],
  [24, 74, 1], [25, 76, 1], [26, 79, 2], [28, 81, 1], [29, 79, 1], [30, 74, 2],
  [32, 79, 1], [33, 76, 1], [34, 79, 1], [35, 81, 2], [37, 84, 1], [38, 81, 2],
  [40, 79, 1], [41, 76, 1], [42, 74, 2], [44, 76, 1], [45, 74, 1], [46, 72, 2],
  [48, 69, 1], [49, 72, 1], [50, 74, 1], [51, 76, 2], [53, 79, 1], [54, 76, 2],
  [56, 74, 2], [58, 76, 1], [59, 74, 1], [60, 74, 2], [62, 67, 2],
];
const melodyAt = new Map(MELODY.map(([step, note, len]) => [step, { note, len }]));
const midiFreq = (n) => 440 * 2 ** ((n - 69) / 12);

let music = null; // 播放中：{ bus, timer, step, nextTime }

// 排一個八分音符位置上的所有聲音：鼓、貝斯、和弦（反拍刷奏）、旋律
function scheduleStep(step, time) {
  const out = music.bus;
  const delay = Math.max(0, time - ctx.currentTime);
  const beat = step % 8;
  const chord = Math.floor(step / 8) % CHORDS.length;

  if (beat === 0 || beat === 4) tone({ freq: 140, to: 45, dur: 0.16, vol: 0.35, delay, out }); // 大鼓
  if (beat === 2 || beat === 6) noise({ dur: 0.09, filter: 'bandpass', freq: 1600, vol: 0.12, delay, out }); // 拍手
  noise({ dur: 0.035, filter: 'highpass', freq: 7000, vol: beat % 2 ? 0.05 : 0.025, delay, out }); // 沙鈴

  if (beat in BASS_PATTERN) {
    tone({ freq: midiFreq(BASS[chord] + BASS_PATTERN[beat]), dur: EIGHTH * 1.6, type: 'triangle', vol: 0.32, delay, out });
  }
  if (beat % 2 === 1) {
    for (const n of CHORDS[chord]) tone({ freq: midiFreq(n), dur: 0.14, type: 'triangle', vol: 0.06, delay, out });
  }

  const lead = melodyAt.get(step);
  if (lead) {
    const f = midiFreq(lead.note);
    tone({ freq: f, dur: Math.max(0.3, lead.len * EIGHTH), vol: 0.16, delay, out });
    tone({ freq: f * 3.9, dur: 0.07, vol: 0.03, delay, out }); // 敲擊的泛音
  }
}

function startMusic() {
  const bus = ctx.createGain();
  bus.gain.setValueAtTime(0.0001, ctx.currentTime);
  bus.gain.exponentialRampToValueAtTime(MUSIC_VOLUME, ctx.currentTime + 1);
  bus.connect(master);
  music = { bus, step: 0, nextTime: ctx.currentTime + 0.1 };
  const tick = () => {
    while (music.nextTime < ctx.currentTime + LOOKAHEAD) {
      scheduleStep(music.step, music.nextTime);
      music.nextTime += EIGHTH;
      music.step = (music.step + 1) % LOOP_STEPS;
    }
  };
  tick();
  music.timer = setInterval(tick, 60);
}

// 淡出後再拆掉（已經排好的音符會在淡出中播完）
function stopMusic() {
  const { bus, timer } = music;
  clearInterval(timer);
  const t = ctx.currentTime;
  bus.gain.cancelScheduledValues(t);
  bus.gain.setValueAtTime(Math.max(bus.gain.value, 0.0001), t);
  bus.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
  setTimeout(() => bus.disconnect(), 800);
  music = null;
}

// 切到別的分頁時先停掉（計時器在背景會變慢，音樂會斷斷續續），回來後下一幀會再開始
document.addEventListener('visibilitychange', () => {
  if (document.hidden && music) stopMusic();
});

// 蓄氣中的低沉嗡嗡聲（持續音，開關要配對）
let hum = null;

function startHum() {
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = 70;
  const lfo = ctx.createOscillator(); // 音高微微起伏
  lfo.frequency.value = 5;
  const depth = ctx.createGain();
  depth.gain.value = 6;
  lfo.connect(depth).connect(osc.frequency);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 400;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.07, ctx.currentTime + 0.3);
  osc.connect(filter).connect(gain).connect(master);
  osc.start();
  lfo.start();
  hum = { osc, lfo, gain };
}

function stopHum() {
  const { osc, lfo, gain } = hum;
  const t = ctx.currentTime;
  gain.gain.cancelScheduledValues(t);
  gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
  osc.stop(t + 0.3);
  lfo.stop(t + 0.3);
  hum = null;
}

export const sound = {
  play(name) {
    if (muted || !sfxOn || !init()) return;
    if (ctx.state === 'suspended') ctx.resume();
    SOUNDS[name]();
  },

  // 每幀呼叫都可以：只有狀態改變時才開始或停止
  setHum(on) {
    const want = on && !muted && sfxOn;
    if (want && !hum && init()) startHum();
    else if (!want && hum) stopHum();
  },

  // 背景音樂（主畫面播放）：每幀呼叫都可以，靜音、設定關掉、還沒互動過、分頁在背景時不播
  setMusic(on) {
    const want = on && musicOn && !muted && unlocked && !document.hidden;
    if (want && !music && init()) {
      if (ctx.state === 'suspended') ctx.resume();
      startMusic();
    } else if (!want && music) {
      stopMusic();
    }
  },

  toggleMute() {
    muted = !muted;
    if (muted && hum) stopHum();
    return muted;
  },

  get sfxEnabled() {
    return sfxOn;
  },

  get musicEnabled() {
    return musicOn;
  },

  toggleSfx() {
    sfxOn = !sfxOn;
    saveFlag(STORAGE.sfx, sfxOn);
    if (!sfxOn && hum) stopHum();
    return sfxOn;
  },

  toggleMusic() {
    musicOn = !musicOn;
    saveFlag(STORAGE.music, musicOn);
    return musicOn;
  },
};

// 瀏覽器設定可能被封鎖（無痕模式等），讀寫失敗就用預設值（開）
function loadFlag(key) {
  try {
    return localStorage.getItem(key) !== '0';
  } catch {
    return true;
  }
}

function saveFlag(key, on) {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    // 忽略
  }
}
