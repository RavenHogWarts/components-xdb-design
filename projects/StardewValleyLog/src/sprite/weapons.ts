// weapons.ts —— weapons.png（128×144，8 列 16px）解析
// 公式（1.6 源码 WeaponDataDefinition）：getSourceRectForStandardTileSheet(16,16)
// → x=(idx%8)*16, y=⌊idx/8⌋*16；命名链 Weapons.json → Strings/Weapons.zh-CN.json。

import { SheetSpec, SpriteEntry } from './types';
import WEAPONS_INDEX from '../assets/data/weapons-index.json';
import WEAPONS_PNG from '../assets/sprites/weapons.png';

interface WeaponIndexItem {
  i: number;
  n: string;
  d: string;
}

const COLS = 8;

let _entries: SpriteEntry[] | null = null;

function deriveEntries(): SpriteEntry[] {
  if (_entries) return _entries;
  _entries = (WEAPONS_INDEX as WeaponIndexItem[]).map((it) => ({
    key: `weapon-${it.i}`,
    name: it.n,
    sub: `伤害 ${it.d}`,
    sheet: 'weapons' as const,
    rect: { x: (it.i % COLS) * 16, y: Math.floor(it.i / COLS) * 16, w: 16, h: 16 },
  }));
  return _entries;
}

export const weaponsSheet: SheetSpec = {
  id: 'weapons',
  label: '武器',
  category: 'TileSheets',
  png: WEAPONS_PNG,
  imgW: 128,
  imgH: 144,
  entries: deriveEntries,
};
