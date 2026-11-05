import * as THREE from 'three';
import { BALL, BLOCK, COURT, HIT, HUMAN_SIDES, POWER } from '../config.js';
import { JUMP_PEAK, jumpToReach } from '../entities/player.js';
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
import { aiBlockGrade, aiHitGrade, aiSpikeTarget, aiWantsPower } from './ai.js';
import { closestTo, hitKind, standSpot } from './positioning.js';

const RESULT_TIME = 2;
const BLOCK_MAX_NET_DIST = 1; // 攔網員離網超過這距離就攔不到（還沒跑到位）
const DIVE_RANGE = 0.8; // 撲救比平常多搆得到的距離
const DIVE_MAX_HEIGHT = 1.5; // 只有低球能撲救（舉球、扣球的高球不行）
const DOWNGRADE = { perfect: 'good', good: 'bad', bad: 'bad' }; // 撲救的擊球品質降一級
const REACH_TIME = 0.3; // 碰球前幾秒開始把手伸向球
const MIN_JUMP = 0.15; // 需要跳的高度比這個低就不跳（站著就碰得到）
const SPIKE_TIME = { perfect: 0.5, good: 0.7, bad: 0.6 }; // 扣球飛行秒數，越短越快
const ERROR = { perfect: 0, good: 0.8, bad: 2.5 }; // 落點隨機誤差（公尺）
const HARD_BALL_BAD_ERROR = 5;
// 玩家扣球的九宮格落點：左中右（x）× 短中深（離網距離）
const SPIKE_ZONE_X = [-2.8, 0, 2.8];
const SPIKE_ZONE_DEPTH = [3.2, 5.6, 7.3];

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
  // onPoint(winnerSide, reason)：判定得分當下呼叫（reason 如「界內」「出界」）；onFinished()：結果顯示完畢後呼叫
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
    this.energy = { 1: 0, [-1]: 0 };
    this.armed = { 1: false, [-1]: false }; // 能量滿、已按 A，等著下一次扣球
    this.spikeAim = null; // 玩家這次扣球選的落點格子 { col, row }
    this.ballState = null; // 'spike' | 'power'：球正在扣球飛行中（特效用）
    this.noPlays = false; // 練習用：這一球之後沒有人再碰球
    this.resetEnergy();
  }

  // 中斷這一球（暫停選單的重新開局、回到主畫面）
  reset() {
    this.state = 'idle';
    this.plan = null;
    this.spikeAim = null;
    this.ballState = null;
    this.ball.gravity = BALL.gravity; // 強力球飛到一半被中斷，也要拿掉上旋
    this.clearReach();
  }

  // 練習用：從現在起沒有人再碰球（球自己落地判定，或被中斷）
  stopPlays() {
    this.noPlays = true;
    this.plan = null;
    this.spikeAim = null;
    this.clearReach();
  }

  // 新的一局：能量回到開局值（預設玩家滿能量、對手 0）
  resetEnergy() {
    for (const side of [1, -1]) {
      this.energy[side] = this.isHuman(side) ? POWER.startEnergy.human : POWER.startEnergy.ai;
      this.armed[side] = false;
    }
  }

  // 玩家按 A：能量滿才能開啟強力擊球，回傳是否成功
  armPower(side) {
    if (this.armed[side] || this.energy[side] < POWER.maxEnergy) return false;
    this.armed[side] = true;
    return true;
  }

  // 再按一次 A：取消強力擊球，能量保留（之後可以再開）
  disarmPower(side) {
    if (!this.armed[side]) return false;
    this.armed[side] = false;
    return true;
  }

  start(server) {
    this.startFrom(server, 'serve', 0);
  }

  // 從「lastHitter 剛用 lastType 碰完球、這一側已經碰了 touches 次」開始這一球（練習模式直接從舉球開始）
  startFrom(lastHitter, lastType, touches) {
    this.state = 'live';
    this.time = 0;
    this.ballState = null;
    this.noPlays = false;
    this.ball.gravity = BALL.gravity; // 發球、舉球都不帶上旋
    this.lastSide = lastHitter.team.side;
    this.lastType = lastType;
    this.lastGrade = 'good';
    this.lastPower = false;
    this.lastHitter = lastHitter;
    this.touches = touches;
    this.flags = { net: false, outsideAntenna: false };
    this.replan();
  }

  isHuman(side) {
    return HUMAN_SIDES.includes(side);
  }

  // 每幀呼叫一次：處理按鍵
  update() {
    if (this.state !== 'live') return;
    if (input.wasPressed('action')) this.press();
    this.updateSpikeAim();
  }

  // 玩家扣球前用方向鍵選落點：左右選邊、上＝深球、下＝短球（選了就記住，不用一直按著）
  updateSpikeAim() {
    const aim = this.spikeAim;
    if (!aim) return;
    const dx = (input.wasPressed('right') ? 1 : 0) - (input.wasPressed('left') ? 1 : 0);
    const dy = (input.wasPressed('up') ? 1 : 0) - (input.wasPressed('down') ? 1 : 0);
    aim.col = THREE.MathUtils.clamp(aim.col + dx, 0, SPIKE_ZONE_X.length - 1);
    aim.row = THREE.MathUtils.clamp(aim.row + dy, 0, SPIKE_ZONE_DEPTH.length - 1);
  }

  // 扣球瞄準標記的位置 { x, z }；沒在瞄準時回傳 null
  getSpikeTarget() {
    const plan = this.plan;
    if (!this.spikeAim || !plan || plan.type !== 'spike') return null;
    return { x: SPIKE_ZONE_X[this.spikeAim.col], z: -plan.side * SPIKE_ZONE_DEPTH[this.spikeAim.row] };
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
      this.onEvent('land', { pos: this.ball.pos.clone(), lastType: this.lastType, power: this.ballState === 'power' });
      this.ballState = null;
      this.endPoint();
      return;
    }
    this.updatePlan();
    this.updateReach();
  }

  replan() {
    this.plan = null;
    this.spikeAim = null;
    if (this.noPlays) return;
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
      const windowScale = hardBall ? HIT.hardDigWindow[this.lastGrade] * (this.lastPower ? POWER.digWindow : 1) : 1;
      this.plan = { side, touch, type, point, time: this.time + t, moveAt, hitter, hardBall, windowScale, grade: null, jumped: false, leave: false };
      if (!this.isHuman(side)) this.decideAi(this.plan);
      if (type === 'spike') {
        this.plan.block = this.makeBlock(this.plan);
        // 玩家扣球：預設瞄斜線（對角）、中間深度
        if (this.isHuman(side)) this.spikeAim = { col: point.x > 0 ? 0 : SPIKE_ZONE_X.length - 1, row: 1 };
        // AI 在這時就決定要不要用強力擊球：提前開啟，氣場才來得及冒出來，當作給玩家的警告
        else if (this.energy[side] >= POWER.maxEnergy && aiWantsPower(this.plan.grade)) this.armed[side] = true;
      }
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
    plan.grade = aiHitGrade(plan.hardBall, this.lastGrade, this.lastPower);
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
    block.blocker.playJump(BLOCK.jumpHeight);
    block.blocker.playAction('block'); // 雙手高舉撐住
  }

  // 碰球前讓擊球的人把手伸向球（越接近碰球時間伸得越準），碰到那一刻手剛好在球上
  updateReach() {
    const plan = this.plan;
    const hitter = plan && !plan.leave ? plan.hitter : null;
    if (this.reachPlayer && this.reachPlayer !== hitter) this.reachPlayer.setReach(null);
    this.reachPlayer = hitter;
    if (!hitter) return;
    const weight = 1 - THREE.MathUtils.clamp((plan.time - this.time) / REACH_TIME, 0, 1);
    hitter.setReach(hitKind(plan), this.ball.pos, weight);
  }

  clearReach() {
    this.reachPlayer?.setReach(null);
    this.reachPlayer = null;
  }

  updatePlan() {
    const plan = this.plan;
    if (!plan) return;

    // 扣球、跳舉球提前起跳（含起跳前下蹲），跳到最高點時剛好碰球；跳多高由觸球高度決定，手才碰得到球
    const kind = hitKind(plan);
    const jump = kind === 'bump' ? 0 : jumpToReach(plan.point.y, kind);
    if (jump > MIN_JUMP && !plan.jumped && !plan.leave && this.time >= plan.time - JUMP_PEAK) {
      plan.hitter.playJump(jump);
      plan.jumped = true;
    }

    // AI 攔網員在理想時間起跳
    const block = plan.block;
    if (block && block.grade && !block.jumped && this.time >= block.idealTime) this.blockJump(block);

    if (this.time < plan.time) return;
    if (plan.grade) {
      this.hit();
    } else if (plan.leave) {
      this.plan = null;
    } else if (!this.isHuman(plan.side)) {
      // AI 漏接（接不起重球）：撲過去但沒碰到
      plan.hitter.playDive(plan.point.x, plan.point.z);
      this.plan = null;
    } else if (this.time >= plan.time + HIT.windows.bad) {
      this.hud.showJudge('miss');
      this.plan = null;
    }
  }

  hit() {
    const plan = this.plan;
    const { hitter, side, type } = plan;
    let { grade } = plan;
    this.plan = null;

    // 低球差一點搆不到就撲救：救得起來但擊球品質降一級；太遠就撲空
    const stand = standSpot(plan);
    const dist = Math.hypot(hitter.pos.x - stand.x, hitter.pos.z - stand.z);
    let dove = false;
    if (dist > HIT.reach) {
      const canDive = plan.point.y < DIVE_MAX_HEIGHT;
      if (canDive) hitter.playDive(stand.x, stand.z);
      if (!canDive || dist > HIT.reach + DIVE_RANGE) {
        if (this.isHuman(side)) this.hud.showJudge('far');
        return;
      }
      grade = DOWNGRADE[grade];
      dove = true;
    }

    // 強力擊球：玩家按過 A、或 AI 決定要用；用了能量歸零，沒用的扣球則累積能量
    const power = type === 'spike' && this.usePower(side);
    plan.power = power;
    if (type === 'spike' && !power) this.gainEnergy(side, grade);

    const contact = this.ball.pos.clone();
    this.shoot({ ...plan, grade, power });
    if (!dove) {
      // 碰球這一刻把手伸到位（手剛好貼在球上），順勢動作再從這個姿勢接下去
      hitter.setReach(hitKind(plan), contact, 1);
      hitter.applyReach();
      hitter.playAction(type === 'spike' ? 'spike' : plan.point.y < 1.5 ? 'bump' : 'set');
    }
    if (this.isHuman(side)) this.hud.showJudge(dove ? 'dive' : power && grade !== 'bad' ? 'power' : grade);
    this.onEvent('hit', { type, grade, power, hitter, side, human: this.isHuman(side), pos: contact });

    if (type === 'spike' && this.tryBlock(plan)) return;
    this.touched(hitter, type, grade, plan.touch, power);
    if (type === 'spike') this.ballState = power ? 'power' : 'spike';
  }

  // 已開啟（玩家按 A，或 AI 在扣球前決定）就用掉：能量歸零
  usePower(side) {
    if (!this.armed[side]) return false;
    this.energy[side] = 0;
    this.armed[side] = false;
    return true;
  }

  // 強力擊球的氣場：開啟後兩人先冒小氣場；確定誰扣球時，扣球的人全開、隊友散掉
  auraLevel(player) {
    const side = player.team.side;
    if (!this.armed[side]) return 0;
    const plan = this.plan;
    if (plan && plan.type === 'spike' && plan.side === side) return plan.hitter === player ? POWER.auraFull : 0;
    return POWER.auraSmall;
  }

  gainEnergy(side, grade) {
    this.energy[side] = Math.min(POWER.maxEnergy, this.energy[side] + POWER.gain[grade]);
  }

  // 記錄最後一次觸球，並預測下一次
  touched(player, type, grade, touches, power = false) {
    this.lastSide = player.team.side;
    this.lastType = type;
    this.lastGrade = grade;
    this.lastPower = power;
    this.ballState = null;
    this.lastHitter = player;
    this.touches = touches;
    this.flags.net = false;
    this.flags.outsideAntenna = false;
    this.replan();
  }

  // 扣球剛擊出：球路經過攔網員手的範圍就被攔下。回傳是否攔到。
  tryBlock(plan) {
    const { blocker, grade } = plan.block;
    const width = (BLOCK.width[grade] ?? 0) * (plan.power ? POWER.blockWidth : 1); // 強力球比較難攔
    if (!width || Math.abs(blocker.pos.z) > BLOCK_MAX_NET_DIST) return false;

    const cross = predictNetCrossing(this.ball, new THREE.Vector3());
    if (!cross || cross.y < COURT.netHeight || cross.y > BLOCK.reach) return false;
    if (Math.abs(cross.x - blocker.pos.x) > width) return false;

    // 球在網子攻擊方那一側被手擋下（強力球的上旋也被擋掉）
    const s = plan.side;
    const ball = this.ball;
    ball.gravity = BALL.gravity;
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

  shoot({ side, type, grade, hitter, block, hardBall, power }) {
    const ball = this.ball;
    // 重球沒接好會彈得更亂，通常就救不回來了
    const err = hardBall && grade === 'bad' ? HARD_BALL_BAD_ERROR : ERROR[grade];
    const jitter = () => (Math.random() * 2 - 1) * err;
    const target = new THREE.Vector3();
    ball.gravity = BALL.gravity; // 只有強力扣球帶上旋（下面另外設）

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
      const aim = this.isHuman(side) ? this.humanSpikeAim() : aiSpikeTarget(ball.pos, side, this.sides[-side], block ?? null);
      target.set(aim.x + jitter(), BALL.radius, -side * aim.depth + jitter());
      // 強力球帶強烈上旋：往下的加速度變大，可以打得又快又平還過網，過網後急墜
      if (power) ball.gravity = BALL.gravity * POWER.spin;
      let time = SPIKE_TIME[grade] * (power ? POWER.speed : 1);
      velocityForTime(ball.pos, target, time, ball.vel, ball.gravity);
      // 好球保證過網：太平就放慢、拋高一點；壞球不保證
      while (grade !== 'bad' && time < 1.4 && willHitNet(ball)) {
        time += 0.05;
        velocityForTime(ball.pos, target, time, ball.vel, ball.gravity);
      }
    } else {
      // 球不夠高沒辦法扣，只能推過網
      target.set(jitter(), BALL.radius, -side * 5 + jitter());
      velocityToTarget(ball.pos, target, ball.pos.y + 2, ball.vel);
    }
  }

  // 玩家選的九宮格落點（鏡頭在 home 後方：螢幕左 = -x、螢幕上方 = 深球）
  humanSpikeAim() {
    const aim = this.spikeAim ?? { col: this.ball.pos.x > 0 ? 0 : SPIKE_ZONE_X.length - 1, row: 1 };
    return { x: SPIKE_ZONE_X[aim.col], depth: SPIKE_ZONE_DEPTH[aim.row] };
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
    this.clearReach();
    this.state = 'dead';
    this.resultTimer = RESULT_TIME;
    this.onPoint(-loser, reason);
  }
}
