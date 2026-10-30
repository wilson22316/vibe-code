import * as THREE from 'three';

export function createLights() {
  const group = new THREE.Group();

  const hemi = new THREE.HemisphereLight(0xbfe6ff, 0xf2d6a2, 1.4);

  const sun = new THREE.DirectionalLight(0xfff1d8, 2.6);
  sun.position.set(10, 22, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0005;
  Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 70 });

  group.add(hemi, sun);
  return group;
}
