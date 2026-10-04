// objects.ts —— springobjects.png（384×624）物品图标解析
// 图标位 = (idx % 24, ⌊idx / 24⌋) × 16px，idx 来自构建期派生的 objects-index.json
//（scripts/derive-catalog.mjs：Objects.json + Strings/Objects.zh-CN.json）。

import { SheetSpec, SpriteEntry } from './types';
import OBJ_INDEX from '../assets/data/objects-index.json';
import SPRING_OBJECTS_PNG from '../assets/sprites/springobjects.png';
import OBJECTS_2_PNG from '../assets/sprites/Objects_2.png';

interface ObjIndexItem {
  /** 图标索引（SpriteIndex） */
  i: number;
  /** 官方中文名 */
  n: string;
  /** Category 分类码 */
  c: number;
  /** 售价 */
  p: number;
  /** 'o2' = 图标在 Objects_2（1.6 新物品，8 列网格）；缺省 = springobjects（24 列） */
  t?: 'o2';
}

/** 分类码 → 中文组名（样本校对自 derive-catalog --stats） */
const CATEGORIES: Record<number, string> = {
  '-999': '杂项',
  0: '杂项',
  '-2': '宝石',
  '-4': '鱼',
  '-5': '蛋',
  '-6': '奶',
  '-7': '料理',
  '-8': '制造物',
  '-12': '矿物',
  '-15': '金属锭',
  '-16': '基础资源',
  '-17': '珍品',
  '-18': '牧产品',
  '-19': '肥料土壤',
  '-20': '垃圾',
  '-21': '鱼饵',
  '-22': '钓鱼具',
  '-23': '贝壳',
  '-24': '地板装饰',
  '-26': '工匠品',
  '-27': '树脂',
  '-28': '怪物战利品',
  '-74': '种子',
  '-75': '蔬菜',
  '-79': '水果',
  '-80': '花',
  '-81': '采集物',
};

/** 分组显示顺序（未列出的追加在「其他」前） */
const GROUP_ORDER = [
  '蔬菜', '水果', '花', '采集物', '鱼', '贝壳', '料理', '工匠品', '树脂',
  '牧产品', '蛋', '奶', '宝石', '矿物', '金属锭', '基础资源', '种子',
  '肥料土壤', '鱼饵', '钓鱼具', '怪物战利品', '珍品', '地板装饰', '制造物',
  '垃圾', '杂项',
];

let _entries: SpriteEntry[] | null = null;

function deriveEntries(): SpriteEntry[] {
  if (_entries) return _entries;
  const items = OBJ_INDEX as ObjIndexItem[];
  const result = items
    .filter((it) => !it.t)
    .map((it) => ({
      key: `obj-${it.i}`,
      name: it.n,
      sub: it.p > 0 ? `${it.p}g` : undefined,
      group: CATEGORIES[it.c] ?? '其他',
      sheet: 'objects' as const,
      rect: {
        x: (it.i % 24) * 16,
        y: Math.floor(it.i / 24) * 16,
        w: 16,
        h: 16,
      },
    }));
  // 分组排序：按 GROUP_ORDER，同组按图标索引
  const order = new Map(GROUP_ORDER.map((g, i) => [g, i]));
  result.sort(
    (a, b) =>
      (order.get(a.group ?? '') ?? 90) - (order.get(b.group ?? '') ?? 90) ||
      a.key.localeCompare(b.key, undefined, { numeric: true })
  );
  _entries = result;
  return result;
}

export const objectsSheet: SheetSpec = {
  id: 'objects',
  label: '物品',
  category: 'Maps',
  png: SPRING_OBJECTS_PNG,
  imgW: 384,
  imgH: 624,
  entries: deriveEntries,
};

// ── 物品 1.6：Objects_2.png（128×320，8 列 16px）——1.6 新物品图标 ──

let _entries2: SpriteEntry[] | null = null;

function deriveEntries2(): SpriteEntry[] {
  if (_entries2) return _entries2;
  const items = (OBJ_INDEX as ObjIndexItem[]).filter((it) => it.t === 'o2');
  const result = items.map((it) => ({
    key: `obj2-${it.i}`,
    name: it.n,
    sub: it.p > 0 ? `${it.p}g` : undefined,
    group: CATEGORIES[it.c] ?? '其他',
    sheet: 'objects' as const,
    rect: { x: (it.i % 8) * 16, y: Math.floor(it.i / 8) * 16, w: 16, h: 16 },
  }));
  const order = new Map(GROUP_ORDER.map((g, i) => [g, i]));
  result.sort(
    (a, b) =>
      (order.get(a.group ?? '') ?? 90) - (order.get(b.group ?? '') ?? 90) ||
      a.key.localeCompare(b.key, undefined, { numeric: true })
  );
  _entries2 = result;
  return result;
}

export const objects2Sheet: SheetSpec = {
  id: 'objects',
  label: '物品 1.6',
  category: 'Maps',
  png: OBJECTS_2_PNG,
  imgW: 128,
  imgH: 320,
  entries: deriveEntries2,
};
