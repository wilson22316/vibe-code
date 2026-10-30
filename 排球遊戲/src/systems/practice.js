import * as THREE from 'three';
import { HIT, POWER, TEAMS } from '../config.js';
import { velocityToTarget } from './ballPhysics.js';
import { SPIKE_APPROACH_Z } from './positioning.js';

const SET_APEX = 5; // 舉球的最高點（跟比賽一樣）
const END_DELAY = 1.2; // 判定完之後看一下結果再換下一球（遊戲時間秒數，比比賽的結果畫面短，練起來比較順）

// 練習項目：名稱與畫面底部的操作提示
export const DRILLS = {
  serve: { name: '發球', hint: '按住空白鍵蓄力、放開發球（力道條在中間最剛好）　·　← → 瞄準　·　Esc 暫停' },
  receive: { name: '接球', hint: '對方發球過來：外圈縮到黃圈時按空白鍵接球　·　Esc 暫停' },
  spike: { name: '扣球', hint: '隊友舉球：外圈縮到黃圈時按空白鍵扣球　·　扣球前 ↑ ↓ ← → 選落點　·　A 強力擊球（練習時能量無限）　·　Esc 暫停' },
  block: { name: '攔網', hint: '對方要扣球了：外圈縮到黃圈時按空白鍵起跳攔網　·　Esc 暫停' },
};

// 練習：同一個項目一球接一球無限重來，不計分，只記成功幾次。
// 發球、接球從發球開始；扣球、攔網從隊友舉球開始。做完該做的動作就讓 Rally 停止後續觸球（stopPlays），
// 球落地或過一下子就換下一球
export class Practice {
  // slow：慢速；title：資訊列改顯示這段文字（教學用）；onResult(ok)：每一球判定成功或失敗時呼叫
  constructor(drill, { teams, ball, rally, serve, positioning, hud, slow = false, title = null, onResult = () => {} }) {
    this.drill = drill;
    this.menuScreen = 'practice'; // 暫停選單「回到主畫面」時回到哪一頁
    this.title = title;
    this.teams = teams;
    this.ball = ball;
    this.rally = rally;
    this.serve = serve;
    this.positioning = positioning;
    this.hud = hud;
    this.slow = slow;
    this.onResult = onResult;
    this.tries = 0;
    this.success = 0;
    this.result = null; // 這一球：null 還沒判定、true 成功、false 失敗
    this.endTimer = null; // 判定完之後倒數換下一球
  }

  get name() {
    return DRILLS[this.drill].name;
  }

  // 從頭開始（成功次數歸零）
  start() {
    this.tries = 0;
    this.success = 0;
    this.next();
  }

  // 擺好下一球；兩名隊員輪流當主角
  next() {
    this.result = null;
    this.endTimer = null;
    this.hud.showResult(null);
    const turn = this.tries % 2;
    if (this.drill === 'serve') this.serve.reset(this.teams.home[turn]);
    else if (this.drill === 'receive') this.serve.reset(this.teams.away[turn]);
    else this.setUp(this.drill === 'spike' ? this.teams.home : this.teams.away, turn);
    this.updatePanel();
  }

  // 扣球、攔網：從 team 的舉球開始（舉球員把球舉到攻擊手那一側的網前）
  setUp(team, spikerIndex) {
    const side = team[0].team.side;
    const spiker = team[spikerIndex];
    const setter = team[1 - spikerIndex];
    this.serve.clear();
    this.positioning.reset();
    setter.resetTo(0, side * (HIT.setSpotZ + HIT.standBehind.set));
    spiker.resetTo(spiker.base.x * 0.9, side * SPIKE_APPROACH_Z);
    this.ball.pos.set(0, HIT.heights.set, side * HIT.setSpotZ);
    this.ball.vel.set(0, 0, 0);

    // 舉球員擺出剛舉完球的姿勢
    setter.syncMesh();
    setter.setReach('set', this.ball.pos, 1);
    setter.applyReach();
    setter.playAction('set');
    setter.setReach(null);

    const target = new THREE.Vector3(spiker.base.x * 0.9, HIT.heights.spike, side * HIT.spikeSpotZ);
    velocityToTarget(this.ball.pos, target, SET_APEX, this.ball.vel);
    this.rally.startFrom(setter, 'set', 2);
    if (side === TEAMS.home.side) this.rally.energy[side] = POWER.maxEnergy; // 練習扣球：強力擊球隨時可以用
  }

  // 發球出去了：練習發球時對手不接，看球落在哪
  onServe() {
    if (this.drill === 'serve') this.rally.stopPlays();
  }

  // Rally 的擊球、攔網事件
  onEvent(name, data) {
    if (this.result !== null) return;
    if (this.drill === 'receive' && name === 'hit' && data.human && data.type === 'bump') {
      this.rally.stopPlays(); // 接起來就好，隊友不用再舉
      this.finish(data.grade !== 'bad', data.grade === 'bad' ? '球沒墊好' : '接起來了！');
    } else if (this.drill === 'spike' && name === 'hit' && data.human && data.type === 'spike') {
      this.rally.stopPlays(); // 對手不接，看球落在哪
    } else if (this.drill === 'block') {
      if (name === 'hit' && !data.human && data.type === 'spike') this.rally.stopPlays(); // 沒攔到的話我方不用接
      else if (name === 'block' && data.human) this.finish(true, '攔下來了！');
    }
  }

  // 球落地：發球、扣球落在對方場內算成功；接球、攔網走到這裡表示沒做到
  onPoint(winner, reason) {
    if (this.result !== null) return;
    const landedIn = winner === TEAMS.home.side && reason === '界內';
    if (this.drill === 'serve') this.finish(landedIn, landedIn ? '發球成功！' : reason);
    else if (this.drill === 'spike') this.finish(landedIn, landedIn ? '扣球得分！' : reason === '落地' ? '沒扣到' : reason);
    else this.finish(false, this.drill === 'receive' ? '沒接到' : '沒攔到');
  }

  finish(ok, text) {
    this.result = ok;
    this.tries++;
    if (ok) this.success++;
    this.hud.showResult({ text: ok ? text : `${text}・再試一次`, good: ok });
    this.updatePanel();
    this.endTimer = END_DELAY;
    this.onResult(ok);
  }

  // 每幀呼叫（遊戲時間）：判定完過一下子換下一球
  update(dt) {
    if (this.endTimer === null) return;
    this.endTimer -= dt;
    if (this.endTimer > 0) return;
    this.rally.reset();
    this.next();
  }

  updatePanel() {
    this.hud.setPractice({ title: this.title, name: this.name, success: this.success, tries: this.tries, slow: this.slow });
  }
}
