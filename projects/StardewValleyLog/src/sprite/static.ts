// static.ts —— 无数据文件驱动的贴图：hoeDirt / grass / houses
// 矩形边界来自 scripts/analyze-sheets.mjs 扫描；语义命名对照游戏精修（见设计文档第 7 节）。

import { SheetSpec, SpriteEntry, SpriteRect } from './types';
import HOE_DIRT_PNG from '../assets/sprites/hoeDirt.png';
import GRASS_PNG from '../assets/sprites/grass.png';
import HOUSES_PNG from '../assets/sprites/houses.png';
import A_CHICKEN_WHITE from '../assets/sprites/White Chicken.png';
import A_CHICKEN_BROWN from '../assets/sprites/Brown Chicken.png';
import A_CHICKEN_BLUE from '../assets/sprites/Blue Chicken.png';
import A_CHICKEN_VOID from '../assets/sprites/Void Chicken.png';
import A_CHICKEN_GOLDEN from '../assets/sprites/Golden Chicken.png';
import A_DUCK from '../assets/sprites/Duck.png';
import A_RABBIT from '../assets/sprites/Rabbit.png';
import A_DINOSAUR from '../assets/sprites/Dinosaur.png';
import A_COW_WHITE from '../assets/sprites/White Cow.png';
import A_COW_BROWN from '../assets/sprites/Brown Cow.png';
import A_GOAT from '../assets/sprites/Goat.png';
import A_SHEEP from '../assets/sprites/Sheep.png';
import A_PIG from '../assets/sprites/Pig.png';
import A_OSTRICH from '../assets/sprites/Ostrich.png';
import A_CAT from '../assets/sprites/cat.png';
import A_DOG from '../assets/sprites/dog.png';
import A_BABY_CHICKEN_WHITE from '../assets/sprites/BabyWhite Chicken.png';
import A_BABY_CHICKEN_BROWN from '../assets/sprites/BabyBrown Chicken.png';
import A_BABY_CHICKEN_BLUE from '../assets/sprites/BabyBlue Chicken.png';
import A_BABY_CHICKEN_VOID from '../assets/sprites/BabyVoid Chicken.png';
import A_BABY_CHICKEN_GOLDEN from '../assets/sprites/BabyGolden Chicken.png';
import A_BABY_RABBIT from '../assets/sprites/BabyRabbit.png';
import A_BABY_COW_WHITE from '../assets/sprites/BabyWhite Cow.png';
import A_BABY_COW_BROWN from '../assets/sprites/BabyBrown Cow.png';
import A_BABY_GOAT from '../assets/sprites/BabyGoat.png';
import A_BABY_SHEEP from '../assets/sprites/BabySheep.png';
import A_BABY_PIG from '../assets/sprites/BabyPig.png';
import A_BABY_OSTRICH from '../assets/sprites/BabyOstrich.png';
import A_SHEEP_SHEARED from '../assets/sprites/ShearedSheep.png';
import A_HORSE from '../assets/sprites/horse.png';
import A_TURTLE from '../assets/sprites/turtle.png';
import A_TURTLE1 from '../assets/sprites/turtle1.png';
import A_CAT1 from '../assets/sprites/cat1.png';
import A_CAT2 from '../assets/sprites/cat2.png';
import A_CAT3 from '../assets/sprites/cat3.png';
import A_CAT4 from '../assets/sprites/cat4.png';
import A_CAT5 from '../assets/sprites/cat5.png';
import A_DOG1 from '../assets/sprites/dog1.png';
import A_DOG2 from '../assets/sprites/dog2.png';
import A_DOG3 from '../assets/sprites/dog3.png';
import A_DOG4 from '../assets/sprites/dog4.png';
import A_DOG5 from '../assets/sprites/dog5.png';

// ── 耕地：hoeDirt.png 192×64 —— 布局经 1.6 源码 HoeDirt.draw 验证：
// 干土 16 种邻接形态（4 列×4 行，x0-63）；已浇灌 = 同形态右移 64px；
// 稻田水浇灌 = 右移 128px。即 cols 0-3/4-7/8-11 三组，各 16 形态。──

const DIRT_GROUPS = ['干土', '已浇灌', '稻田水浇灌'] as const;

export const hoeDirtSheet: SheetSpec = {
  id: 'nature',
  label: '耕地',
  category: 'TerrainFeatures',
  png: HOE_DIRT_PNG,
  imgW: 192,
  imgH: 64,
  entries: () => {
    const entries: SpriteEntry[] = [];
    for (let g = 0; g < DIRT_GROUPS.length; g++) {
      for (let pos = 0; pos < 16; pos++) {
        entries.push({
          key: `dirt-${g}-${pos}`,
          name: `${DIRT_GROUPS[g]} 形态${pos + 1}`,
          sub: '耕地土壤（4×4 邻接形态）',
          group: DIRT_GROUPS[g],
          sheet: 'nature',
          rect: { x: g * 64 + (pos % 4) * 16, y: Math.floor(pos / 4) * 16, w: 16, h: 16 },
        });
      }
    }
    return entries;
  },
};

// ── 草丛：grass.png 66×240 —— 布局经 1.6 源码 Grass.draw 验证：
// 15×20 格，whichWeed×15 为列（4 变体），grassSourceOffset 为行（每 20px 一档）：
//   普通草(type1) 春0/夏20/秋40/冬80；type2=60；type4=100；type5/6=120/140；
//   1.6 花草(type7) 春160/夏180/秋200/冬220。──

const GRASS_ROWS = [
  '普通草·春',
  '普通草·夏',
  '普通草·秋',
  '草丛·类型 2',
  '普通草·冬',
  '草丛·类型 4',
  '草丛·类型 5',
  '草丛·类型 6',
  '花草·春',
  '花草·夏',
  '花草·秋',
  '花草·冬',
] as const;

export const grassSheet: SheetSpec = {
  id: 'nature',
  label: '草丛',
  category: 'TerrainFeatures',
  png: GRASS_PNG,
  imgW: 66,
  imgH: 240,
  entries: () => {
    const entries: SpriteEntry[] = [];
    for (let r = 0; r < GRASS_ROWS.length; r++) {
      // 源码 whichWeed = Next(3)：游戏只用 3 个变体，第 4 列（x45+）不使用
      for (let w = 0; w < 3; w++) {
        entries.push({
          key: `grass-${r}-${w}`,
          name: `${GRASS_ROWS[r]} 变体${w + 1}`,
          sub: '草丛（15×20 格，3 变体）',
          group: GRASS_ROWS[r],
          sheet: 'nature',
          rect: { x: w * 15, y: r * 20, w: 15, h: 20 },
        });
      }
    }
    return entries;
  },
};

// ── 建筑：农舍 3 级（144×144 纵向堆叠，x=16）──

const HOUSE_LEVELS = ['农舍 Lv.1', '农舍 Lv.2', '农舍 Lv.3'];

export const buildingsSheet: SheetSpec = {
  id: 'buildings',
  label: '农舍',
  category: 'Buildings',
  png: HOUSES_PNG,
  imgW: 272,
  imgH: 432,
  entries: () =>
    HOUSE_LEVELS.map((name, i) => ({
      key: `house-${i}`,
      name,
      sub: '农舍外观',
      sheet: 'buildings' as const,
      rect: { x: 16, y: i * 144, w: 144, h: 144 },
    })),
};

// ── 动物：Animals/ 帧网格，页签按物种归组（成年/幼年/花色同页）──
// 帧尺寸经 1.6 源码/数据验证：
// FarmAnimal 帧尺寸来自 Data/FarmAnimals.json（鸡类/鸭/兔/恐龙 16×16，
// 牛/羊/猪/鸵鸟 32×32），贴图固定 4 列（源码要求 Width == 4×SpriteWidth）；
// 猫/狗为 Cat.cs/Dog.cs 的 AnimatedSprite(0, 32, 32)。──

interface AnimalVariant {
  key: string;
  name: string;
  png: string;
  imgW: number;
  imgH: number;
  frame: number;
}

const ANIMAL_SPECIES: { label: string; variants: AnimalVariant[] }[] = [
  {
    label: '鸡',
    variants: [
      { key: 'chicken-white', name: '白鸡', png: A_CHICKEN_WHITE, imgW: 64, imgH: 112, frame: 16 },
      { key: 'chicken-brown', name: '棕鸡', png: A_CHICKEN_BROWN, imgW: 64, imgH: 112, frame: 16 },
      { key: 'chicken-blue', name: '蓝鸡', png: A_CHICKEN_BLUE, imgW: 64, imgH: 112, frame: 16 },
      { key: 'chicken-void', name: '虚空鸡', png: A_CHICKEN_VOID, imgW: 64, imgH: 112, frame: 16 },
      { key: 'chicken-golden', name: '金鸡', png: A_CHICKEN_GOLDEN, imgW: 64, imgH: 112, frame: 16 },
      { key: 'baby-chicken-white', name: '幼年白鸡', png: A_BABY_CHICKEN_WHITE, imgW: 64, imgH: 224, frame: 16 },
      { key: 'baby-chicken-brown', name: '幼年棕鸡', png: A_BABY_CHICKEN_BROWN, imgW: 64, imgH: 112, frame: 16 },
      { key: 'baby-chicken-blue', name: '幼年蓝鸡', png: A_BABY_CHICKEN_BLUE, imgW: 64, imgH: 112, frame: 16 },
      { key: 'baby-chicken-void', name: '幼年虚空鸡', png: A_BABY_CHICKEN_VOID, imgW: 64, imgH: 112, frame: 16 },
      { key: 'baby-chicken-golden', name: '幼年金鸡', png: A_BABY_CHICKEN_GOLDEN, imgW: 64, imgH: 224, frame: 16 },
    ],
  },
  { label: '鸭', variants: [{ key: 'duck', name: '鸭', png: A_DUCK, imgW: 64, imgH: 224, frame: 16 }] },
  {
    label: '兔子',
    variants: [
      { key: 'rabbit', name: '兔子', png: A_RABBIT, imgW: 64, imgH: 112, frame: 16 },
      { key: 'baby-rabbit', name: '幼年兔子', png: A_BABY_RABBIT, imgW: 64, imgH: 112, frame: 16 },
    ],
  },
  { label: '恐龙', variants: [{ key: 'dinosaur', name: '恐龙', png: A_DINOSAUR, imgW: 64, imgH: 112, frame: 16 }] },
  {
    label: '牛',
    variants: [
      { key: 'cow-white', name: '白牛', png: A_COW_WHITE, imgW: 128, imgH: 160, frame: 32 },
      { key: 'cow-brown', name: '棕牛', png: A_COW_BROWN, imgW: 128, imgH: 160, frame: 32 },
      { key: 'baby-cow-white', name: '幼年白牛', png: A_BABY_COW_WHITE, imgW: 128, imgH: 160, frame: 32 },
      { key: 'baby-cow-brown', name: '幼年棕牛', png: A_BABY_COW_BROWN, imgW: 128, imgH: 160, frame: 32 },
    ],
  },
  {
    label: '山羊',
    variants: [
      { key: 'goat', name: '山羊', png: A_GOAT, imgW: 128, imgH: 160, frame: 32 },
      { key: 'baby-goat', name: '幼年山羊', png: A_BABY_GOAT, imgW: 128, imgH: 160, frame: 32 },
    ],
  },
  {
    label: '绵羊',
    variants: [
      { key: 'sheep', name: '绵羊', png: A_SHEEP, imgW: 128, imgH: 160, frame: 32 },
      { key: 'sheep-sheared', name: '绵羊·剪毛后', png: A_SHEEP_SHEARED, imgW: 128, imgH: 160, frame: 32 },
      { key: 'baby-sheep', name: '幼年绵羊', png: A_BABY_SHEEP, imgW: 128, imgH: 160, frame: 32 },
    ],
  },
  {
    label: '猪',
    variants: [
      { key: 'pig', name: '猪', png: A_PIG, imgW: 128, imgH: 160, frame: 32 },
      { key: 'baby-pig', name: '幼年猪', png: A_BABY_PIG, imgW: 128, imgH: 160, frame: 32 },
    ],
  },
  {
    label: '鸵鸟',
    variants: [
      { key: 'ostrich', name: '鸵鸟', png: A_OSTRICH, imgW: 128, imgH: 160, frame: 32 },
      { key: 'baby-ostrich', name: '幼年鸵鸟', png: A_BABY_OSTRICH, imgW: 128, imgH: 160, frame: 32 },
    ],
  },
  { label: '马', variants: [{ key: 'horse', name: '马', png: A_HORSE, imgW: 224, imgH: 128, frame: 32 }] },
  {
    label: '猫',
    variants: [
      { key: 'cat', name: '猫', png: A_CAT, imgW: 128, imgH: 256, frame: 32 },
      { key: 'cat1', name: '猫·花色1', png: A_CAT1, imgW: 128, imgH: 256, frame: 32 },
      { key: 'cat2', name: '猫·花色2', png: A_CAT2, imgW: 128, imgH: 256, frame: 32 },
      { key: 'cat3', name: '猫·花色3', png: A_CAT3, imgW: 128, imgH: 288, frame: 32 },
      { key: 'cat4', name: '猫·花色4', png: A_CAT4, imgW: 128, imgH: 288, frame: 32 },
      { key: 'cat5', name: '猫·花色5', png: A_CAT5, imgW: 128, imgH: 288, frame: 32 },
    ],
  },
  {
    label: '狗',
    variants: [
      { key: 'dog', name: '狗', png: A_DOG, imgW: 128, imgH: 288, frame: 32 },
      { key: 'dog1', name: '狗·花色1', png: A_DOG1, imgW: 128, imgH: 288, frame: 32 },
      { key: 'dog2', name: '狗·花色2', png: A_DOG2, imgW: 128, imgH: 288, frame: 32 },
      { key: 'dog3', name: '狗·花色3', png: A_DOG3, imgW: 128, imgH: 288, frame: 32 },
      { key: 'dog4', name: '狗·花色4', png: A_DOG4, imgW: 128, imgH: 288, frame: 32 },
      { key: 'dog5', name: '狗·花色5', png: A_DOG5, imgW: 128, imgH: 288, frame: 32 },
    ],
  },
  {
    label: '宠物龟',
    variants: [
      { key: 'turtle', name: '宠物龟', png: A_TURTLE, imgW: 128, imgH: 288, frame: 32 },
      { key: 'turtle1', name: '宠物龟·花色2', png: A_TURTLE1, imgW: 128, imgH: 288, frame: 32 },
    ],
  },
];

export const animalsSheets: SheetSpec[] = ANIMAL_SPECIES.map((species) => {
  const head = species.variants[0];
  return {
    id: 'nature' as const,
    label: species.label,
    category: 'Animals',
    png: head.png,
    imgW: head.imgW,
    imgH: head.imgH,
    entries: () =>
      species.variants.map((v) => {
        const cols = v.imgW / v.frame;
        const rows = v.imgH / v.frame;
        const frames: SpriteRect[] = [];
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            frames.push({ x: c * v.frame, y: r * v.frame, w: v.frame, h: v.frame });
          }
        }
        // 每个变体各是一张独立文件：条目卡面与胶片条都指向自己的贴图
        const source = { png: v.png, imgW: v.imgW, imgH: v.imgH };
        return {
          key: `animal-${v.key}`,
          name: v.name,
          sub: `${v.frame}×${v.frame} 帧，${cols}列 × ${rows}行`,
          sheet: 'nature' as const,
          source,
          rect: frames[0],
          strip: frames.map((rect) => ({ rect, source })),
        };
      }),
  };
});
