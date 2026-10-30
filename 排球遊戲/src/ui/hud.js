const powerBar = document.getElementById('power-bar');
const powerFill = document.getElementById('power-fill');
const result = document.getElementById('result');
const judge = document.getElementById('judge');

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
