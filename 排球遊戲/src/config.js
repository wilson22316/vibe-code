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

export const HIT = {
  heights: { bump: 0.9, set: 2.1, spike: 3.0 }, // 各種擊球的觸球高度
  windows: { perfect: 0.07, good: 0.18, bad: 0.35 }, // 時機判定（秒，與理想觸球時間的差）
  reach: 0.9, // 角色離理想站位多遠以內還碰得到球
  standBehind: 0.35, // 站在觸球點後方（遠離網子）多少
  setSpotZ: 2.2, // 墊球送到離網多遠讓隊友舉
  spikeSpotZ: 1.6, // 舉球送到離網多遠讓隊友扣
};

export const PLAYER = {
  speed: 5.5, // 最高跑速（公尺/秒）
  turnSpeed: 12, // 轉身速度
};

// 兩隊：home 在 +z（玩家方），away 在 -z。base 為每次發球前的站位。
export const TEAMS = {
  home: {
    side: 1,
    shirt: 0xff6b4a,
    members: [
      { base: [-2, 5], skin: 0xffd7b5, hair: 0x3b2a20 },
      { base: [2, 5], skin: 0xf1c08f, hair: 0xe0a33a },
    ],
  },
  away: {
    side: -1,
    shirt: 0x5b6cff,
    members: [
      { base: [-2, -5], skin: 0xe7b48a, hair: 0x1f1f2e },
      { base: [2, -5], skin: 0xffe0c4, hair: 0xc4473a },
    ],
  },
};
