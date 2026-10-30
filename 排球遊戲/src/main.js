import * as THREE from 'three';
import { HUMAN_SIDES, TEAMS } from './config.js';
import { sound } from './audio/sound.js';
import { Ball, createLandingMarker, createTimingCue } from './entities/ball.js';
import { Player } from './entities/player.js';
import { Effects } from './fx/effects.js';
import { input } from './input/keyboard.js';
import { createCamera } from './scene/camera.js';
import { createCourt } from './scene/court.js';
import { createEnvironment } from './scene/environment.js';
import { Graphics } from './scene/graphics.js';
import { createLights } from './scene/lights.js';
import { predictLanding } from './systems/ballPhysics.js';
import { aiLevel, setAiLevel } from './systems/ai.js';
import { Match } from './systems/match.js';
import { Positioning } from './systems/positioning.js';
import { Rally } from './systems/rally.js';
import { createAimMarker, ServeController } from './systems/serve.js';
import { hud } from './ui/hud.js';

const PHYSICS_STEP = 1 / 120; // 固定步長，球路才不會受幀率影響
const MAX_FRAME = 0.1; // 分頁切回來時避免一次補太多步

// 抗鋸齒交給後製的 FXAA（見 postprocessing.js），畫布本身不用開；解析度倍率由畫質設定決定
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping; // 比 ACES 更保留鮮豔色塊，適合卡通風
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.add(createEnvironment(scene), createCourt(), createLights());

const camera = createCamera();
const graphics = new Graphics(renderer, scene, camera);

const ball = new Ball();
const landingMarker = createLandingMarker();
const timingCue = createTimingCue();
const aimMarker = createAimMarker();
scene.add(ball.mesh, landingMarker, timingCue, aimMarker);

const teams = {};
for (const [name, team] of Object.entries(TEAMS)) {
  teams[name] = team.members.map((m) => new Player({ team, shirt: team.shirt, ...m }));
  for (const p of teams[name]) scene.add(p.mesh);
}
const positioning = new Positioning(teams);
const players = positioning.allPlayers();

const match = new Match();
const effects = new Effects(scene, camera);
const COURT_CENTER = new THREE.Vector3(0, 0, 0);

// 擊球、攔網、撞網、落地的特效與音效
function onRallyEvent(name, data) {
  if (name === 'hit') {
    sound.play(data.type === 'spike' ? 'spike' : data.type === 'set' ? 'set' : 'bump');
    if (data.human && data.grade === 'perfect') sound.play('perfect');
    effects.hit(data.pos, data.grade);
    if (data.type === 'spike') {
      effects.shake(data.grade === 'perfect' ? 0.25 : 0.12);
      // 只有玩家的完美扣球放慢動作：對手扣球放慢會讓接球變簡單
      if (data.human && data.grade === 'perfect') effects.slowMo();
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
    effects.sand(data.pos, hard ? 1.6 : 1);
    if (hard) effects.shake(0.2);
  }
}

const rally = new Rally(ball, teams, hud, {
  onPoint: (side) => {
    match.pointTo(side);
    hud.setScore(match.score, match.servingSide);
    sound.play('whistle');
    if (HUMAN_SIDES.includes(side)) {
      sound.play('cheer');
      effects.celebrate(ball.pos);
    }
  },
  onFinished: () => {
    if (match.winner) {
      const win = HUMAN_SIDES.includes(match.winner);
      hud.showGameOver({ win, score: match.score });
      sound.play(win ? 'win' : 'lose');
      if (win) effects.celebrate(COURT_CENTER, true);
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
  },
});
const landing = new THREE.Vector3();

const LEVELS = ['easy', 'normal', 'hard'];
let levelIndex = 1;
let inMenu = true;

function openMenu() {
  inMenu = true;
  hud.showGameOver(null);
  hud.showMenu(LEVELS[levelIndex]);
}

function startMatch() {
  inMenu = false;
  hud.showMenu(null);
  setAiLevel(LEVELS[levelIndex]);
  for (const p of teams.away) p.speedScale = aiLevel().speed;
  match.reset();
  hud.setScore(match.score, match.servingSide);
  serve.reset(match.server(teams));
}

function updateMenu() {
  const dir = (input.wasPressed('right') ? 1 : 0) - (input.wasPressed('left') ? 1 : 0);
  if (dir !== 0) {
    levelIndex = (levelIndex + dir + LEVELS.length) % LEVELS.length;
    hud.showMenu(LEVELS[levelIndex]);
    sound.play('ui');
  }
  if (input.wasPressed('action')) {
    sound.play('ui');
    startMatch();
  }
}

hud.onLevelClick((level) => {
  levelIndex = LEVELS.indexOf(level);
  sound.play('ui');
  startMatch();
});

// 選單背後先擺好發球前的場景
match.reset();
hud.setScore(match.score, match.servingSide);
serve.reset(match.server(teams));
openMenu();

function resize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  graphics.resize();
}

function toggleGraphics() {
  graphics.toggle();
  hud.setGraphicsLabel(graphics.label);
  hud.toast(`畫質：${graphics.label}`);
  sound.play('ui');
}
hud.setGraphicsLabel(graphics.label);
hud.onGraphicsClick(toggleGraphics);
window.addEventListener('resize', resize);
resize();

const timer = new THREE.Timer();
let accumulator = 0;

renderer.setAnimationLoop((time) => {
  timer.update(time);
  const dt = Math.min(timer.getDelta(), MAX_FRAME);
  const simDt = dt * effects.timeScale; // 慢動作時球與角色變慢

  if (input.wasPressed('mute')) hud.setMuted(sound.toggleMute());
  if (input.wasPressed('graphics')) toggleGraphics();

  if (inMenu) {
    updateMenu();
  } else {
    serve.update(dt);
    rally.update();
    // 一局結束、結果畫面出現後，按鍵回到選單
    if (match.winner && rally.state === 'idle' && input.wasPressed('action')) openMenu();
  }

  if (rally.state !== 'idle') {
    accumulator += simDt;
    while (accumulator >= PHYSICS_STEP) {
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

  positioning.update(plan, ball.pos, live, rally.time);
  for (const p of players) p.update(simDt);

  ball.syncMesh(simDt);
  effects.update(dt);
  input.endFrame();
  graphics.render();
});
