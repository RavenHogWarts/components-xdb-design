// scripts/derive-farmer.mjs
// 构建期数据派生（人物）：从本机游戏解包转储（assets/Content (unpacked)，gitignored）
// 生成提交进 git 的 src/assets/data/farmer-index.json，供 src/sprite/farmer.ts 消费。
//
// 内容：
//   skinCount   肤色档数（skinColors.png 行数，每行暗/中/亮 3 色）
//   hairBase    基础发型数（hairstyles.png 高 / 96 × 8，每发型 16×96 列条）
//   hairExtra   HairData.json 扩展发型（texture/tileX/tileY/isBald/coveredIndex/usesUniqueLeftSprite）
//   shirts      创建可选上衣（Data/Shirts.json CanChooseDuringCharacterCustomization 且无自定义贴图）
//   pants       创建可选裤子（Data/Pants.json 同规则）
//
// 中文名解析：DisplayName 占位符 [LocalizedText Strings\Shirts:Key] → Strings/<ns>.zh-CN.json[Key]。
// 切片公式依据 1.6 反编译源码 CharacterCustomization.cs / FarmerRenderer.cs。
//
// 用法: node scripts/derive-farmer.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DUMP = path.resolve(__dirname, '../assets/Content (unpacked)');
const OUT = path.resolve(__dirname, '../src/assets/data');

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const PLACEHOLDER = (ns) => new RegExp(`\\[LocalizedText Strings\\\\+${ns}:(.+?)\\]`);
function zhOf(displayName, ns, zh) {
  const m = PLACEHOLDER(ns).exec(displayName ?? '');
  if (!m) return displayName || null;
  return zh[m[1]] ?? null;
}

const index = {};

// ── 1. 肤色档数（FarmerRenderer.ApplySkinColor：每行 = 暗/中/亮 3 色）──
{
  const png = PNG.sync.read(fs.readFileSync(path.join(DUMP, 'Characters/Farmer/skinColors.png')));
  index.skinCount = png.height;
  console.log(`skinCount: ${index.skinCount} 档（skinColors.png ${png.width}×${png.height}）`);
}

// ── 2. 发型：基础（hairstyles.png 高/96×8）+ HairData.json 扩展 ──
{
  const png = PNG.sync.read(fs.readFileSync(path.join(DUMP, 'Characters/Farmer/hairstyles.png')));
  index.hairBase = (png.height / 96) * 8;
  const hair = readJson(path.join(DUMP, 'Data/HairData.json'));
  index.hairExtra = [];
  let skipped = 0;
  for (const [id, v] of Object.entries(hair)) {
    const parts = String(v).split('/');
    if (parts.length < 6) {
      console.warn(`  ⚠ HairData ${id} 格式异常: ${v}`);
      skipped++;
      continue;
    }
    const [texture, tx, ty, bald, covered, left] = parts;
    if (texture !== 'hairstyles2') {
      console.warn(`  ⚠ HairData ${id} 使用未内联贴图 ${texture}，跳过`);
      skipped++;
      continue;
    }
    // GetAllHairstyleIndices 只收录 key >= 0 的扩展发型，负数为内部特殊样式
    if (Number(id) < 0) {
      skipped++;
      continue;
    }
    index.hairExtra.push({
      id: Number(id),
      texture,
      tx: Number(tx),
      ty: Number(ty),
      bald: bald === 'true',
      left: left === 'true',
    });
  }
  index.hairExtra.sort((a, b) => a.id - b.id);
  console.log(
    `hair: 基础 ${index.hairBase} + 扩展 ${index.hairExtra.length}（跳过 ${skipped}）`
  );
}

// ── 3. 上衣：创建可选（无自定义贴图）──
{
  const data = readJson(path.join(DUMP, 'Data/Shirts.json'));
  const zh = readJson(path.join(DUMP, 'Strings/Shirts.zh-CN.json'));
  const parseColor = (t) => {
    if (typeof t !== 'string') return null;
    const m = /^(\d+) (\d+) (\d+)$/.exec(t);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  index.shirts = Object.entries(data)
    .filter(([, e]) => e.CanChooseDuringCharacterCustomization && !e.Texture)
    .map(([id, e]) => ({
      id,
      i: e.SpriteIndex,
      n: zhOf(e.DisplayName, 'Shirts', zh) ?? id,
      sleeves: !!e.HasSleeves,
      dye: !!e.CanBeDyed,
      dc: parseColor(e.DefaultColor),
      p: e.Price ?? 0,
    }))
    .sort((a, b) => a.i - b.i);
  console.log(`shirts: ${index.shirts.length} 件创建可选上衣`);
}

// ── 4. 裤子：创建可选 ──
{
  const data = readJson(path.join(DUMP, 'Data/Pants.json'));
  const zh = readJson(path.join(DUMP, 'Strings/Pants.zh-CN.json'));
  const parseColor = (t) => {
    if (typeof t !== 'string') return null;
    const m = /^(\d+) (\d+) (\d+)$/.exec(t);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  index.pants = Object.entries(data)
    .filter(([, e]) => e.CanChooseDuringCharacterCustomization && !e.Texture)
    .map(([id, e]) => ({
      id,
      i: e.SpriteIndex,
      n: zhOf(e.DisplayName, 'Pants', zh) ?? id,
      dye: !!e.CanBeDyed,
      dc: parseColor(e.DefaultColor),
      p: e.Price ?? 0,
    }))
    .sort((a, b) => a.i - b.i);
  console.log(`pants: ${index.pants.length} 条创建可选裤子`);
}

// ── 5. 宠物：Data/Pets.json 品种表（创建界面动物偏好用，原版只列 CanBeChosenAtStart）──
// 品种自带 Texture（如 Animals\cat3，整身帧表）+ IconTexture/IconSourceRect
// （创建界面显示的是 16×16 头像图标拉伸到 64×64 框——CharacterCustomization.draw 2931-2947）。
// 图标源在 LooseSprites\Cursors(.zh-CN 等)/Cursors_1_6 两张大表 → 构建期切片为 dataURL。
{
  const pets = readJson(path.join(DUMP, 'Data/Pets.json'));
  const iconSheets = {};
  const loadSheet = (name) => {
    if (!iconSheets[name]) {
      iconSheets[name] = PNG.sync.read(fs.readFileSync(path.join(DUMP, 'LooseSprites', name)));
    }
    return iconSheets[name];
  };
  const cropToDataUrl = (sheet, x, y, w, h) => {
    const out = new PNG({ width: w, height: h });
    for (let yy = 0; yy < h; yy++)
      for (let xx = 0; xx < w; xx++) {
        const si = ((y + yy) * sheet.width + (x + xx)) * 4;
        out.data.set(sheet.data.subarray(si, si + 4), (yy * w + xx) * 4);
      }
    return 'data:image/png;base64,' + PNG.sync.write(out).toString('base64');
  };
  index.pets = Object.entries(pets)
    .map(([type, v]) => ({
      type,
      breeds: (v.Breeds ?? [])
        .filter((b) => b.CanBeChosenAtStart)
        .map((b) => {
          const sheetName = String(b.IconTexture ?? '').split('\\').pop() + '.png';
          const rect = b.IconSourceRect ?? { X: 0, Y: 0, Width: 16, Height: 16 };
          return {
            id: String(b.Id),
            tex: String(b.Texture ?? '').split('\\').pop() + '.png',
            icon: cropToDataUrl(loadSheet(sheetName), rect.X, rect.Y, rect.Width, rect.Height),
          };
        }),
    }))
    .filter((t) => t.breeds.length > 0);
  console.log(
    `pets: ${index.pets.map((t) => `${t.type}×${t.breeds.length}`).join(' + ')} 个开局可选品种（含头像图标）`
  );
}

// ── 6. 作物价目（打卡收获出货 + 种子店分级）：收获物卖价 + 种子买价（Price×2 商店加成）+ 季节 ──
{
  const crops = readJson(path.join(DUMP, 'Data/Crops.json'));
  const objects = readJson(path.join(DUMP, 'Data/Objects.json'));
  const zhObjects = readJson(path.join(DUMP, 'Strings/Objects.zh-CN.json'));
  const shops = readJson(path.join(DUMP, 'Data/Shops.json'));
  const seedConds = {};
  for (const it of shops['SeedShop']?.Items ?? []) {
    const id = String(it.ItemId ?? '').replace('(O)', '');
    if (id && it.Condition) seedConds[id] = String(it.Condition);
  }
  const out = {};
  let skipped = 0;
  for (const [seedId, crop] of Object.entries(crops)) {
    const seedItem = objects[seedId];
    const obj = objects[String(crop.HarvestItemId ?? '')];
    if (!seedItem || !obj) {
      skipped++;
      continue;
    }
    const tex = String(obj.Texture ?? '').replaceAll('\\\\', '\\').toLowerCase();
    const sheet = !obj.Texture ? 'so' : tex === 'tilesheets\\objects_2' ? 'o2' : null;
    if (!sheet || !Number.isInteger(obj.SpriteIndex)) {
      skipped++;
      continue;
    }
    // 原版商店买价 = Objects.Price × 2（SeedShop DefaultMarkup Multiply 2）；
    // 上架条件 Condition（season/YEAR）原版为季节门槛，本插件换算为耕种等级档位，
    // 条件原文存 seasons/cond 供 UI 展示。
    const cond = seedConds[seedId] ?? '';
    const year2 = /YEAR 2/.test(cond);
    out[seedId] = {
      price: obj.Price ?? 0,
      i: obj.SpriteIndex,
      sheet,
      n: zhOf(obj.DisplayName, 'Objects', zhObjects) ?? String(obj.Name ?? ''),
      seedBuy: (seedItem.Price ?? 0) * 2,
      seedI: seedItem.SpriteIndex ?? 0,
      seasons: (crop.Seasons ?? []).map((x) => x[0]).join(''),
      year2,
    };
  }
  index.crops = out;
  console.log(`crops: ${Object.keys(out).length} 种作物（价目+种子买价+季节，跳过 ${skipped}）`);
}

// ── 7. 动物（Data/FarmAnimals.json，可购买品种）：House 绑定建筑 + PurchasePrice + 商店图标 ──
{
  const fa = readJson(path.join(DUMP, 'Data/FarmAnimals.json'));
  const zh = readJson(path.join(DUMP, 'Strings/FarmAnimals.zh-CN.json'));
  const re = new RegExp('\\[LocalizedText Strings\\\\+FarmAnimals:(.+?)\\]');
  const out = [];
  for (const [key, v] of Object.entries(fa)) {
    if (v.SkipForRandomSale || (v.PurchasePrice ?? -1) < 0) continue; // 特殊获得（虚空/金鸡等）不在商店
    const m = re.exec(v.DisplayName ?? '');
    const shop = v.ShopSourceRect ?? { X: 0, Y: 0, Width: 32, Height: 16 };
    const sheet = PNG.sync.read(fs.readFileSync(path.join(DUMP, 'LooseSprites', String(v.ShopTexture ?? 'LooseSprites\\Cursors').split('\\').pop() + '.png')));
    const crop = new PNG({ width: shop.Width, height: shop.Height });
    for (let yy = 0; yy < shop.Height; yy++)
      for (let xx = 0; xx < shop.Width; xx++) {
        const si = ((shop.Y + yy) * sheet.width + (shop.X + xx)) * 4;
        crop.data.set(sheet.data.subarray(si, si + 4), (yy * shop.Width + xx) * 4);
      }
    out.push({
      id: key,
      n: m ? (zh[m[1]] ?? key) : key,
      house: String(v.House ?? ''),
      price: v.PurchasePrice ?? 0,
      icon: 'data:image/png;base64,' + PNG.sync.write(crop).toString('base64'),
    });
  }
  index.animals = out;
  console.log(`animals: ${out.length} 种可购买牲畜`);
}

// ── 8. 材料元数据（打卡产出 + 建造消耗的物品）：Objects.json 名称/卖价/springobjects 图标索引 ──
{
  const objects = readJson(path.join(DUMP, 'Data/Objects.json'));
  const zhObjects = readJson(path.join(DUMP, 'Strings/Objects.zh-CN.json'));
  const IDS = [
    '388', '390', '382', '378', '380', '334', '335', '337', '338', '709', '771', '330', '152',
  ];
  const out = {};
  for (const id of IDS) {
    const e = objects[id];
    if (!e) continue;
    const m = new RegExp('\\[LocalizedText Strings\\\\+Objects:(.+?)\\]').exec(e.DisplayName ?? '');
    out[id] = { n: m ? (zhObjects[m[1]] ?? e.Name) : e.Name, price: e.Price ?? 0, i: e.SpriteIndex ?? 0 };
  }
  index.materials = out;
  console.log(`materials: ${Object.keys(out).length} 种材料元数据`);
}

fs.writeFileSync(path.join(OUT, 'farmer-index.json'), JSON.stringify(index));
console.log(`farmer-index.json → ${path.join(OUT, 'farmer-index.json')}`);
