// 全部用 Web Audio 即時合成，不需要音檔。
// 瀏覽器要求使用者互動後才能出聲，所以 AudioContext 在第一次播放時才建立。
let ctx = null;
let master = null;
let noiseBuffer = null;
let muted = false;

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

// 音高從 freq 滑到 to，音量快速起音後衰減
function tone({ freq, to = freq, dur, type = 'sine', vol = 0.3, delay = 0 }) {
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.05);
  return osc;
}

// 濾波後的噪音；attack 為起音秒數（歡呼聲用比較慢的起音）
function noise({ dur, filter = 'lowpass', freq = 1000, vol = 0.3, attack = 0.005, delay = 0 }) {
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
  src.connect(biquad).connect(gain).connect(master);
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
};

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
    if (muted || !init()) return;
    if (ctx.state === 'suspended') ctx.resume();
    SOUNDS[name]();
  },

  // 每幀呼叫都可以：只有狀態改變時才開始或停止
  setHum(on) {
    const want = on && !muted;
    if (want && !hum && init()) startHum();
    else if (!want && hum) stopHum();
  },

  toggleMute() {
    muted = !muted;
    if (muted && hum) stopHum();
    return muted;
  },
};
