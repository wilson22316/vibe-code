import * as THREE from 'three';
import { HUMAN_SIDES, POWER, PRACTICE_SLOW, TEAMS } from './config.js';
import { sound } from './audio/sound.js';
import { Ball, createLandingMarker, createSpikeMarker, createTimingCue } from './entities/ball.js';
import { Player } from './entities/player.js';
import { Effects } from './fx/effects.js';
import { Footprints } from './fx/footprints.js';
import { input } from './input/keyboard.js';
import { createCamera } from './scene/camera.js';
import { CameraRig } from './scene/cameraRig.js';
import { createCourt } from './scene/court.js';
import { Ambience } from './scene/ambience.js';
import { createEnvironment } from './scene/environment.js';
import { Graphics } from './scene/graphics.js';
import { createLights } from './scene/lights.js';
import { predictLanding } from './systems/ballPhysics.js';
import { aiLevel, setAiLevel } from './systems/ai.js';
import { Match } from './systems/match.js';
import { Positioning } from './systems/positioning.js';
import { DRILLS, Practice } from './systems/practice.js';
import { Rally } from './systems/rally.js';
import { createAimMarker, ServeController } from './systems/serve.js';
import { Tutorial } from './systems/tutorial.js';
import { WarmUp } from './systems/warmup.js';
import { Customizer, loadTeamLook, PREVIEW_VIEW } from './ui/customize.js';
import { hud } from './ui/hud.js';
import { Menu } from './ui/menu.js';

const PHYSICS_STEP = 1 / 120; // 固定步長，球路才不會受幀率影響
const MAX_FRAME = 0.1; // 分頁切回來時避免一次補太多步
// 視窗夠寬時主畫面選單靠左，球場往右挪這個比例的畫面寬（斷點跟 style.css 一致）
const MENU_SIDE_MIN_WIDTH = 900;
const MENU_SHIFT = 0.13;
const SPIKE_ZOOM_LEAD = 0.8; // 扣球前幾秒鏡頭開始推近

// 抗鋸齒交給後製的 FXAA（見 postprocessing.js），畫布本身不用開；解析度倍率由畫質設定決定
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping; // 比 ACES 更保留鮮豔色塊，適合卡通風
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const environment = createEnvironment(scene);
scene.add(environment, createCourt(), createLights());
const ambience = new Ambience(scene, environment.userData.palms); // 觀眾、旗子、雲、海浪、椰子樹擺動
const footprints = new Footprints(scene);

const camera = createCamera();
const graphics = new Graphics(renderer, scene, camera);

const ball = new Ball();
const landingMarker = createLandingMarker();
const timingCue = createTimingCue();
const aimMarker = createAimMarker();
const spikeMarker = createSpikeMarker();
const warmBall = new Ball(); // 主畫面對手那組熱身用的第二顆球
warmBall.mesh.visible = false;
scene.add(ball.mesh, warmBall.mesh, landingMarker, timingCue, aimMarker, spikeMarker);

// 我方外觀用角色自訂存的設定
const homeLook = loadTeamLook();
const teams = {};
for (const [name, team] of Object.entries(TEAMS)) {
  teams[name] = team.members.map((m, i) =>
    name === 'home'
      ? new Player({ team, ...m, ...homeLook.members[i], shirt: homeLook.shirt })
      : new Player({ team, shirt: team.shirt, ...m }),
  );
  for (const p of teams[name]) scene.add(p.mesh);
}
const positioning = new Positioning(teams);
const players = positioning.allPlayers();
const warmUp = new WarmUp([
  { players: teams.home, ball },
  { players: teams.away, ball: warmBall },
]);

const match = new Match();
const effects = new Effects(scene);
const rig = new CameraRig(camera, renderer.domElement);
const cameraFocus = { point: ball.pos, zoom: 0 }; // 比賽中鏡頭要跟的球
const COURT_CENTER = new THREE.Vector3(0, 0, 0);

// 玩家強力扣球的衝擊定格：鏡頭直接切到扣球者側前方，對準手碰球的地方，定格後拉回原本視角
function powerImpact({ pos, side }) {
  const out = Math.sign(pos.x) || 1; // 從場外那一側看進來，背景才是球場
  const cutPos = new THREE.Vector3(pos.x + out * 3.2, pos.y - 0.6, pos.z - side * 1.4);
  const cutTarget = new THREE.Vector3(pos.x, pos.y - 0.55, pos.z + side * 0.25);
  rig.cutTo(cutPos, cutTarget, POWER.freezeTime, POWER.cutBackTime);
  effects.freeze(POWER.freezeTime);
  effects.shockwave(pos, cutPos);
  hud.impact(POWER.freezeTime);
}

// 擊球、攔網、撞網、落地的特效與音效
function onRallyEvent(name, data) {
  if (name === 'hit') {
    sound.play(data.power ? 'power' : data.type === 'spike' ? 'spike' : data.type === 'set' ? 'set' : 'bump');
    if (data.human && data.grade === 'perfect') sound.play('perfect');
    effects.hit(data.pos, data.power ? 'perfect' : data.grade);
    if (data.type === 'spike') {
      effects.shake(data.power ? 0.45 : data.grade === 'perfect' ? 0.25 : 0.12);
      // 只有玩家的完美扣球、強力扣球放慢動作：對手扣球放慢會讓接球變簡單
      if (data.human && data.power) powerImpact(data);
      else if (data.human && data.grade === 'perfect') effects.slowMo();
    }
  } else if (name === 'block') {
    sound.play('block');
    effects.hit(data.pos, data.grade);
    effects.shake(0.3);
  } else if (name === 'net') {
    sound.play('net');
  } else if (name === 'land') {
    const hard = data.lastType === 'spike' || data.lastType === 'block';
    sound.play('land');
    effects.sand(data.pos, data.power ? 2.2 : hard ? 1.6 : 1);
    if (hard) effects.shake(data.power ? 0.35 : 0.2);
  }
  practice?.onEvent(name, data);
}

const rally = new Rally(ball, teams, hud, {
  onPoint: (side, reason) => {
    if (practice) {
      practice.onPoint(side, reason); // 練習不計分
      return;
    }
    match.pointTo(side);
    hud.setScore(match.score, match.servingSide);
    positioning.celebrate(side);
    sound.play('whistle');
    // 觀眾每一分都會歡呼，我方得分時比較熱烈
    if (HUMAN_SIDES.includes(side)) {
      sound.play('cheer');
      effects.celebrate(ball.pos);
      ambience.cheer(1);
    } else {
      ambience.cheer(0.5);
    }
  },
  onFinished: () => {
    if (practice) {
      practice.next();
    } else if (match.winner) {
      const win = HUMAN_SIDES.includes(match.winner);
      hud.showGameOver({ win, score: match.score });
      sound.play(win ? 'win' : 'lose');
      if (win) {
        effects.celebrate(COURT_CENTER, true);
        ambience.cheer(1.4);
      }
    } else {
      serve.reset(match.server(teams));
    }
  },
  onEvent: onRallyEvent,
});
const serve = new ServeController(ball, hud, aimMarker, {
  onReset: () => positioning.reset(),
  onServe: (server) => {
    sound.play('serve');
    effects.hit(ball.pos, 'good');
    rally.start(server);
    practice?.onServe();
  },
});
const landing = new THREE.Vector3();

let level = 'normal';
let inMenu = true;
let practice = null; // 練習模式中：Practice；互動教學中：Tutorial（用法相同）
let practiceSlow = true; // 練習選單的「速度」：慢速（預設）或正常

const onOff = (on) => (on ? '開' : '關');
const CUSTOM_KEYS = ['member', 'hairStyle', 'hair', 'skin', 'accessory', 'shirt'];
const menu = new Menu(
  {
    level: (name) => startMatch(name),
    graphics: () => toggleGraphics(),
    sfx: () => {
      const on = sound.toggleSfx();
      menu.setValue('sfx', onOff(on));
      if (on) sound.play('ui'); // 剛打開時讓玩家聽到
    },
    music: () => menu.setValue('music', onOff(sound.toggleMusic())),
    practice: (drill) => startPractice(drill),
    tutorial: () => startTutorial(),
    practiceSpeed: () => {
      practiceSlow = !practiceSlow;
      menu.setValue('practiceSpeed', practiceSlow ? '慢速' : '正常');
    },
    ...Object.fromEntries(CUSTOM_KEYS.map((key) => [key, (value, dir) => customizer.change(key, dir)])),
    resetLook: () => {
      customizer.reset();
      hud.toast('已恢復預設外觀');
    },
  },
  onMenuScreen,
);
menu.setValue('sfx', onOff(sound.sfxEnabled));
menu.setValue('music', onOff(sound.musicEnabled));
menu.setValue('practiceSpeed', practiceSlow ? '慢速' : '正常');
const customizer = new Customizer(teams.home, menu);
scene.add(customizer.marker);

// 切到角色自訂：我方兩人停止熱身、站到鏡頭前；離開時回去繼續熱身（對手一直在後面熱身）
function onMenuScreen(name) {
  if (name === 'custom') {
    warmUp.stop(TEAMS.home.side);
    ball.mesh.visible = false;
    customizer.enter();
    rig.holdView(PREVIEW_VIEW.position, PREVIEW_VIEW.target);
  } else if (customizer.active) {
    customizer.exit();
    ball.mesh.visible = true;
    warmUp.start(TEAMS.home.side);
    rig.startOrbit();
  }
}

// 主畫面：兩隊在場上熱身互傳球，鏡頭慢慢繞場。screen：直接打開哪一頁
function openMenu(screen = 'main') {
  inMenu = true;
  practice = null;
  hud.setPractice(null);
  hud.setTutorial(null);
  hud.setHint(null);
  hud.showGameOver(null);
  hud.showResult(null);
  hud.setPower(null);
  hud.setPauseButtonVisible(false);
  aimMarker.visible = false;
  warmBall.mesh.visible = true;
  warmUp.start();
  rig.startOrbit();
  menu.open(screen);
}

// 離開主畫面進入比賽或練習；cameraTime：鏡頭從繞場移到比賽視角的秒數（不傳用預設）
function leaveMenu(aiName, cameraTime) {
  inMenu = false;
  menu.close();
  warmUp.stop();
  warmBall.mesh.visible = false;
  rig.stopOrbit(cameraTime);
  hud.setPauseButtonVisible(true);
  setAiLevel(aiName);
  for (const p of teams.away) p.speedScale = aiLevel().speed;
  match.reset();
  rally.resetEnergy();
}

// name：難度；不傳就沿用上一局（暫停選單的重新開局）
function startMatch(name = level) {
  level = name;
  leaveMenu(level, INTRO.camera);
  hud.setScore(match.score, match.servingSide);
  serve.reset(match.server(teams));
  intro = { t: 0, ready: false, go: false };
  hud.showIntro(aiLevel().label);
}

// 比賽開場動畫：「我方 VS 對手」→ READY? → GO!（時間點跟 style.css 的 #intro 動畫一致），期間不能發球；空白鍵跳過
const INTRO = { ready: 1.4, go: 2.05, end: 2.7, camera: 1.8 };
let intro = null; // 開場動畫進行中：{ t, ready, go }

function updateIntro(dt) {
  if (input.wasPressed('action')) intro.t = INTRO.end; // 跳過（不播 READY、GO 的音效）
  else intro.t += dt;
  const playing = intro.t < INTRO.end;
  if (playing && !intro.ready && intro.t >= INTRO.ready) {
    intro.ready = true;
    sound.play('ui');
  }
  if (playing && !intro.go && intro.t >= INTRO.go) {
    intro.go = true;
    sound.play('whistle');
  }
  if (!playing) {
    intro = null;
    hud.showIntro(null);
  }
}

// 練習模式：drill 為 'serve' | 'receive' | 'spike' | 'block'，一球接一球無限重來
function startPractice(drill) {
  leaveMenu('practice');
  practice = new Practice(drill, {
    teams,
    ball,
    rally,
    serve,
    positioning,
    hud,
    slow: practiceSlow,
    onResult: practiceResult,
  });
  hud.setHint(DRILLS[drill].hint);
  practice.start();
}

// 練習、教學每一球成功時：音效＋觀眾小小歡呼
function practiceResult(ok) {
  if (!ok) return;
  sound.play('success');
  ambience.cheer(0.6);
}

// 互動教學：發球 → 接球 → 扣球 → 攔網，做對才進下一步，全部完成後慶祝並回到主畫面
function startTutorial() {
  leaveMenu('practice');
  practice = new Tutorial(
    { teams, ball, rally, serve, positioning, hud },
    {
      onResult: practiceResult,
      onComplete: () => {
        sound.play('win');
        effects.celebrate(COURT_CENTER, true);
        ambience.cheer(1.4);
      },
      onDone: () => {
        openMenu();
        hud.toast('教學完成！可以開始比賽了');
      },
    },
  );
  practice.start();
}

// 按 A：能量滿就開啟強力擊球（下一次扣球生效）；已開啟時再按一次就取消（能量保留）
function togglePower() {
  const side = HUMAN_SIDES[0];
  if (rally.disarmPower(side)) {
    sound.play('uncharge');
    hud.toast('已取消強力擊球');
  } else if (rally.armPower(side)) {
    sound.play('charge');
  } else {
    hud.toast('能量還沒集滿');
  }
}

// 暫停選單：繼續、重新開局（同難度）、回到主畫面
const PAUSE_OPTIONS = ['resume', 'restart', 'menu'];
let paused = false;
let pauseIndex = 0;

// 一局打完、結果畫面出現後就不需要暫停
function canPause() {
  return !inMenu && !intro && !(!practice && match.winner && rally.state === 'idle');
}

function pause() {
  if (paused || !canPause()) return;
  paused = true;
  pauseIndex = 0;
  serve.cancelCharge();
  hud.showPause(pauseIndex);
  sound.play('ui');
}

function resume() {
  paused = false;
  hud.showPause(null);
}

// 中斷正在進行的這一球
function abortRally() {
  rally.reset();
  effects.reset();
  hud.showResult(null);
}

function choosePause(option) {
  sound.play('ui');
  resume();
  if (option === 'restart') {
    abortRally();
    if (practice) practice.start(); // 練習：成功次數歸零重來
    else startMatch();
  } else if (option === 'menu') {
    abortRally();
    openMenu(practice ? practice.menuScreen : 'main'); // 練習（教學）中回到練習（教學）選單，方便換項目
  }
}

function updatePause() {
  const dir = (input.wasPressed('down') ? 1 : 0) - (input.wasPressed('up') ? 1 : 0);
  if (dir !== 0) {
    pauseIndex = (pauseIndex + dir + PAUSE_OPTIONS.length) % PAUSE_OPTIONS.length;
    hud.showPause(pauseIndex);
    sound.play('ui');
  }
  if (input.wasPressed('action')) choosePause(PAUSE_OPTIONS[pauseIndex]);
  else if (input.wasPressed('pause')) resume();
}

hud.onPauseOption(choosePause);
hud.onPauseButton(pause);

openMenu();

function resize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  graphics.resize();
}

// 主畫面選單在左邊時，畫面往右挪讓球場露出來（切換時平滑移動）
let viewShift = 0;
function updateViewShift(dt) {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const want = inMenu && w >= MENU_SIDE_MIN_WIDTH ? w * MENU_SHIFT : 0;
  viewShift = THREE.MathUtils.damp(viewShift, want, 5, dt);
  if (viewShift > 0.5) camera.setViewOffset(w, h, -viewShift, 0, w, h);
  else if (camera.view?.enabled) camera.clearViewOffset();
}

function toggleGraphics() {
  graphics.toggle();
  menu.setValue('graphics', graphics.label);
  hud.toast(`畫質：${graphics.label}`);
  sound.play('ui');
}
menu.setValue('graphics', graphics.label);
window.addEventListener('resize', resize);
resize();

const timer = new THREE.Timer();
let accumulator = 0;

renderer.setAnimationLoop((time) => {
  timer.update(time);
  const dt = Math.min(timer.getDelta(), MAX_FRAME);
  const gameSpeed = practice?.slow ? PRACTICE_SLOW : 1; // 練習慢速：整個遊戲（含時機提示圈）變慢
  const simDt = dt * effects.timeScale * gameSpeed; // 慢動作時球與角色變慢

  if (input.wasPressed('mute')) hud.setMuted(sound.toggleMute());
  if (input.wasPressed('graphics')) toggleGraphics();
  if (input.wasPressed('camera') && !inMenu) {
    rig.nextPreset();
    hud.toast(`視角：${rig.presetName}`);
    sound.play('ui');
  }

  if (paused) {
    updatePause();
  } else if (inMenu) {
    menu.update();
  } else if (intro) {
    updateIntro(dt);
  } else if (input.wasPressed('pause') && canPause()) {
    pause();
  } else {
    serve.update(dt * gameSpeed);
    rally.update();
    practice?.update(simDt);
    if (input.wasPressed('power')) togglePower();
    // 一局結束、結果畫面出現後，按鍵回到選單
    if (!practice && match.winner && rally.state === 'idle' && input.wasPressed('action')) openMenu();
  }

  // 暫停時整個場面定格（球、角色、粒子、慢動作都不動），鏡頭仍可轉動查看
  sound.setHum(!inMenu && !paused && rally.armed[HUMAN_SIDES[0]]); // 蓄氣中的嗡嗡聲
  sound.setMusic(inMenu); // 背景音樂只在主畫面播
  updateViewShift(dt);

  if (paused) {
    rig.update(dt, effects.shakeOffset, true);
    input.endFrame();
    graphics.render();
    return;
  }

  if (rally.state !== 'idle') {
    accumulator += simDt;
    // 強力扣球命中會在中途觸發定格：剩下的步數等定格結束再算，畫面才會停在手碰球的那一刻
    while (accumulator >= PHYSICS_STEP && !effects.frozen) {
      rally.step(PHYSICS_STEP);
      accumulator -= PHYSICS_STEP;
    }
  } else {
    accumulator = 0;
  }

  // 輪到玩家擊球或攔網時顯示時機提示，其他時候顯示落點
  const live = rally.state === 'live';
  const plan = rally.plan;
  const cue = rally.getCue();
  timingCue.visible = cue !== null;
  if (cue) timingCue.userData.update(cue.x, cue.z, cue.timeLeft);
  landingMarker.visible = live && !timingCue.visible && predictLanding(ball, landing) !== null;
  if (landingMarker.visible) landingMarker.position.set(landing.x, 0.03, landing.z);
  // 玩家扣球前的瞄準準星
  const spikeTarget = rally.getSpikeTarget();
  spikeMarker.visible = spikeTarget !== null;
  if (spikeTarget) spikeMarker.position.set(spikeTarget.x, 0.04, spikeTarget.z);

  if (inMenu) warmUp.update(simDt);
  else positioning.update(plan, ball.pos, live, rally.time);
  const animDt = effects.frozen ? 0 : simDt; // 這一幀中途開始定格的話，角色和球也停在碰球那一刻
  for (const p of players) {
    // 強力擊球的氣場（主畫面不顯示）
    p.setAura(inMenu ? 0 : rally.auraLevel(p));
    p.update(animDt);
    if (p.auraLevel > 0.05) effects.auraSparks(p.pos, p.auraLevel);
  }

  // 扣球飛行中：拖尾；強力球再加能量光
  ball.setPower(rally.ballState === 'power');
  if (live && rally.ballState && !effects.frozen) effects.trail(ball.pos, rally.ballState === 'power');
  ball.syncMesh(animDt);
  if (inMenu) warmBall.syncMesh(animDt);
  footprints.update(dt, players);
  hud.setEnergy(rally.energy, rally.armed, POWER.maxEnergy);
  ambience.update(dt);
  effects.update(dt);
  // 比賽中鏡頭輕微跟著球；扣球前一下子到扣球飛行中稍微推近
  const spiking = (plan?.type === 'spike' && plan.time - rally.time < SPIKE_ZOOM_LEAD) || rally.ballState !== null;
  cameraFocus.zoom = spiking ? 1 : 0;
  rig.update(dt, effects.shakeOffset, false, inMenu ? null : cameraFocus);
  input.endFrame();
  graphics.render();
});
