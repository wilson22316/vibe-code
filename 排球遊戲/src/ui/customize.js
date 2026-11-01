import * as THREE from 'three';
import { TEAMS } from '../config.js';
import { ACCESSORIES, HAIR_STYLES } from '../entities/characterModel.js';

const STORAGE_KEY = 'volleyball.look';
const HAIR_STYLE_NAMES = { short: '短髮', spiky: '刺蝟頭', ponytail: '馬尾', bun: '包頭', bob: '鮑伯頭' };
const ACCESSORY_NAMES = { none: '無', headband: '頭帶', sunglasses: '太陽眼鏡' };
// 球衣不放藍色系：對手穿藍色，撞色會分不清哪一隊
const SHIRTS = [
  [0xff6b4a, '珊瑚紅'], [0xe63946, '正紅'], [0xff9f1c, '橘色'], [0xffc93c, '黃色'],
  [0x2fbf4f, '綠色'], [0x14b8a6, '青綠'], [0xff70a6, '粉紅'], [0x2b2d42, '黑色'],
];
const HAIRS = [
  [0x3b2a20, '深棕'], [0x1f1f2e, '黑色'], [0x8b5a2b, '栗色'], [0xe0a33a, '金色'],
  [0xc4473a, '紅色'], [0xe8e8f0, '銀白'], [0x4d7cff, '藍色'], [0xff70a6, '粉紅'],
];
const SKINS = [
  [0xffe0c4, '白皙'], [0xffd7b5, '淺膚'], [0xf1c08f, '小麥'], [0xe7b48a, '健康'], [0xc68642, '古銅'], [0x8d5524, '深色'],
];
const COLORS = { shirt: SHIRTS, hair: HAIRS, skin: SKINS };

// 預覽：我方兩人並排站在自己場上、面向鏡頭（背景是球網和海）
const PREVIEW_SPOTS = [[-0.75, 6.5], [0.75, 6.5]];
export const PREVIEW_VIEW = { position: [0, 1.6, 10.2], target: [0, 1.05, 6.5] };
const HOP = 0.25; // 換了外觀的那個人小跳一下

// 我方外觀：{ shirt, members: [{ skin, hair, hairStyle, accessory }, …] }。讀不到或格式不對就用 config 的預設
export function loadTeamLook() {
  const look = defaultLook();
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (Number.isInteger(saved?.shirt)) look.shirt = saved.shirt;
    look.members.forEach((m, i) => {
      const s = saved?.members?.[i];
      if (!s) return;
      if (Number.isInteger(s.skin)) m.skin = s.skin;
      if (Number.isInteger(s.hair)) m.hair = s.hair;
      if (HAIR_STYLES.includes(s.hairStyle)) m.hairStyle = s.hairStyle;
      if (ACCESSORIES.includes(s.accessory)) m.accessory = s.accessory;
    });
  } catch {
    // 沒存過、格式壞掉或瀏覽器封鎖儲存：用預設
  }
  return look;
}

function defaultLook() {
  const home = TEAMS.home;
  return {
    shirt: home.shirt,
    members: home.members.map(({ skin, hair, hairStyle, accessory }) => ({ skin, hair, hairStyle, accessory })),
  };
}

function saveTeamLook(look) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(look));
  } catch {
    // 忽略
  }
}

// 角色自訂畫面：左右鍵換選項，改了馬上套用在場上的角色並存起來
export class Customizer {
  // players：我方兩人；menu：用來更新選項右邊顯示的值
  constructor(players, menu) {
    this.players = players;
    this.menu = menu;
    this.look = loadTeamLook();
    this.member = 0; // 正在改第幾個人
    this.active = false;
    this.cameraPos = new THREE.Vector3(...PREVIEW_VIEW.position);
    // 腳下的圈：標出正在改的是誰
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.45, 0.58, 40),
      new THREE.MeshBasicMaterial({ color: 0xffe14d, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.visible = false;
    setHomeColor(this.look.shirt);
  }

  // 進入自訂畫面：兩人站到預覽位置看著鏡頭
  enter() {
    this.active = true;
    this.players.forEach((p, i) => {
      p.resetTo(...PREVIEW_SPOTS[i]);
      p.facing = this.cameraPos;
    });
    this.marker.visible = true;
    this.refresh();
  }

  exit() {
    this.active = false;
    for (const p of this.players) p.facing = null;
    this.marker.visible = false;
  }

  // key：'member'（換人）、'hairStyle'、'accessory'、'hair'、'skin'、'shirt'（全隊）；dir：1 下一個、-1 上一個
  change(key, dir) {
    if (key === 'member') {
      this.member = (this.member + dir + this.players.length) % this.players.length;
      this.players[this.member].playJump(HOP);
      this.refresh();
      return;
    }
    if (key === 'shirt') {
      this.look.shirt = cycle(SHIRTS.map(([c]) => c), this.look.shirt, dir);
      setHomeColor(this.look.shirt);
      this.players.forEach((p, i) => this.apply(i));
    } else {
      const m = this.look.members[this.member];
      const list = key === 'hairStyle' ? HAIR_STYLES : key === 'accessory' ? ACCESSORIES : COLORS[key].map(([c]) => c);
      m[key] = cycle(list, m[key], dir);
      this.apply(this.member);
    }
    saveTeamLook(this.look);
    this.refresh();
  }

  reset() {
    this.look = defaultLook();
    setHomeColor(this.look.shirt);
    this.players.forEach((p, i) => this.apply(i));
    saveTeamLook(this.look);
    this.refresh();
  }

  apply(i) {
    const p = this.players[i];
    p.setLook({ ...this.look.members[i], shirt: this.look.shirt });
    p.playJump(HOP);
  }

  // 更新選單上顯示的值，腳下的圈移到正在改的人
  refresh() {
    const m = this.look.members[this.member];
    const p = this.players[this.member];
    this.menu.setValue('member', `${p.look.number} 號`);
    this.menu.setValue('hairStyle', HAIR_STYLE_NAMES[m.hairStyle]);
    this.menu.setValue('accessory', ACCESSORY_NAMES[m.accessory]);
    this.menu.setValue('hair', colorName(HAIRS, m.hair), m.hair);
    this.menu.setValue('skin', colorName(SKINS, m.skin), m.skin);
    this.menu.setValue('shirt', colorName(SHIRTS, this.look.shirt), this.look.shirt);
    this.marker.position.set(p.pos.x, 0.03, p.pos.z);
  }
}

// 在 list 裡從 current 往 dir 方向移一格（頭尾相接）；current 不在清單裡就從頭開始
function cycle(list, current, dir) {
  const i = list.indexOf(current);
  if (i < 0) return list[0];
  return list[(i + dir + list.length) % list.length];
}

function colorName(palette, color) {
  return palette.find(([c]) => c === color)?.[1] ?? '自訂';
}

// 記分板上我方的顏色跟著球衣
function setHomeColor(color) {
  document.documentElement.style.setProperty('--home-color', `#${color.toString(16).padStart(6, '0')}`);
}
