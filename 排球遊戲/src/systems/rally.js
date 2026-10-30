import * as THREE from 'three';
import { BALL, BLOCK, COURT, HIT, HUMAN_SIDES } from '../config.js';
import { JUMP_TIME } from '../entities/player.js';
import { input } from '../input/keyboard.js';
import {
  isInCourt,
  predictCrossing,
  predictLanding,
  predictNetCrossing,
  stepBall,
  velocityForTime,
  velocityToTarget,
  willHitNet,
} from './ballPhysics.js';
import { aiBlockGrade, aiHitGrade, aiSpikeTarget } from './ai.js';
import { closestTo, standSpot } from './positioning.js';

const RESULT_TIME = 2;
const BLOCK_MAX_NET_DIST = 1; // 攔網員離網超過這距離就攔不到（還沒跑到位）
const SPIKE_TIME = { perfect: 0.5, good: 0.7, bad: 0.6 }; // 扣球飛行秒數，越短越快
const ERROR = { perfect: 0, good: 0.8, bad: 2.5 }; // 落點隨機誤差（公尺）
const HARD_BALL_BAD_ERROR = 5;
const SPIKE_AIM_X = 2.8;

// early：離理想時間還有幾秒（負數為晚按）；scale：時窗倍率。太早回傳 null（當作沒按）。
function gradeTiming(early, scale = 1) {
  const { perfect, good, bad } = HIT.windows;
  if (early > bad) return null;
  const diff = Math.abs(early);
  return diff <= perfect * scale ? 'perfect' : diff <= good * scale ? 'good' : 'bad';
}

// 第幾次觸球 → 依序嘗試的 [擊球類型, 觸球高度]；球不夠高時降級
const ATTEMPTS = {
  1: [['bump', HIT.heights.bump]],
  2: [['set', HIT.heights.set], ['set', HIT.heights.bump]],
  3: [['spike', HIT.heights.spike], ['free', HIT.heights.set], ['free', HIT.heights.bump]],
};

// 一球的來回：預測下一次誰在哪裡碰球、判定按鍵時機、執行擊球、判定得分。
// 球路是確定性的，所以每次擊球後就能算出下一次觸球的精確位置與時間（plan）。
export class Rally {
  // onPoint(winnerSide)：判定得分當下呼叫；onFinished()：結果顯示完畢後呼叫
  // onEvent(name, data)：給特效與音效用，'hit' | 'block' | 'net' | 'land'
  constructor(ball, teams, hud, { onPoint, onFinished, onEvent = () => {} }) {
    this.ball = ball;
    this.sides = { 1: teams.home, [-1]: teams.away };
    this.hud = hud;
    this.onPoint = onPoint;
    this.onFinished = onFinished;
    this.onEvent = onEvent;
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
      this.onEvent('net');
      this.replan();
    }
    if (events.includes('ground')) {
      this.onEvent('land', { pos: this.ball.pos.clone(), lastType: this.lastType });
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
      // 接扣球：防守員要反應一下才起動；扣球和完美攔網蓋下來的球比較難接
      const moveAt = this.time + (this.lastType === 'spike' ? HIT.digReaction : 0);
      const hardBall = touch === 1 && (this.lastType === 'spike' || (this.lastType === 'block' && this.lastGrade === 'perfect'));
      const windowScale = hardBall ? HIT.hardDigWindow[this.lastGrade] : 1;
      this.plan = { side, touch, type, point, time: this.time + t, moveAt, hitter, hardBall, windowScale, grade: null, jumped: false, leave: false };
      if (!this.isHuman(side)) this.decideAi(this.plan);
      if (type === 'spike') this.plan.block = this.makeBlock(this.plan);
      return;
    }
  }

  // 對方要扣球時，防守方離扣球點最近的人上網攔網
  makeBlock(plan) {
    const defendSide = -plan.side;
    const block = {
      blocker: closestTo(this.sides[defendSide], plan.point),
      grade: null,
      jumped: false,
      idealTime: plan.time - BLOCK.lead,
    };
    if (!this.isHuman(defendSide)) block.grade = aiBlockGrade();
    return block;
  }

  // 目前要給玩家看的時機提示：{ x, z, timeLeft } 或 null
  getCue() {
    const plan = this.plan;
    if (this.state !== 'live' || !plan) return null;
    if (this.isHuman(plan.side)) return { x: plan.point.x, z: plan.point.z, timeLeft: plan.time - this.time };
    const block = plan.block;
    if (block && !block.grade && this.isHuman(block.blocker.team.side)) {
      return { x: block.blocker.pos.x, z: block.blocker.pos.z, timeLeft: block.idealTime - this.time };
    }
    return null;
  }

  // AI：一傳看到會出界就不碰；其餘依難度決定擊球品質或漏接（grade 為 null，時間到就當沒碰到）
  decideAi(plan) {
    if (plan.touch === 1) {
      const landing = predictLanding(this.ball, new THREE.Vector3());
      if (landing && !isInCourt(landing)) {
        plan.leave = true;
        return;
      }
    }
    plan.grade = aiHitGrade(plan.hardBall, this.lastGrade);
  }

  press() {
    const plan = this.plan;
    if (!plan) return;

    // 對方扣球前：攔網起跳
    const block = plan.block;
    if (block && !block.grade && this.isHuman(block.blocker.team.side)) {
      const grade = gradeTiming(block.idealTime - this.time);
      if (!grade) return;
      block.grade = grade;
      this.blockJump(block);
      return;
    }

    if (!this.isHuman(plan.side) || plan.grade) return;
    const early = plan.time - this.time; // 正數：提早按
    const grade = gradeTiming(early, plan.windowScale);
    if (!grade) return; // 太早，當作沒按，可以再按一次
    plan.grade = grade;
    if (early <= 0) this.hit(); // 晚按：馬上擊球
  }

  blockJump(block) {
    block.jumped = true;
    block.blocker.playJump();
    block.blocker.playAction('set'); // 雙手舉高
  }

  updatePlan() {
    const plan = this.plan;
    if (!plan) return;

    // 扣球提前起跳，讓跳到最高點時剛好碰球
    if (plan.type === 'spike' && !plan.jumped && !plan.leave && this.time >= plan.time - JUMP_TIME / 2) {
      plan.hitter.playJump();
      plan.jumped = true;
    }

    // AI 攔網員在理想時間起跳
    const block = plan.block;
    if (block && block.grade && !block.jumped && this.time >= block.idealTime) this.blockJump(block);

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

    const contact = this.ball.pos.clone();
    this.shoot(plan);
    hitter.playAction(type === 'spike' ? 'swing' : plan.point.y < 1.5 ? 'bump' : 'set');
    if (this.isHuman(side)) this.hud.showJudge(grade);
    this.onEvent('hit', { type, grade, human: this.isHuman(side), pos: contact });

    if (type === 'spike' && this.tryBlock(plan)) return;
    this.touched(hitter, type, grade, plan.touch);
  }

  // 記錄最後一次觸球，並預測下一次
  touched(player, type, grade, touches) {
    this.lastSide = player.team.side;
    this.lastType = type;
    this.lastGrade = grade;
    this.lastHitter = player;
    this.touches = touches;
    this.flags.net = false;
    this.flags.outsideAntenna = false;
    this.replan();
  }

  // 扣球剛擊出：球路經過攔網員手的範圍就被攔下。回傳是否攔到。
  tryBlock(plan) {
    const { blocker, grade } = plan.block;
    const width = BLOCK.width[grade];
    if (!width || Math.abs(blocker.pos.z) > BLOCK_MAX_NET_DIST) return false;

    const cross = predictNetCrossing(this.ball, new THREE.Vector3());
    if (!cross || cross.y < COURT.netHeight || cross.y > BLOCK.reach) return false;
    if (Math.abs(cross.x - blocker.pos.x) > width) return false;

    // 球在網子攻擊方那一側被手擋下
    const s = plan.side;
    const ball = this.ball;
    ball.pos.set(cross.x, cross.y, s * (BALL.radius + 0.05));
    const target = new THREE.Vector3();
    if (grade === 'perfect') {
      // 直接蓋回對方場地
      target.set(cross.x + (Math.random() * 2 - 1), BALL.radius, s * (1.5 + Math.random() * 1.5));
      velocityForTime(ball.pos, target, 0.45, ball.vel);
    } else {
      // 軟攔：球彈高回對方場地，對方可以再組織進攻
      target.set((Math.random() * 2 - 1) * 2, HIT.heights.bump, s * 4);
      velocityToTarget(ball.pos, target, cross.y + 1.5, ball.vel);
    }

    if (this.isHuman(blocker.team.side)) this.hud.showJudge('block');
    this.onEvent('block', { grade, human: this.isHuman(blocker.team.side), pos: ball.pos.clone() });
    // 攔網不算三次觸球之一，對方重新算三次
    this.touched(blocker, 'block', grade, 0);
    return true;
  }

  shoot({ side, type, grade, hitter, block, hardBall }) {
    const ball = this.ball;
    // 重球沒接好會彈得更亂，通常就救不回來了
    const err = hardBall && grade === 'bad' ? HARD_BALL_BAD_ERROR : ERROR[grade];
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
      const aim = this.isHuman(side)
        ? { x: this.spikeAimX(), depth: 5.5 + Math.random() * 1.5 }
        : aiSpikeTarget(ball.pos, side, this.sides[-side], block ?? null);
      target.set(aim.x + jitter(), BALL.radius, -side * aim.depth + jitter());
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

  // 玩家扣球方向；鏡頭在 home 後方：螢幕左 = -x
  spikeAimX() {
    const dir = (input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0);
    if (dir !== 0) return dir * SPIKE_AIM_X;
    return -Math.sign(this.ball.pos.x || 1) * 2; // 沒按方向：打斜線
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
      reason = this.lastType === 'block' ? '攔網' : '界內';
    } else {
      loser = this.lastSide;
      reason = '出界';
    }

    const humanWins = this.isHuman(-loser);
    this.hud.showResult({ text: `${reason}・${humanWins ? '我方得分！' : '對手得分'}`, good: humanWins });
    this.plan = null;
    this.state = 'dead';
    this.resultTimer = RESULT_TIME;
    this.onPoint(-loser);
  }
}
