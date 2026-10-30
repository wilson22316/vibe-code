import * as THREE from 'three';
import { BLOCK, COURT, HIT } from '../config.js';

const REACH_MARGIN = 1.5; // 允許跑出場外多遠去救球
const SPIKE_APPROACH_Z = 3.2; // 等舉球時，攻擊手先退到這裡準備助跑

// 簡化版自動跑位：依 Rally 的下一次觸球計畫（plan）決定每個人該去哪。
// 第 6 階段 AI 會在這之上做決策。
export class Positioning {
  constructor(teams) {
    this.teams = teams; // { home: Player[], away: Player[] }
  }

  // 每球開始前全員回站位
  reset() {
    for (const p of this.allPlayers()) {
      p.resetTo(p.base.x, p.base.z);
      p.facing = null;
    }
  }

  // plan：Rally 的觸球計畫或 null；live：來回進行中（大家盯著球）
  update(plan, ballPos, live) {
    for (const p of this.allPlayers()) p.facing = live ? ballPos : null;
    if (!plan) return;

    const { hitter, side, type } = plan;
    const team = side > 0 ? this.teams.home : this.teams.away;
    const teammate = team.find((p) => p !== hitter);

    if (plan.leave) hitter.moveTo(hitter.base.x, hitter.base.z);
    else {
      const spot = standSpot(plan);
      hitter.moveTo(spot.x, spot.z);
    }

    // 隊友預先到下一次觸球的位置
    if (type === 'bump') teammate.moveTo(0, side * (HIT.setSpotZ + HIT.standBehind));
    else if (type === 'set') teammate.moveTo(teammate.base.x * 0.9, side * SPIKE_APPROACH_Z);
    else teammate.moveTo(teammate.base.x, teammate.base.z);

    // 另一隊回防守站位；對方扣球時攔網員上網
    const defenders = side > 0 ? this.teams.away : this.teams.home;
    for (const p of defenders) {
      if (plan.block?.blocker === p) {
        const halfW = COURT.width / 2 - 0.5;
        p.moveTo(clamp(plan.point.x, -halfW, halfW), -side * BLOCK.netGap);
      } else {
        p.moveTo(p.base.x, p.base.z);
      }
    }
  }

  allPlayers() {
    return [...this.teams.home, ...this.teams.away];
  }
}

// 擊球時角色該站的位置：觸球點後方一點，限制在可救球範圍內
export function standSpot(plan) {
  const halfW = COURT.width / 2 + REACH_MARGIN;
  const maxDepth = COURT.length / 2 + REACH_MARGIN;
  const z = plan.point.z + plan.side * HIT.standBehind;
  return new THREE.Vector3(
    clamp(plan.point.x, -halfW, halfW),
    0,
    plan.side * clamp(Math.abs(z), 0.4, maxDepth),
  );
}

export function closestTo(players, point) {
  let best = players[0];
  let bestDist = Infinity;
  for (const p of players) {
    const d = (p.pos.x - point.x) ** 2 + (p.pos.z - point.z) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}
