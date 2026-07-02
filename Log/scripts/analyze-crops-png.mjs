// scripts/analyze-crops-png.mjs
// 扫描 crops.png 的真实布局：逐 16px 单元格统计非透明像素数
// 用法: node scripts/analyze-crops-png.mjs

import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const PNG_PATH = path.resolve('stardew-habit/crops.png');
const CELL = 16;

const buf = fs.readFileSync(PNG_PATH);
const png = PNG.sync.read(buf);
const W = png.width;
const H = png.height;
const cols = W / CELL;
const rows = H / CELL;
console.log(`crops.png = ${W}x${H}, grid ${cols}cols x ${rows}rows (16px)\n`);

// 统计每个 16x16 单元格的非透明像素数
const grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const idx = (y * W + x) << 2;
    const a = png.data[idx + 3];
    if (a > 16) grid[(y / CELL) | 0][(x / CELL) | 0]++;
  }
}

// 1. 完整热力图（每格非透明像素数）
console.log('=== Cell opacity heatmap (non-transparent pixel count) ===');
console.log('     ' + Array.from({ length: cols }, (_, c) => c.toString().padStart(5)).join(''));
for (let r = 0; r < rows; r++) {
  const rowStr = grid[r].map((n) => (n === 0 ? '   . ' : n.toString().padStart(4) + ' ')).join('');
  console.log(`r${r.toString().padStart(2)} | ${rowStr}`);
}

// 2. 左半边 vs 右半边 非空单元格数对比（验证"两大列"假设）
const half = cols / 2;
let leftNonEmpty = 0, rightNonEmpty = 0;
for (let r = 0; r < rows; r++) {
  for (let c = 0; c < cols; c++) {
    if (grid[r][c] > 0) {
      if (c < half) leftNonEmpty++;
      else rightNonEmpty++;
    }
  }
}
console.log(`\n=== Left half (cols 0-${half - 1}) vs Right half (cols ${half}-${cols - 1}) ===`);
console.log(`Left  non-empty cells: ${leftNonEmpty}`);
console.log(`Right non-empty cells: ${rightNonEmpty}`);

// 3. 逐对行（每作物占 2 行）分析：每一对的偶数行/奇数行非空单元格数
console.log(`\n=== Per-pair-of-rows (each SpriteIndex occupies 2 rows) ===`);
console.log('spriteIdx | even-row-non-empty-cols | odd-row-non-empty-cols | even-cols-detail | odd-cols-detail');
for (let si = 0; si < rows / 2; si++) {
  const even = grid[si * 2];
  const odd = grid[si * 2 + 1];
  const evenCols = even.map((n, c) => (n > 0 ? c : -1)).filter((c) => c >= 0);
  const oddCols = odd.map((n, c) => (n > 0 ? c : -1)).filter((c) => c >= 0);
  console.log(
    `si${si.toString().padStart(2)}      | ` +
    `even=${evenCols.length.toString().padStart(2)}                  ` +
    `odd=${oddCols.length.toString().padStart(2)}                 ` +
    `cols=[${evenCols.join(',')}]`.padEnd(20) +
    ` | cols=[${oddCols.join(',')}]`
  );
}

// 4. 验证"两大列"假设：检查右半边(cols 8-15)的每对行是否也有作物
console.log(`\n=== Right-half check (cols 8-15), per pair of rows ===`);
for (let si = 0; si < rows / 2; si++) {
  const evenRight = grid[si * 2].slice(half).filter((n) => n > 0).length;
  const oddRight = grid[si * 2 + 1].slice(half).filter((n) => n > 0).length;
  if (evenRight > 0 || oddRight > 0) {
    const evenColsR = grid[si * 2].map((n, c) => (n > 0 && c >= half ? c : -1)).filter((c) => c >= 0);
    const oddColsR = grid[si * 2 + 1].map((n, c) => (n > 0 && c >= half ? c : -1)).filter((c) => c >= 0);
    console.log(`si${si.toString().padStart(2)} even_right_cols=[${evenColsR.join(',')}] odd_right_cols=[${oddColsR.join(',')}]`);
  }
}
