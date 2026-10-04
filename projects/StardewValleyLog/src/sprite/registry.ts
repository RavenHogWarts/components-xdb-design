// registry.ts —— 图鉴分类注册表
// 大类 = Content (unpacked) 中的文件夹名（category 字段），子类 = 贴图资源。
// 顺序即显示顺序。

import { SheetSpec } from './types';
import { cropsSheet } from './crops';
import { fruitTreesSheet } from './fruitTrees';
import { objectsSheet, objects2Sheet } from './objects';
import { toolsSheet } from './tools';
import { weaponsSheet } from './weapons';
import { craftablesSheet } from './craftables';
import { hoeDirtSheet, grassSheet, buildingsSheet, animalsSheets } from './static';
import { farmBuildingsSheet } from './buildings';
import {
  farmerBaseSheet,
  skinSheet,
  hairSheet,
  colorSheet,
  shirtsSheet,
  pantsSheet,
  accessoriesSheet,
} from './farmer';

export const ALMANAC_SHEETS: SheetSpec[] = [
  // TileSheets/
  cropsSheet,
  fruitTreesSheet,
  toolsSheet,
  weaponsSheet,
  craftablesSheet,
  // Maps/
  objectsSheet,
  objects2Sheet,
  // TerrainFeatures/
  hoeDirtSheet,
  grassSheet,
  // Buildings/
  buildingsSheet,
  farmBuildingsSheet,
  // Animals/
  ...animalsSheets,
  // Characters/（人物创建素材）
  farmerBaseSheet,
  skinSheet,
  hairSheet,
  colorSheet,
  shirtsSheet,
  pantsSheet,
  accessoriesSheet,
];

/** 大类 → 子类分组（保持 ALMANAC_SHEETS 顺序） */
export interface AlmanacCategory {
  name: string;
  sheets: SheetSpec[];
}

export function getAlmanacCategories(): AlmanacCategory[] {
  const out: AlmanacCategory[] = [];
  for (const sheet of ALMANAC_SHEETS) {
    let cat = out[out.length - 1];
    if (!cat || cat.name !== sheet.category) {
      cat = { name: sheet.category, sheets: [] };
      out.push(cat);
    }
    cat.sheets.push(sheet);
  }
  // 大类按字母顺序排序（用户要求）
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
