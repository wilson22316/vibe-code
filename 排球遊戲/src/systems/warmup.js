import * as THREE from 'three';
import { HIT } from '../config.js';
import { JUMP_PEAK, jumpToReach } from '../entities/player.js';
import { predictCrossing, stepBall, velocityToTarget } from './ballPhysics.js';

const STEP = 1 / 120; // 跟比賽一樣用固定步長，算好的觸球時間才準
const REACH_TIME = 0.3; // 碰球前幾秒開始把手伸向球
const PASS_APEX = [3.8, 4.6]; // 傳球最高點（隨機）
const JITTER = 0.6; // 每一傳的落點隨機偏移，接球的人要小跑步去接
const SPOTS = { 1: [[-2.3, 4.2], [2.3, 4.2]], [-1]: [[2.3, -4.2], [-2.3, -4.2]] }; // 兩人站的位置（各隊自己的半場）

// 主畫面背景：每隊兩人在自己的半場互相傳球熱身，墊球、舉球隨機交替
export class WarmUp {
  // pairs：[{ players: [Player, Player], ball: { pos, vel } }]
  constructor(pairs) {
    this.pairs = pairs.map(({ players, ball }) => ({
      players,
      ball,
      side: players[0].team.side,
      spots: SPOTS[players[0].team.side].map(([x, z]) => new THREE.Vector3(x, 0, z)),
      plan: null, // 下一次觸球：{ receiver, kind, point, time, jumped }；null 表示這組沒在熱身
    }));
    this.time = 0;
    this.accumulator = 0;
  }

  // 回到熱身位置，由第一個人把球傳出去。side：只開始這一隊（不傳就兩隊都開始）
  start(side) {
    for (const pair of this.pairs) {
      if (side !== undefined && pair.side !== side) continue;
      pair.players.forEach((p, i) => {
        p.resetTo(pair.spots[i].x, pair.spots[i].z);
        p.facing = pair.ball.pos; // 一直看著球
      });
      const passer = pair.players[0];
      pair.ball.pos.set(passer.pos.x, HIT.heights.set, passer.pos.z);
      this.pass(pair, passer);
    }
  }

  // side：只停這一隊（不傳就兩隊都停）
  stop(side) {
    for (const pair of this.pairs) {
      if (side !== undefined && pair.side !== side) continue;
      for (const p of pair.players) {
        p.setReach(null);
        p.facing = null;
      }
      pair.plan = null;
    }
  }

  update(dt) {
    const active = this.pairs.filter((pair) => pair.plan);
    this.accumulator += dt;
    while (this.accumulator >= STEP) {
      this.accumulator -= STEP;
      this.time += STEP;
      for (const pair of active) this.step(pair);
    }
    // 越接近觸球時間，手越準確地伸向球
    for (const { plan, ball } of active) {
      const weight = 1 - THREE.MathUtils.clamp((plan.time - this.time) / REACH_TIME, 0, 1);
      plan.receiver.setReach(plan.kind, ball.pos, weight);
    }
  }

  step(pair) {
    const plan = pair.plan;
    stepBall(pair.ball, STEP);
    // 舉球要小跳一下，跳到最高點時剛好碰球
    if (plan.kind === 'set' && !plan.jumped && this.time >= plan.time - JUMP_PEAK) {
      plan.receiver.playJump(jumpToReach(plan.point.y, 'set'));
      plan.jumped = true;
    }
    if (this.time >= plan.time - STEP / 2) this.hit(pair); // 留半步誤差：時間是一步一步累加的浮點數
  }

  hit(pair) {
    const { receiver, kind } = pair.plan;
    const contact = pair.ball.pos.clone();
    this.pass(pair, receiver);
    // 碰球這一刻手剛好貼在球上，順勢動作從這個姿勢接下去
    receiver.setReach(kind, contact, 1);
    receiver.applyReach();
    receiver.playAction(kind);
    receiver.setReach(null);
  }

  // passer 把球傳給隊友：隨機選墊球（低）或舉球（高），算好落點和觸球時間，接球的人先跑過去
  pass(pair, passer) {
    const receiver = pair.players.find((p) => p !== passer);
    const kind = Math.random() < 0.5 ? 'bump' : 'set';
    const home = pair.spots[pair.players.indexOf(receiver)];
    const stand = new THREE.Vector3(home.x + (Math.random() * 2 - 1) * JITTER, 0, home.z + (Math.random() * 2 - 1) * JITTER);
    // 球在接球的人前方（朝傳球的人那一側），距離跟比賽中的站位一樣
    const toPasser = new THREE.Vector3(passer.pos.x - stand.x, 0, passer.pos.z - stand.z).normalize();
    const point = stand.clone().addScaledVector(toPasser, HIT.standBehind[kind]);
    point.y = HIT.heights[kind];

    const apex = PASS_APEX[0] + Math.random() * (PASS_APEX[1] - PASS_APEX[0]);
    velocityToTarget(pair.ball.pos, point, apex, pair.ball.vel);
    const t = predictCrossing(pair.ball, point.y, point);
    receiver.moveTo(stand.x, stand.z);
    pair.plan = { receiver, kind, point, time: this.time + (t ?? 1), jumped: false };
  }
}
