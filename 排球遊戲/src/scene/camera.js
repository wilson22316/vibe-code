import * as THREE from 'three';

// 轉播視角：站在玩家方（+z）後上方，看向網子
// 高度要夠，對手半場才不會被網子擋住
const POSITION = new THREE.Vector3(0, 13, 20);
const TARGET = new THREE.Vector3(0, 0, -2);

export function createCamera() {
  const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.copy(POSITION);
  camera.lookAt(TARGET);
  return camera;
}
