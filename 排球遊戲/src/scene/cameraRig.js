import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CAMERA_PRESETS } from './camera.js';

const TRANSITION_TIME = 0.6; // 切換預設視角的過場秒數
// 主畫面：從球場斜上方慢慢繞場（autoRotateSpeed 1 約 60 秒一圈）。
// 繞的半徑 15 公尺：在椰子樹（17 公尺外）和旗子（20 公尺外）裡面，繞一圈都不會被擋住
const ORBIT_VIEW = { position: [10.6, 7, 10.6], target: [0, 1, 0] };
const ORBIT_SPEED = 1;
// 比賽中鏡頭輕微跟著球：球在 (x, z) 時鏡頭和注視點一起偏移 (x × 0.25, z × 0.12)，最多 1.2 公尺
const FOLLOW = { x: 0.25, z: 0.12, max: 1.2, rate: 2.5 };
// 扣球時沿視線往前推近（距離的比例），推近快、退回慢
const SPIKE_ZOOM = 0.1;
const ZOOM_IN_RATE = 4;
const ZOOM_OUT_RATE = 2;

// 鏡頭控制：滑鼠拖曳 360 度旋轉、滾輪往游標方向縮放、切換預設視角，
// 最後疊上跟球偏移、扣球推近與畫面震動（每幀先拿掉再重新疊，控制器只看得到使用者的操作）
export class CameraRig {
  constructor(camera, domElement) {
    this.camera = camera;
    this.controls = new OrbitControls(camera, domElement);
    Object.assign(this.controls, {
      enableDamping: true,
      dampingFactor: 0.1,
      enablePan: false, // 平移很容易把球場拉出畫面，需要時切回預設視角就好
      zoomToCursor: true, // 指著角色滾滾輪就能拉近看
      minDistance: 3,
      maxDistance: 45,
      minPolarAngle: 0.05,
      maxPolarAngle: 1.45, // 不讓鏡頭鑽到沙子底下
    });
    this.controls.autoRotateSpeed = ORBIT_SPEED;
    this.presetIndex = 0;
    this.transition = null;
    this.cinematic = null; // 衝擊特寫：暫時接管鏡頭
    this.orbiting = false; // 主畫面繞場中
    this.shake = new THREE.Vector3(); // 目前疊在鏡頭上的震動
    this.follow = new THREE.Vector3(); // 目前疊上去的跟球偏移（鏡頭和注視點一起移）
    this.zoom = 0; // 目前的推近距離
    this.zoomOffset = new THREE.Vector3(); // 推近造成的鏡頭位移（沿視線）
    this.applyPreset(0, true);
  }

  // 主畫面：鏡頭移到球場斜上方後慢慢繞場（拖曳轉過之後也會繼續繞）
  startOrbit(instant = false) {
    this.orbiting = true;
    this.moveTo(new THREE.Vector3(...ORBIT_VIEW.position), new THREE.Vector3(...ORBIT_VIEW.target), instant);
  }

  // 停在指定視角、不繞場（角色自訂的預覽）；position、target 為 [x, y, z]
  holdView(position, target) {
    this.orbiting = false;
    this.moveTo(new THREE.Vector3(...position), new THREE.Vector3(...target));
  }

  // 離開主畫面：停止繞場，回到原本選的預設視角；duration：過場秒數（比賽開場用比較長的掃鏡）
  stopOrbit(duration = TRANSITION_TIME) {
    this.orbiting = false;
    this.controls.autoRotate = false;
    this.applyPreset(this.presetIndex, false, duration);
  }

  // 衝擊特寫：鏡頭直接切到 position 看著 target，停 hold 秒，再用 back 秒拉回原本的視角
  cutTo(position, target, hold, back) {
    this.cinematic = {
      t: 0,
      hold,
      back,
      savedPos: this.transition ? this.transition.toPos.clone() : this.basePosition(),
      savedTarget: this.transition ? this.transition.toTarget.clone() : this.baseTarget(),
      cutPos: position.clone(),
      cutTarget: target.clone(),
    };
    this.transition = null;
    this.controls.enabled = false; // 特寫期間滑鼠不能轉，避免把鏡頭拉離特寫
  }

  get presetName() {
    return CAMERA_PRESETS[this.presetIndex].name;
  }

  nextPreset() {
    if (this.cinematic) return; // 特寫中不切換，結束後會回到原本視角
    this.applyPreset((this.presetIndex + 1) % CAMERA_PRESETS.length);
  }

  applyPreset(index, instant = false, duration = TRANSITION_TIME) {
    this.presetIndex = index;
    const { position, target } = CAMERA_PRESETS[index];
    this.moveTo(new THREE.Vector3(...position), new THREE.Vector3(...target), instant, duration);
  }

  // 鏡頭平滑移到 toPos、看著 toTarget（instant：直接跳過去）
  moveTo(toPos, toTarget, instant = false, duration = TRANSITION_TIME) {
    if (instant) {
      this.shake.set(0, 0, 0);
      this.follow.set(0, 0, 0);
      this.zoom = 0;
      this.zoomOffset.set(0, 0, 0);
      this.camera.position.copy(toPos);
      this.controls.target.copy(toTarget);
      this.controls.update();
      return;
    }
    this.transition = { t: 0, duration, fromPos: this.basePosition(), fromTarget: this.baseTarget(), toPos, toTarget };
  }

  // 鏡頭本身的位置與注視點（扣掉每幀疊上去的震動、跟球偏移、推近）
  basePosition() {
    return this.camera.position.clone().sub(this.shake).sub(this.follow).sub(this.zoomOffset);
  }

  baseTarget() {
    return this.controls.target.clone().sub(this.follow);
  }

  // 每幀呼叫；shakeOffset 為這一幀的震動位移；holdCinematic：暫停中，特寫計時與跟球都先停住
  // focus：比賽中要跟的 { point：球的位置, zoom：0～1 推近程度 }，null 表示不跟（主畫面）
  update(dt, shakeOffset, holdCinematic = false, focus = null) {
    // 先拿掉上一幀疊上去的效果，控制器才不會把它們誤當成使用者的操作而越飄越遠
    this.camera.position.sub(this.shake).sub(this.follow).sub(this.zoomOffset);
    this.controls.target.sub(this.follow);

    if (this.cinematic) {
      // 特寫中不跟球；結束後從零開始慢慢跟上
      this.follow.set(0, 0, 0);
      this.zoom = 0;
      this.zoomOffset.set(0, 0, 0);
      this.updateCinematic(holdCinematic ? 0 : dt);
      this.shake.copy(shakeOffset);
      this.camera.position.add(this.shake);
      return;
    }

    if (this.transition) {
      const tr = this.transition;
      tr.t = Math.min(1, tr.t + dt / tr.duration);
      const k = tr.t * tr.t * (3 - 2 * tr.t); // 平滑起停
      this.camera.position.lerpVectors(tr.fromPos, tr.toPos, k);
      this.controls.target.lerpVectors(tr.fromTarget, tr.toTarget, k);
      if (tr.t >= 1) this.transition = null;
    }
    this.controls.autoRotate = this.orbiting && !this.transition; // 移到定位後才開始繞
    this.controls.update(dt); // 傳 dt：繞場速度不受幀率影響

    if (!holdCinematic) this.updateFollow(dt, focus);
    // 沿視線往前推近（方向不變，所以不用重新 lookAt）
    this.zoomOffset.subVectors(this.controls.target, this.camera.position).setLength(this.zoom);
    this.controls.target.add(this.follow);
    this.camera.position.add(this.follow).add(this.zoomOffset);
    this.shake.copy(shakeOffset);
    this.camera.position.add(this.shake);
  }

  // 跟球偏移與推近平滑地往目標值靠
  updateFollow(dt, focus) {
    _want.set(0, 0, 0);
    if (focus) _want.set(focus.point.x * FOLLOW.x, 0, focus.point.z * FOLLOW.z).clampLength(0, FOLLOW.max);
    this.follow.x = THREE.MathUtils.damp(this.follow.x, _want.x, FOLLOW.rate, dt);
    this.follow.z = THREE.MathUtils.damp(this.follow.z, _want.z, FOLLOW.rate, dt);
    const wantZoom = focus ? focus.zoom * SPIKE_ZOOM * this.camera.position.distanceTo(this.controls.target) : 0;
    this.zoom = THREE.MathUtils.damp(this.zoom, wantZoom, wantZoom > this.zoom ? ZOOM_IN_RATE : ZOOM_OUT_RATE, dt);
  }

  // 特寫期間不經過 OrbitControls（它會把距離限制在 3 公尺以上，特寫會被推開）
  updateCinematic(dt) {
    const c = this.cinematic;
    c.t += dt;
    if (c.t < c.hold) {
      this.camera.position.copy(c.cutPos);
      this.camera.lookAt(c.cutTarget);
      return;
    }
    const s = Math.min(1, (c.t - c.hold) / c.back);
    const k = s * s * (3 - 2 * s); // 平滑起停
    this.camera.position.lerpVectors(c.cutPos, c.savedPos, k);
    const target = new THREE.Vector3().lerpVectors(c.cutTarget, c.savedTarget, k);
    this.camera.lookAt(target);
    if (s >= 1) {
      this.controls.target.copy(c.savedTarget);
      this.controls.enabled = true;
      this.cinematic = null;
      this.controls.update();
    }
  }
}

const _want = new THREE.Vector3();
