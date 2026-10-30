import { MATCH } from '../config.js';

// 一局的計分與發球權：每球得分制，贏球的隊伍發下一球；
// 隊伍每次重新取得發球權時，由兩名隊員輪流發球。
export class Match {
  constructor() {
    this.reset();
  }

  reset() {
    this.score = { 1: 0, [-1]: 0 };
    this.servingSide = 1;
    // 各隊取得發球權的次數，用來決定輪到哪位隊員發球
    this.serveTurns = { 1: 1, [-1]: 0 };
    this.winner = null;
  }

  pointTo(side) {
    if (this.winner) return;
    this.score[side]++;
    if (side !== this.servingSide) {
      this.servingSide = side;
      this.serveTurns[side]++;
    }
    const lead = this.score[side] - this.score[-side];
    if (this.score[side] >= MATCH.points && lead >= MATCH.winBy) this.winner = side;
  }

  // teams: { home: Player[], away: Player[] }
  server(teams) {
    const team = this.servingSide > 0 ? teams.home : teams.away;
    return team[this.serveTurns[this.servingSide] % 2];
  }
}
