// 資源改用相對路徑：放在任何子資料夾（例如 Apache 的 htdocs/volleyball/）都能正常載入
export default {
  base: './',
  // 開發模式測連線：另外開 npm run lan:server，連線（/lan）轉給它
  server: {
    proxy: {
      '/lan': { target: 'ws://127.0.0.1:8090', ws: true },
    },
  },
};
