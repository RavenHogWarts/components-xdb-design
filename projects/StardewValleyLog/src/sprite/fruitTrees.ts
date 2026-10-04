// fruitTrees.ts —— fruitTrees.png（432×720）解析
// 权威布局来自 1.6 反编译源码 FruitTree.draw（refer/StardewValleyDecompiled）：
// 每 strip 80px（TextureSpriteRow = strip 号，spriteRow·5·16）：
//   阶段 0-3：48×80 格 @ x=0/48/96/144
//   成熟树×4季：48×80 格 @ x=192(春)/240(夏)/288(秋)/336(冬)（树冠48×64+树干48×16）
//   落叶粒子：8×8 @ (384+season·16, k·80)（粒子特效，不展示）
//   树桩：48×32 @ (384, k·80+48)
// 果实不在这张贴图：游戏运行时把果实物品图标（springobjects）画上树冠。
// → 卡面用构建期合成的"夏季挂果树"（tree-faces.json），胶片条附果实图标格。

import { SheetSpec, SpriteEntry, SpriteRect, StripCell } from './types';
import FRUIT_TREES_RAW from '../assets/data/FruitTrees.json';
import TREE_NAMES from '../assets/data/tree-names.zh-CN.json';
import TREE_FACES from '../assets/data/tree-faces.json';
import FRUIT_TREES_PNG from '../assets/sprites/fruitTrees.png';
import SPRING_OBJECTS_PNG from '../assets/sprites/springobjects.png';

interface FruitTreeEntry {
  DisplayName?: string;
  Seasons?: string[];
  TextureSpriteRow?: number;
  Fruit?: { ItemId?: string }[];
}

/** DisplayName 占位符 → 内部键（如 Banana_Name） */
const PLACEHOLDER = /\[LocalizedText Strings\\+Objects:(.+?)\]/;

const SEASON_ZH: Record<string, string> = {
  Spring: '春',
  Summer: '夏',
  Fall: '秋',
  Winter: '冬',
};
const SEASON_ORDER = ['Spring', 'Summer', 'Fall', 'Winter'];

/** 四季成熟树的 48×80 格横坐标（spring=0 → x192） */
const SEASON_X = [192, 240, 288, 336];

let _entries: SpriteEntry[] | null = null;

function deriveEntries(): SpriteEntry[] {
  if (_entries) return _entries;
  const names = TREE_NAMES as Record<string, string>;
  const faces = TREE_FACES as Record<string, { face?: string; fruitIcon?: string }>;
  const result: SpriteEntry[] = [];

  for (const [saplingId, tree] of Object.entries(
    FRUIT_TREES_RAW as Record<string, FruitTreeEntry>
  )) {
    const k = tree.TextureSpriteRow ?? 0;
    const m = PLACEHOLDER.exec(tree.DisplayName ?? '');
    const zh = m ? names[m[1]] : undefined;
    const name = zh ? `${zh}树` : `果树 ${saplingId}`;
    const seasons = SEASON_ORDER.filter((s) => tree.Seasons?.includes(s)).map(
      (s) => SEASON_ZH[s] ?? s
    );
    const strip: StripCell[] = [];
    const cell = (x: number, y: number, w: number, h: number): StripCell => ({
      rect: { x, y, w, h } satisfies SpriteRect,
    });

    // 生长阶段 0-3（48×80 格）
    for (let i = 0; i < 4; i++) strip.push(cell(i * 48, k * 80, 48, 80));
    // 四季成熟树（春/夏/秋/冬）
    for (const x of SEASON_X) strip.push(cell(x, k * 80, 48, 80));
    // 树桩
    strip.push(cell(384, k * 80 + 48, 48, 32));
    // 果实图标（来自 springobjects，独立合成图）
    const fruitIcon = faces[saplingId]?.fruitIcon;
    if (fruitIcon) strip.push({ rect: { x: 0, y: 0, w: 16, h: 16 }, src: fruitIcon });

    // 卡面 = 构建期合成的"夏季挂果树"；缺失时退回夏季树格切片
    const composed = faces[saplingId]?.face;
    result.push({
      key: `fruitTree-${saplingId}`,
      name,
      sub: `结果季 ${seasons.join('/')}`,
      sheet: 'fruitTrees',
      rect: composed ? { x: 0, y: 0, w: 48, h: 80 } : { x: 240, y: k * 80, w: 48, h: 80 },
      src: composed,
      strip,
    });
  }
  result.sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
  _entries = result;
  return result;
}

export const fruitTreesSheet: SheetSpec = {
  id: 'fruitTrees',
  label: '果树',
  category: 'TileSheets',
  png: FRUIT_TREES_PNG,
  imgW: 432,
  imgH: 720,
  entries: deriveEntries,
};
