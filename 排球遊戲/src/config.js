// 場地尺寸（公尺），依沙灘排球標準。網子沿 x 軸、位於 z = 0；玩家方在 +z，對手在 -z。
export const COURT = {
  length: 16,
  width: 8,
  netHeight: 2.43,
  netDepth: 1, // 網子上下高度
  postOffset: 1, // 網柱在邊線外 1 公尺
};

export const MATCH = {
  points: 15, // 先到幾分
  winBy: 2, // 至少領先幾分
};

// 由玩家操作的隊伍（1 = home）；本機雙人時加入 -1
export const HUMAN_SIDES = [1];

// 電腦對手難度
// perfectRate / badRate：每次觸球打出 Perfect / Bad 的機率
// digChance：接得起對方扣球（或完美攔網）的機率，依來球品質
// blockRate：對方扣球時起跳攔網的機率與品質
// speed：跑速倍率；smartAim：扣球時找空檔、看攔網的機率
// powerChance：能量滿時這次扣球用強力擊球的機率；powerOnPerfect：只在完美扣球時用（抓時機）
export const AI_LEVELS = {
  easy: {
    label: '簡單',
    perfectRate: 0.1,
    badRate: 0.2,
    digChance: { perfect: 0.15, good: 0.4, bad: 0.7 },
    blockRate: { perfect: 0.05, good: 0.1 },
    serveFaultRate: 0.2,
    speed: 0.85,
    smartAim: 0,
    powerChance: 0,
    powerOnPerfect: false,
  },
  normal: {
    label: '普通',
    perfectRate: 0.3,
    badRate: 0.08,
    digChance: { perfect: 0.5, good: 0.82, bad: 0.92 },
    blockRate: { perfect: 0.15, good: 0.25 },
    serveFaultRate: 0.1,
    speed: 1,
    smartAim: 0.3,
    powerChance: 0.4,
    powerOnPerfect: false,
  },
  hard: {
    label: '困難',
    perfectRate: 0.5,
    badRate: 0.03,
    digChance: { perfect: 0.72, good: 0.92, bad: 0.96 },
    blockRate: { perfect: 0.25, good: 0.3 },
    serveFaultRate: 0.05,
    speed: 1.05,
    smartAim: 0.6,
    powerChance: 1,
    powerOnPerfect: true,
  },
  // 練習模式用（不會出現在難度選單）：發球不失誤、不攔網、扣球隨機落點（不找空檔、不閃攔網）
  practice: {
    label: '練習',
    perfectRate: 0.3,
    badRate: 0,
    digChance: { perfect: 0.5, good: 0.82, bad: 0.92 },
    blockRate: { perfect: 0, good: 0 },
    serveFaultRate: 0,
    speed: 1,
    smartAim: 0,
    powerChance: 0,
    powerOnPerfect: false,
  },
};

// 練習模式「慢速」的遊戲速度倍率：球、角色、時機提示圈一起變慢，判定時窗等於變寬
export const PRACTICE_SLOW = 0.6;

// 畫質設定（選單或 G 鍵切換）。實測內顯（Intel UHD 630，1080p）：畫質優先約 21ms/幀、效能優先約 13ms/幀
export const GRAPHICS = {
  quality: { label: '畫質優先', maxPixelRatio: 2, bloom: true, grade: true, shadowMapSize: 2048 },
  performance: { label: '效能優先', maxPixelRatio: 1, bloom: false, grade: false, shadowMapSize: 1024 },
};

// 強力擊球：扣球累積能量，滿了按 A，下一次扣球變成強力球（用完能量歸零）
export const POWER = {
  maxEnergy: 5,
  startEnergy: { human: 5, ai: 0 }, // 每局開始時的能量：玩家一開局就有一次強力擊球可用（想讓對手也有，把 ai 改成 5）
  gain: { perfect: 2, good: 1, bad: 1 }, // 每次扣球累積的能量
  speed: 0.7, // 扣球飛行時間倍率（越小越快）
  digWindow: 0.7, // 接強力球的判定時窗再乘上這個
  aiDigFactor: 0.6, // AI 接得起強力球的機率再乘上這個
  blockWidth: 0.6, // 攔網涵蓋範圍再乘上這個
  auraSmall: 1, // 按了 A、還不知道誰扣球時，兩人先冒的小氣場強度
  auraFull: 1.5, // 確定誰扣球時，那個人的氣場全開強度（原本 1，加強 50%；越大火焰越猛）
  freezeTime: 1, // 玩家強力扣球命中時，畫面定格的秒數
  cutBackTime: 0.4, // 定格結束後，鏡頭從特寫拉回原本視角的秒數
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
  // 站在觸球點後方（遠離網子）多少。Q 版頭大手短：要站遠一點，球才會在額頭前上方（墊球在胸前）、不會貼到臉
  standBehind: { bump: 0.55, set: 0.45, spike: 0.6 },
  spikeShift: 0.3, // 扣球時往左挪，讓打球的右肩剛好在球正後方
  digReaction: 0.2, // 對方扣球過來時，防守員要先判斷球路才起動（秒）
  hardDigWindow: { perfect: 0.5, good: 0.75, bad: 1 }, // 接扣球時判定時窗的倍率（依來球品質），球越快越難接
  setSpotZ: 2.2, // 墊球送到離網多遠讓隊友舉
  spikeSpotZ: 1.6, // 舉球送到離網多遠讓隊友扣
};

export const BLOCK = {
  netGap: 0.45, // 攔網員站在離網多遠
  lead: 0.15, // 理想起跳時間比對方扣球早多少秒（跳到最高點時球剛好到網）
  reach: 3.3, // 跳起來手能碰到的高度
  width: { perfect: 0.55, good: 0.3 }, // 攔網員左右能蓋住的範圍
  jumpHeight: 1.2, // 攔網跳多高：Q 版手短，要跳這麼高雙手才會在網子上方
};

export const PLAYER = {
  speed: 5.5, // 最高跑速（公尺/秒）
  turnSpeed: 12, // 轉身速度
};

// 兩隊：home 在 +z（玩家方），away 在 -z。base 為每次發球前的站位。
// pattern：球衣花紋（stripes 兩側直條、band 胸口橫條）；hairStyle、accessory 見 characterModel.js
export const TEAMS = {
  home: {
    side: 1,
    shirt: 0xff6b4a,
    pattern: 'stripes',
    members: [
      { base: [-2, 5], skin: 0xffd7b5, hair: 0x3b2a20, hairStyle: 'short', accessory: 'sunglasses', number: 7 },
      { base: [2, 5], skin: 0xf1c08f, hair: 0xe0a33a, hairStyle: 'ponytail', accessory: 'none', number: 11 },
    ],
  },
  away: {
    side: -1,
    shirt: 0x5b6cff,
    pattern: 'band',
    members: [
      { base: [-2, -5], skin: 0xe7b48a, hair: 0x1f1f2e, hairStyle: 'spiky', accessory: 'headband', number: 3 },
      { base: [2, -5], skin: 0xffe0c4, hair: 0xc4473a, hairStyle: 'bun', accessory: 'none', number: 9 },
    ],
  },
};
