// 1 對 1 的紀錄：目前連勝、最高連勝、最快獲勝時間（秒）、上次選的難度。
// 存在瀏覽器的 localStorage；讀不到（無痕模式等）就當作沒有紀錄。

const STORAGE_KEY = 'basketball.duelRecords'
const EMPTY = { streak: 0, best: 0, fastest: null, level: 'normal' }

export function loadRecords() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY))
    if (saved && typeof saved === 'object') return { ...EMPTY, ...saved }
  } catch {
    // 讀不到或格式不對就用空的
  }
  return { ...EMPTY }
}

function save(records) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
  } catch {
    // 存不進去時，只是下次不會記得
  }
  return records
}

export const saveLevel = (level) => save({ ...loadRecords(), level })

// 記下一場的結果（won 贏了沒、seconds 打了幾秒）。回傳更新後的紀錄，多帶 newBest、newFastest 表示有沒有破紀錄
export function recordGame(won, seconds) {
  const records = loadRecords()
  const streak = won ? records.streak + 1 : 0
  const newBest = streak > records.best
  const newFastest = won && (records.fastest === null || seconds < records.fastest)
  const saved = save({
    ...records,
    streak,
    best: Math.max(records.best, streak),
    fastest: newFastest ? Math.round(seconds) : records.fastest,
  })
  return { ...saved, newBest, newFastest }
}
