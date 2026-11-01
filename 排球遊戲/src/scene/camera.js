import * as THREE from 'three';

// 預設視角（C 鍵切換）：position 為鏡頭位置、target 為看的點。
// 第一個是比賽用的轉播視角：站在玩家方（+z）後上方，高度要夠，對手半場才不會被網子擋住
export const CAMERA_PRESETS = [
  { name: '轉播視角', position: [0, 13, 20], target: [0, 0, -2] },
  { name: '近景視角', position: [0, 2.2, 1.0], target: [0, 1.2, 6.5] }, // 從網前回頭看我方，平常看不到的正面
  { name: '側面視角', position: [15, 7.5, 0], target: [0, 0.8, 0] }, // 再遠會被椰子樹擋住
  { name: '俯瞰視角', position: [0, 24, 2.5], target: [0, 0, 0] },
];

export function createCamera() {
  const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 1000);
  const { position, target } = CAMERA_PRESETS[0];
  camera.position.set(...position);
  camera.lookAt(...target);
  return camera;
}
