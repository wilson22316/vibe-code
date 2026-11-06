// 分頁在背景（切到別的分頁、視窗縮小）時瀏覽器會停掉 requestAnimationFrame。
// 連線對戰中主機停住的話兩邊都會卡，所以用 Worker 的計時器（在背景不會被降速）每 interval 毫秒叫一次 callback，
// 由呼叫的人判斷畫面是不是停了。（有些瀏覽器背景分頁的 document.hidden 仍是 false，不能只看它）
export function startBackgroundTicker(callback, interval = 1000 / 60) {
  const url = URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${interval});`], { type: 'text/javascript' }));
  const worker = new Worker(url);
  worker.onmessage = () => callback(performance.now());
}
