import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

// 光暈只讓最亮的地方（白色物件、陽光直射面）微微發光；半徑太大會在角色周圍的沙地暈出一圈亮斑
const BLOOM = { strength: 0.2, radius: 0.1, threshold: 1.2 };

// 色調：在最終畫面（sRGB）上加一點飽和、對比與暖色，讓陽光感更強
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    saturation: { value: 1.05 },
    contrast: { value: 1.05 },
    warmth: { value: 0.01 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float saturation;
    uniform float contrast;
    uniform float warmth;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float luma = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb = mix(vec3(luma), c.rgb, saturation);
      c.rgb = (c.rgb - 0.5) * contrast + 0.5;
      c.rgb += vec3(warmth, warmth * 0.4, -warmth);
      gl_FragColor = vec4(clamp(c.rgb, 0.0, 1.0), c.a);
    }
  `,
};

// 畫面流程：場景 → 光暈 → 色調映射與 sRGB（OutputPass）→ 調色 → 抗鋸齒（FXAA）
// 抗鋸齒不用 MSAA：實測在內顯（Intel UHD 630）上 4 倍 MSAA 的後製緩衝每幀多花約 20ms，FXAA 只要 1ms 左右。
// 光暈與調色可以個別關掉（效能優先模式）。
export function createComposer(renderer, scene, camera) {
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), BLOOM.strength, BLOOM.radius, BLOOM.threshold);
  const grade = new ShaderPass(GradeShader);
  const fxaa = new ShaderPass(FXAAShader);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  composer.addPass(grade);
  composer.addPass(fxaa);

  return {
    composer,
    bloom,
    grade,
    // width、height 為 CSS 像素
    setSize(width, height, pixelRatio) {
      composer.setPixelRatio(pixelRatio);
      composer.setSize(width, height);
      fxaa.material.uniforms.resolution.value.set(1 / (width * pixelRatio), 1 / (height * pixelRatio));
    },
  };
}
