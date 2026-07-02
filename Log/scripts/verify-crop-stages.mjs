// scripts/verify-crop-stages.mjs
// 基于新「两大列」坐标公式，对每个作物报告各阶段的像素填充与双高判定
// 用法: node scripts/verify-crop-stages.mjs

import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const ROOT = path.resolve('.');
const CROPS_JSON = JSON.parse(fs.readFileSync(path.join(ROOT, 'stardew-habit/Crops.json'), 'utf8'));
const PNG_PATH = path.join(ROOT, 'stardew-habit/crops.png');

const png = PNG.sync.read(fs.readFileSync(PNG_PATH));
const W = png.width, H = png.height, CELL = 16;
const cols = W / CELL, rows = H / CELL;

// 16x16 单元格非透明像素数
const grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const a = png.data[((y * W + x) << 2) + 3];
    if (a > 16) grid[(y / CELL) | 0][(x / CELL) | 0]++;
  }
}

const DOUBLE_THRESHOLD = 12; // 偶数行像素 > 此值视为双高（顶部有内容）

const lines = [];
const push = (s) => lines.push(s);

push('si | name           | pc | pair|base|off | stage-cols [even/odd pixels] (D=double)');
push('---|----------------|----|-----|----|----|-------------------------------------------');

const doubleAtMaturity = new Set(); // 成熟态（倒数第二格）双高的 si
const doubleAtLast = new Set();     // 最后格双高的 si

for (const [seedId, e] of Object.entries(CROPS_JSON)) {
  if (!e.Texture?.toLowerCase().includes('crops')) continue;
  const si = e.SpriteIndex ?? 0;
  const pc = (e.DaysInPhase ?? []).length;
  const pairIdx = Math.floor(si / 2);
  const baseRow = pairIdx * 2;
  const colOffset = si % 2 === 0 ? 0 : 8;

  const cells = [];
  // 阶段 0..pc+1（含成熟和最后态），共 pc+2 个
  for (let i = 0; i <= pc + 1; i++) {
    const c = colOffset + i;
    if (c >= cols || baseRow + 1 >= rows) { cells.push('OOB'); continue; }
    const even = grid[baseRow][c];
    const odd = grid[baseRow + 1][c];
    const isDouble = even > DOUBLE_THRESHOLD;
    cells.push(`${c}${isDouble ? 'D' : ''}(${even}/${odd})`);
    if (i === pc) and(isDouble, () => doubleAtMaturity.add(si));       // 倒数第二=成熟
    if (i === pc + 1 && isDouble) doubleAtLast.add(si);                // 最后
  }
  function and(cond, fn) { if (cond) fn(); }

  push(
    `${String(si).padStart(2)} | ${String(seedId).padEnd(14)} | ${String(pc).padStart(2)} | ` +
    `${String(pairIdx).padStart(3)} |${String(baseRow).padStart(3)} |${String(colOffset).padStart(3)} | ` +
    cells.join(' ')
  );
}

push('');
push('=== 成熟态(倒数第二)双高的 SpriteIndex ===');
push(`[${[...doubleAtMaturity].sort((a, b) => a - b).join(', ')}]`);
push('');
push('=== 最后态双高的 SpriteIndex ===');
push(`[${[...doubleAtLast].sort((a, b) => a - b).join(', ')}]`);
push('');
push('=== IsRaised=true 的 SpriteIndex（应全部双高） ===');
const raised = [];
for (const [, e] of Object.entries(CROPS_JSON)) {
  if (e.Texture?.toLowerCase().includes('crops') && e.IsRaised) raised.push(e.SpriteIndex ?? 0);
}
push(`[${raised.sort((a, b) => a - b).join(', ')}]`);

console.log(lines.join('\n'));
