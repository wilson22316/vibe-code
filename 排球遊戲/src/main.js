import * as THREE from 'three';
import { TEAMS } from './config.js';
import { Ball, createLandingMarker } from './entities/ball.js';
import { Player } from './entities/player.js';
import { input } from './input/keyboard.js';
import { createCamera } from './scene/camera.js';
import { createCourt } from './scene/court.js';
import { createEnvironment } from './scene/environment.js';
import { createLights } from './scene/lights.js';
import { predictLanding, stepBall } from './systems/ballPhysics.js';
import { Positioning } from './systems/positioning.js';
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
const aimMarker = createAimMarker();
scene.add(ball.mesh, landingMarker, aimMarker);

const teams = {};
for (const [name, team] of Object.entries(TEAMS)) {
  teams[name] = team.members.map((m) => new Player({ team, shirt: team.shirt, ...m }));
  for (const p of teams[name]) scene.add(p.mesh);
}
const positioning = new Positioning(teams);
const players = positioning.allPlayers();

// 目前固定由 home 隊右邊的人發球；輪流發球在第 5 階段規則加入
const serve = new ServeController(ball, hud, aimMarker, teams.home[1], () => positioning.reset());
const landing = new THREE.Vector3();

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

  if (serve.state === 'flying' || serve.state === 'result') {
    accumulator += dt;
    while (accumulator >= PHYSICS_STEP) {
      serve.onBallEvents(stepBall(ball, PHYSICS_STEP));
      accumulator -= PHYSICS_STEP;
    }
  } else {
    accumulator = 0;
  }

  landingMarker.visible = serve.isBallInFlight && predictLanding(ball, landing) !== null;
  if (landingMarker.visible) landingMarker.position.set(landing.x, 0.03, landing.z);

  positioning.update(landingMarker.visible ? landing : null, ball.pos);
  for (const p of players) p.update(dt);

  ball.syncMesh(dt);
  input.endFrame();
  renderer.render(scene, camera);
});
