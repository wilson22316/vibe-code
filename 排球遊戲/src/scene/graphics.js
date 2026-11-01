import * as THREE from 'three';
import { GRAPHICS } from '../config.js';
import { setOutlineResolution } from '../fx/toon.js';
import { createComposer } from './postprocessing.js';

const STORAGE_KEY = 'volleyball.graphics';
const DEFAULT_MODE = 'quality';

// 畫質設定：解析度倍率、陰影解析度、光暈與調色開關。選擇會記在瀏覽器裡，下次開啟沿用。
export class Graphics {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.post = createComposer(renderer, scene, camera);
    this.sun = null;
    scene.traverse((o) => {
      if (o.isDirectionalLight && o.castShadow) this.sun = o;
    });
    this.drawingSize = new THREE.Vector2();
    this.setMode(loadMode());
  }

  get label() {
    return GRAPHICS[this.mode].label;
  }

  setMode(name) {
    const preset = GRAPHICS[name];
    this.mode = name;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, preset.maxPixelRatio));
    this.post.bloom.enabled = preset.bloom;
    this.post.grade.enabled = preset.grade;

    // 陰影貼圖換尺寸要丟掉舊的，下一幀會用新尺寸重建
    const shadow = this.sun.shadow;
    if (shadow.mapSize.x !== preset.shadowMapSize) {
      shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
      shadow.map?.dispose();
      shadow.map = null;
    }

    this.resize();
    saveMode(name);
  }

  toggle() {
    this.setMode(this.mode === 'quality' ? 'performance' : 'quality');
  }

  resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height);
    this.post.setSize(width, height, this.renderer.getPixelRatio());
    this.renderer.getDrawingBufferSize(this.drawingSize);
    setOutlineResolution(this.drawingSize.x, this.drawingSize.y);
  }

  render() {
    this.post.composer.render();
  }
}

// 瀏覽器設定可能被封鎖（無痕模式等），讀寫失敗就用預設值
function loadMode() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && saved in GRAPHICS) return saved;
  } catch {
    // 忽略
  }
  return DEFAULT_MODE;
}

function saveMode(name) {
  try {
    localStorage.setItem(STORAGE_KEY, name);
  } catch {
    // 忽略
  }
}
