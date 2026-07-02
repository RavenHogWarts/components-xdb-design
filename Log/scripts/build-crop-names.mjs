/**
 * build-crop-names.mjs
 *
 * 从游戏原始解包数据派生每个作物的官方中文名，输出可直接粘贴进 crop-loader.ts 的映射表。
 *
 * 数据流：
 *   Crops.json (seedId → HarvestItemId)
 *     → Objects.json (HarvestItemId → Name 内部英文键)
 *     → Strings/Objects.zh-CN.json (Name + "_Name" → 中文名)
 *
 * 用法：node scripts/build-crop-names.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '../assets/Content (unpacked)/Data');
const STRINGS_DIR = resolve(__dirname, '../assets/Content (unpacked)/Strings');

const crops = JSON.parse(readFileSync(resolve(DATA_DIR, 'Crops.json'), 'utf-8'));
const objects = JSON.parse(readFileSync(resolve(DATA_DIR, 'Objects.json'), 'utf-8'));
const zhObjects = JSON.parse(
  readFileSync(resolve(STRINGS_DIR, 'Objects.zh-CN.json'), 'utf-8')
);

/** 把内部 Name 转成中文 DisplayName */
function resolveZhName(itemId) {
  const obj = objects[itemId];
  if (!obj) return null;
  const internalName = obj.Name;
  if (!internalName) return null;

  // 主路径：{Name}_Name（保留空格，部分老条目用此格式）
  const keyWithSpace = `${internalName}_Name`;
  if (zhObjects[keyWithSpace]) return zhObjects[keyWithSpace];

  // 路径 2：去空格（{GreenBean}_Name 等，多数条目用此格式）
  const keyNoSpace = `${internalName.replace(/\s+/g, '')}_Name`;
  if (zhObjects[keyNoSpace]) return zhObjects[keyNoSpace];

  // 兜底 1：直接用 internalName（极少数键没加后缀）
  if (zhObjects[internalName]) return zhObjects[internalName];

  // 兜底 2：英文 Name（最后手段，保留原值方便人工核对）
  return internalName;
}

const rows = [];
for (const [seedId, crop] of Object.entries(crops)) {
  // 仅处理使用标准 crops 贴图的条目（与 crop-loader.ts 过滤逻辑一致）
  const texture = crop.Texture ?? '';
  if (!texture.toLowerCase().includes('crops')) continue;

  const harvestId = String(crop.HarvestItemId);
  const spriteIndex = crop.SpriteIndex ?? 0;
  const zh = resolveZhName(harvestId);
  const enName = objects[harvestId]?.Name ?? '?';
  const zhKey = `${enName}_Name`;
  const zhHit = zhObjects[zhKey] ? 'HIT' : 'MISS';

  rows.push({
    seedId,
    harvestId,
    spriteIndex,
    enName,
    zhKey,
    zhHit,
    zhName: zh ?? '(未找到)',
  });
}

// 按 SpriteIndex 升序
rows.sort((a, b) => a.spriteIndex - b.spriteIndex);

// 输出报告 + 可粘贴的 TS 映射
console.log('─'.repeat(90));
console.log(`共 ${rows.length} 株作物（使用标准 crops 贴图）`);
console.log('─'.repeat(90));
console.log(
  'seedId | spriteIdx | harvestId | enName            | zhKey                       | hit | zhName'
);
for (const r of rows) {
  console.log(
    `${r.seedId.padEnd(7)} | ${String(r.spriteIndex).padEnd(9)} | ${r.harvestId.padEnd(9)} | ${r.enName.padEnd(17)} | ${r.zhKey.padEnd(27)} | ${r.zhHit.padEnd(4)} | ${r.zhName}`
  );
}

console.log('\n// ── 可直接粘贴到 crop-loader.ts 的 HARVEST_NAMES ──\n');
console.log('const HARVEST_NAMES: Record<string, string> = {');
for (const r of rows) {
  const comment = `// ${r.enName}${r.zhHit === 'MISS' ? ' ⚠ 未在 zh-CN 命中' : ''}`;
  // 仅 escape 反引号和美元符号
  const safe = r.zhName.replace(/`/g, '\\`').replace(/\$/g, '\\$');
  console.log(`  '${r.harvestId}': \`${safe}\`, ${comment}`);
}
console.log('};');

// 统计
const missCount = rows.filter(r => r.zhHit === 'MISS').length;
console.log(`\n命中：${rows.length - missCount}/${rows.length}`);
