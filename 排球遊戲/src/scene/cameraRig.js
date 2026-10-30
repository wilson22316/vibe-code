import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CAMERA_PRESETS } from './camera.js';

const TRANSITION_TIME = 0.6; // 切換預設視角的過場秒數

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
    this.presetIndex = 0;
    this.transition = null;
    this.cinematic = null; // 衝擊特寫：暫時接管鏡頭
    this.shake = new THREE.Vector3(); // 目前疊在鏡頭上的震動
    this.applyPreset(0, true);
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
    const toPos = new THREE.Vector3(...position);
    const toTarget = new THREE.Vector3(...target);
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
    this.controls.update();

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
