// 場地尺寸（公尺），依沙灘排球標準。網子沿 x 軸、位於 z = 0；玩家方在 +z，對手在 -z。
export const COURT = {
  length: 16,
  width: 8,
  netHeight: 2.43,
  netDepth: 1, // 網子上下高度
  postOffset: 1, // 網柱在邊線外 1 公尺
};

export const BALL = {
  radius: 0.15, // 實際約 0.105，放大一些讓畫面好讀
  gravity: 7, // 比真實 9.81 小，球飛得比較飄、好反應
  bounce: 0.35, // 沙地反彈係數
  friction: 0.6, // 每次觸地水平速度保留比例
};
