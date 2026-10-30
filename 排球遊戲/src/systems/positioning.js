import { COURT } from '../config.js';

const REACH_MARGIN = 1.5; // 允許跑出場外多遠去救球

// 簡化版自動跑位：球飛行時，落點那一隊離落點最近的人跑過去，隊友回站位。
// 第 4 階段會改成跑到「擊球點」而非落點，第 6 階段 AI 會在這之上做決策。
export class Positioning {
  constructor(teams) {
    this.teams = teams; // { home: Player[], away: Player[] }
    this.receiver = null;
  }

  // 每球開始前全員回站位
  reset() {
    this.receiver = null;
    for (const p of this.allPlayers()) {
      p.resetTo(p.base.x, p.base.z);
      p.facing = null;
    }
  }

  // landing：預測落點（Vector3）或 null；ballPos：讓沒在跑的人盯著球
  update(landing, ballPos) {
    if (!landing) {
      this.receiver = null;
      for (const p of this.allPlayers()) p.facing = null;
      return;
    }

    const team = landing.z > 0 ? this.teams.home : this.teams.away;

    // 接球的人一旦選定就不換，除非落點跑到另一隊（例如撞網彈回）
    if (!this.receiver || !team.includes(this.receiver)) {
      this.receiver = closestTo(team, landing);
    }

    const side = this.receiver.team.side;
    const halfW = COURT.width / 2 + REACH_MARGIN;
    const maxDepth = COURT.length / 2 + REACH_MARGIN;
    const x = clamp(landing.x, -halfW, halfW);
    const z = side * clamp(Math.abs(landing.z), 0.6, maxDepth);
    this.receiver.moveTo(x, z);

    for (const p of this.allPlayers()) {
      p.facing = ballPos;
      if (p !== this.receiver) p.moveTo(p.base.x, p.base.z);
    }
  }

  allPlayers() {
    return [...this.teams.home, ...this.teams.away];
  }
}

function closestTo(players, point) {
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
