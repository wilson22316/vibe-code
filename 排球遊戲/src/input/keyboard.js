// 鍵盤輸入層：遊戲邏輯只認「動作」，不直接認按鍵。
// 之後加手機觸控或手把時，只要多一個來源去觸發同樣的動作。
const BINDINGS = {
  Space: 'action', // 發球（按住蓄力）／擊球（抓時機）／選單確定
  KeyJ: 'action',
  Enter: 'action',
  ArrowUp: 'up',
  ArrowDown: 'down',
  Escape: 'pause',
  KeyP: 'pause',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyA: 'power', // 能量滿時開啟強力擊球
  KeyM: 'mute',
  KeyG: 'graphics',
  KeyC: 'camera',
};

const down = new Set();
const pressed = new Set();
const released = new Set();

window.addEventListener('keydown', (e) => {
  const action = BINDINGS[e.code];
  if (!action) return;
  e.preventDefault();
  if (!down.has(action)) pressed.add(action);
  down.add(action);
});

window.addEventListener('keyup', (e) => {
  const action = BINDINGS[e.code];
  if (!action) return;
  down.delete(action);
  released.add(action);
});

// 切到別的視窗時放開所有按鍵，避免卡鍵
window.addEventListener('blur', () => {
  for (const action of down) released.add(action);
  down.clear();
});

export const input = {
  isDown: (action) => down.has(action),
  wasPressed: (action) => pressed.has(action),
  wasReleased: (action) => released.has(action),
  // 每幀結束時呼叫
  endFrame() {
    pressed.clear();
    released.clear();
  },
};

// 網路送來的按鍵（連線對戰時，主機用它讀客人的操作），用法跟 input 一樣
export function createRemoteInput() {
  const rDown = new Set();
  const rPressed = new Set();
  const rReleased = new Set();
  return {
    isDown: (action) => rDown.has(action),
    wasPressed: (action) => rPressed.has(action),
    wasReleased: (action) => rReleased.has(action),
    // 收到對方的按鍵：isDown 為按下或放開
    receive(action, isDown) {
      if (isDown) {
        if (!rDown.has(action)) rPressed.add(action);
        rDown.add(action);
      } else {
        rDown.delete(action);
        rReleased.add(action);
      }
    },
    endFrame() {
      rPressed.clear();
      rReleased.clear();
    },
  };
}

// 每一隊由哪個輸入來源操作：預設都是本機鍵盤；連線對戰時客人那隊換成網路送來的按鍵（source 傳 null 換回本機）
const sideInputs = {};

export function setSideInput(side, source) {
  if (source) sideInputs[side] = source;
  else delete sideInputs[side];
}

export function inputFor(side) {
  return sideInputs[side] ?? input;
}
