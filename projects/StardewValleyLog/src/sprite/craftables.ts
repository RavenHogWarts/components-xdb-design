// craftables.ts —— Craftables.png（128×1472，8 列 16×32）解析
// 公式（1.6 源码 Object.getSourceRectForBigCraftable）：
//   x=(idx%8)*16, y=⌊idx/8⌋*32；命名链 BigCraftables.json → Strings/BigCraftables.zh-CN.json。

import { SheetSpec, SpriteEntry } from './types';
import CRAFTABLES_INDEX from '../assets/data/craftables-index.json';
import CRAFTABLES_PNG from '../assets/sprites/Craftables.png';

interface CraftableIndexItem {
  i: number;
  n: string;
  p: number;
}

const COLS = 8;

let _entries: SpriteEntry[] | null = null;

function deriveEntries(): SpriteEntry[] {
  if (_entries) return _entries;
  _entries = (CRAFTABLES_INDEX as CraftableIndexItem[]).map((it) => ({
    key: `craft-${it.i}`,
    name: it.n,
    sub: it.p > 0 ? `${it.p}g` : undefined,
    sheet: 'craftables' as const,
    rect: { x: (it.i % COLS) * 16, y: Math.floor(it.i / COLS) * 32, w: 16, h: 32 },
  }));
  return _entries;
}

export const craftablesSheet: SheetSpec = {
  id: 'craftables',
  label: '大型制造物',
  category: 'TileSheets',
  png: CRAFTABLES_PNG,
  imgW: 128,
  imgH: 1472,
  entries: deriveEntries,
};
