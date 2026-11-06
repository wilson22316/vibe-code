# 籃球遊戲（basketball-game）

網頁 3D 籃球遊戲，手繪動畫風。最終目標是 3 對 3、5 對 5，半場與全場。

目前階段：角色動作已大致完成，開始做遊戲（主畫面 → 練習模式 → 教學模式 → 對戰模式）。

> 骨架、動作、渲染、物理等詳細規格與開發規則見 [CLAUDE.md](CLAUDE.md)。

## 技術

| 用途 | 技術 |
| --- | --- |
| 前端框架 | Vue 3 |
| 建置與開發伺服器 | Vite |
| 3D 渲染 | three.js（npm 最新版） |
| 模型與動作 | Blender 5.2 + Python 腳本（`blender/scripts/`） |
| 模型格式 | glTF Binary（`.glb`） |
| 部署 | Apache，虛擬主機指向 `dist/` |

three.js 主要用到：`GLTFLoader`（載入模型）、`AnimationMixer`（播放與切換動作）、`OrbitControls`（旋轉視角）、`SkeletonHelper` / `GridHelper`（看骨架與格線）、`MeshToonMaterial`（卡通材質）。

## 資料夾

```
public/models/athlete_game.glb   遊戲載入的模型（腳本產生，不要手動修改）
src/                             Vue 程式碼
blender/scripts/                 產生模型與動作的 Python 腳本
blender/out/                     腳本的暫存輸出（不進 git）
reference/                       早期網頁原型（three.js r128 舊寫法，僅供參考）
```

原始 `.blend` 檔放在專案外的 `D:\BlenderModel`，不進 git。

## 開發

需要 Node.js（目前用 v24）。開發伺服器在 http://localhost:5173（Vite 預設）。

```powershell
npm install      # 安裝套件
npm run dev      # 啟動開發伺服器
npm run build    # 建置到 dist/
```

動作展示館是開發工具，主選單不會顯示：網址加 `?gallery` 才進得去（例如 http://localhost:5173/?gallery）。

## 重新產生模型

修改 `blender/scripts/` 裡的腳本後執行（會清空場景，務必加 `--background`）：

```powershell
D:\Blender\blender.exe --background --python blender\scripts\build_athlete.py -- --out public\models\athlete_game.glb
```

完成後重新整理網頁即可看到新的模型與動作。

## 部署

1. `npm run build`
2. 把 `dist/` 放到 Apache，虛擬主機的 DocumentRoot 指向 `dist`
