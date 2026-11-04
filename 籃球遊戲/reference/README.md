# 早期網頁原型（僅供參考）

這三個檔案是在 Claude App 裡做的單頁原型，使用 three.js r128 的舊寫法。
模型原本以 base64 內嵌在 `__GLB__` 等位置，這裡已拿掉，只保留程式碼。

- `shoot_game_r128.html`：投籃練習場。方向鍵衝刺、攝影機對準籃框、蓄力投籃、拋物線物理、碰框與籃板反彈、進球判定。
- `dribble_preview_r128.html`：運球動畫預覽。AnimationMixer 切換動作、骨架顯示、速度調整。
- `style_comparison_r128.html`：五種風格比較（Low poly、卡通、簡化、寫實、手繪動畫風）的上色與描邊寫法。

搬到新專案時，要改成新版 three.js 的寫法（見專案根目錄 CLAUDE.md）。
