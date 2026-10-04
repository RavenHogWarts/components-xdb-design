// scripts/probe-components.mjs
// 连通域探针：对贴图做 flood-fill，输出每个独立精灵的包围盒。
// 用于推导 fruitTrees.png / tools.png 的真实切片矩形。
//
// 用法: node scripts/probe-components.mjs <png路径> [--min=30]

import fs from 'node:fs';
import { PNG } from 'pngjs';

const [file, minArg] = process.argv.slice(2);
if (!file) {
  console.error('用法: node scripts/probe-components.mjs <png路径> [--min=30]');
  process.exit(1);
}
const MIN_PIXELS = Number(minArg?.split('=')[1] ?? 30);

const png = PNG.sync.read(fs.readFileSync(file));
const { width: W, height: H, data } = png;
const seen = new Uint8Array(W * H);
const alphaAt = (x, y) => data[(y * W + x) * 4 + 3] > 16;

const components = [];
for (let y0 = 0; y0 < H; y0++) {
  for (let x0 = 0; x0 < W; x0++) {
    const i0 = y0 * W + x0;
    if (seen[i0] || !alphaAt(x0, y0)) continue;
    // BFS
    let minX = x0, maxX = x0, minY = y0, maxY = y0, count = 0;
    const stack = [i0];
    seen[i0] = 1;
    while (stack.length) {
      const i = stack.pop();
      const x = i % W, y = (i / W) | 0;
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        if (seen[ni] || !alphaAt(nx, ny)) continue;
        seen[ni] = 1;
        stack.push(ni);
      }
    }
    if (count >= MIN_PIXELS) components.push({ minX, minY, maxX, maxY, count });
  }
}

components.sort((a, b) => a.minY - b.minY || a.minX - b.minX);
console.log(`${file}: ${components.length} 个连通域 (≥${MIN_PIXELS}px)`);
for (const c of components) {
  console.log(
    `  x${c.minX}-${c.maxX} y${c.minY}-${c.maxY}  (${c.maxX - c.minX + 1}x${c.maxY - c.minY + 1})  px=${c.count}`
  );
}
