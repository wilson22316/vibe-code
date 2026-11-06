@echo off
chcp 65001 > nul
rem 排球遊戲的連線轉傳伺服器：遊戲頁面放在 Apache，連線對戰的訊息由這個 Node 程式轉傳（見 部署說明.md）
rem 視窗開著就是在跑，關掉就停止。埠號要跟 Apache 設定的 ProxyPass 一致
set PORT=8090
title 排球遊戲 連線伺服器（埠號 %PORT%）
cd /d "%~dp0"

where node > nul 2>&1
if errorlevel 1 (
  echo 找不到 Node.js，請先安裝 https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules\ws" (
  echo 第一次執行：安裝需要的套件...
  rem 不能加 --omit=dev：會把打包用的 vite 刪掉，npm run build 就不能用了
  call npm install
)

node server\lan.js --ws-only
echo.
echo 連線伺服器已停止。
pause
