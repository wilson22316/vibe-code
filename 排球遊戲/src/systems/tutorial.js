import { DRILLS, Practice } from './practice.js';

const ADVANCE_DELAY = 1.6; // 成功後停一下讓玩家看到結果，再進下一步（遊戲時間秒數）
const COMPLETE_TIME = 3; // 全部完成後的慶祝畫面停多久再回主畫面

// 互動教學的每一步：用練習模式的項目，做對一次才進下一步
export const STEPS = [
  { drill: 'serve', title: '發球', text: '按住空白鍵蓄力，力道條擺到中間時放開，把球發進對方場內。蓄力時可以用 ← → 瞄準左右。' },
  { drill: 'receive', title: '接球', text: '對方發球過來了！地上的白色外圈縮到跟黃色內圈一樣大時按空白鍵，把球墊起來。角色會自己跑位，你只要抓時機。' },
  { drill: 'spike', title: '扣球', text: '隊友把球舉起來了！外圈縮到黃圈時按空白鍵扣球，把球打進對方場內。扣球前可以用方向鍵選落點。' },
  { drill: 'block', title: '攔網', text: '對方要扣球了！網前的我方球員腳下出現提示圈時，抓準時機按空白鍵起跳，把球攔下來。' },
];

// 互動教學：發球 → 接球 → 扣球 → 攔網，每一步是一個練習項目（固定慢速），成功一次就進下一步。
// 對外的用法跟 Practice 一樣（main.js 把 Rally 的回呼轉進來）
export class Tutorial {
  // deps：Practice 需要的 { teams, ball, rally, serve, positioning, hud }
  // onResult(ok)：每一球判定時；onComplete()：四步都完成時（慶祝）；onDone()：慶祝完、該回主畫面時
  constructor(deps, { onResult = () => {}, onComplete = () => {}, onDone = () => {} } = {}) {
    this.deps = deps;
    this.onResultCallback = onResult;
    this.onComplete = onComplete;
    this.onDone = onDone;
    this.menuScreen = 'tutorial';
    this.slow = true;
    this.step = 0;
    this.practice = null;
    this.advanceTimer = null; // 成功後倒數進下一步
    this.completeTimer = null; // 全部完成後倒數回主畫面
  }

  // 開始（或暫停選單「重新開局」時重來）目前這一步
  start() {
    const step = STEPS[this.step];
    this.advanceTimer = null;
    this.practice = new Practice(step.drill, {
      ...this.deps,
      slow: true,
      title: `操作教學　${this.step + 1} / ${STEPS.length}：${step.title}`,
      onResult: (ok) => this.onResult(ok),
    });
    this.deps.hud.setTutorial({ step: this.step + 1, total: STEPS.length, title: step.title, text: step.text });
    this.deps.hud.setHint(DRILLS[step.drill].hint);
    this.practice.start();
  }

  onResult(ok) {
    this.onResultCallback(ok);
    if (ok) this.advanceTimer = ADVANCE_DELAY;
  }

  // 每幀呼叫（遊戲時間）
  update(dt) {
    if (this.completeTimer !== null) {
      this.completeTimer -= dt;
      if (this.completeTimer <= 0) {
        this.completeTimer = null;
        this.onDone();
      }
      return;
    }
    if (this.advanceTimer === null) {
      this.practice.update(dt);
      return;
    }
    this.advanceTimer -= dt;
    if (this.advanceTimer > 0) return;
    this.advanceTimer = null;
    this.deps.rally.reset();
    this.step++;
    if (this.step < STEPS.length) {
      this.start();
      return;
    }
    // 四步都完成
    this.deps.hud.showResult({ text: '教學完成！', good: true });
    this.deps.hud.setTutorial({ title: '教學完成！', text: '發球、接球、扣球、攔網都學會了，去比一場吧！' });
    this.completeTimer = COMPLETE_TIME;
    this.onComplete();
  }

  // Rally 的回呼轉給目前這一步的練習（成功後等著進下一步時不再換球）
  onServe() {
    this.practice.onServe();
  }

  onEvent(name, data) {
    this.practice.onEvent(name, data);
  }

  onPoint(winner, reason) {
    this.practice.onPoint(winner, reason);
  }

  next() {
    if (this.advanceTimer === null && this.completeTimer === null) this.practice.next();
  }
}
