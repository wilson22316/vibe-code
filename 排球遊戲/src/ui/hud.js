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
const muteBadge = document.getElementById('mute');
const toastEl = document.getElementById('toast');
const impactEl = document.getElementById('impact');
const pauseEl = document.getElementById('pause');
const pauseOptions = [...document.querySelectorAll('#pause-options button')];
const pauseButton = document.getElementById('pause-button');
const hudRoot = document.getElementById('hud');
const practicePanel = document.getElementById('practice-panel');
const tutorialEl = document.getElementById('tutorial');
const hintEl = document.getElementById('hint');
const defaultHint = hintEl.textContent;

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
export function replay(el, className) {
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
}

export const hud = {
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

  // 練習模式的資訊列（取代記分板）：{ name, success, tries, slow, title }，有 title 就顯示 title；傳 null 回到比賽畫面
  setPractice(info) {
    hudRoot.classList.toggle('practice', info !== null);
    practicePanel.hidden = info === null;
    if (!info) return;
    practicePanel.textContent = info.title ?? `${info.name}練習　成功 ${info.success} / ${info.tries}${info.slow ? '　·　慢速' : ''}`;
  },

  // 互動教學的說明卡：{ step, total, title, text }（step 從 1 開始；沒有 step 時是完成畫面）；傳 null 隱藏
  setTutorial(info) {
    tutorialEl.hidden = info === null;
    if (!info) return;
    tutorialEl.querySelector('.tutorial-step').textContent = info.step ? `第 ${info.step} 步／共 ${info.total} 步` : '完成';
    tutorialEl.querySelector('.tutorial-title').textContent = info.title;
    tutorialEl.querySelector('.tutorial-text').textContent = info.text;
    replay(tutorialEl, 'show');
  },

  // 底部的操作提示；傳 null 恢復比賽用的提示
  setHint(text) {
    hintEl.textContent = text ?? defaultHint;
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
