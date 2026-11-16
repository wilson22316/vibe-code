// 3 對 3（半場）：玩家這隊 3 人（you）對 AI 3 人（foe），輪流進攻。規則和 1 對 1 相同（duel.js）：
// 三分線內進球 1 分、線外 2 分，先得 WIN_SCORE 分獲勝；進球、出界、進攻超時換對方在弧頂開球；
// 防守籃板、抄截、抄到傳球不停球，拿到球的那隊要先把球帶出三分線（清球）才能出手。
// 操控：進攻時操控持球的人（傳球給隊友就換人），防守時自動換到離球最近的人。沒被操控的人都由這裡的 AI 控制：
//   進攻沒持球的人跑到空檔位置（偶爾往籃下切），對手持球的人運球、找空檔跳投、切入上籃灌籃、傳給有空檔的隊友；
//   防守的人一對一盯人（盯持球的人時貼身滑步、其他人站在盯的人和籃框之間），出手時跳起來干擾，沒進的球去搶籃板。
// 玩家的操控在 practice.js（用 bind 換角色），這裡用它的 rules 和 state() 接上；所有出手的球都交給它的物理和判定（foeShot）。
import * as THREE from 'three'
import { COURT } from './court.js'
import { MOVE_SPEEDS, NIGHT_BASKET_Z } from '../gallery/scene.js'
import { attachFire } from './fire.js'
import { FIXED_CAMERA, LEVELS, SHOT_CLOCK, WIN_SCORE, beyondArc } from './duel.js'
import {
  DRIVES,
  DRIVE_BRAKE,
  DRIVE_TAKEOFF,
  JUMP_START as SHOT_START,
  LAYUP_ERROR,
  PASS_WINDUP,
  SHOOT_LENGTH,
  SHOOT_RELEASE,
} from './practice.js'

// ===== 可以調整的參數 =====
const TEAM_SIZE = 3
// 3 對 3 才有的難度參數（其他的沿用 duel.js 的 LEVELS）：
//   passChance 對手持球時每次決定要傳給有空檔隊友的機率、intercept 傳球路線上的防守者抄到球的機率
const TEAM_LEVELS = {
  easy: { passChance: 0.3, intercept: 0.25 },
  normal: { passChance: 0.4, intercept: 0.4 },
  hard: { passChance: 0.5, intercept: 0.55 },
}
// 進攻的站位（相對籃框中心：x 往右、z 往球場，公尺）：沒持球的人從這裡面挑離持球的人和隊友最遠的位置
const SPOTS = [
  [0, 7.2], [-4.6, 5.1], [4.6, 5.1], [-6.4, 1.0], [6.4, 1.0], [-2.4, 4.6], [2.4, 4.6], [-1.9, 1.3], [1.9, 1.3],
]
const SPOT_EVERY = 2.5 // 沒持球的人每幾秒重新挑一次位置
const CUT_CHANCE = 0.25 // 重新挑位置時，盯他的人離他夠遠（CUT_OPEN m）的話往籃下切的機率
const CUT_OPEN = 2.0
const OFFBALL_SPEED = 1.0 // 沒持球的人跑位的速度（Run 3.345 m/s 的幾倍）
// 防守：盯持球的人站在他往籃框 GUARD_GAP m；盯其他人的站在「盯的人 → 籃框」這條線上 HELP_SAG 比例的地方，
// 再往球的方向偏 HELP_BALL 比例（協防）
const GUARD_GAP = 1.2
const HELP_SAG = 0.35
const HELP_BALL = 0.15
const LEAD = 0.15 // 盯持球的人時預判他幾秒後的位置
const SLIDE_SCALE_MAX = 1.7
const RECOVER_FROM = 1.5 // 離防守位置超過這麼遠就轉身跑回去
const BODY_GAP = 0.6 // 兩個人中心最近的距離
const LANE_HALF_WIDTH = 0.55 // 玩家切入時，路線兩側這麼寬以內有對手就擋住
const GUARD_LANE_HALF_WIDTH = 1.0 // 對手切入時，路線兩側這麼寬以內有我方的人就不切
const DUNK_CLEAR = 1.5 // 玩家切入時最近的對手離超過這個距離才灌籃
const CONTEST_RANGE = 1.6
const CONTEST_FULL = 0.7
const CONTEST_JUMP = 0.3
const GUARD_CONTEST_RANGE = 2.4 // 我方干擾對手出手的範圍和強度
const GUARD_CONTEST_MAX = 5
const BURST_RANGE = 2.5 // 玩家突破時，這麼近的對手會愣住 BURST_STUN 秒
const BURST_STUN = 0.6
const TURNOVER_STUN = 0.5 // 換球權時（抄截、搶到籃板），失去球的那隊愣住幾秒
const STEAL_RANGE = 1.6 // 玩家抄球的範圍（成功率見 LEVELS 的 stealChance）
const BLOCK_RANGE = 1.8 // 對手出手時玩家正在跳、在他前方這麼近就蓋掉
const FOE_STEAL_RANGE = 1.0 // 對手貼近玩家到這麼近時，每 FOE_STEAL_EVERY 秒伸手抄一次（成功率見 LEVELS 的 foeSteal）
const FOE_STEAL_EVERY = 1.2
const FOE_REACH = 0.35
const FOE_OPEN = 1.6 // 對手持球時，最近的防守者離他超過這個距離算有空檔
const FOE_SHOT_RANGE = 7.2
const FOE_DUNK_CLEAR = 2.5
const PASS_OPEN = 2.0 // 隊友最近的防守者離他超過這個距離，對手才會考慮傳給他
const PASS_SPEED = 10 // 傳球的速度（m/s）
const PASS_ARC = 0.03 // 傳球的弧度：每公尺往上拱幾公尺
const INTERCEPT_RANGE = 0.55 // 防守者離傳球路線這麼近就有機會抄到
const MATE_REBOUND_WAIT = 0.4 // 我方的 AI 隊友等幾秒才去搶籃板（對手的見 LEVELS 的 reboundWait）
const SWITCH_MARGIN = 1.0 // 防守時，別的隊友比目前操控的人近這麼多才換人
const FIRE_STREAK = 3 // 同一個人連進幾球（中間對手沒得分）就著火
const FIRE_ERROR = 0.6
const FIRE_ZONE = 1.6
const NEXT_DELAY = 1.8
const SCORE_DELAY = 2.8
// =========================

const BASELINE_Z = NIGHT_BASKET_Z - COURT.BASKET_TO_BASELINE
const MARGIN = 0.3
const TURN_SPEED = 10
const FADE = 0.2
const SLIDE_SPEED = MOVE_SPEEDS.DefenseSlide
const CONTEST_FROM = 4 / 24
const CONTEST_TO = 20 / 24
const PASS_FROM = 4 / 24 // 傳球動作從第 4 格開始播（同 practice.js 的 ACTS.pass）
const PASS_LENGTH = 10 / 24
const PICKUP_RADIUS = 0.7
const PICKUP_HEIGHT = 1.3
const UP = THREE.Object3D.DEFAULT_UP

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a))
const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random())
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z)
const other = (team) => (team === 'you' ? 'foe' : 'you')
const newStats = () => ({ shots: 0, makes: 0, twos: 0, blocks: 0, steals: 0, rebounds: 0 })

// 介面和 duel.js 的 createDuel 相同（PracticeView 兩種模式共用）
export function createTeamMatch({
  onScore = () => {},
  onMessage = () => {},
  onMoment = () => {},
  onSound = () => {},
  onEnd = () => {},
} = {}) {
  let L = { ...LEVELS.normal, ...TEAM_LEVELS.normal }
  let controls = null
  let physics = null
  let rim = null
  let locals = null
  let stage = null
  const agents = [] // 6 個人：{ id, team, index, actor, pos, mark, act, clip, ... }
  let ctrl = null // 玩家操控中的人
  let marker = null // 操控中的人腳下的光圈
  let passBall = null // 傳球時飛行中的球
  const score = { you: 0, foe: 0 }
  const stats = { you: newStats(), foe: newStats() }
  let offense = 'you'
  let phase = 'play' // play、dead（等重新開球）、over
  let next = 'you'
  let wait = 0
  let holder = null // 拿著球的人（玩家操控的人拿球時也是）
  let pass = null // 傳球：{ from, to, t, delay, duration, start, end, released, intercept }
  let needClear = false
  let shotClock = SHOT_CLOCK
  let ticked = 0
  let missed = false
  let looseFor = 0 // 球判定完多久了（搶籃板用）
  let lastFoeShooter = null
  let time = 0
  let denied = 0
  const target = new THREE.Vector3()
  const to = new THREE.Vector3()
  const ballWorld = new THREE.Vector3()
  const assist = new THREE.Vector3()
  const lead = new THREE.Vector3()
  const report = () =>
    onScore({ ...score, offense, clear: needClear, fire: { you: teamOnFire('you'), foe: teamOnFire('foe') } })

  // ---------- 建立 ----------
  function start(court, playerControls, foeColors, homeColors) {
    stage = court
    controls = playerControls
    physics = controls.physics
    rim = controls.rim
    locals = controls.releaseLocals()
    const main = controls.actor()
    for (const team of ['you', 'foe']) {
      for (let index = 0; index < TEAM_SIZE; index++) {
        const actor = team === 'you' && index === 0 ? main : stage.addCharacter(team === 'you' ? homeColors : foeColors)
        actor.id = `${team}${index}`
        agents.push({
          id: actor.id,
          team,
          index,
          actor,
          pos: actor.root.position,
          mark: null,
          act: null, // 做到一半的動作：{ kind: 'shot' | 'pass' | 'contest' | 'reach', ... }
          clip: null,
          stun: 0,
          jumped: false,
          stealWait: FOE_STEAL_EVERY,
          spot: new THREE.Vector3(),
          spotWait: 0,
          think: 0,
          side: 1,
          streak: 0,
          dribbleLow: false,
          seen: new THREE.Vector3(),
          seenBefore: new THREE.Vector3(),
          fire: attachFire(actor.ball, actor.root),
        })
      }
    }
    for (const a of agents) a.mark = agents.find((b) => b.team !== a.team && b.index === a.index)
    ctrl = agents[0]
    marker = new THREE.Mesh(
      new THREE.RingGeometry(0.34, 0.42, 40),
      new THREE.MeshBasicMaterial({ color: 0xffd23a, transparent: true, opacity: 0.85, depthWrite: false, fog: false }),
    )
    marker.rotation.x = -Math.PI / 2
    marker.position.y = 0.02
    ctrl.actor.root.add(marker)
    passBall = main.ball.clone()
    main.ball.getWorldScale(passBall.scale)
    passBall.visible = false
    stage.scene.add(passBall)
    begin('you')
  }

  // ---------- 小工具 ----------
  const team = (t) => agents.filter((a) => a.team === t)
  const isCtrl = (a) => a === ctrl
  const teamOnFire = (t) => team(t).some((a) => a.streak >= FIRE_STREAK)
  const byId = (id) => agents.find((a) => a.id === id)

  function setClip(a, name, scale = 1, startAt = 0, fade = FADE) {
    if (a.clip !== name) a.actor.play(name, fade, scale, startAt)
    else a.actor.setTimeScale(scale)
    a.clip = name
  }

  function turnTowards(a, angle, delta) {
    const diff = wrapAngle(angle - a.actor.root.rotation.y)
    a.actor.root.rotation.y = wrapAngle(a.actor.root.rotation.y + Math.sign(diff) * Math.min(Math.abs(diff), TURN_SPEED * delta))
  }

  const face = (a, p, delta) => turnTowards(a, Math.atan2(p.x - a.pos.x, p.z - a.pos.z), delta)

  function moveBy(a, dx, dz) {
    a.pos.x = THREE.MathUtils.clamp(a.pos.x + dx, -COURT.HALF_WIDTH + MARGIN, COURT.HALF_WIDTH - MARGIN)
    a.pos.z = THREE.MathUtils.clamp(a.pos.z + dz, BASELINE_Z + MARGIN, BASELINE_Z + COURT.HALF_LENGTH - MARGIN)
  }

  // 轉身往 target 跑（name：Run 沒球、Sprint 運球）
  function runTo(a, delta, name = 'Run', scale = L.runScale) {
    face(a, target, delta)
    setClip(a, name, scale)
    const v = MOVE_SPEEDS[name] * scale
    const turn = a.actor.root.rotation.y
    moveBy(a, Math.sin(turn) * v * delta, Math.cos(turn) * v * delta)
  }

  // 面向 facing、滑步往 target（DefenseSlide 往左滑，往右倒著播）；到位就站防守姿勢
  function slideTo(a, facing, delta) {
    face(a, facing, delta)
    to.set(target.x - a.pos.x, 0, target.z - a.pos.z)
    const d = to.length()
    const v = Math.min(SLIDE_SPEED * SLIDE_SCALE_MAX, d / 0.15)
    if (d > 1e-4) moveBy(a, (to.x / d) * v * delta, (to.z / d) * v * delta)
    const turn = a.actor.root.rotation.y
    const left = d > 1e-4 ? ((to.x * Math.cos(turn) - to.z * Math.sin(turn)) / d) * v : 0
    if (Math.abs(left) > (a.clip === 'DefenseSlide' ? 0.15 : 0.4)) setClip(a, 'DefenseSlide', left / SLIDE_SPEED)
    else setClip(a, 'Defense')
  }

  // 走到 target 附近就停下來面向 facing（沒球的人跑位用）
  function goTo(a, facing, delta, stand = 'Idle') {
    if (flat(target, a.pos) > 0.35) runTo(a, delta, 'Run', OFFBALL_SPEED)
    else {
      face(a, facing, delta)
      setClip(a, stand)
    }
  }

  // 所有人互相不重疊（玩家操控的人由 rules.collide 推開）
  function separate() {
    for (let i = 0; i < agents.length; i++) {
      for (let j = i + 1; j < agents.length; j++) {
        const a = agents[i]
        const b = agents[j]
        to.set(a.pos.x - b.pos.x, 0, a.pos.z - b.pos.z)
        const d = to.length()
        if (d >= BODY_GAP || d < 1e-6) continue
        const push = (BODY_GAP - d) / d
        if (isCtrl(a)) b.pos.addScaledVector(to, -push)
        else if (isCtrl(b)) a.pos.addScaledVector(to, push)
        else {
          a.pos.addScaledVector(to, push / 2)
          b.pos.addScaledVector(to, -push / 2)
        }
      }
    }
  }

  // 防守位置：從 p 往籃框 gap m（已經在籃下就站在他和籃框中間）
  function guardSpot(p, gap) {
    to.set(rim.x - p.x, 0, rim.z - p.z)
    const d = to.length()
    target.copy(p).addScaledVector(to, Math.min(gap, d * 0.5) / Math.max(d, 1e-6))
    target.y = 0
    return target
  }

  // from 到籃框（或 end）的直線上有沒有 team 的人擋著
  function laneClear(from, blockers, halfWidth, end = rim) {
    const lx = end.x - from.x
    const lz = end.z - from.z
    const length = Math.hypot(lx, lz)
    return blockers.every((b) => {
      const along = ((b.pos.x - from.x) * lx + (b.pos.z - from.z) * lz) / length
      if (along < 0 || along > length) return true
      return Math.abs((b.pos.x - from.x) * lz - (b.pos.z - from.z) * lx) / length > halfWidth
    })
  }

  function contestBy(defender, from, jumping, range = CONTEST_RANGE, max = L.contestMax) {
    let k = THREE.MathUtils.clamp((range - flat(defender, from)) / (range - CONTEST_FULL), 0, 1)
    const front = (defender.x - from.x) * (rim.x - from.x) + (defender.z - from.z) * (rim.z - from.z) > 0
    if (!front) k *= 0.3
    else if (jumping && k > 0) k = Math.min(1, k + CONTEST_JUMP)
    return 1 + max * k
  }

  const nearest = (list, p) => list.reduce((best, a) => (!best || flat(a.pos, p) < flat(best.pos, p) ? a : best), null)

  // 球現在在哪裡（拿著的人、傳球中、場上滾的球）
  function ballSpot(state) {
    if (holder) return holder.pos
    if (pass) return pass.released ? passBall.position : pass.from.pos
    return state.ball?.position ?? null
  }

  // ---------- 操控換人 ----------
  function control(a, ball = false) {
    if (a === ctrl) {
      if (ball && !controls.state().hasBall) controls.giveBall()
      return
    }
    const prev = ctrl
    ctrl = a
    controls.bind(a.actor, { ball })
    a.act = null
    prev.clip = null
    prev.act = null
    a.actor.root.add(marker)
  }

  // ---------- 開球、換球權 ----------
  function begin(who) {
    offense = who
    phase = 'play'
    pass = null
    passBall.visible = false
    needClear = false
    shotClock = SHOT_CLOCK
    ticked = 0
    missed = false
    looseFor = 0
    if (Math.max(score.you, score.foe) >= WIN_SCORE - 1) onSound('alert') // 賽末點
    const attackers = team(who)
    const defenders = team(other(who))
    // 進攻：0 號在弧頂（三分線外）拿球，另外兩人在兩翼；防守：各自站在盯的人和籃框之間
    const top = new THREE.Vector3(0, 0, rim.z + 7.3)
    const wings = [new THREE.Vector3(-4.6, 0, rim.z + 5.1), new THREE.Vector3(4.6, 0, rim.z + 5.1)]
    attackers.forEach((a, i) => a.pos.copy(i === 0 ? top : wings[i - 1]))
    defenders.forEach((d) => d.pos.copy(guardSpot(d.mark.pos, GUARD_GAP)))
    for (const a of agents) {
      a.act = null
      a.clip = null
      a.stun = 0
      a.jumped = false
      a.stealWait = FOE_STEAL_EVERY
      a.spotWait = 0
      a.actor.ball.visible = false
      const facing = a.team === who ? rim : a.mark.pos
      a.actor.root.rotation.y = Math.atan2(facing.x - a.pos.x, facing.z - a.pos.z)
      a.seen.copy(a.mark.pos)
      a.spot.copy(a.pos)
    }
    holder = attackers[0]
    // 玩家：進攻時操控持球的人，防守時操控盯持球的人
    const mine = who === 'you' ? holder : holder.mark
    control(mine, who === 'you')
    controls.reset({ ball: who === 'you', position: mine.pos.clone() })
    for (const a of agents) {
      if (isCtrl(a)) continue
      setClip(a, a === holder ? 'Dribble' : a.team === who ? 'Idle' : 'Defense', 1, 0, 0)
    }
    holder.think = 1
    holder.clock = 0
    report()
  }

  // 不停球的攻守轉換（防守籃板、抄截）：a 拿到球，他那隊要先帶出三分線才能出手
  function takeOver(a, message) {
    const was = offense
    offense = a.team
    holder = a
    pass = null
    passBall.visible = false
    needClear = !beyondArc(a.pos, rim)
    shotClock = SHOT_CLOCK
    ticked = 0
    missed = false
    looseFor = 0
    a.spot.copy(a.pos)
    for (const b of agents) {
      b.act = isCtrl(b) ? b.act : null
      b.spotWait = 0
      b.jumped = false
      if (b.team === was) b.stun = TURNOVER_STUN
    }
    if (a.team === 'you') control(a, true)
    else {
      a.think = 0.4
      a.clock = 0
      // 防守時操控離球最近的人（玩家動作做到一半就等做完，見 switchOnDefense）
      if (!controls.busy()) control(nearest(team('you'), a.pos), false)
    }
    if (message) onMessage(message)
    report()
  }

  function deadBall(who, message, delay = NEXT_DELAY) {
    phase = 'dead'
    next = who
    wait = delay
    holder = null
    pass = null
    passBall.visible = false
    for (const a of agents) {
      a.act = null
      if (!isCtrl(a) && a.clip !== 'Celebrate' && a.clip !== 'Frustrated') setClip(a, 'Idle')
    }
    if (message) onMessage(message)
  }

  const outside = (p) => Math.abs(p.x) > COURT.HALF_WIDTH || p.z < BASELINE_Z

  // ---------- 傳球 ----------
  // from 傳給 to：先做傳球動作（PASS_WINDUP 秒後出手），路線上有對方的人可能被抄
  function startPass(from, toAgent) {
    pass = { from, to: toAgent, t: 0, delay: PASS_WINDUP, released: false }
    holder = null
    if (!isCtrl(from)) {
      from.act = { kind: 'pass', time: PASS_FROM }
      face(from, toAgent.pos, 1)
      setClip(from, 'Pass', 1, PASS_FROM, 0.1)
    }
  }

  function releasePass() {
    const { from } = pass
    pass.released = true
    pass.start = from.actor.ball.getWorldPosition(new THREE.Vector3())
    // 抄截：對方離傳球路線夠近的人（最靠近傳球者的那個）有機會抄到
    const end = pass.to.pos
    const lx = end.x - from.pos.x
    const lz = end.z - from.pos.z
    const length = Math.hypot(lx, lz) || 1
    const thieves = team(other(from.team))
      .map((d) => ({ d, along: ((d.pos.x - from.pos.x) * lx + (d.pos.z - from.pos.z) * lz) / length }))
      .filter(({ d, along }) => along > 0.15 * length && along < length - 0.5 && Math.abs((d.pos.x - from.pos.x) * lz - (d.pos.z - from.pos.z) * lx) / length < INTERCEPT_RANGE)
      .sort((a, b) => a.along - b.along)
    // 對手抄玩家的傳球用難度的 intercept；玩家這隊抄對手的傳球用固定一半的機率
    const chance = from.team === 'you' ? L.intercept : 0.5
    if (thieves.length && Math.random() < chance) pass.intercept = thieves[0].d
    const receiver = pass.intercept ?? pass.to
    pass.end = receiver.pos.clone().setY(1.15)
    pass.duration = Math.max(0.2, pass.start.distanceTo(pass.end) / PASS_SPEED)
    pass.t = 0
    passBall.position.copy(pass.start)
    passBall.visible = true
    from.actor.ball.visible = false
    if (!isCtrl(from)) from.act = { kind: 'pass', time: PASS_FROM + PASS_WINDUP }
  }

  function updatePass(delta) {
    if (!pass.released) {
      pass.t += delta
      pass.from.actor.ball.visible = true // 出手前球還在手上
      if (pass.t >= pass.delay) releasePass()
      return
    }
    pass.t += delta
    const receiver = pass.intercept ?? pass.to
    pass.end.set(receiver.pos.x, 1.15, receiver.pos.z) // 接球的人還在動的話跟著他
    const k = Math.min(1, pass.t / pass.duration)
    passBall.position.lerpVectors(pass.start, pass.end, k)
    passBall.position.y += Math.sin(Math.PI * k) * PASS_ARC * pass.start.distanceTo(pass.end)
    passBall.rotateX(-delta * 12)
    if (k < 1) return
    passBall.visible = false
    const thief = pass.intercept
    pass = null
    if (thief) {
      stats[thief.team].steals++
      onSound('steal')
      takeOver(thief, thief.team === 'you' ? '抄到傳球！' : '傳球被抄了！')
      return
    }
    holder = receiver
    receiver.spot.copy(receiver.pos)
    onSound('bounce', 0.4)
    if (receiver.team === 'you') control(receiver, true)
    else {
      receiver.act = null
      receiver.think = 0.35
      setClip(receiver, 'Dribble')
    }
  }

  // ---------- 進攻 ----------
  // 沒持球的人：跑到空檔位置，偶爾往籃下切
  function offBall(a, delta, ballPos) {
    a.spotWait -= delta
    if (a.spotWait <= 0) {
      a.spotWait = SPOT_EVERY * (0.7 + Math.random() * 0.6)
      const mates = team(a.team).filter((b) => b !== a)
      const defender = nearest(team(other(a.team)), a.pos)
      if (defender && flat(defender.pos, a.pos) > CUT_OPEN && Math.random() < CUT_CHANCE) {
        a.spot.set(rim.x + (a.pos.x > 0 ? 1.2 : -1.2), 0, rim.z + 1.3) // 往籃下切
      } else {
        let best = null
        let bestScore = -Infinity
        for (const [x, z] of SPOTS) {
          const p = new THREE.Vector3(rim.x + x, 0, rim.z + z)
          let s = Math.min(flat(p, ballPos), ...mates.map((m) => (m === holder || isCtrl(m) ? flat(p, m.pos) : flat(p, m.spot))))
          if (flat(p, ballPos) < 3) s -= 5
          s += Math.random() * 0.8
          if (s > bestScore) {
            bestScore = s
            best = p
          }
        }
        a.spot.copy(best)
      }
    }
    target.copy(a.spot)
    goTo(a, ballPos, delta)
  }

  // 對手持球：清球、運球找機會，每 L.think 秒決定一次
  function dribble(a, delta) {
    a.clock = (a.clock ?? 0) + delta
    if (needClear) {
      const angle = THREE.MathUtils.clamp(Math.atan2(a.pos.x - rim.x, a.pos.z - rim.z), -1, 1)
      const radius = COURT.THREE_RADIUS + 0.7
      target.set(rim.x + Math.sin(angle) * radius, 0, rim.z + Math.cos(angle) * radius)
      runTo(a, delta, 'Sprint', L.foeSprint)
      return
    }
    a.think -= delta
    if (a.think <= 0) {
      a.think = L.think
      if (decide(a)) return
    }
    target.copy(a.spot)
    if (flat(target, a.pos) > 0.3) runTo(a, delta, 'Sprint', L.foeSprint)
    else {
      face(a, rim, delta)
      setClip(a, 'Dribble')
    }
  }

  // 決定下一步：切入、跳投、傳球，或換個位置。開始了動作就回傳 true
  function decide(a) {
    const p = a.pos
    const defenders = team(other(a.team))
    const dRim = flat(rim, p)
    const dDef = Math.min(...defenders.map((d) => flat(d.pos, p)))
    const hurry = shotClock < 3
    if (dRim < 6 && dRim > 2.2 && laneClear(p, defenders, GUARD_LANE_HALF_WIDTH)) {
      let name = dDef > FOE_DUNK_CLEAR && Math.random() < 0.5 ? 'Dunk' : 'Layup'
      let plan = controls.drivePlan(name, p)
      if (plan === 'near' && name === 'Dunk') {
        name = 'Layup'
        plan = controls.drivePlan(name, p)
      }
      if (plan === 'far') {
        a.spot.set(rim.x + (p.x - rim.x) * 0.3, 0, rim.z + (p.z - rim.z) * 0.3)
        a.think = 0.1
        return false
      }
      if (plan !== 'near') {
        startShot(a, name, plan.start, plan.heading, plan.air)
        return true
      }
    }
    if (dRim < FOE_SHOT_RANGE && ((dDef > FOE_OPEN && Math.random() < L.shootChance) || hurry || dRim <= 2.2)) {
      startShot(a, 'jump', SHOT_START, Math.atan2(rim.x - p.x, rim.z - p.z), 0)
      return true
    }
    // 傳給有空檔、傳球路線沒人擋的隊友
    if (Math.random() < L.passChance) {
      const open = team(a.team)
        .filter((m) => m !== a)
        .map((m) => ({ m, space: Math.min(...defenders.map((d) => flat(d.pos, m.pos))) }))
        .filter(({ m, space }) => space > PASS_OPEN && laneClear(p, defenders, INTERCEPT_RANGE, m.pos))
        .sort((x, y) => y.space - x.space)
      if (open.length) {
        startPass(a, open[0].m)
        return true
      }
    }
    // 換位置：往旁邊繞、慢慢往裡面靠
    const angle = Math.atan2(p.x - rim.x, p.z - rim.z)
    if (Math.abs(angle) > 1) a.side = angle > 0 ? -1 : 1
    else if (Math.random() < 0.35) a.side = -a.side
    const spotAngle = THREE.MathUtils.clamp(angle + a.side * (0.4 + Math.random() * 0.4), -1.1, 1.1)
    const radius = Math.max(4.2, Math.min(dRim, 6.5) - 0.6)
    a.spot.set(rim.x + Math.sin(spotAngle) * radius, 0, rim.z + Math.cos(spotAngle) * radius)
    return false
  }

  function startShot(a, kind, startAt, heading, air) {
    a.act = { kind: 'shot', shot: kind, time: startAt, air, spot: a.pos.clone(), released: false }
    a.actor.root.rotation.y = heading
    setClip(a, kind === 'jump' ? 'Shoot' : kind, 1, startAt)
  }

  // 對手的投籃動作：上籃、灌籃照 practice.js 的方式移動；到出手那一格把球交給物理
  function updateShot(a, delta, state) {
    const act = a.act
    const drive = DRIVES[act.shot]
    act.time += delta
    if (drive) {
      let v = MOVE_SPEEDS.Sprint
      if (act.time >= DRIVE_TAKEOFF) v = act.air * THREE.MathUtils.clamp(1 - (act.time - drive.land) / DRIVE_BRAKE, 0, 1)
      const turn = a.actor.root.rotation.y
      moveBy(a, Math.sin(turn) * v * delta, Math.cos(turn) * v * delta)
    }
    if (!act.released && act.time >= (drive ? drive.release : SHOOT_RELEASE)) release(a, state)
    else if (!act.released) a.actor.ball.visible = true
    if (act.time >= (drive ? drive.length : SHOOT_LENGTH) - 1e-3) a.act = null
  }

  function release(a, state) {
    const act = a.act
    const heading = a.actor.root.rotation.y
    const from = locals[act.shot].clone().applyAxisAngle(UP, heading).add(a.pos)
    const defenders = team(other(a.team))
    const contest = Math.max(
      ...defenders.map((d) =>
        contestBy(d.pos, from, isCtrl(d) ? state.jumping : d.act?.kind === 'contest', GUARD_CONTEST_RANGE, GUARD_CONTEST_MAX),
      ),
    )
    // 火鍋：玩家正在跳、在出手的人前方夠近
    const blocker =
      ctrl.team !== a.team &&
      state.jumping &&
      flat(ctrl.pos, a.pos) < BLOCK_RANGE &&
      (ctrl.pos.x - a.pos.x) * (rim.x - a.pos.x) + (ctrl.pos.z - a.pos.z) * (rim.z - a.pos.z) > 0
    let velocity
    let scored = false
    if (blocker) {
      const angle = heading + Math.PI + (Math.random() - 0.5) * 2
      velocity = new THREE.Vector3(Math.sin(angle) * 3, 2, Math.cos(angle) * 3)
      stats[ctrl.team].blocks++
      onMessage('火鍋！')
      onSound('block')
      onMoment('block')
    } else if (act.shot === 'Dunk') {
      velocity = new THREE.Vector3(Math.sin(heading) * 0.3, -2.5, Math.cos(heading) * 0.3)
      scored = true
    } else {
      const angle = controls.shotAngle(from)
      const ideal = physics.idealSpeed(from, angle) ?? 9
      const error = act.shot === 'Layup' ? LAYUP_ERROR : L.shotError
      // 上籃打板；跳投在籃下也會打板（practice.js 的 aimVelocity）
      velocity =
        (act.shot === 'Layup' ? physics.bankShotVelocity(from) : controls.aimVelocity(from)) ||
        physics.launchVelocity(from, angle, ideal)
      const k = contest * rules.accuracy(a.id)
      velocity.multiplyScalar(1 + gauss() * error.speed * k)
      velocity.applyAxisAngle(UP, THREE.MathUtils.degToRad(gauss() * error.side * k))
    }
    act.released = true
    a.actor.ball.visible = false
    holder = null
    looseFor = 0
    lastFoeShooter = a
    controls.foeShot({ by: a.id, kind: act.shot, spot: act.spot, from, velocity, scored })
  }

  // ---------- 防守 ----------
  function defend(a, delta, state) {
    const mark = a.mark
    const ballPos = ballSpot(state)
    if (a.stun > 0) {
      a.stun -= delta
      setClip(a, 'Defense')
      return
    }
    const markShooting = isCtrl(mark) ? state.shooting === 'jump' && !state.ball : mark.act?.kind === 'shot' && mark.act.shot === 'jump' && !mark.act.released
    if (markShooting && !a.jumped && flat(mark.pos, a.pos) < CONTEST_RANGE) {
      a.jumped = true
      a.act = { kind: 'contest' }
      a.clip = null
      setClip(a, 'Rebound', 1, CONTEST_FROM)
      return
    }
    if (!markShooting) a.jumped = false
    if (holder === mark) {
      // 盯持球的人：預判位置、貼身滑步；貼夠近就伸手抄球（只有對手抄玩家）
      a.seenBefore.copy(a.seen)
      a.seen.lerp(mark.pos, Math.min(1, delta / L.reaction))
      const speed = a.seen.distanceTo(a.seenBefore) / delta
      lead.copy(a.seen).addScaledVector(a.seenBefore.sub(a.seen), -LEAD / delta)
      guardSpot(lead, GUARD_GAP + 0.15 * speed)
      if (a.team === 'foe' && isCtrl(mark) && tryReach(a, delta, state)) return
    } else {
      // 協防：站在盯的人和籃框之間，往球的方向偏一點
      a.seen.copy(mark.pos)
      target.set(mark.pos.x + (rim.x - mark.pos.x) * HELP_SAG, 0, mark.pos.z + (rim.z - mark.pos.z) * HELP_SAG)
      if (ballPos) {
        target.x += (ballPos.x - target.x) * HELP_BALL
        target.z += (ballPos.z - target.z) * HELP_BALL
      }
    }
    const far = flat(target, a.pos) > (a.running ? 0.6 : RECOVER_FROM)
    a.running = far
    if (far) runTo(a, delta)
    else slideTo(a, mark.pos, delta)
  }

  // 對手伸手抄玩家的球
  function tryReach(a, delta, state) {
    a.stealWait -= delta
    if (!state.hasBall || state.shooting || state.bursting || a.stealWait > 0 || flat(a.pos, ctrl.pos) > FOE_STEAL_RANGE) return false
    a.stealWait = FOE_STEAL_EVERY
    a.clip = null
    setClip(a, 'Catch', 1, 2 / 24)
    if (Math.random() < L.foeSteal) {
      controls.loseBall()
      stats.foe.steals++
      onSound('steal')
      takeOver(a, '被抄截了！')
    } else a.act = { kind: 'reach', left: FOE_REACH }
    return true
  }

  // ---------- 搶籃板 ----------
  // 球在場上：每隊離球最近的 AI 去搶（對手等 L.reboundWait 秒、隊友等 MATE_REBOUND_WAIT 秒），其他人回位置
  function rebound(delta, state) {
    const ball = state.ball
    looseFor = ball.judged ? looseFor + delta : 0
    for (const t of ['you', 'foe']) {
      const chaser = nearest(team(t).filter((a) => !isCtrl(a) && !a.act), ball.position)
      for (const a of team(t)) {
        if (isCtrl(a) || a.act) continue
        if (a !== chaser) {
          if (a.team === offense) offBall(a, delta, ball.position)
          else defend(a, delta, state)
          continue
        }
        const waitFor = t === 'foe' ? L.reboundWait : MATE_REBOUND_WAIT
        target.set(ball.position.x + ball.velocity.x * 0.3, 0, ball.position.z + ball.velocity.z * 0.3)
        const d = flat(ball.position, a.pos)
        if (looseFor > waitFor && d > 0.4) runTo(a, delta)
        else {
          face(a, ball.position, delta)
          setClip(a, 'Defense')
        }
        if (looseFor > waitFor && !state.shooting && ball.judged && ball.position.y < PICKUP_HEIGHT && d < PICKUP_RADIUS) {
          pickUp(a)
          return
        }
      }
    }
  }

  // AI 撿到場上的球
  function pickUp(a) {
    controls.takeBall()
    if (missed) stats[a.team].rebounds++
    missed = false
    if (a.team !== offense) {
      takeOver(a, a.team === 'you' ? '隊友搶到籃板！' : '對手搶到籃板！')
      return
    }
    // 進攻籃板：繼續進攻，進攻時間重新算
    holder = a
    a.spot.copy(a.pos)
    shotClock = SHOT_CLOCK
    looseFor = 0
    if (a.team === 'you') control(a, true)
    else {
      a.think = 0.3
      a.clock = 0
      setClip(a, 'Dribble')
    }
  }

  // ---------- 每一格 ----------
  function update(delta, paused) {
    if (!ctrl || paused || delta <= 0) return
    delta = Math.min(delta, 0.1)
    time += delta
    for (const a of agents) a.fire(a.streak >= FIRE_STREAK, time)
    if (phase === 'dead') {
      wait -= delta
      if (wait <= 0) begin(next)
      return
    }
    if (phase !== 'play') return
    const state = controls.state()

    // 玩家操控的人撿到球、或在投籃
    if (state.hasBall && holder !== ctrl && !pass) {
      if (missed) stats[ctrl.team].rebounds++
      missed = false
      if (offense !== ctrl.team) takeOver(ctrl, '搶到籃板！')
      else {
        holder = ctrl
        shotClock = SHOT_CLOCK
      }
    }
    if (holder === ctrl && state.shooting && state.ball) holder = null // 玩家投出去了
    if (holder === ctrl && !state.hasBall && !pass) holder = null

    if (pass) updatePass(delta)
    runShotClock(delta, state)
    if (phase !== 'play') return
    if (needClear && holder && beyondArc(holder.pos, rim)) {
      needClear = false
      report()
    }
    if (holder === ctrl && !state.shooting && outside(ctrl.pos)) {
      onSound('whistle')
      deadBall(other(ctrl.team), '踩出界了，換對手進攻')
      return
    }

    // AI
    for (const a of agents) {
      if (isCtrl(a)) continue
      if (a.act?.kind === 'shot') updateShot(a, delta, state)
      else if (a.act?.kind === 'pass') {
        a.act.time += delta
        if (a.act.time >= PASS_FROM + PASS_LENGTH) a.act = null
      } else if (a.act?.kind === 'contest') {
        if (a.actor.actionTime() >= CONTEST_TO) a.act = null
      } else if (a.act?.kind === 'reach') {
        a.act.left -= delta
        if (a.act.left <= 0) a.act = null
      }
    }
    if (phase !== 'play') return
    if (state.ball && !holder && !pass) rebound(delta, state)
    else {
      const ballPos = ballSpot(state) ?? ctrl.pos
      for (const a of agents) {
        if (isCtrl(a) || a.act) continue
        if (pass && (a === pass.to || a === pass.intercept)) {
          face(a, pass.from.pos, delta)
          setClip(a, a.team === offense ? 'Idle' : 'Defense')
        } else if (a === holder) dribble(a, delta)
        else if (a.team === offense) offBall(a, delta, ballPos)
        else defend(a, delta, state)
      }
    }
    if (phase !== 'play') return
    separate()
    switchOnDefense(state)
    // 對手持球的人的運球聲、手上的球
    for (const a of agents) {
      if (isCtrl(a)) continue
      const shooting = a.act?.kind === 'shot' && !a.act.released
      const passing = pass && !pass.released && pass.from === a
      a.actor.ball.visible = Boolean(a === holder || shooting || passing)
      const low = a === holder && a.actor.ball.getWorldPosition(ballWorld).y < 0.18
      if (low && !a.dribbleLow) onSound('bounce', 0.6)
      a.dribbleLow = low
    }
  }

  // 防守時操控離球最近的人（玩家做動作到一半時不換）
  function switchOnDefense(state) {
    if (offense === ctrl.team || controls.busy()) return
    const ballPos = ballSpot(state)
    if (!ballPos) return
    const best = nearest(team(ctrl.team), ballPos)
    if (best === ctrl || flat(best.pos, ballPos) >= flat(ctrl.pos, ballPos) - SWITCH_MARGIN) return
    control(best, false)
    // 換盯人：原本盯持球的那位改去盯玩家原本盯的人，免得兩個人包夾持球的人、放空另一個
    const ballMan = holder ?? pass?.to
    const guard = ballMan && team(ctrl.team).find((a) => a !== ctrl && a.mark === ballMan)
    if (guard) [guard.mark, ctrl.mark] = [ctrl.mark, guard.mark]
  }

  // 進攻時間：進攻方拿著球（或傳球中）時倒數，剩 3 秒起每秒滴答，歸零換球權
  function runShotClock(delta, state) {
    const live = (holder && holder.team === offense && !(isCtrl(holder) && state.shooting) && holder.act?.kind !== 'shot') || pass
    if (!live) return
    shotClock -= delta
    const left = Math.ceil(shotClock)
    if (left <= 3 && left >= 1 && left !== ticked) {
      ticked = left
      onSound('tick')
    }
    if (shotClock <= 0) {
      shotClock = 0
      onSound('buzzer')
      deadBall(other(offense), offense === 'you' ? '進攻超時，換對手進攻' : '對手進攻超時，換你進攻')
    }
  }

  // 每投一球的結果（practice.js 的 onResult；by 是出手者的 id）。回傳這球得幾分
  function result({ made, spot, by }) {
    const shooter = byId(by)
    if (phase !== 'play' || !shooter) return 0
    const t = shooter.team
    stats[t].shots++
    if (!made) {
      missed = true
      return 0
    }
    const points = beyondArc(spot, rim) ? 2 : 1
    score[t] += points
    stats[t].makes++
    if (points === 2) stats[t].twos++
    shooter.streak++
    for (const a of team(other(t))) a.streak = 0
    if (shooter.streak === FIRE_STREAK) {
      onSound('fire')
      onMoment('fire')
    }
    onSound(t === 'you' ? 'cheer' : 'groan')
    report()
    // 得分的那隊慶祝、另一隊沮喪
    for (const a of agents) {
      const emote = a.team === t ? 'Celebrate' : 'Frustrated'
      if (isCtrl(a)) controls.playEmote(emote)
      else {
        a.act = null
        setClip(a, emote)
      }
    }
    if (score[t] >= WIN_SCORE) {
      phase = 'over'
      holder = null
      onSound('buzzer')
      onSound(t === 'you' ? 'win' : 'lose')
      onEnd(t, stats)
    } else deadBall(other(t), null, SCORE_DELAY)
    return points
  }

  function restart() {
    for (const t of ['you', 'foe']) {
      score[t] = 0
      stats[t] = newStats()
    }
    for (const a of agents) a.streak = 0
    controls.rest()
    begin('you')
  }

  function setLevel(name) {
    L = { ...(LEVELS[name] ?? LEVELS.normal), ...(TEAM_LEVELS[name] ?? TEAM_LEVELS.normal) }
  }

  // ---------- 重播 ----------
  // 記下 6 個人的位置、方向、動作、手上的球，和傳球中的球；x、z 是對手最後出手的人（重播鏡頭用）
  function snapshot() {
    const focus = lastFoeShooter ?? holder ?? agents[TEAM_SIZE]
    return {
      x: focus.pos.x,
      z: focus.pos.z,
      actors: agents.map((a) => ({
        x: a.pos.x,
        z: a.pos.z,
        turn: a.actor.root.rotation.y,
        clip: a.actor.clip,
        time: a.actor.actionTime(),
        ball: a.actor.ball.visible,
      })),
      pass: passBall.visible ? passBall.position.clone() : null,
      passSpin: passBall.visible ? passBall.quaternion.clone() : null,
    }
  }

  function restore(a, b = a, k = 0, resume = false) {
    agents.forEach((agent, i) => {
      const s = a.actors[i]
      const e = b.actors[i]
      const same = e.clip === s.clip && e.time >= s.time
      agent.pos.set(s.x + (e.x - s.x) * k, 0, s.z + (e.z - s.z) * k)
      agent.actor.root.rotation.y = s.turn + wrapAngle(e.turn - s.turn) * k
      if (s.clip) agent.actor.play(s.clip, 0, resume ? 1 : 0, same ? s.time + (e.time - s.time) * k : s.time)
      agent.actor.ball.visible = s.ball
      if (resume) agent.clip = s.clip
    })
    passBall.visible = Boolean(a.pass)
    if (a.pass) passBall.position.copy(a.pass).lerp(b.pass ?? a.pass, k)
    if (a.passSpin) passBall.quaternion.copy(a.passSpin).slerp(b.passSpin ?? a.passSpin, k)
  }

  // ---------- 給 practice.js 的規則 ----------
  const opponents = () => team(other(ctrl.team))
  const rules = {
    collide(position) {
      for (const a of agents) {
        if (isCtrl(a)) continue
        to.set(position.x - a.pos.x, 0, position.z - a.pos.z)
        const d = to.length()
        if (d < BODY_GAP && d > 1e-6) position.addScaledVector(to, (BODY_GAP - d) / d)
      }
    },
    laneOpen: () => laneClear(ctrl.pos, opponents(), LANE_HALF_WIDTH),
    dunkOpen: () => Math.min(...opponents().map((a) => flat(a.pos, ctrl.pos))) > DUNK_CLEAR,
    contest: (from) => Math.max(...opponents().map((a) => contestBy(a.pos, from, a.act?.kind === 'contest'))),
    onBurst() {
      for (const a of opponents()) if (flat(a.pos, ctrl.pos) < BURST_RANGE && a.mark === ctrl) a.stun = BURST_STUN
    },
    // 玩家伸手抄球：對手持球的人在範圍內才有機會
    steal() {
      if (phase !== 'play' || !holder || holder.team === ctrl.team || holder.act) return false
      if (flat(ctrl.pos, holder.pos) > STEAL_RANGE || Math.random() > L.stealChance) return false
      stats[ctrl.team].steals++
      onSound('steal')
      takeOver(ctrl, '抄截成功！')
      return true
    },
    defending: () => offense !== ctrl.team,
    faceTarget: () => (offense !== ctrl.team ? (holder?.pos ?? null) : null),
    guardSpot() {
      if (offense === ctrl.team || phase !== 'play') return null
      const mark = holder && holder.team !== ctrl.team ? holder : ctrl.mark
      return assist.copy(guardSpot(mark.pos, GUARD_GAP))
    },
    canShoot: () => !(offense === ctrl.team && needClear),
    onDenied() {
      if (performance.now() - denied < 1500) return
      denied = performance.now()
      onMessage('先把球帶出三分線')
    },
    bounds: true,
    onBallOut(by) {
      if (phase !== 'play') return
      const shooter = byId(by)
      onSound('whistle')
      controls.takeBall()
      const t = other(shooter?.team ?? offense)
      deadBall(t, t === 'foe' ? '球出界，換對手進攻' : '球出界，換你進攻')
    },
    stamina: true,
    externalFire: true,
    accuracy: (id) => ((byId(id)?.streak ?? 0) >= FIRE_STREAK ? FIRE_ERROR : 1),
    onFire: (id) => (byId(id)?.streak ?? 0) >= FIRE_STREAK,
    zoneScale: () => (ctrl.streak >= FIRE_STREAK ? FIRE_ZONE : 1),
    side(id) {
      const shooter = byId(id)
      if (!shooter || shooter.team !== 'you') return 'foe'
      return isCtrl(shooter) ? 'you' : 'mate'
    },
    // 按 F 傳球：傳給方向鍵指的那位隊友（沒按方向鍵就傳給最有空檔的）
    pass(direction) {
      if (phase !== 'play' || holder !== ctrl || pass) return false
      const mates = team(ctrl.team).filter((a) => !isCtrl(a))
      let receiver = null
      if (direction) {
        let best = 0.3
        for (const m of mates) {
          to.set(m.pos.x - ctrl.pos.x, 0, m.pos.z - ctrl.pos.z).normalize()
          const cos = to.dot(direction)
          if (cos > best) {
            best = cos
            receiver = m
          }
        }
      }
      if (!receiver) {
        receiver = mates
          .map((m) => ({ m, space: Math.min(...opponents().map((d) => flat(d.pos, m.pos))) }))
          .sort((x, y) => y.space - x.space)[0].m
      }
      startPass(ctrl, receiver)
      ctrl.actor.root.rotation.y = Math.atan2(receiver.pos.x - ctrl.pos.x, receiver.pos.z - ctrl.pos.z)
      return true
    },
    fixedCamera: FIXED_CAMERA,
  }

  return { start, update, result, restart, setLevel, snapshot, restore, rules, shotClock: () => shotClock }
}
