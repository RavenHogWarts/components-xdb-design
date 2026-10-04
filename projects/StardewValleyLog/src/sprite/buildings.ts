// buildings.ts —— Buildings/ 建筑图鉴（Data/Buildings.json 全量，Farmhouse 除外）
// 解析权威依据（1.6 反编译源码 + Buildings.json）：
//   Building.getSourceRect()：SourceRect 空则整图；Cabin 随升级横向偏移 ×3；
//     Greenhouse 完好(sr)/破损(Y−H) 两态；阴影 = GreenhouseBuilding.shadow_rectangle(112,0,128,144)。
//   Buildings.json DrawLayers：附加绘制层（Barn 族 4 个动物门状态、Coop 族 2 个、
//     Mill 风车帆叶 10 帧格 + 传动轴 7 帧、Pet Bowl 背景层），r 即层矩形。
//   专属 getSourceRectForMenu()：FishPond (0,0,80,80)、JunimoHut (季节×48,0,48,64)。
//   PetBowl.draw：盛水覆盖层在 SourceRect.X + Width。
// 未被源码引用的贴图遗留区（Mill 右下大片、FishPond 右下、Pet Bowl 下三行）不展示。

import { SheetSpec, SpriteEntry, SpriteRect } from './types';
import BUILDINGS_INDEX from '../assets/data/buildings-index.json';

import B_JUNIMO_HUT from '../assets/sprites/Junimo Hut.png';
import B_EARTH_OBELISK from '../assets/sprites/Earth Obelisk.png';
import B_WATER_OBELISK from '../assets/sprites/Water Obelisk.png';
import B_DESERT_OBELISK from '../assets/sprites/Desert Obelisk.png';
import B_ISLAND_OBELISK from '../assets/sprites/Island Obelisk.png';
import B_GOLD_CLOCK from '../assets/sprites/Gold Clock.png';
import B_COOP from '../assets/sprites/Coop.png';
import B_BARN from '../assets/sprites/Barn.png';
import B_WELL from '../assets/sprites/Well.png';
import B_SILO from '../assets/sprites/Silo.png';
import B_MILL from '../assets/sprites/Mill.png';
import B_SHED from '../assets/sprites/Shed.png';
import B_FISH_POND from '../assets/sprites/Fish Pond.png';
import B_STONE_CABIN from '../assets/sprites/Stone Cabin.png';
import B_PET_BOWL from '../assets/sprites/Pet Bowl.png';
import B_STABLE from '../assets/sprites/Stable.png';
import B_SLIME_HUTCH from '../assets/sprites/Slime Hutch.png';
import B_BIG_COOP from '../assets/sprites/Big Coop.png';
import B_DELUXE_COOP from '../assets/sprites/Deluxe Coop.png';
import B_BIG_BARN from '../assets/sprites/Big Barn.png';
import B_DELUXE_BARN from '../assets/sprites/Deluxe Barn.png';
import B_BIG_SHED from '../assets/sprites/Big Shed.png';
import B_SHIPPING_BIN from '../assets/sprites/Shipping Bin.png';
import B_GREENHOUSE from '../assets/sprites/Greenhouse.png';

/** 贴图文件 → dataURL + 原始尺寸 */
const PNG: Record<string, { png: string; w: number; h: number }> = {
  'Junimo Hut.png': { png: B_JUNIMO_HUT, w: 256, h: 64 },
  'Earth Obelisk.png': { png: B_EARTH_OBELISK, w: 48, h: 128 },
  'Water Obelisk.png': { png: B_WATER_OBELISK, w: 48, h: 128 },
  'Desert Obelisk.png': { png: B_DESERT_OBELISK, w: 48, h: 128 },
  'Island Obelisk.png': { png: B_ISLAND_OBELISK, w: 48, h: 128 },
  'Gold Clock.png': { png: B_GOLD_CLOCK, w: 48, h: 80 },
  'Coop.png': { png: B_COOP, w: 96, h: 128 },
  'Barn.png': { png: B_BARN, w: 112, h: 128 },
  'Well.png': { png: B_WELL, w: 48, h: 80 },
  'Silo.png': { png: B_SILO, w: 48, h: 128 },
  'Mill.png': { png: B_MILL, w: 224, h: 128 },
  'Shed.png': { png: B_SHED, w: 112, h: 128 },
  'Fish Pond.png': { png: B_FISH_POND, w: 160, h: 176 },
  'Stone Cabin.png': { png: B_STONE_CABIN, w: 240, h: 112 },
  'Pet Bowl.png': { png: B_PET_BOWL, w: 96, h: 128 },
  'Stable.png': { png: B_STABLE, w: 64, h: 96 },
  'Slime Hutch.png': { png: B_SLIME_HUTCH, w: 112, h: 112 },
  'Big Coop.png': { png: B_BIG_COOP, w: 96, h: 128 },
  'Deluxe Coop.png': { png: B_DELUXE_COOP, w: 96, h: 128 },
  'Big Barn.png': { png: B_BIG_BARN, w: 112, h: 128 },
  'Deluxe Barn.png': { png: B_DELUXE_BARN, w: 112, h: 128 },
  'Big Shed.png': { png: B_BIG_SHED, w: 112, h: 128 },
  'Shipping Bin.png': { png: B_SHIPPING_BIN, w: 32, h: 32 },
  'Greenhouse.png': { png: B_GREENHOUSE, w: 240, h: 320 },
};

interface LayerInfo {
  id: string;
  r: [number, number, number, number];
  fc: number;
  fpr: number;
}
interface BuildingInfo {
  f: string;
  n: string;
  sr: [number, number, number, number] | null;
  dl: LayerInfo[];
}

const INDEX = BUILDINGS_INDEX as unknown as Record<string, BuildingInfo>;

const rect = (r: [number, number, number, number]): SpriteRect => ({
  x: r[0],
  y: r[1],
  w: r[2],
  h: r[3],
});

interface Part {
  rect: SpriteRect;
  label?: string;
}

/** 特殊建筑的组成区块（源码权威矩形，见文件头注释）；无条目 = 走通用 DrawLayers */
const EXTRA_PARTS: Record<string, () => Part[]> = {
  'Junimo Hut': () =>
    ['春', '夏', '秋', '冬'].map((s, i) => ({
      rect: { x: i * 48, y: 0, w: 48, h: 64 },
      label: `${s}季外观`,
    })),
  'Fish Pond': () => [
    { rect: { x: 80, y: 0, w: 80, h: 48 }, label: '后沿' },
    { rect: { x: 0, y: 80, w: 80, h: 80 }, label: '水下基底' },
    { rect: { x: 16, y: 160, w: 48, h: 7 }, label: '波光' },
  ],
  Greenhouse: () => [
    { rect: { x: 0, y: 0, w: 112, h: 160 }, label: '破损态' },
    { rect: { x: 112, y: 0, w: 128, h: 144 }, label: '阴影' },
  ],
  Cabin: () => [1, 2].map((lv) => ({
    rect: { x: lv * 80, y: 0, w: 80, h: 112 },
    label: `升级 Lv.${lv + 1}`,
  })),
  'Pet Bowl': () => [
    { rect: { x: 64, y: 0, w: 32, h: 32 }, label: '盛水态' },
    { rect: { x: 0, y: 0, w: 32, h: 32 }, label: '背景层' },
  ],
};

/** 卡面矩形覆盖：专属 getSourceRectForMenu 优先于 SourceRect/整图 */
const CARD_OVERRIDE: Record<string, [number, number, number, number]> = {
  'Junimo Hut': [0, 0, 48, 64], // 春季（菜单卡面）
  'Fish Pond': [0, 0, 80, 80], // getSourceRectForMenu
};

let _entries: SpriteEntry[] | null = null;

function deriveEntries(): SpriteEntry[] {
  if (_entries) return _entries;
  const out: SpriteEntry[] = [];
  for (const [type, info] of Object.entries(INDEX)) {
    const img = PNG[info.f];
    if (!img) continue; // 素材未内联（防御）
    const source = { png: img.png, imgW: img.w, imgH: img.h };
    const card = CARD_OVERRIDE[type] ?? info.sr ?? [0, 0, img.w, img.h];
    const cardRect = rect(card as [number, number, number, number]);

    const parts: Part[] = [{ rect: cardRect, label: '主体' }];
    const extra = EXTRA_PARTS[type]?.() ?? null;
    if (extra) {
      parts.push(...extra);
    } else {
      for (const layer of info.dl)
        parts.push({ rect: rect(layer.r), label: `层 ${layer.id.replace(/^Default_/, '')}` });
    }

    const notes: string[] = [
      `${cardRect.w}×${cardRect.h}${info.sr || CARD_OVERRIDE[type] ? '' : ' 整图'}`,
    ];
    if (extra) notes.push(`${parts.length - 1} 个组成区块`);
    else if (info.dl.length) notes.push(`${info.dl.length} 个绘制层`);

    out.push({
      key: `building-${type}`,
      name: info.n,
      sub: notes.join(' · '),
      sheet: 'buildings' as const,
      source,
      scale: 1, // 贴图本身较大，原尺寸展示
      rect: cardRect,
      strip: parts.map((p) => ({ rect: p.rect, source, label: p.label })),
    });
  }
  _entries = out;
  return out;
}

/**
 * 建筑子页：单 spec 承载多张贴图 —— 全部条目走独立 src（SpriteCell 支持）。
 */
export const farmBuildingsSheet: SheetSpec = {
  id: 'buildings',
  label: '农场建筑',
  category: 'Buildings',
  png: B_BARN,
  imgW: 112,
  imgH: 128,
  entries: deriveEntries,
};
