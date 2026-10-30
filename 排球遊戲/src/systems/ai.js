import { AI_LEVELS, BALL, BLOCK, HIT, POWER } from '../config.js';

const SPIKE_X = [-2.8, 0, 2.8];
// 聰明扣球的候選落點（對方半場，depth 為離網距離）
const SMART_X = [-3.3, -2.2, -1.1, 0, 1.1, 2.2, 3.3];
const SMART_DEPTH = [2.2, 3.5, 5, 6.2, 7.4]; // 2.2：網前斜線小球（cut shot）
const BLOCK_AVOID = BLOCK.width.perfect + 0.3; // 過網位置離攔網員多近就算會被攔

let level = AI_LEVELS.normal;

export function setAiLevel(name) {
  level = AI_LEVELS[name];
}

export function aiLevel() {
  return level;
}

// 這次觸球的品質；回傳 null 代表漏接。hardIncoming：來球是扣球或完美攔網；incomingPower：來球是強力球
export function aiHitGrade(hardIncoming, incomingGrade, incomingPower = false) {
  const digChance = level.digChance[incomingGrade] * (incomingPower ? POWER.aiDigFactor : 1);
  if (hardIncoming && Math.random() > digChance) return null;
  const r = Math.random();
  if (r < level.badRate) return 'bad';
  return r < level.badRate + level.perfectRate ? 'perfect' : 'good';
}

// 能量滿時，這次扣球要不要用強力擊球（困難只在完美扣球時用，才不會浪費）
export function aiWantsPower(grade) {
  if (level.powerOnPerfect && grade !== 'perfect') return false;
  return Math.random() < level.powerChance;
}

// 對方扣球時要不要攔網；回傳 'perfect' | 'good' | null
export function aiBlockGrade() {
  const r = Math.random();
  if (r < level.blockRate.perfect) return 'perfect';
  return r < level.blockRate.perfect + level.blockRate.good ? 'good' : null;
}

// 發球力道：大多落在界內（約 0.33～0.67），偶爾失誤
export function aiServePower() {
  if (Math.random() < level.serveFaultRate) {
    return Math.random() < 0.5 ? 0.1 + Math.random() * 0.15 : 0.72 + Math.random() * 0.18;
  }
  return 0.38 + Math.random() * 0.26;
}

// 扣球落點 { x, depth }（depth 為離網距離）。
// from：擊球位置；side：扣球方；defenders：對方球員；block：對方的攔網（Rally 的 plan.block）或 null
export function aiSpikeTarget(from, side, defenders, block) {
  if (level.straightSpike) return { x: from.x, depth: 6 }; // 練習：直線扣球
  if (Math.random() >= level.smartAim) {
    return { x: SPIKE_X[Math.floor(Math.random() * SPIKE_X.length)], depth: 5.5 + Math.random() * 1.5 };
  }

  // 看攔網：對方沒跳或跳錯時機，就不用閃
  const blocker = block?.blocker ?? null;
  const blockUp = block?.grade === 'perfect' || block?.grade === 'good';

  // 防守員是在球掉到墊球高度時接球，不是在落點。扣球很快、球路接近直線，
  // 用比例估出那個位置，找離兩名防守員（攔網員落地後也能救）都遠、又不會撞上攔網的落點
  const digRatio = (from.y - HIT.heights.bump) / (from.y - BALL.radius);
  let best = null;
  let bestScore = -Infinity;
  for (const x of SMART_X) {
    for (const depth of SMART_DEPTH) {
      const z = -side * depth;
      const digX = from.x + (x - from.x) * digRatio;
      const digZ = from.z + (z - from.z) * digRatio;
      let score = Math.min(...defenders.map((p) => Math.hypot(p.pos.x - digX, p.pos.z - digZ)));
      if (blockUp) {
        // 球路大致是直線，用比例估算過網時的 x
        const crossX = from.x + (x - from.x) * (Math.abs(from.z) / (Math.abs(from.z) + depth));
        if (Math.abs(crossX - blocker.pos.x) < BLOCK_AVOID) score -= 10;
      }
      score += Math.random() * 0.5; // 一點隨機，避免每次都打同一點
      if (score > bestScore) {
        bestScore = score;
        best = { x, depth };
      }
    }
  }
  return best;
}
