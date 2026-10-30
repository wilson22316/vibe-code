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

const JUDGE_TEXT = {
  perfect: 'PERFECT!',
  good: 'GOOD',
  bad: 'BAD',
  miss: 'MISS',
  far: '搆不到',
  block: 'BLOCK!',
};

// 重新觸發 CSS 動畫
function replay(el, className) {
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
}

export const hud = {
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

  // 擊球時機判定：'perfect' | 'good' | 'bad' | 'miss' | 'far' | 'block'
  showJudge(grade) {
    judge.textContent = JUDGE_TEXT[grade];
    judge.dataset.grade = grade;
    replay(judge, 'flash');
  },
};
