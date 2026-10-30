import * as THREE from 'three';
import { BALL, HIT } from '../config.js';
import { JUMP_TIME } from '../entities/player.js';
import { input } from '../input/keyboard.js';
import {
  isInCourt,
  predictCrossing,
  predictLanding,
  stepBall,
  velocityForTime,
  velocityToTarget,
  willHitNet,
} from './ballPhysics.js';
import { closestTo, standSpot } from './positioning.js';

const RESULT_TIME = 2;
const HUMAN_SIDES = [1]; // 目前只有 home 由玩家操作；本機雙人時加入 -1
// AI 基本參數，第 6 階段依難度調整
const AI_PERFECT_RATE = 0.3;
const AI_BAD_RATE = 0.08;
const AI_DIG_CHANCE = { perfect: 0.35, good: 0.7, bad: 0.9 }; // 接得起對方扣球的機率（依扣球品質）
const SPIKE_TIME = { perfect: 0.5, good: 0.7, bad: 0.6 }; // 扣球飛行秒數，越短越快
const ERROR = { perfect: 0, good: 0.8, bad: 2.5 }; // 落點隨機誤差（公尺）
const SPIKE_AIM_X = 2.8;

// 第幾次觸球 → 依序嘗試的 [擊球類型, 觸球高度]；球不夠高時降級
const ATTEMPTS = {
  1: [['bump', HIT.heights.bump]],
  2: [['set', HIT.heights.set], ['set', HIT.heights.bump]],
  3: [['spike', HIT.heights.spike], ['free', HIT.heights.set], ['free', HIT.heights.bump]],
};

// 一球的來回：預測下一次誰在哪裡碰球、判定按鍵時機、執行擊球、判定得分。
// 球路是確定性的，所以每次擊球後就能算出下一次觸球的精確位置與時間（plan）。
export class Rally {
  constructor(ball, teams, hud, onFinished) {
    this.ball = ball;
    this.sides = { 1: teams.home, [-1]: teams.away };
    this.hud = hud;
    this.onFinished = onFinished;
    this.state = 'idle'; // idle（發球前）→ live（來回中）→ dead（顯示結果）
    this.plan = null;
    this.time = 0;
  }

  start(server) {
    this.state = 'live';
    this.time = 0;
    this.lastSide = server.team.side;
    this.lastType = 'serve';
    this.lastHitter = server;
    this.touches = 0;
    this.flags = { net: false, outsideAntenna: false };
    this.replan();
  }

  isHuman(side) {
    return HUMAN_SIDES.includes(side);
  }

  // 每幀呼叫一次：處理按鍵
  update() {
    if (this.state === 'live' && input.wasPressed('action')) this.press();
  }

  // 固定步長呼叫：推進球與判定
  step(dt) {
    if (this.state === 'idle') return;
    this.time += dt;
    const events = stepBall(this.ball, dt);

    if (this.state === 'dead') {
      this.resultTimer -= dt;
      if (this.resultTimer <= 0) {
        this.state = 'idle';
        this.onFinished();
      }
      return;
    }

    if (events.includes('outsideAntenna')) this.flags.outsideAntenna = true;
    if (events.includes('net')) {
      this.flags.net = true;
      this.replan();
    }
    if (events.includes('ground')) {
      this.endPoint();
      return;
    }
    this.updatePlan();
  }

  replan() {
    this.plan = null;
    const probe = new THREE.Vector3();
    if (predictCrossing(this.ball, HIT.heights.bump, probe) === null) return;

    const side = probe.z > 0 ? 1 : -1;
    const sameSide = side === this.lastSide;
    // 發球掛網彈回、或已經碰滿三次：這一側不能再碰
    if (sameSide && (this.lastType === 'serve' || this.touches >= 3)) return;
    const touch = sameSide ? this.touches + 1 : 1;
    const team = this.sides[side];

    for (const [type, height] of ATTEMPTS[touch]) {
      const point = new THREE.Vector3();
      const t = predictCrossing(this.ball, height, point);
      if (t === null || (point.z > 0 ? 1 : -1) !== side) continue;

      const hitter = touch === 1 ? closestTo(team, point) : team.find((p) => p !== this.lastHitter);
      this.plan = { side, touch, type, point, time: this.time + t, hitter, grade: null, jumped: false, leave: false };
      if (!this.isHuman(side)) this.decideAi(this.plan);
      return;
    }
  }

  // AI：一傳看到會出界就不碰；接扣球有機率漏接；其餘照機率決定擊球品質
  decideAi(plan) {
    if (plan.touch === 1) {
      const landing = predictLanding(this.ball, new THREE.Vector3());
      if (landing && !isInCourt(landing)) {
        plan.leave = true;
        return;
      }
      // 漏接：不給 grade，時間到就當沒碰到
      if (this.lastType === 'spike' && Math.random() > AI_DIG_CHANCE[this.lastGrade]) return;
    }
    const r = Math.random();
    plan.grade = r < AI_BAD_RATE ? 'bad' : r < AI_BAD_RATE + AI_PERFECT_RATE ? 'perfect' : 'good';
  }

  press() {
    const plan = this.plan;
    if (!plan || !this.isHuman(plan.side) || plan.grade) return;
    const early = plan.time - this.time; // 正數：提早按
    if (early > HIT.windows.bad) return; // 太早，當作沒按，可以再按一次
    const diff = Math.abs(early);
    plan.grade = diff <= HIT.windows.perfect ? 'perfect' : diff <= HIT.windows.good ? 'good' : 'bad';
    if (early <= 0) this.hit(); // 晚按：馬上擊球
  }

  updatePlan() {
    const plan = this.plan;
    if (!plan) return;

    // 扣球提前起跳，讓跳到最高點時剛好碰球
    if (plan.type === 'spike' && !plan.jumped && !plan.leave && this.time >= plan.time - JUMP_TIME / 2) {
      plan.hitter.playJump();
      plan.jumped = true;
    }

    if (this.time < plan.time) return;
    if (plan.grade) {
      this.hit();
    } else if (plan.leave || this.time >= plan.time + HIT.windows.bad) {
      if (!plan.leave && this.isHuman(plan.side)) this.hud.showJudge('miss');
      this.plan = null;
    }
  }

  hit() {
    const plan = this.plan;
    const { hitter, side, type, grade } = plan;
    this.plan = null;

    const stand = standSpot(plan);
    if (Math.hypot(hitter.pos.x - stand.x, hitter.pos.z - stand.z) > HIT.reach) {
      if (this.isHuman(side)) this.hud.showJudge('far');
      return;
    }

    this.shoot(plan);
    hitter.playAction(type === 'spike' ? 'swing' : plan.point.y < 1.5 ? 'bump' : 'set');
    if (this.isHuman(side)) this.hud.showJudge(grade);

    this.lastSide = side;
    this.lastType = type;
    this.lastGrade = grade;
    this.lastHitter = hitter;
    this.touches = plan.touch;
    this.flags.net = false;
    this.flags.outsideAntenna = false;
    this.replan();
  }

  shoot({ side, type, grade, hitter }) {
    const ball = this.ball;
    const err = ERROR[grade];
    const jitter = () => (Math.random() * 2 - 1) * err;
    const target = new THREE.Vector3();

    if (type === 'bump') {
      // 送到網前讓隊友舉
      target.set(jitter(), HIT.heights.set, side * HIT.setSpotZ + jitter() * 0.6);
      velocityToTarget(ball.pos, target, 4, ball.vel);
    } else if (type === 'set') {
      // 舉到隊友那一側的網前
      const spiker = this.sides[side].find((p) => p !== hitter);
      target.set(spiker.base.x * 0.9 + jitter(), HIT.heights.spike, side * HIT.spikeSpotZ + jitter() * 0.5);
      velocityToTarget(ball.pos, target, 5, ball.vel);
    } else if (type === 'spike') {
      target.set(this.spikeAimX(side) + jitter(), BALL.radius, -side * (5.5 + Math.random() * 1.5) + jitter());
      let time = SPIKE_TIME[grade];
      velocityForTime(ball.pos, target, time, ball.vel);
      // 好球保證過網：太平就放慢、拋高一點；壞球不保證
      while (grade !== 'bad' && time < 1.4 && willHitNet(ball)) {
        time += 0.05;
        velocityForTime(ball.pos, target, time, ball.vel);
      }
    } else {
      // 球不夠高沒辦法扣，只能推過網
      target.set(jitter(), BALL.radius, -side * 5 + jitter());
      velocityToTarget(ball.pos, target, ball.pos.y + 2, ball.vel);
    }
  }

  spikeAimX(side) {
    if (this.isHuman(side)) {
      // 鏡頭在 home 後方：螢幕左 = -x
      const dir = (input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0);
      if (dir !== 0) return dir * SPIKE_AIM_X;
      return -Math.sign(this.ball.pos.x || 1) * 2; // 沒按方向：打斜線
    }
    return [-SPIKE_AIM_X, 0, SPIKE_AIM_X][Math.floor(Math.random() * 3)];
  }

  endPoint() {
    const pos = this.ball.pos;
    const landSide = pos.z > 0 ? 1 : -1;
    let loser;
    let reason;

    if (landSide === this.lastSide) {
      // 球最後是自己碰的、又掉回自己這側
      loser = landSide;
      if (this.flags.net) reason = '掛網';
      else if (this.lastType === 'serve') reason = '沒過網';
      else reason = isInCourt(pos) ? '落地' : '出界';
    } else if (this.flags.outsideAntenna) {
      loser = this.lastSide;
      reason = '標誌桿外';
    } else if (isInCourt(pos)) {
      loser = landSide;
      reason = '界內';
    } else {
      loser = this.lastSide;
      reason = '出界';
    }

    const humanWins = this.isHuman(-loser);
    this.hud.showResult({ text: `${reason}・${humanWins ? '我方得分！' : '對手得分'}`, good: humanWins });
    this.plan = null;
    this.state = 'dead';
    this.resultTimer = RESULT_TIME;
  }
}
