const powerBar = document.getElementById('power-bar');
const powerFill = document.getElementById('power-fill');
const result = document.getElementById('result');
const judge = document.getElementById('judge');
const scoreHome = document.getElementById('score-home');
const scoreAway = document.getElementById('score-away');
const teamHome = document.querySelector('#scoreboard .home');
const teamAway = document.querySelector('#scoreboard .away');
const gameOver = document.getElementById('game-over');
const gameOverTitle = document.getElementById('game-over-title');
const gameOverScore = document.getElementById('game-over-score');
const menu = document.getElementById('menu');
const muteBadge = document.getElementById('mute');
const graphicsButton = document.getElementById('graphics-button');
const toastEl = document.getElementById('toast');
const impactEl = document.getElementById('impact');
const pauseEl = document.getElementById('pause');
const pauseOptions = [...document.querySelectorAll('#pause-options button')];
const pauseButton = document.getElementById('pause-button');
const levelButtons = [...document.querySelectorAll('#levels button')];

const JUDGE_TEXT = {
  perfect: 'PERFECT!',
  good: 'GOOD',
  bad: 'BAD',
  miss: 'MISS',
  far: '搆不到',
  block: 'BLOCK!',
  dive: '撲救！',
  power: 'POWER!',
};

// 能量條：每隊一組格子
const energyEls = {
  1: document.getElementById('energy-home'),
  [-1]: document.getElementById('energy-away'),
};
let energyKey = '';

// 重新觸發 CSS 動畫
function replay(el, className) {
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
}

export const hud = {
  // 難度選單：selected 為 'easy' | 'normal' | 'hard'；傳 null 隱藏
  showMenu(selected) {
    menu.hidden = selected === null;
    for (const b of levelButtons) b.classList.toggle('selected', b.dataset.level === selected);
  },

  // energy、armed：{ 1: 我方, -1: 對手 }；只有數值變了才更新畫面
  setEnergy(energy, armed, max) {
    const key = `${energy[1]},${energy[-1]},${armed[1]},${armed[-1]}`;
    if (key === energyKey) return;
    energyKey = key;
    for (const side of [1, -1]) {
      const el = energyEls[side];
      const cells = el.querySelector('.cells');
      if (cells.children.length !== max) cells.innerHTML = '<div class="cell"></div>'.repeat(max);
      [...cells.children].forEach((c, i) => c.classList.toggle('on', i < energy[side]));
      const full = energy[side] >= max;
      el.classList.toggle('full', full && !armed[side]);
      el.classList.toggle('armed', armed[side]);
      const label = el.querySelector('.energy-label');
      if (side > 0) label.textContent = armed[side] ? '強力擊球準備！（A 取消）' : full ? '按 A 強力擊球！' : '';
      else label.textContent = full ? '對手能量滿！' : '';
    }
  },

  setMuted(muted) {
    muteBadge.hidden = !muted;
  },

  setGraphicsLabel(label) {
    graphicsButton.textContent = label;
  },

  onGraphicsClick(callback) {
    graphicsButton.addEventListener('click', () => {
      graphicsButton.blur(); // 不然之後按空白鍵會再觸發這顆按鈕
      callback();
    });
  },

  // 暫停畫面：selected 為選中的選項索引；傳 null 隱藏
  showPause(selected) {
    pauseEl.hidden = selected === null;
    pauseOptions.forEach((b, i) => b.classList.toggle('selected', i === selected));
  },

  // 滑鼠點暫停選項：callback('resume' | 'restart' | 'menu')
  onPauseOption(callback) {
    for (const b of pauseOptions) {
      b.addEventListener('click', () => {
        b.blur();
        callback(b.dataset.option);
      });
    }
  },

  setPauseButtonVisible(visible) {
    pauseButton.hidden = !visible;
  },

  onPauseButton(callback) {
    pauseButton.addEventListener('click', () => {
      pauseButton.blur();
      callback();
    });
  },

  // 強力扣球的衝擊畫面（白光＋速度線），持續 seconds 秒
  impact(seconds) {
    impactEl.style.setProperty('--impact-time', `${seconds}s`);
    replay(impactEl, 'show');
  },

  // 右上角短暫提示
  toast(text) {
    toastEl.textContent = text;
    replay(toastEl, 'show');
  },

  // 滑鼠點選難度
  onLevelClick(callback) {
    for (const b of levelButtons) b.addEventListener('click', () => callback(b.dataset.level));
  },

  // score：{ 1: home 分數, -1: away 分數 }；servingSide：1 或 -1
  setScore(score, servingSide) {
    scoreHome.textContent = score[1];
    scoreAway.textContent = score[-1];
    teamHome.classList.toggle('serving', servingSide > 0);
    teamAway.classList.toggle('serving', servingSide < 0);
  },

  // { win, score }；傳 null 隱藏
  showGameOver(data) {
    gameOver.hidden = data === null;
    if (data === null) return;
    result.hidden = true;
    gameOver.classList.toggle('lose', !data.win);
    gameOverTitle.textContent = data.win ? '你贏了！' : '對手獲勝';
    gameOverScore.textContent = `${data.score[1]} : ${data.score[-1]}`;
  },

  // value 為 0~1；傳 null 隱藏
  setPower(value) {
    powerBar.hidden = value === null;
    if (value !== null) powerFill.style.width = `${value * 100}%`;
  },

  // { text, good }；傳 null 隱藏
  showResult(data) {
    result.hidden = data === null;
    if (data === null) return;
    result.textContent = data.text;
    result.classList.toggle('good', data.good);
    replay(result, 'pop');
  },

  // 擊球時機判定：'perfect' | 'good' | 'bad' | 'miss' | 'far' | 'block' | 'dive' | 'power'
  showJudge(grade) {
    judge.textContent = JUDGE_TEXT[grade];
    judge.dataset.grade = grade;
    replay(judge, 'flash');
  },
};
