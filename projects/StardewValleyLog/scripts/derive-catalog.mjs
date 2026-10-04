// scripts/derive-catalog.mjs
// 构建期数据派生：从本机游戏解包转储（assets/Content (unpacked)，gitignored）
// 生成提交进 git 的瘦身命名/切片数据，供 src/sprite/ 运行时消费。
//
// 输出（均在 src/assets/data/）：
//   crop-names.zh-CN.json   作物收获物 id → 官方中文名
//   tree-names.zh-CN.json   果树内部名（Banana_Name 等） → 官方中文名
//   tree-sprites.json       果树真实精灵包围盒（连通域分析，face + strip）
//   objects-index.json      springobjects 物品索引 [{i,n,c,p}]
//
// 用法:
//   node scripts/derive-catalog.mjs          # 生成全部
//   node scripts/derive-catalog.mjs --stats  # 附带打印分类样本/命中率，用于校对
//
// 中文名解析规则：
//   DisplayName 若为 "[LocalizedText Strings\\Objects:Key]" 占位符
//   → Strings/Objects.zh-CN.json[Key]；DisplayName 为字面量则直接用。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DUMP = path.resolve(__dirname, '../assets/Content (unpacked)');
const OUT = path.resolve(__dirname, '../src/assets/data');
const STATS = process.argv.includes('--stats');

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const objects = readJson(path.join(DUMP, 'Data/Objects.json'));
const crops = readJson(path.join(DUMP, 'Data/Crops.json'));
const zhObjects = readJson(path.join(DUMP, 'Strings/Objects.zh-CN.json'));

const PLACEHOLDER = /^\[LocalizedText Strings\\+Objects:(.+?)\]$/;

/** Objects.json 条目 → 官方中文名；查不到返回 null */
function zhNameOf(obj) {
  if (!obj) return null;
  const m = PLACEHOLDER.exec(obj.DisplayName ?? '');
  const key = m ? m[1] : null;
  if (key && zhObjects[key] != null) return zhObjects[key];
  // DisplayName 是字面量
  if (!m && obj.DisplayName) return obj.DisplayName;
  return null;
}

// ── 1. 作物名：Crops.json.HarvestItemId → Objects → zh ──
{
  const out = {};
  let miss = 0;
  for (const [seedId, crop] of Object.entries(crops)) {
    const hid = String(crop.HarvestItemId ?? '');
    const zh = zhNameOf(objects[hid]);
    if (zh == null) {
      miss++;
      console.warn(`  ⚠ 作物 ${seedId} 收获物 ${hid} 未命中中文名`);
      continue;
    }
    out[hid] = zh;
  }
  fs.writeFileSync(path.join(OUT, 'crop-names.zh-CN.json'), JSON.stringify(out, null, 1));
  console.log(`crop-names.zh-CN.json: ${Object.keys(out).length} 条 (${miss} 未命中)`);
}

// ── 2. 果树名：FruitTrees.json.DisplayName 占位符 → zh ──
{
  const trees = readJson(path.join(DUMP, 'Data/FruitTrees.json'));
  const out = {};
  for (const [id, tree] of Object.entries(trees)) {
    const m = PLACEHOLDER.exec(tree.DisplayName ?? '');
    if (!m) {
      console.warn(`  ⚠ 果树 ${id} DisplayName 非占位符: ${tree.DisplayName}`);
      continue;
    }
    const key = m[1]; // 如 Banana_Name
    out[key] = zhObjects[key] ?? key.replace(/_Name$/, '');
  }
  fs.writeFileSync(path.join(OUT, 'tree-names.zh-CN.json'), JSON.stringify(out, null, 1));
  console.log(`tree-names.zh-CN.json: ${Object.keys(out).length} 条`);
}


// ── 3. 果树卡面合成（布局依据 1.6 反编译源码 FruitTree.draw，权威矩形）──
// fruitTrees.png 每 strip 80px（spriteRow×80），每 strip：
//   阶段0-3：48×80 格 @ x=0/48/96/144
//   成熟树×4季：48×80 格 @ x=192(春)/240(夏)/288(秋)/336(冬)，各=树冠48×64+树干48×16
//   落叶粒子：8×8 @ (384+season·16, k·80)（粒子特效，图鉴不展示）
//   树桩：48×32 @ (384, k·80+48)
// 树上的果实不在这张贴图：游戏运行时画果实物品的图标（springobjects）于树冠。
// → 卡面 = 夏季树 + 果实图标（树冠中上）合成"挂果树"；另派生 16×16 果实图标。
{
  const ftree = PNG.sync.read(fs.readFileSync(path.join(OUT, '../sprites/fruitTrees.png')));
  const spring = PNG.sync.read(fs.readFileSync(path.join(OUT, '../sprites/springobjects.png')));
  const trees = readJson(path.join(DUMP, 'Data/FruitTrees.json'));

  const grabFrom = (png, x, y, w, h) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let yy = 0; yy < h; yy++)
      for (let xx = 0; xx < w; xx++) {
        const si = ((y + yy) * png.width + (x + xx)) * 4;
        data.set(png.data.subarray(si, si + 4), (yy * w + xx) * 4);
      }
    return { data, w, h };
  };
  const paste = (dst, src, ox, oy) => {
    for (let y = 0; y < src.h; y++)
      for (let x = 0; x < src.w; x++) {
        const si = (y * src.w + x) * 4;
        if (src.data[si + 3] === 0) continue;
        const di = ((oy + y) * dst.w + (ox + x)) * 4;
        dst.data.set(src.data.subarray(si, si + 4), di);
      }
  };
  const toPngDataUrl = (img) => {
    const p = new PNG({ width: img.w, height: img.h });
    p.data = Buffer.from(img.data);
    return 'data:image/png;base64,' + PNG.sync.write(p).toString('base64');
  };

  const out = {};
  for (const [saplingId, tree] of Object.entries(trees)) {
    const k = tree.TextureSpriteRow ?? 0;
    const fruitItemId = String(tree.Fruit?.[0]?.ItemId ?? '').match(/\(O\)(\w+)/)?.[1];
    let fruitIcon = null;
    if (fruitItemId && /^\d+$/.test(fruitItemId)) {
      const id = Number(fruitItemId);
      fruitIcon = grabFrom(spring, (id % 24) * 16, Math.floor(id / 24) * 16, 16, 16);
      // 卡面 = 夏季树 + 果实（树冠中上，仿游戏内挂果位置）
      const face = grabFrom(ftree, 240, k * 80, 48, 80);
      paste(face, fruitIcon, 16, 12);
      out[saplingId] = { face: toPngDataUrl(face), fruitIcon: toPngDataUrl(fruitIcon) };
    } else {
      console.warn(`  ⚠ 果树 ${saplingId} 果实 ItemId 非数字：${fruitItemId}，卡面不含果实`);
      out[saplingId] = { face: toPngDataUrl(grabFrom(ftree, 240, k * 80, 48, 80)) };
    }
  }
  fs.writeFileSync(path.join(OUT, 'tree-faces.json'), JSON.stringify(out));
  console.log(`tree-faces.json: ${Object.keys(out).length} 棵树的挂果卡面 + 果实图标`);
}

// ── 3.5 作物卡面与状态数：按 16×32 块的像素实测 ──
// 状态数不能从 DaysInPhase 推（葡萄/啤酒花/咖啡为 8 态 = pc+3，防风草等为
// pc+2），以贴图里该作物 8 列窗口的最右非空列为准，但需排除巨型作物区域：
//   GiantCrops.json.TexturePosition 指出巨型花椰菜/甜瓜/南瓜在 crops.png 的
//   (112,512)/(160,512)/(208,512)，各 3×3 tile（48×48px）→ cols 7-15 × rows 32-34，
//   会混入相邻作物（未碾米等）的列窗口。
// 卡面阶段：再生作物（RegrowDays>0）取倒数第二格（结果实态）；一次性作物取
// 最后一格（完全绽放态）。
// 花类（TintColors 非空）：最右列是白色花冠，需按官方 TintColors 着色后叠到
// 倒数第二格（植株）上才是完整的花 → 构建期合成各色的完整花 PNG（dataURL）。
{
  const png = PNG.sync.read(fs.readFileSync(path.join(OUT, '../sprites/crops.png')));
  // 巨型作物排除区（crops.png 内）：3 个 48×48 位于 (112/160/208, 512)，
  // 且精灵阴影向下溢出一行 → cols 7-15 × rows 32-35（该区无正常作物）
  const isGiantCell = (col, row) => col >= 7 && col <= 15 && row >= 32 && row <= 35;
  const blockPixels = (col, baseRow) => {
    let n = 0;
    for (let rr = baseRow; rr <= baseRow + 1; rr++) {
      if (isGiantCell(col, rr)) continue;
      for (let yy = rr * 16; yy < rr * 16 + 16; yy++)
        for (let xx = col * 16; xx < col * 16 + 16; xx++)
          if (png.data[(yy * png.width + xx) * 4 + 3] > 16) n++;
    }
    return n;
  };

  const NAMED_COLORS = { red: [255, 0, 0], white: [255, 255, 255], blue: [0, 114, 255] };
  const parseColor = (t) => {
    const hex = /^#?([0-9a-f]{6})$/i.exec(String(t).trim());
    if (hex) {
      const h = hex[1];
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    return NAMED_COLORS[String(t).trim().toLowerCase()] ?? [255, 255, 255];
  };
  /** 抠 16×32 块 → RGBA 拷贝 */
  const grab = (col, baseRow) => {
    const out = new Uint8ClampedArray(16 * 32 * 4);
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 16; x++) {
        const si = ((baseRow * 16 + y) * png.width + (col * 16 + x)) * 4;
        out.set(png.data.subarray(si, si + 4), (y * 16 + x) * 4);
      }
    return out;
  };
  /** 花冠着色（乘法，同游戏 SpriteBatch 着色）后叠到植株上 */
  const composeFlower = (plant, crown, [tr, tg, tb]) => {
    const out = plant.slice();
    for (let i = 0; i < out.length; i += 4) {
      const ca = crown[i + 3];
      if (ca === 0) continue;
      const cr = (crown[i] * tr) / 255;
      const cg = (crown[i + 1] * tg) / 255;
      const cb = (crown[i + 2] * tb) / 255;
      const a = ca / 255;
      const pa = out[i + 3] / 255;
      const oa = a + pa * (1 - a);
      if (oa === 0) continue;
      out[i] = (cr * a + out[i] * pa * (1 - a)) / oa;
      out[i + 1] = (cg * a + out[i + 1] * pa * (1 - a)) / oa;
      out[i + 2] = (cb * a + out[i + 2] * pa * (1 - a)) / oa;
      out[i + 3] = oa * 255;
    }
    return out;
  };
  const toPngDataUrl = (rgba, w, h) => {
    const p = new PNG({ width: w, height: h });
    p.data = Buffer.from(rgba);
    return 'data:image/png;base64,' + PNG.sync.write(p).toString('base64');
  };

  const faces = {};
  for (const [seedId, crop] of Object.entries(crops)) {
    if (crop.Texture && !crop.Texture.toLowerCase().includes('crops')) continue;
    const si = crop.SpriteIndex ?? 0;
    const pc = (crop.DaysInPhase ?? []).length;
    const colOff = si % 2 === 0 ? 0 : 8;
    const baseRow = Math.floor(si / 2) * 2;
    let stages = pc + 2; // 兜底：像素全空时退回数据推导
    for (let i = 7; i >= 0; i--) {
      if (blockPixels(colOff + i, baseRow) > 0) { stages = i + 1; break; }
    }
    const tints = (crop.TintColors ?? []).map(parseColor);
    if (tints.length) {
      // 花类：末列 = 白色花冠，其余 = 植株状态
      const growth = stages - 1;
      const plant = grab(colOff + growth - 1, baseRow);
      const crown = grab(colOff + stages - 1, baseRow);
      faces[seedId] = {
        f: growth - 1,
        s: growth,
        imgs: tints.map((t) => toPngDataUrl(composeFlower(plant, crown, t), 16, 32)),
      };
    } else {
      const face = (crop.RegrowDays ?? -1) > 0 ? stages - 2 : stages - 1;
      faces[seedId] = { f: Math.max(face, 0), s: stages };
    }
  }
  fs.writeFileSync(path.join(OUT, 'crop-faces.json'), JSON.stringify(faces));
  const flowerCount = Object.values(faces).filter((x) => x.imgs).length;
  console.log(
    `crop-faces.json: ${Object.keys(faces).length} 条（含 ${flowerCount} 种花的花冠着色合成）`
  );
}

// ── 4. 物品索引：springobjects（Texture 空）+ Objects_2（1.6 新物品图标）──
{
  const items = [];
  let skippedTexture = 0;
  let skippedRange = 0;
  const catSamples = {};
  for (const [id, obj] of Object.entries(objects)) {
    // 贴图归属：null = springobjects（384×624，24 列）；Objects_2 = 1.6 新物品（128×320，8 列）
    const tex = obj.Texture ? obj.Texture.replaceAll('\\\\', '\\').toLowerCase() : null;
    let sheet = null, maxIdx = 0;
    if (!obj.Texture) { sheet = 'so'; maxIdx = 24 * 39; }
    else if (tex === 'tilesheets\\objects_2') { sheet = 'o2'; maxIdx = 8 * 20; }
    else { skippedTexture++; continue; }
    const idx = obj.SpriteIndex;
    if (!Number.isInteger(idx) || idx < 0 || idx >= maxIdx) {
      skippedRange++;
      continue;
    }
    const zh = zhNameOf(obj);
    if (zh == null) continue;
    const it = { i: idx, n: zh, c: obj.Category ?? 0, p: obj.Price ?? 0 };
    if (sheet === 'o2') it.t = 'o2';
    items.push(it);
    const c = String(obj.Category ?? 0);
    (catSamples[c] ??= []).push(zh);
  }
  items.sort((a, b) => a.i - b.i || (a.t ?? '').localeCompare(b.t ?? ''));
  fs.writeFileSync(path.join(OUT, 'objects-index.json'), JSON.stringify(items));
  const o2 = items.filter((x) => x.t === 'o2').length;
  console.log(
    `objects-index.json: ${items.length} 条（springobjects ${items.length - o2} + Objects_2 ${o2}；跳过其他贴图 ${skippedTexture} / 越界 ${skippedRange}）`
  );
  if (STATS) {
    console.log('\nCategory 样本（用于校对分类命名）：');
    for (const c of Object.keys(catSamples).sort((a, b) => a - b)) {
      console.log(`  ${c}: ${catSamples[c].slice(0, 5).join('、')}`);
    }
  }
}

// ── 5. 大型制造物索引：Craftables.png（128×1472，8 列 16×32）──
// 公式（Object.getSourceRectForBigCraftable）：x=(idx%8)*16, y=⌊idx/8⌋*32
{
  const bc = readJson(path.join(DUMP, 'Data/BigCraftables.json'));
  const zh = readJson(path.join(DUMP, 'Strings/BigCraftables.zh-CN.json'));
  const PLACEHOLDER_BC = /\[LocalizedText Strings\\+BigCraftables:(.+?)\]/;
  const items = [];
  for (const [, e] of Object.entries(bc)) {
    if (e.Texture) continue;
    const idx = e.SpriteIndex;
    if (!Number.isInteger(idx) || idx < 0 || idx >= 8 * 92) continue;
    const m = PLACEHOLDER_BC.exec(e.DisplayName ?? '');
    const n = m ? zh[m[1]] ?? null : e.DisplayName ?? null;
    if (n == null) continue;
    items.push({ i: idx, n, p: e.Price ?? 0 });
  }
  items.sort((a, b) => a.i - b.i);
  fs.writeFileSync(path.join(OUT, 'craftables-index.json'), JSON.stringify(items));
  console.log(`craftables-index.json: ${items.length} 条`);
}

// ── 6. 武器索引：weapons.png（128×144，8 列 16×16）──
// 公式（WeaponDataDefinition）：getSourceRectForStandardTileSheet(16,16) → 8 列网格
{
  const w = readJson(path.join(DUMP, 'Data/Weapons.json'));
  const zh = readJson(path.join(DUMP, 'Strings/Weapons.zh-CN.json'));
  const PLACEHOLDER_W = /\[LocalizedText Strings\\+Weapons:(.+?)\]/;
  const items = [];
  for (const [, e] of Object.entries(w)) {
    const idx = e.SpriteIndex;
    if (!Number.isInteger(idx) || idx < 0 || idx >= 8 * 9) continue;
    const m = PLACEHOLDER_W.exec(e.DisplayName ?? '');
    const n = m ? zh[m[1]] ?? null : e.DisplayName ?? null;
    if (n == null) continue;
    items.push({ i: idx, n, d: `${e.MinDamage ?? 0}-${e.MaxDamage ?? 0}` });
  }
  items.sort((a, b) => a.i - b.i);
  fs.writeFileSync(path.join(OUT, 'weapons-index.json'), JSON.stringify(items));
  console.log(`weapons-index.json: ${items.length} 条`);
}

// ── 7. 建筑索引：Data/Buildings.json 全量（Farmhouse 除外——农舍外观在 houses 页）──
// 每类输出：f=贴图文件名、n=官方中文名、sr=SourceRect（空=整图绘制）、
// dl=DrawLayers 附加绘制层（动物门状态/风车帆叶等，r 为矩形，fc=帧数，fpr=每行帧数）。
// 权威依据 Building.getSourceRect()：SourceRect 空则整图；Cabin 随升级横向偏移 ×3、
// Greenhouse 完好(sr)/破损(Y−H) 两态 + 阴影(112,0,128,144)、FishPond 与 JunimoHut
// 有专属 getSourceRectForMenu、PetBowl 盛水态在 X+W。这些组成区块在 buildings.ts 编码。
{
  const b = readJson(path.join(DUMP, 'Data/Buildings.json'));
  const zh = readJson(path.join(DUMP, 'Strings/Buildings.zh-CN.json'));
  const PLACEHOLDER_B = /\[LocalizedText Strings\\+Buildings:(.+?)\]/;
  const out = {};
  for (const [type, e] of Object.entries(b)) {
    if (type === 'Farmhouse') continue;
    const tex = String(e.Texture ?? '').split('\\').pop() + '.png';
    const m = PLACEHOLDER_B.exec(e.Name ?? '');
    const sr =
      e.SourceRect && e.SourceRect.Width > 0
        ? [e.SourceRect.X, e.SourceRect.Y, e.SourceRect.Width, e.SourceRect.Height]
        : null;
    const dl = (e.DrawLayers ?? []).map((d) => ({
      id: d.Id,
      r: [d.SourceRect.X, d.SourceRect.Y, d.SourceRect.Width, d.SourceRect.Height],
      fc: d.FrameCount ?? 1,
      fpr: d.FramesPerRow ?? -1,
    }));
    const bm = (e.BuildMaterials ?? []).map((mt) => [
      String(mt.ItemId ?? '').replace('(O)', ''),
      mt.Amount ?? 0,
    ]);
    out[type] = { f: tex, n: m ? (zh[m[1]] ?? type) : type, sr, dl, bm, size: [e.Size?.X ?? 0, e.Size?.Y ?? 0] };
  }
  fs.writeFileSync(path.join(OUT, 'buildings-index.json'), JSON.stringify(out));
  console.log(`buildings-index.json: ${Object.keys(out).length} 类建筑`);
}
