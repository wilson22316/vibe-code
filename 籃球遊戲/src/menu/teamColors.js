// 隊伍配色：只換球衣、短褲（材質 Athlete_Shirt、Athlete_Shorts，見 CLAUDE.md），色碼為 sRGB。
// 選擇存在瀏覽器的 localStorage，下次打開沿用；讀不到（無痕模式等）就用預設配色。

export const DEFAULT_COLORS = { shirt: '#6aa79c', shorts: '#47607a' }

// 預設的幾套球衣，配合手繪動畫風的柔和色調
export const KITS = [
  { name: '青綠', shirt: '#6aa79c', shorts: '#47607a' },
  { name: '珊瑚紅', shirt: '#d9735f', shorts: '#f4efe4' },
  { name: '天藍', shirt: '#7fb3d5', shorts: '#2f4f6f' },
  { name: '芥末黃', shirt: '#e3b448', shorts: '#4a3f35' },
  { name: '葡萄紫', shirt: '#8e7cc3', shorts: '#3d3456' },
  { name: '白色', shirt: '#f4efe4', shorts: '#47607a' },
]

const STORAGE_KEY = 'basketball.teamColors'
const HEX = /^#[0-9a-f]{6}$/i

export function loadColors() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY))
    if (HEX.test(saved?.shirt) && HEX.test(saved?.shorts)) return { shirt: saved.shirt, shorts: saved.shorts }
  } catch {
    // 讀不到或格式不對就用預設
  }
  return { ...DEFAULT_COLORS }
}

export function saveColors(colors) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ shirt: colors.shirt, shorts: colors.shorts }))
  } catch {
    // 無痕模式等存不進去時，只是下次不會記得
  }
}
