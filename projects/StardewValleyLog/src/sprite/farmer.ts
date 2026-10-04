// farmer.ts —— Characters/ 人物创建素材图鉴（性别/肤色/发型/配色/上衣/裤子/配件）
// 切片公式全部依据 1.6 反编译源码：
//   drawMiniPortrat：底图朝向行 y+0(下)/+32(侧)/+64(上)，左侧 = 侧向翻转；
//   drawHairAndAccesories：发型 16×96 列条（含 HairData 扩展 tileX/tileY 定位）、
//     上衣 8×8 × 前(+0)/侧(+8)/上(+24)、x+128 为染色层（不可染色上衣为空）、
//     配件 16×32 前(+0)/侧(+16)，0-7 号画在头发下层、6-7 号胡子按发色染色；
//   draw：裤子 192×688 块（男左 96 / 女右 96），帧位置与底图一致；
//   ApplySkinColor：skinColors.png 每行 = 暗/中/亮 3 色（标记色 260-262）；
//   ColorPicker：发色/眼色/裤色共用 HSV 三条 24 段滑杆，无贴图，色板按其
//     HsvToRgb 运行时采样生成（饱和 0.9，明度 1.0→0.3）。

import { SheetSpec, SpriteEntry, SpriteRect } from './types';
import FARMER_BASE from '../assets/sprites/farmer_base.png';
import FARMER_GIRL_BASE from '../assets/sprites/farmer_girl_base.png';
import HAIRSTYLES_PNG from '../assets/sprites/hairstyles.png';
import HAIRSTYLES2_PNG from '../assets/sprites/hairstyles2.png';
import SHIRTS_PNG from '../assets/sprites/shirts.png';
import PANTS_PNG from '../assets/sprites/pants.png';
import ACCESSORIES_PNG from '../assets/sprites/accessories.png';
import SKIN_COLORS_PNG from '../assets/sprites/skinColors.png';
import FARMER_INDEX from '../assets/data/farmer-index.json';

interface FarmerIndex {
  skinCount: number;
  hairBase: number;
  hairExtra: { id: number; texture: string; tx: number; ty: number; bald: boolean; left: boolean }[];
  shirts: { id: string; i: number; n: string; sleeves: boolean; dye: boolean; p: number }[];
  pants: { id: string; i: number; n: string; dye: boolean; p: number }[];
}

const IDX = FARMER_INDEX as FarmerIndex;

const BASE_W = 288;
const BASE_H = 672;
/** drawMiniPortrat：底图朝向行（下/侧/上；左侧为侧向翻转） */
const DIRECTION_ROWS = [0, 32, 64];

// ── 性别：基础帧表（男/女各一张，288×672，调色板标记色在运行时换色）──

export const farmerBaseSheet: SheetSpec = {
  id: 'farmer',
  label: '性别',
  category: 'Characters',
  png: FARMER_BASE,
  imgW: BASE_W,
  imgH: BASE_H,
  entries: () =>
    [
      { key: 'farmer-male', name: '男性', png: FARMER_BASE },
      { key: 'farmer-female', name: '女性', png: FARMER_GIRL_BASE },
    ].map((v) => ({
      key: v.key,
      name: v.name,
      sub: '基础帧表 288×672：16×32 帧，下/侧/上（左 = 侧向翻转）',
      sheet: 'farmer' as const,
      source: { png: v.png, imgW: BASE_W, imgH: BASE_H },
      rect: { x: 0, y: 0, w: 16, h: 32 },
      strip: DIRECTION_ROWS.map((y) => ({
        rect: { x: 0, y, w: 16, h: 32 },
        source: { png: v.png, imgW: BASE_W, imgH: BASE_H },
      })),
    })),
};

// ── 肤色：skinColors.png 3×24，每行 = 暗/中/亮 3 阶 ──

export const skinSheet: SheetSpec = {
  id: 'farmer',
  label: '肤色',
  category: 'Characters',
  png: SKIN_COLORS_PNG,
  imgW: 3,
  imgH: IDX.skinCount,
  entries: () =>
    Array.from({ length: IDX.skinCount }, (_, i) => ({
      key: `skin-${i}`,
      name: `肤色 ${i + 1}`,
      sub: '单行 3 阶（暗/中/亮，替换底图标记色 260-262）',
      sheet: 'farmer' as const,
      scale: 12,
      rect: { x: 0, y: i, w: 3, h: 1 },
    })),
};

// ── 发型：基础 56（16×96 列条 ×8/行）+ HairData 扩展（hairstyles2.png tile 定位）──

export const hairSheet: SheetSpec = {
  id: 'farmer',
  label: '发型',
  category: 'Characters',
  png: HAIRSTYLES_PNG,
  imgW: 128,
  imgH: 672,
  entries: () => {
    const entries: SpriteEntry[] = [];
    for (let i = 0; i < IDX.hairBase; i++) {
      const x = (i % 8) * 16;
      const y = Math.floor(i / 8) * 96;
      entries.push({
        key: `hair-${i}`,
        name: `发型 ${i + 1}`,
        group: '基础（hairstyles）',
        sub: '下/侧/上 3 向（左 = 侧向翻转）',
        sheet: 'farmer',
        rect: { x, y, w: 16, h: 32 },
        strip: DIRECTION_ROWS.map((dy) => ({ rect: { x, y: y + dy, w: 16, h: 32 } })),
      });
    }
    for (const h of IDX.hairExtra) {
      const x = h.tx * 16;
      const y = h.ty * 16;
      const source = { png: HAIRSTYLES2_PNG, imgW: 128, imgH: 672 };
      // usesUniqueLeftSprite 时第 4 行为左侧专用帧（源码 case 3 offset +96）
      const rows = [0, 32, 64, ...(h.left ? [96] : [])];
      entries.push({
        key: `hair-${h.id}`,
        name: `发型 ${h.id}`,
        group: '扩展（HairData，hairstyles2）',
        sub: h.bald ? '光头型 · id ' + h.id : `HairData 扩展 · id ${h.id}`,
        sheet: 'farmer',
        source,
        rect: { x, y, w: 16, h: 32 },
        strip: rows.map((dy) => ({ rect: { x, y: y + dy, w: 16, h: 32 }, source })),
      });
    }
    return entries;
  },
};

// ── 配色：发色/眼色/裤色共用 ColorPicker（HSV 三条 24 段滑杆，无贴图）──
// 按源码 HsvToRgb 采样：24 色相 × 8 明度（饱和 0.9）；卡片取第 2 行（v=0.9）
// = 游戏色相条原色。

export function hsvToRgb(hue: number, saturation: number, value: number): [number, number, number] {
  if (value <= 0) return [0, 0, 0];
  if (saturation <= 0) {
    const c = Math.round(value * 255);
    return [c, c, c];
  }
  const h = ((hue % 360) + 360) % 360;
  const num = h / 60;
  const i = Math.floor(num);
  const f = num - i;
  const pv = value * (1 - saturation);
  const qv = value * (1 - saturation * f);
  const tv = value * (1 - saturation * (1 - f));
  let r: number, g: number, b: number;
  switch (i) {
    case 0: r = value; g = tv; b = pv; break;
    case 1: r = qv; g = value; b = pv; break;
    case 2: r = pv; g = value; b = tv; break;
    case 3: r = pv; g = qv; b = value; break;
    case 4: r = tv; g = pv; b = value; break;
    default: r = value; g = pv; b = qv; break;
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

const HUES = 24;
const SHADES = 8;
const CELL = 4;
const toHex = ([r, g, b]: [number, number, number]) =>
  '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');

const COLOR_GRID_PNG = (() => {
  const rects: string[] = [];
  for (let h = 0; h < HUES; h++) {
    for (let j = 0; j < SHADES; j++) {
      const [r, g, b] = hsvToRgb((h / HUES) * 360, 0.9, 1 - j * 0.1);
      rects.push(
        `<rect x="${h * CELL}" y="${j * CELL}" width="${CELL}" height="${CELL}" fill="${toHex([r, g, b])}"/>`
      );
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${HUES * CELL}" height="${SHADES * CELL}">${rects.join('')}</svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
})();

export const colorSheet: SheetSpec = {
  id: 'farmer',
  label: '配色',
  category: 'Characters',
  png: COLOR_GRID_PNG,
  imgW: HUES * CELL,
  imgH: SHADES * CELL,
  entries: () =>
    Array.from({ length: HUES }, (_, h) => {
      const hex = toHex(hsvToRgb((h / HUES) * 360, 0.9, 0.9));
      return {
        key: `hue-${h}`,
        name: `色相 ${h + 1}`,
        sub: `${hex} · 发/眼/裤共用 HSV 取色采样（饱和 0.9，明度 1.0→0.3）`,
        sheet: 'farmer' as const,
        scale: 8,
        rect: { x: h * CELL, y: CELL, w: CELL, h: CELL },
        strip: Array.from({ length: SHADES }, (_, j) => ({
          rect: { x: h * CELL, y: j * CELL, w: CELL, h: CELL },
        })),
      };
    }),
};

// ── 上衣：shirts.png 256×608，每款 8×32 列条（前+0/侧+8/上+24），x+128 染色层 ──

export const shirtsSheet: SheetSpec = {
  id: 'farmer',
  label: '上衣',
  category: 'Characters',
  png: SHIRTS_PNG,
  imgW: 256,
  imgH: 608,
  entries: () =>
    IDX.shirts.map((s) => {
      const x = (s.i * 8) % 128;
      const y = Math.floor((s.i * 8) / 128) * 32;
      const flags = [s.sleeves ? '有袖' : '无袖', s.dye ? '可染色' : null]
        .filter(Boolean)
        .join(' · ');
      return {
        key: `shirt-${s.id}`,
        name: s.n,
        sub: `$${s.p}${flags ? ' · ' + flags : ''}`,
        sheet: 'farmer' as const,
        scale: 4,
        rect: { x, y, w: 8, h: 8 },
        strip: [0, 8, 24].map((dy) => ({ rect: { x, y: y + dy, w: 8, h: 8 } })),
      };
    }),
};

// ── 裤子：pants.png，每款 192×688 块（男左 96 / 女右 96），帧位置同底图 ──

export const pantsSheet: SheetSpec = {
  id: 'farmer',
  label: '裤子',
  category: 'Characters',
  png: PANTS_PNG,
  imgW: 1920,
  imgH: 1376,
  entries: () =>
    IDX.pants.map((p) => {
      const bx = (p.i % 10) * 192;
      const by = Math.floor(p.i / 10) * 688;
      return {
        key: `pants-${p.id}`,
        name: p.n,
        sub: `$${p.p}${p.dye ? ' · 可染色' : ''} · 裤色乘法染色`,
        sheet: 'farmer' as const,
        rect: { x: bx, y: by, w: 16, h: 32 },
        strip: [
          { rect: { x: bx, y: by, w: 16, h: 32 } },
          { rect: { x: bx, y: by + 32, w: 16, h: 32 } },
          { rect: { x: bx, y: by + 64, w: 16, h: 32 } },
          { rect: { x: bx + 96, y: by, w: 16, h: 32 } },
        ],
      };
    }),
};

// ── 配件：accessories.png 128×128，每个 16×32（前+0/侧+16）──
// 0-7 号画在头发下层（6-7 号为胡子、按发色染色），8+ 号画在头发上层。

export const accessoriesSheet: SheetSpec = {
  id: 'farmer',
  label: '配件',
  category: 'Characters',
  png: ACCESSORIES_PNG,
  imgW: 128,
  imgH: 128,
  entries: () =>
    Array.from({ length: 30 }, (_, i) => {
      const x = (i * 16) % 128;
      const y = Math.floor((i * 16) / 128) * 32;
      const facial = i >= 6 && i < 8;
      return {
        key: `acc-${i}`,
        name: facial ? `胡子 ${i - 5}` : `配件 ${i}`,
        group: i < 8 ? '发下层（0-7）' : '发上层（8-29）',
        sub: facial ? '胡子 · 按发色染色' : i < 8 ? '绘制于头发下层' : '绘制于头发上层',
        sheet: 'farmer' as const,
        rect: { x, y, w: 16, h: 16 },
        strip: [
          { rect: { x, y, w: 16, h: 16 } },
          { rect: { x, y: y + 16, w: 16, h: 16 } },
        ],
      };
    }),
};
