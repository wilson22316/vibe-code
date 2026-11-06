import * as THREE from 'three';
import { COURT, HUMAN_SIDES, POWER, PRACTICE_SLOW, TEAMS } from './config.js';
import { sound } from './audio/sound.js';
import { Ball, createLandingMarker, createSpikeMarker, createTimingCue } from './entities/ball.js';
import { Player } from './entities/player.js';
import { Effects } from './fx/effects.js';
import { Footprints } from './fx/footprints.js';
import { createRemoteInput, input, inputFor, setSideInput } from './input/keyboard.js';
import { Connection } from './net/connection.js';
import { GuestSync } from './net/guest.js';
import { HostSync } from './net/host.js';
import { startBackgroundTicker } from './net/ticker.js';
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
import { Rally, resultText } from './systems/rally.js';
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
const GUEST_SIDE = -1; // 內網連線對戰：開房的主機操作 home（+z），加入的客人操作 away
const LAN_ACTIONS = ['action', 'up', 'down', 'left', 'right', 'power']; // 客人要送給主機的按鍵

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
  lanEvent(name, data);
}

const rally = new Rally(ball, teams, hud, {
  onPoint: (side, reason) => {
    if (practice) {
      practice.onPoint(side, reason); // 練習不計分
      return;
    }
    match.pointTo(side);
    positioning.celebrate(side);
    showPoint(side, match.score, match.servingSide);
    lanEvent('point', { side, reason, score: match.score, serving: match.servingSide });
  },
  onFinished: () => {
    if (practice) {
      practice.next();
    } else if (match.winner) {
      showGameOver(match.winner, match.score);
      lanEvent('gameover', { winner: match.winner, score: match.score });
    } else {
      serve.reset(match.server(teams));
      lanEvent('next');
    }
  },
  onEvent: onRallyEvent,
});
// 得分：記分板、哨音、觀眾歡呼（每一分都會歡呼，這台的玩家得分時比較熱烈）
function showPoint(side, score, servingSide) {
  hud.setScore(score, servingSide);
  sound.play('whistle');
  if (side === HUMAN_SIDES[0]) {
    sound.play('cheer');
    effects.celebrate(ball.pos);
    ambience.cheer(1);
  } else {
    ambience.cheer(0.5);
  }
}

// 一局結束的結果畫面
function showGameOver(winner, score) {
  const win = winner === HUMAN_SIDES[0];
  hud.showGameOver({ win, score });
  sound.play(win ? 'win' : 'lose');
  if (win) {
    effects.celebrate(COURT_CENTER, true);
    ambience.cheer(1.4);
  }
  if (lan) lan.over = true;
}

// 發球的音效與特效
function showServe() {
  sound.play('serve');
  effects.hit(ball.pos, 'good');
}

const serve = new ServeController(ball, hud, aimMarker, {
  onReset: () => positioning.reset(),
  onServe: (server) => {
    showServe();
    rally.start(server);
    practice?.onServe();
    lanEvent('serve');
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
    lanHost: () => openLan('create'),
    lanJoin: () => openLan('join'),
    lanCancel: () => {
      leaveLan();
      menu.show('lan');
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
  if (lan && !lan.playing && name !== 'lan-wait') leaveLan(); // 等待對手時按 Esc 返回：取消房間
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
  if (lan) leaveLan();
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
  hud.setPauseButtonVisible(!lan); // 連線對戰不能暫停
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
  startIntro(`對手難度：${aiLevel().label}`);
}

function startIntro(subtitle) {
  intro = { t: 0, ready: false, go: false };
  hud.showIntro(subtitle);
}

// 比賽開場動畫：「我方 VS 對手」→ READY? → GO!（時間點跟 style.css 的 #intro 動畫一致），期間不能發球；
// 空白鍵跳過（連線對戰兩邊要同步開始，不能跳過）
const INTRO = { ready: 1.4, go: 2.05, end: 2.7, camera: 1.8 };
let intro = null; // 開場動畫進行中：{ t, ready, go }

function updateIntro(dt) {
  if (!lan && input.wasPressed('action')) intro.t = INTRO.end; // 跳過（不播 READY、GO 的音效）
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

// side 那隊的玩家按 A：能量滿就開啟強力擊球（下一次扣球生效）；已開啟時再按一次就取消（能量保留）
function togglePower(side) {
  const result = rally.disarmPower(side) ? 'off' : rally.armPower(side) ? 'on' : 'empty';
  if (side === HUMAN_SIDES[0]) powerFeedback(result);
  else lanEvent('power', { result }); // 連線的客人按的：音效和提示在客人那邊
}

function powerFeedback(result) {
  if (result === 'off') {
    sound.play('uncharge');
    hud.toast('已取消強力擊球');
  } else if (result === 'on') {
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
  return !lan && !inMenu && !intro && !(!practice && match.winner && rally.state === 'idle');
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

// ── 內網連線對戰（1 對 1）──
// 主機（建立房間的那台）跑整場比賽，客人只送按鍵、顯示主機傳來的狀態；伺服器見 server/lan.js
let lan = null; // 連線中：{ role: 'host' | 'guest', conn, playing, over, sync }
const remoteInput = createRemoteInput(); // 主機收到的客人按鍵
const lanInfo = document.getElementById('lan-info');
const lanTitle = lanInfo.parentElement.querySelector('.screen-title');
const rootStyle = document.documentElement.style;
let savedHomeColor = '';

// 主機把比賽事件轉給客人
function lanEvent(name, data) {
  if (lan?.role === 'host' && lan.playing) lan.sync.event(name, data);
}

// role：'create' 建立房間、'join' 加入房間
async function openLan(role) {
  const conn = new Connection({ onMessage: onLanMessage, onClose: onLanClosed });
  lan = { role: role === 'create' ? 'host' : 'guest', conn, playing: false, over: false, sync: null };
  try {
    const reply = await conn.open(role);
    if (lan?.conn !== conn) return; // 等回覆的時候已經取消了
    if (role === 'create') {
      showLanWait('等待對手加入…', '請對手用瀏覽器打開遊戲網址，選「多人連線 → 加入房間」', shareUrls(reply.ips));
    } else {
      showLanWait('已加入房間', '等待主機開始…', []);
    }
  } catch (e) {
    if (lan?.conn !== conn) return;
    lan = null;
    sound.play('deny');
    hud.toast(e.message);
  }
}

// 給對手開的網址：用跟自己一樣的網址開；自己是用 localhost 開的話，換成這台電腦的內網位址
// （外網的對手要開對外的網址，例如 Apache 對外的埠號，這台電腦不知道，只能請玩家自己分享）
function shareUrls(ips) {
  const page = `${location.port ? `:${location.port}` : ''}${location.pathname}`;
  if (!['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) return [location.origin + location.pathname];
  return ips.map((ip) => `${location.protocol}//${ip}${page}`);
}

function showLanWait(title, text, urls) {
  lanTitle.textContent = title;
  lanInfo.textContent = text;
  for (const url of urls) {
    const b = document.createElement('b');
    b.textContent = url;
    lanInfo.append(b);
  }
  menu.show('lan-wait');
}

function onLanMessage(msg) {
  if (!lan) return;
  if (lan.role === 'host') {
    if (msg.t === 'peer-joined') startLanHost();
    else if (msg.t === 'k') remoteInput.receive(msg.a, msg.d === 1);
  } else if (msg.t === 'start') {
    startLanGuest();
  } else {
    lan.sync?.receive(msg);
  }
}

// 對方離開或伺服器關閉
function onLanClosed() {
  if (!lan) return;
  if (!lan.playing) {
    leaveLan();
    menu.show('lan');
    hud.toast('連線中斷');
  } else if (lan.over) {
    hud.toast('對方已離開'); // 結果畫面留著，按空白鍵回主畫面
  } else {
    abortRally();
    openMenu();
    hud.toast('連線中斷：對方已離開');
  }
}

// 主機：對手加入了，開始比賽（主機先發球）
function startLanHost() {
  lan.playing = true;
  HUMAN_SIDES.splice(0, HUMAN_SIDES.length, -GUEST_SIDE, GUEST_SIDE);
  setSideInput(GUEST_SIDE, remoteInput);
  lan.sync = new HostSync(lan.conn, { players, ball, rally, serve });
  lan.sync.capture();
  lan.conn.send({ t: 'start' });
  leaveMenu('normal', INTRO.camera); // 雙方跑速都是 1
  hud.setScore(match.score, match.servingSide);
  serve.reset(match.server(teams));
  startIntro('內網連線對戰');
}

// 客人：鏡頭、記分板都換到 away 那隊的角度
function startLanGuest() {
  lan.playing = true;
  HUMAN_SIDES.splice(0, HUMAN_SIDES.length, GUEST_SIDE, -GUEST_SIDE);
  lan.sync = new GuestSync(players, ball, PHYSICS_STEP);
  rig.setSide(GUEST_SIDE);
  hud.setViewSide(GUEST_SIDE);
  // 記分板左邊「我方」換成 away 的藍色，右邊換成畫面上 home 的球衣顏色
  savedHomeColor = rootStyle.getPropertyValue('--home-color');
  rootStyle.setProperty('--away-color', savedHomeColor || '#ff6b4a');
  rootStyle.setProperty('--home-color', `#${TEAMS.away.shirt.toString(16).padStart(6, '0')}`);
  leaveMenu('normal', INTRO.camera);
  hud.setScore(match.score, match.servingSide);
  startIntro('內網連線對戰');
}

// 離開連線（取消房間、回主畫面）：全部換回單人模式的設定
function leaveLan() {
  lan.conn.close();
  if (lan.playing) {
    HUMAN_SIDES.splice(0, HUMAN_SIDES.length, 1);
    setSideInput(GUEST_SIDE, null);
    if (lan.role === 'host') {
      lan.sync.release();
    } else {
      rig.setSide(1);
      hud.setViewSide(1);
      if (savedHomeColor) rootStyle.setProperty('--home-color', savedHomeColor);
      else rootStyle.removeProperty('--home-color');
      rootStyle.removeProperty('--away-color');
    }
  }
  lan = null;
}

// 客人每幀：把按鍵送給主機、播主機傳來的事件、套用最新狀態
function updateGuest(guest) {
  for (const a of LAN_ACTIONS) {
    if (input.wasPressed(a)) lan.conn.send({ t: 'k', a, d: 1 });
    if (input.wasReleased(a)) lan.conn.send({ t: 'k', a, d: 0 });
  }
  for (const [name, data] of guest.takeEvents()) {
    if (name === 'anim') {
      guest.playAnim(data);
    } else if (name === 'judge') {
      hud.showJudge(data.grade);
    } else if (name === 'point') {
      const win = data.side === HUMAN_SIDES[0];
      hud.showResult({ text: resultText(data.reason, win), good: win });
      showPoint(data.side, data.score, data.serving);
    } else if (name === 'gameover') {
      showGameOver(data.winner, data.score);
    } else if (name === 'next') {
      hud.showResult(null);
    } else if (name === 'serve') {
      showServe();
    } else if (name === 'power') {
      powerFeedback(data.result);
    } else {
      onRallyEvent(name, data); // hit、block、net、land
    }
  }
  guest.apply();
  const sv = guest.serve;
  aimMarker.visible = sv !== null;
  if (sv) aimMarker.position.set(sv.aimX, 0.02, -GUEST_SIDE * (COURT.length / 4));
  hud.setPower(sv?.charge ?? null);
}

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

const STALL_TIME = 100; // 毫秒：畫面更新停了這麼久就當作分頁在背景
let lastDrawn = 0; // 上一次由 requestAnimationFrame 更新畫面的時間

// background：分頁在背景時由計時器呼叫（只更新、不繪製）
function frame(time, background = false) {
  if (!background) lastDrawn = performance.now();
  timer.update(time);
  const dt = Math.min(timer.getDelta(), MAX_FRAME);
  const gameSpeed = practice?.slow ? PRACTICE_SLOW : 1; // 練習慢速：整個遊戲（含時機提示圈）變慢
  const simDt = dt * effects.timeScale * gameSpeed; // 慢動作時球與角色變慢
  const guest = lan?.role === 'guest' && lan.playing ? lan.sync : null; // 連線對戰的客人：只顯示主機傳來的狀態

  if (input.wasPressed('mute')) hud.setMuted(sound.toggleMute());
  if (input.wasPressed('graphics')) toggleGraphics();
  if (input.wasPressed('camera') && !inMenu) {
    rig.nextPreset();
    hud.toast(`視角：${rig.presetName}`);
    sound.play('ui');
  }

  if (guest) updateGuest(guest);
  if (paused) {
    updatePause();
  } else if (inMenu) {
    menu.update();
  } else if (intro) {
    updateIntro(dt);
  } else if (guest) {
    // 一局結束、結果畫面出現後，按鍵回到選單
    if (lan.over && input.wasPressed('action')) {
      abortRally();
      openMenu();
    }
  } else if (input.wasPressed('pause') && canPause()) {
    pause();
  } else {
    serve.update(dt * gameSpeed);
    rally.update();
    practice?.update(simDt);
    for (const side of HUMAN_SIDES) if (inputFor(side).wasPressed('power')) togglePower(side);
    // 一局結束、結果畫面出現後，按鍵回到選單
    if (!practice && match.winner && rally.state === 'idle' && input.wasPressed('action')) {
      if (lan) abortRally();
      openMenu();
    }
  }

  // 暫停時整個場面定格（球、角色、粒子、慢動作都不動），鏡頭仍可轉動查看
  const armed = guest ? guest.armed : rally.armed;
  sound.setHum(!inMenu && !paused && armed[HUMAN_SIDES[0]]); // 蓄氣中的嗡嗡聲
  sound.setMusic(inMenu); // 背景音樂只在主畫面播
  updateViewShift(dt);

  if (paused) {
    rig.update(dt, effects.shakeOffset, true);
    input.endFrame();
    graphics.render();
    return;
  }

  if (guest) {
    guest.stepBall(simDt, effects.frozen);
  } else if (rally.state !== 'idle') {
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
  const live = guest ? guest.live : rally.state === 'live';
  const plan = rally.plan;
  const cue = guest ? guest.cue : rally.getCue();
  timingCue.visible = cue !== null;
  if (cue) timingCue.userData.update(cue.x, cue.z, cue.timeLeft);
  landingMarker.visible = live && !timingCue.visible && predictLanding(ball, landing) !== null;
  if (landingMarker.visible) landingMarker.position.set(landing.x, 0.03, landing.z);
  // 玩家扣球前的瞄準準星
  const spikeTarget = guest ? guest.spikeTarget : rally.getSpikeTarget();
  spikeMarker.visible = spikeTarget !== null;
  if (spikeTarget) spikeMarker.position.set(spikeTarget.x, 0.04, spikeTarget.z);

  if (inMenu) warmUp.update(simDt);
  else if (guest) for (const p of players) p.facing = live ? ball.pos : null; // 跑位由主機決定
  else positioning.update(plan, ball.pos, live, rally.time);
  const animDt = effects.frozen ? 0 : simDt; // 這一幀中途開始定格的話，角色和球也停在碰球那一刻
  for (const p of players) {
    // 強力擊球的氣場（主畫面不顯示）
    if (!guest) p.setAura(inMenu ? 0 : rally.auraLevel(p)); // 客人的氣場強度是主機給的
    p.update(animDt);
    if (p.auraLevel > 0.05) effects.auraSparks(p.pos, p.auraLevel);
  }

  // 扣球飛行中：拖尾；強力球再加能量光
  const ballState = guest ? guest.ballState : rally.ballState;
  ball.setPower(ballState === 'power');
  if (live && ballState && !effects.frozen) effects.trail(ball.pos, ballState === 'power');
  ball.syncMesh(animDt);
  if (inMenu) warmBall.syncMesh(animDt);
  footprints.update(dt, players);
  hud.setEnergy(guest ? guest.energy : rally.energy, armed, POWER.maxEnergy);
  ambience.update(dt);
  effects.update(dt);
  // 比賽中鏡頭輕微跟著球；扣球前一下子到扣球飛行中稍微推近
  const spiking = (plan?.type === 'spike' && plan.time - rally.time < SPIKE_ZOOM_LEAD) || rally.ballState !== null;
  cameraFocus.zoom = guest ? guest.zoom : spiking ? 1 : 0;
  rig.update(dt, effects.shakeOffset, false, inMenu ? null : cameraFocus);
  if (lan?.role === 'host' && lan.playing) lan.sync.send(cameraFocus.zoom);
  input.endFrame();
  remoteInput.endFrame();
  if (!background) graphics.render();
}

renderer.setAnimationLoop((time) => frame(time));
// 連線對戰中分頁切到背景也要繼續跑（主機停住的話兩邊都會卡）
startBackgroundTicker((time) => {
  if (lan?.playing && time - lastDrawn > STALL_TIME) frame(time, true);
});
