const powerBar = document.getElementById('power-bar');
const powerFill = document.getElementById('power-fill');
const result = document.getElementById('result');

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
    // 重新觸發彈出動畫
    result.classList.remove('pop');
    void result.offsetWidth;
    result.classList.add('pop');
  },
};
