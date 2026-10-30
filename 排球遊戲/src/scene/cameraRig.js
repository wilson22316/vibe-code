import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CAMERA_PRESETS } from './camera.js';

const TRANSITION_TIME = 0.6; // 切換預設視角的過場秒數
// 主畫面：從球場斜上方慢慢繞場（autoRotateSpeed 1 約 60 秒一圈）。
// 繞的半徑 15 公尺：在椰子樹（17 公尺外）和旗子（20 公尺外）裡面，繞一圈都不會被擋住
const ORBIT_VIEW = { position: [10.6, 7, 10.6], target: [0, 1, 0] };
const ORBIT_SPEED = 1;

// 鏡頭控制：滑鼠拖曳 360 度旋轉、滾輪往游標方向縮放、切換預設視角，最後疊上畫面震動
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

  // 離開主畫面：停止繞場，回到原本選的預設視角
  stopOrbit() {
    this.orbiting = false;
    this.controls.autoRotate = false;
    this.applyPreset(this.presetIndex);
  }

  // 衝擊特寫：鏡頭直接切到 position 看著 target，停 hold 秒，再用 back 秒拉回原本的視角
  cutTo(position, target, hold, back) {
    const base = this.camera.position.clone().sub(this.shake);
    this.cinematic = {
      t: 0,
      hold,
      back,
      savedPos: this.transition ? this.transition.toPos.clone() : base,
      savedTarget: this.transition ? this.transition.toTarget.clone() : this.controls.target.clone(),
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

  applyPreset(index, instant = false) {
    this.presetIndex = index;
    const { position, target } = CAMERA_PRESETS[index];
    this.moveTo(new THREE.Vector3(...position), new THREE.Vector3(...target), instant);
  }

  // 鏡頭平滑移到 toPos、看著 toTarget（instant：直接跳過去）
  moveTo(toPos, toTarget, instant = false) {
    if (instant) {
      this.camera.position.copy(toPos);
      this.controls.target.copy(toTarget);
      this.controls.update();
      return;
    }
    this.transition = {
      t: 0,
      fromPos: this.camera.position.clone().sub(this.shake),
      fromTarget: this.controls.target.clone(),
      toPos,
      toTarget,
    };
  }

  // 每幀呼叫；shakeOffset 為這一幀的震動位移；holdCinematic：暫停中，特寫計時先停住
  update(dt, shakeOffset, holdCinematic = false) {
    // 先拿掉上一幀的震動，控制器才不會把震動誤當成使用者的操作而越飄越遠
    this.camera.position.sub(this.shake);

    if (this.cinematic) {
      this.updateCinematic(holdCinematic ? 0 : dt);
      this.shake.copy(shakeOffset);
      this.camera.position.add(this.shake);
      return;
    }

    if (this.transition) {
      const tr = this.transition;
      tr.t = Math.min(1, tr.t + dt / TRANSITION_TIME);
      const k = tr.t * tr.t * (3 - 2 * tr.t); // 平滑起停
      this.camera.position.lerpVectors(tr.fromPos, tr.toPos, k);
      this.controls.target.lerpVectors(tr.fromTarget, tr.toTarget, k);
      if (tr.t >= 1) this.transition = null;
    }
    this.controls.autoRotate = this.orbiting && !this.transition; // 移到定位後才開始繞
    this.controls.update(dt); // 傳 dt：繞場速度不受幀率影響

    this.shake.copy(shakeOffset);
    this.camera.position.add(this.shake);
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
