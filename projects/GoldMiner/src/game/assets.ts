// 原版素材（来源 refer/黄金矿工html5小游戏源码/images，复制到 src/assets，
// 构建时由 esbuild dataurl loader 内嵌为 data URL，产物自包含）。
// 子矩形（rect）通过连通域分析原图集测得，避免运行时裁剪。

import g1Url from '../assets/g1.png';
import g2Url from '../assets/g2.png';
import g3Url from '../assets/g3.png';
import g4Url from '../assets/g4.png';
import rockUrl from '../assets/rock.png';
import r1Url from '../assets/r1.png';
import diamondUrl from '../assets/diamond.png';
import bagUrl from '../assets/bag.png';
import boneUrl from '../assets/bone.png';
import skullUrl from '../assets/skull.png';
import tntUrl from '../assets/tnt.png';
import diamoleUrl from '../assets/diamole.png';
import hookUrl from '../assets/hook.png';
import ropehideUrl from '../assets/ropehide.png';
import ropetileUrl from '../assets/ropetile.png';
import ropepinUrl from '../assets/ropepin.png';
import winchUrl from '../assets/winch.png';
import handleUrl from '../assets/handle.png';
import groundUrl from '../assets/ground.png';
import dirtUrl from '../assets/dirt.png';
import bombUrl from '../assets/bomb.png';

export type SpriteKey =
  | 'goldS'
  | 'goldM'
  | 'goldL'
  | 'goldXL'
  | 'rockS'
  | 'rockB'
  | 'diamond'
  | 'bag'
  | 'bone'
  | 'skull'
  | 'tnt'
  | 'mole0'
  | 'mole1'
  | 'mole2'
  | 'mole3'
  | 'claw'
  | 'ropeHide'
  | 'ropeTile'
  | 'ropePin'
  | 'winch'
  | 'minerHandle'
  | 'ground'
  | 'dirt'
  | 'bomb';

export interface SpriteEntry {
  img: HTMLImageElement;
  /** 图集内的子矩形 [sx, sy, sw, sh] */
  rect: [number, number, number, number];
  ready: boolean;
}

/** diamole 图集 4 帧（两行两列，连通域实测） */
const MOLE_FRAMES: Array<[number, number, number, number]> = [
  [7, 8, 52, 41],
  [71, 8, 52, 41],
  [7, 57, 52, 41],
  [71, 57, 52, 41],
];

interface SpriteDef {
  src: string;
  rect?: [number, number, number, number];
}

const DEFS: Record<SpriteKey, SpriteDef> = {
  goldS: { src: g1Url },
  goldM: { src: g2Url },
  goldL: { src: g3Url },
  goldXL: { src: g4Url },
  rockS: { src: r1Url },
  // rock-sheet0 是多块石头的小图集，取右上最大那块
  rockB: { src: rockUrl, rect: [38, 2, 76, 62] },
  diamond: { src: diamondUrl },
  bag: { src: bagUrl },
  bone: { src: boneUrl },
  skull: { src: skullUrl },
  tnt: { src: tntUrl },
  mole0: { src: diamoleUrl, rect: MOLE_FRAMES[0] },
  mole1: { src: diamoleUrl, rect: MOLE_FRAMES[1] },
  mole2: { src: diamoleUrl, rect: MOLE_FRAMES[2] },
  mole3: { src: diamoleUrl, rect: MOLE_FRAMES[3] },
  // hook-sheet1 是爪+物品组合图集，[141,68,48,29] 是其中不带物品的裸爪（铰链在上、爪尖朝下）
  claw: { src: hookUrl, rect: [141, 68, 48, 29] },
  // 井口双绳（原版 ropehide @ (641,172)）：静态双绳环盖在摆动绳根上构成井口
  ropeHide: { src: ropehideUrl },
  // 原版绳索纹理（6x4 灰色 #8f8f8f，平铺成绳）与红色销钉（6x8）
  ropeTile: { src: ropetileUrl },
  ropePin: { src: ropepinUrl },
  // 井口装置：绞盘弹簧 + 摇柄组合（原版 scon roll/handle，绝对位置见 engine.ts）
  winch: { src: winchUrl },
  minerHandle: { src: handleUrl },
  ground: { src: groundUrl },
  dirt: { src: dirtUrl },
  bomb: { src: bombUrl, rect: [44, 38, 92, 88] },
};

export const sprites: Partial<Record<SpriteKey, SpriteEntry>> = {};

// 预加载（无 Image 的环境（如 Node 无头测试）跳过，引擎降级为矢量绘制）
const ImageCtor = (globalThis as any).Image;
if (typeof ImageCtor === 'function') {
  for (const [key, def] of Object.entries(DEFS) as Array<[SpriteKey, SpriteDef]>) {
    const img = new ImageCtor() as HTMLImageElement;
    const entry: SpriteEntry = {
      img,
      rect: def.rect ?? [0, 0, img.width || 1, img.height || 1],
      ready: false,
    };
    // rect 未指定时以自然尺寸填充（onload 后更新）
    img.onload = () => {
      if (!def.rect) entry.rect = [0, 0, img.naturalWidth || 1, img.naturalHeight || 1];
      entry.ready = true;
    };
    img.onerror = () => {
      entry.ready = false;
    };
    img.src = def.src;
    sprites[key] = entry;
  }
}

export function getSprite(key: SpriteKey): SpriteEntry | null {
  const entry = sprites[key];
  return entry && entry.ready ? entry : null;
}
