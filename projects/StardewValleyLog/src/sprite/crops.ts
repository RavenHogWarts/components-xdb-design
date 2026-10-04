// crops.ts —— crops.png（256×1024）解析
// 切片模型（像素扫描验证，见 docs/assets-and-parsing.md 第 4 节）：
//   两大列布局；每个 SpriteIndex 占 2 行（baseRow = ⌊si/2⌋×2）；
//   每个阶段取完整 2 行块（16×32）：16px 单高阶段画在底行，双高阶段跨两行，
//   顶部的空白是透明的——整块切片保证任何阶段都不会被裁剪。

import { SheetSpec, SpriteEntry, SpriteRect, StripCell } from './types';
import CROPS_RAW from '../assets/data/Crops.json';
import CROP_NAMES from '../assets/data/crop-names.zh-CN.json';
import CROP_FACES from '../assets/data/crop-faces.json';
import CROPS_PNG from '../assets/sprites/crops.png';

interface CropsEntry {
  Seasons?: string[];
  DaysInPhase?: number[];
  RegrowDays?: number;
  IsRaised?: boolean;
  HarvestItemId?: string;
  HarvestMethod?: string;
  Texture?: string;
  SpriteIndex?: number;
}

/** SpriteIndex 第 i 阶段的完整切片（16×32 块，顶行透明属于正常） */
export function cropStageRect(spriteIndex: number, i: number): SpriteRect {
  const pairIdx = Math.floor(spriteIndex / 2);
  const baseRow = pairIdx * 2;
  const colOffset = spriteIndex % 2 === 0 ? 0 : 8;
  return { x: (colOffset + i) * 16, y: baseRow * 16, w: 16, h: 32 };
}

const SEASON_ZH: Record<string, string> = {
  Spring: '春',
  Summer: '夏',
  Fall: '秋',
  Winter: '冬',
};

const SEASON_ORDER = ['Spring', 'Summer', 'Fall', 'Winter'];

let _entries: SpriteEntry[] | null = null;

function deriveEntries(): SpriteEntry[] {
  if (_entries) return _entries;
  const data = CROPS_RAW as Record<string, CropsEntry>;
  const result: SpriteEntry[] = [];

  for (const [seedId, crop] of Object.entries(data)) {
    // 防御：非标准作物贴图的条目（当前 50/50 均为标准贴图）
    if (crop.Texture && !crop.Texture.toLowerCase().includes('crops')) continue;

    const si = crop.SpriteIndex ?? 0;
    const days = crop.DaysInPhase ?? [];
    const pc = days.length;
    const hid = String(crop.HarvestItemId ?? '');
    const name = (CROP_NAMES as Record<string, string>)[hid] ?? `作物 ${hid}`;
    const seasons = SEASON_ORDER.filter((s) => crop.Seasons?.includes(s)).map(
      (s) => SEASON_ZH[s] ?? s
    );
    const growthDays = days.reduce((a, b) => a + b, 0);
    const regrow = crop.RegrowDays && crop.RegrowDays > 0 ? ` · 再生${crop.RegrowDays}天` : '';
    // 卡面阶段与状态数按贴图像素实测（见 derive-catalog.mjs）：
    // 状态数可能大于 DaysInPhase 推导值（如啤酒花 8 态 vs pc+2=7）；
    // 花类（TintColors）末列是白色花冠，构建期已按官方色着色合成完整花
    const derived = (CROP_FACES as Record<string, { f: number; s: number; imgs?: string[] }>)[
      seedId
    ];
    const stageCount = derived?.s ?? pc + 2;
    const faceStage = derived?.f ?? pc;
    const imgs = derived?.imgs;

    const strip: StripCell[] = Array.from({ length: stageCount }, (_, i) => ({
      rect: cropStageRect(si, i),
    }));
    // 花类：胶片条末尾追加各色完整花（植株+着色花冠合成图）
    for (const src of imgs ?? []) strip.push({ rect: { x: 0, y: 0, w: 16, h: 32 }, src });

    result.push({
      key: `crop-${seedId}`,
      name,
      sub: `${seasons.join('/')} · 生长${growthDays}天${regrow}`,
      sheet: 'crops',
      rect: imgs ? { x: 0, y: 0, w: 16, h: 32 } : cropStageRect(si, faceStage),
      src: imgs?.[0],
      strip,
    });
  }
  result.sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
  _entries = result;
  return result;
}

export const cropsSheet: SheetSpec = {
  id: 'crops',
  label: '作物',
  category: 'TileSheets',
  png: CROPS_PNG,
  imgW: 256,
  imgH: 1024,
  entries: deriveEntries,
};
