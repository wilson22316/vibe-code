# 籃球遊戲（basketball-game）

網頁 3D 籃球遊戲。最終目標是 3 對 3、5 對 5，半場與全場。
目前階段：先把角色的動作一個個做好（動作展示館），遊戲規則之後再做。

## 技術棧

- 前端：Vue 3 + Vite + three.js（npm 最新版）
- 3D 素材：Blender 5.2，模型與動作都由 `blender/scripts/` 的 Python 腳本產生
- 之後部署：`npm run build` 的 `dist/` 放到 Apache（虛擬主機指向 `dist`）

## 資料夾

```
CLAUDE.md
public/models/athlete_game.glb   ← 遊戲載入的模型（腳本產生，不要手動修改）
src/                             ← Vue 程式碼
blender/scripts/                 ← 產生模型與動作的腳本（進 git）
blender/out/                     ← 腳本的暫存輸出（不進 git）
reference/                       ← 早期在 Claude App 做的網頁原型（three.js r128 舊寫法，僅供參考）
```

原始 `.blend` 檔放在專案外的 `D:\BlenderModel`，不進 git。

## 產生模型

```powershell
D:\Blender\blender.exe --background --python blender\scripts\build_athlete.py -- --out public\models\athlete_game.glb
```

- `athlete_model.py`：模型、骨架、權重、球鞋、籃球
- `athlete_anims.py`：所有動作（兩段式 IK 逐格算骨頭角度，記錄成關鍵影格）
- `build_athlete.py`：從空白場景重建全部並匯出
- 會清空場景，務必用 `--background` 執行。
- 修改動作 → 改 `athlete_anims.py` 的參數 → 重跑 → 重新整理網頁。

## 角色規格

- 座標：Blender 為 Z 軸朝上、角色面向 -Y；匯出 glTF 後為 Y 軸朝上、角色面向 +Z。原點在腳底，單位公尺，身高約 1.80 m。
- 角色約 16,400 個三角形，籃球約 3,300 個。整個 .glb 約 0.8 MB。
- 頭部零件（頭、五官、頭髮）完全綁在 `head`；球鞋前段綁 `toe`、其餘綁 `foot`；身體用自動權重。

### 骨架（26 根，名稱與階層不可更改，所有動作都依賴它）

```
root（不變形）
└─ hips
   ├─ spine ─ chest ─ neck ─ head
   │          ├─ shoulder.L ─ upper_arm.L ─ forearm.L ─ hand.L ─ fingers.L / thumb.L
   │          └─ shoulder.R ─ upper_arm.R ─ forearm.R ─ hand.R ─ fingers.R / thumb.R
   ├─ thigh.L ─ shin.L ─ foot.L ─ toe.L
   └─ thigh.R ─ shin.R ─ foot.R ─ toe.R
```

### 材質名稱與手繪動畫風配色（sRGB）

| 材質 | 色碼 | 材質 | 色碼 |
| --- | --- | --- | --- |
| Athlete_Skin | #F3C9A6 | Athlete_Hair | #3D2B22 |
| Athlete_Shirt | #6AA79C | Athlete_Eyes | #2B201B |
| Athlete_Shorts | #47607A | Athlete_EyeWhite | #FCF9F2 |
| Athlete_Socks | #F4EFE4 | Athlete_Mouth | #C47D67 |
| Athlete_Shoes | #D97B5C | Athlete_ShoeAccent | #2F5D62 |
| Athlete_Sole | #F4EFE4 | Athlete_Laces | #F7F3EA |
| Ball_Leather | #D9803F | Ball_Seam | #3A2A22 |

之後做隊伍配色時，換 `Athlete_Shirt`、`Athlete_Shorts` 的顏色即可，模型與動作共用。

## 動作規格（24 fps）

| 名稱 | 影格 | 長度 | 播放 | 球 | 備註 |
| --- | --- | --- | --- | --- | --- |
| Idle | 48 | 2.0 s | 循環 | 放在右腳前方地上 | 無球待機 |
| Dribble | 24 | 1.0 s | 循環 | 右手運球 | 原地，膝蓋微彎、身體前傾 |
| Shoot | 30 | 1.25 s | 單次 | 第 18 格（0.75 s）出手，之後縮放為 0 | 出手後由遊戲接手球的飛行 |
| Sprint | 12 | 0.5 s | 循環 | 右手在身前運球 | 原地循環，遊戲以 3.0 m/s 推動角色，腳才不會打滑 |

- glTF 裡的動畫長度會多一格（例如 Idle 顯示 2.04 s），這是正常的。
- 每段動作的球都有位置與縮放軌道，切換動作時球會正確出現或消失。
- 新增動作時，在這張表補上：影格數、循環或單次、球的狀態與交接影格、是否原地。

## 手繪動畫風的網頁渲染

- 材質：`MeshToonMaterial`，色階貼圖 4 階 `[120, 170, 215, 245]`，`RedFormat`、`NearestFilter`。
- 描邊：背面放大法，沿法線外推 0.0045 m，顏色 #4A3326。眼睛、嘴巴、球的接縫不加描邊。骨架網格的描邊要用 `SkinnedMesh` 綁同一副骨架。
- 光：半球光（天空 #FFF3E0、地面 #9A8FB0）＋ 帶陰影的平行光（#FFF0D6）。新版 three.js 的燈光強度要重新調。
- 背景：程式產生的藍天白雲與草地（見 `reference/`）。

## 球場與物理常數（公尺、秒；之後做遊戲時用）

- 籃框中心高 3.05，半徑 0.225，框管半徑 0.012；籃板正面在籃框中心後方 0.375，寬 1.8、高 1.05，下緣離地 2.90。
- 球半徑 0.12，重力 9.8。反彈係數：籃框 0.55、籃板 0.6、地板 0.72。
- 出手速度範圍 4–13 m/s；「理想力道」瞄準籃框中心往後 4 cm。物理每秒計算 240 次。
- 進球判定：球心往下穿過籃框高度時，水平距離小於「籃框半徑 − 0.035」。

## three.js 版本注意

`reference/` 裡的原型用的是 r128 舊寫法，搬程式碼時要改成新版：
- `import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'`
- 不要再呼叫 `Color.convertSRGBToLinear()`（新版會自動處理色彩空間）
- `LuminanceFormat` → `RedFormat`；材質的 `skinning: true` 拿掉
- `texture.encoding = sRGBEncoding` → `texture.colorSpace = SRGBColorSpace`；`renderer.outputEncoding` 拿掉（新版預設就是 sRGB 輸出）
- 描邊用 `onBeforeCompile` 取代 `#include <begin_vertex>` 的寫法在新版仍可用
- 以上已對 three.js r187（0.187.0）核對過；升級 three.js 時再核對一次

## 開發規則

- 骨頭名稱與階層不改；需要新骨頭時先討論，並確認既有動作不受影響。
- `.glb` 只由腳本產生；改動作就改腳本。
- 新動作做完先放進「動作展示館」單獨檢查（可 360 度旋轉、調速度、看骨架與地面格線），再做串接測試。
- 不刪除 `D:\BlenderModel` 裡的檔案；刪任何檔案前先列出清單讓使用者確認。

## 路線圖

1. 動作展示館：放入現有 4 個動作，加入串接測試
2. 第一批動作：無球待機、慢跑、無球衝刺、持球待機（三威脅）、運球走、急停、定點投籃、上籃
3. 傳接球、防守、搶籃板（3 對 3 需要）
4. 花式運球、灌籃、情緒動作（可考慮動作捕捉）
5. 遊戲：鍵盤操作、規則、半場 3 對 3 → 全場 5 對 5
