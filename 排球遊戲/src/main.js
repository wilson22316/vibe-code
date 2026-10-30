import * as THREE from 'three';
import { HUMAN_SIDES, TEAMS } from './config.js';
import { Ball, createLandingMarker, createTimingCue } from './entities/ball.js';
import { Player } from './entities/player.js';
import { input } from './input/keyboard.js';
import { createCamera } from './scene/camera.js';
import { createCourt } from './scene/court.js';
import { createEnvironment } from './scene/environment.js';
import { createLights } from './scene/lights.js';
import { predictLanding } from './systems/ballPhysics.js';
import { Match } from './systems/match.js';
import { Positioning } from './systems/positioning.js';
import { Rally } from './systems/rally.js';
import { createAimMarker, ServeController } from './systems/serve.js';
import { hud } from './ui/hud.js';

const PHYSICS_STEP = 1 / 120; // 固定步長，球路才不會受幀率影響
const MAX_FRAME = 0.1; // 分頁切回來時避免一次補太多步

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.add(createEnvironment(scene), createCourt(), createLights());

const camera = createCamera();

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
const rally = new Rally(ball, teams, hud, {
  onPoint: (side) => {
    match.pointTo(side);
    hud.setScore(match.score, match.servingSide);
  },
  onFinished: () => {
    if (match.winner) hud.showGameOver({ win: HUMAN_SIDES.includes(match.winner), score: match.score });
    else serve.reset(match.server(teams));
  },
});
const serve = new ServeController(ball, hud, aimMarker, {
  onReset: () => positioning.reset(),
  onServe: (server) => rally.start(server),
});
const landing = new THREE.Vector3();

function startMatch() {
  match.reset();
  hud.setScore(match.score, match.servingSide);
  hud.showGameOver(null);
  serve.reset(match.server(teams));
}
startMatch();

function resize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resize);
resize();

const timer = new THREE.Timer();
let accumulator = 0;

renderer.setAnimationLoop((time) => {
  timer.update(time);
  const dt = Math.min(timer.getDelta(), MAX_FRAME);

  serve.update(dt);
  rally.update();
  // 一局結束、結果畫面出現後，按鍵再來一局
  if (match.winner && rally.state === 'idle' && input.wasPressed('action')) startMatch();

  if (rally.state !== 'idle') {
    accumulator += dt;
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

  positioning.update(plan, ball.pos, live);
  for (const p of players) p.update(dt);

  ball.syncMesh(dt);
  input.endFrame();
  renderer.render(scene, camera);
});
