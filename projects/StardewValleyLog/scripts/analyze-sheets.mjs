// scripts/analyze-sheets.mjs
// 精灵图排版分析工具：输出 16px（可调）单元格不透明度热力图。
// 用途：推导/验证各贴图的切片公式（如 crops.png 两大列布局）。
//
// 用法:
//   node scripts/analyze-sheets.mjs <png路径> [cellSize=16] [--alpha=16]

import fs from 'node:fs';
import { PNG } from 'pngjs';

const [file, cellArg, flag] = process.argv.slice(2);
if (!file) {
  console.error('用法: node scripts/analyze-sheets.mjs <png路径> [cellSize=16] [--alpha=16]');
  process.exit(1);
}
const CELL = Number(cellArg) || 16;
const ALPHA_MIN = flag?.startsWith('--alpha=') ? Number(flag.split('=')[1]) : 16;

const png = PNG.sync.read(fs.readFileSync(file));
const cols = Math.ceil(png.width / CELL);
const rows = Math.ceil(png.height / CELL);
console.log(`${file} = ${png.width}x${png.height}, ${CELL}px 网格 ${cols} 列 x ${rows} 行\n`);

const grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
for (let y = 0; y < png.height; y++) {
  for (let x = 0; x < png.width; x++) {
    const idx = (y * png.width + x) << 2;
    if (png.data[idx + 3] > ALPHA_MIN) grid[(y / CELL) | 0][(x / CELL) | 0]++;
  }
}
console.log('     ' + Array.from({ length: cols }, (_, c) => String(c).padStart(5)).join(''));
for (let r = 0; r < rows; r++) {
  const line = grid[r].map((n) => (n === 0 ? '    ·' : String(n).padStart(5))).join('');
  console.log(`r${String(r).padStart(2)} | ${line}`);
}
