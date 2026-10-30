import { BALL, COURT } from '../config.js';

const NET_HALF_WIDTH = COURT.width / 2 + COURT.postOffset;
const REST_SPEED = 0.3;

// 推進一步。state = { pos, vel }（THREE.Vector3），會直接修改。
// 回傳這一步發生的事件：'net' 撞網、'outsideAntenna' 從標誌桿外過網、'ground' 觸地。
export function stepBall(state, dt) {
  const { pos, vel } = state;
  const events = [];
  const prevZ = pos.z;

  vel.y -= BALL.gravity * dt;
  pos.addScaledVector(vel, dt);

  // 穿越網子所在平面 z = 0
  if (Math.sign(prevZ) !== Math.sign(pos.z) && prevZ !== 0) {
    const t = prevZ / (prevZ - pos.z);
    const crossY = pos.y - vel.y * dt * (1 - t);
    const crossX = pos.x - vel.x * dt * (1 - t);
    const withinPosts = Math.abs(crossX) <= NET_HALF_WIDTH;

    // 網下方雖然是空的，但規則上球必須從網上過，所以一律當撞網
    if (withinPosts && crossY - BALL.radius < COURT.netHeight) {
      // 撞網：彈回原本那一側，速度大幅衰減
      pos.z = Math.sign(prevZ) * BALL.radius;
      vel.z *= -0.25;
      vel.x *= 0.5;
      events.push('net');
    } else if (Math.abs(crossX) > COURT.width / 2) {
      events.push('outsideAntenna');
    }
  }

  // 觸地
  if (pos.y <= BALL.radius) {
    pos.y = BALL.radius;
    if (vel.y < 0) {
      if (-vel.y > REST_SPEED) events.push('ground');
      vel.y = -vel.y * BALL.bounce;
      vel.x *= BALL.friction;
      vel.z *= BALL.friction;
      if (vel.y < REST_SPEED) vel.y = 0;
    }
  }

  return events;
}

// 給定起點、目標落點與最高點高度，算出需要的初速度。
// 用「指定落點」而不是「指定力道角度」，之後擊球判定與 AI 才能精準控制球路。
export function velocityToTarget(from, to, apexHeight, out) {
  const g = BALL.gravity;
  const apex = Math.max(apexHeight, from.y + 0.1, to.y + 0.1);
  const vy = Math.sqrt(2 * g * (apex - from.y));
  const flightTime = vy / g + Math.sqrt((2 * (apex - to.y)) / g);
  return out.set((to.x - from.x) / flightTime, vy, (to.z - from.z) / flightTime);
}

// 指定飛行時間直達目標（扣球用：時間越短球越快越平）
export function velocityForTime(from, to, time, out) {
  return out.set(
    (to.x - from.x) / time,
    (to.y - from.y) / time + 0.5 * BALL.gravity * time,
    (to.z - from.z) / time,
  );
}

// 模擬到球「往下掉」經過指定高度，回傳經過的秒數並把位置寫入 out；先落地就回傳 null。
export function predictCrossing(state, height, out, dt = 1 / 120, maxSteps = 1200) {
  const sim = { pos: state.pos.clone(), vel: state.vel.clone() };
  for (let i = 1; i <= maxSteps; i++) {
    const prevY = sim.pos.y;
    if (stepBall(sim, dt).includes('ground')) return null;
    if (sim.vel.y < 0 && prevY > height && sim.pos.y <= height) {
      out.copy(sim.pos);
      return i * dt;
    }
  }
  return null;
}

// 球穿越網子平面（z = 0）時的位置，不考慮撞網；先落地就回傳 null。攔網判定用。
export function predictNetCrossing(state, out, dt = 1 / 120, maxSteps = 600) {
  const pos = state.pos.clone();
  const vel = state.vel.clone();
  for (let i = 0; i < maxSteps; i++) {
    const prevX = pos.x;
    const prevY = pos.y;
    const prevZ = pos.z;
    vel.y -= BALL.gravity * dt;
    pos.addScaledVector(vel, dt);
    if (pos.y <= BALL.radius) return null;
    if (Math.sign(prevZ) !== Math.sign(pos.z)) {
      const t = prevZ / (prevZ - pos.z);
      return out.set(prevX + (pos.x - prevX) * t, prevY + (pos.y - prevY) * t, 0);
    }
  }
  return null;
}

// 這條球路在落地前會不會撞網
export function willHitNet(state, dt = 1 / 120, maxSteps = 1200) {
  const sim = { pos: state.pos.clone(), vel: state.vel.clone() };
  for (let i = 0; i < maxSteps; i++) {
    const events = stepBall(sim, dt);
    if (events.includes('net')) return true;
    if (events.includes('ground')) return false;
  }
  return false;
}

// 模擬到第一次觸地，回傳落點（含撞網的影響）。找不到就回傳 null。
export function predictLanding(state, out, dt = 1 / 120, maxSteps = 1200) {
  const sim = { pos: state.pos.clone(), vel: state.vel.clone() };
  for (let i = 0; i < maxSteps; i++) {
    if (stepBall(sim, dt).includes('ground')) return out.copy(sim.pos);
    if (sim.vel.lengthSq() === 0) break;
  }
  return null;
}

// 壓線算界內：球的投影碰到線就算
export function isInCourt(pos) {
  return (
    Math.abs(pos.x) <= COURT.width / 2 + BALL.radius &&
    Math.abs(pos.z) <= COURT.length / 2 + BALL.radius
  );
}
