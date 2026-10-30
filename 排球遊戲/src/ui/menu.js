import { sound } from '../audio/sound.js';
import { input } from '../input/keyboard.js';
import { hud, replay } from './hud.js';

const root = document.getElementById('menu');
const hudRoot = document.getElementById('hud');
const keysHint = document.getElementById('menu-keys');
const SCROLL_STEP = 160; // 說明頁按一下上下鍵捲動的像素

// 主畫面：Logo＋選單，以及子畫面（難度選擇、設定…）。
// 每一頁是 HTML 裡的 .menu-screen：data-axis 決定用哪組方向鍵移動選擇（x 左右、y 上下）、
// data-back 是按 Esc 回到哪一頁、data-default 是預設選第幾個、data-keys 是底部的按鍵提示；頁面裡有 .scroll 的話上下鍵改成捲動它。
// 按鈕：data-goto 切到別頁、data-action 呼叫 main.js 給的動作（data-value 當參數）、
// data-adjust 也能用左右鍵調整、data-soon 還沒開放（顯示即將推出）、data-back 返回（只給滑鼠點）
export class Menu {
  // actions：{ [action]: (value, dir) => void }，dir 為 1 或 -1（左右鍵調整的方向）
  // onScreen(name)：切換頁面時呼叫（例如讓鏡頭跟著換）
  constructor(actions, onScreen = () => {}) {
    this.actions = actions;
    this.onScreen = onScreen;
    this.screens = {};
    this.current = null;
    for (const el of root.querySelectorAll('.menu-screen')) {
      const items = [...el.querySelectorAll('button:not([data-back])')];
      this.screens[el.dataset.screen] = { el, items, index: Number(el.dataset.default ?? 0) };
      items.forEach((b, i) => {
        b.style.setProperty('--i', i); // 依序滑進來的延遲
        b.addEventListener('mouseenter', () => this.select(i));
        b.addEventListener('click', () => {
          b.blur(); // 不然之後按空白鍵會再觸發這顆按鈕
          this.select(i);
          this.activate(b, 1);
        });
      });
      for (const b of el.querySelectorAll('button[data-back]')) {
        b.addEventListener('click', () => {
          b.blur();
          this.back();
        });
      }
    }
  }

  get screenName() {
    return root.dataset.screen ?? null;
  }

  // 打開主畫面（Logo 和選項重新播一次進場動畫）；screen：直接打開哪一頁（例如練習結束回到練習選單）
  open(screen = 'main') {
    root.hidden = false;
    hudRoot.classList.add('in-menu');
    replay(root, 'intro');
    this.show(screen);
  }

  close() {
    root.hidden = true;
    hudRoot.classList.remove('in-menu');
    this.current = null;
    delete root.dataset.screen;
  }

  show(name) {
    if (name !== 'main') root.classList.remove('intro'); // 進場動畫只有第一次進主畫面時播
    for (const [key, screen] of Object.entries(this.screens)) screen.el.hidden = key !== name;
    this.current = this.screens[name];
    root.dataset.screen = name;
    keysHint.textContent = this.current.el.dataset.keys;
    this.select(this.current.index);
    this.onScreen(name);
  }

  select(index) {
    const screen = this.current;
    if (!screen) return;
    screen.index = index;
    screen.items.forEach((b, i) => b.classList.toggle('selected', i === index));
  }

  activate(button, dir) {
    const { goto, action, value } = button.dataset;
    if ('soon' in button.dataset) {
      sound.play('deny');
      hud.toast('即將推出，敬請期待！');
      return;
    }
    sound.play('ui');
    if (goto) this.show(goto);
    else if (action) this.actions[action](value, dir);
  }

  back() {
    const to = this.current?.el.dataset.back;
    if (!to) return;
    sound.play('ui');
    this.show(to);
  }

  // 每幀呼叫：方向鍵移動選擇或調整數值、空白鍵確定、Esc 返回
  update() {
    const screen = this.current;
    if (!screen) return;
    const horizontal = screen.el.dataset.axis === 'x';
    const move = (input.wasPressed(horizontal ? 'right' : 'down') ? 1 : 0) - (input.wasPressed(horizontal ? 'left' : 'up') ? 1 : 0);
    const scroller = screen.el.querySelector('.scroll'); // 說明頁：上下鍵捲動內容，不移動選擇
    if (move !== 0 && scroller) {
      scroller.scrollBy({ top: move * SCROLL_STEP, behavior: 'smooth' });
    } else if (move !== 0) {
      this.select((screen.index + move + screen.items.length) % screen.items.length);
      sound.play('ui');
    }
    const item = screen.items[screen.index];
    if (!horizontal && 'adjust' in item.dataset) {
      const dir = (input.wasPressed('right') ? 1 : 0) - (input.wasPressed('left') ? 1 : 0);
      if (dir !== 0) this.activate(item, dir);
    }
    if (input.wasPressed('action')) this.activate(item, 1);
    else if (input.wasPressed('pause')) this.back();
  }

  // 更新選項右邊顯示的值，例如 setValue('sfx', '開')；color（色碼數字）：顏色選項前面加一個色塊
  setValue(action, text, color) {
    for (const el of root.querySelectorAll(`[data-action="${action}"] [data-current]`)) {
      el.textContent = text;
      if (color === undefined) continue;
      const swatch = document.createElement('i');
      swatch.className = 'swatch';
      swatch.style.background = `#${color.toString(16).padStart(6, '0')}`;
      el.prepend(swatch);
    }
  }
}
