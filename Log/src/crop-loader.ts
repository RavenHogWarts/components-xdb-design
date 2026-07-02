/**
 * crop-loader.ts
 * 在构建时将 Crops.json 内联进 bundle（esbuild loader: json）。
 * 运行时直接从内存对象派生 CropConfig[]，零 vault IO。
 */

import { CropConfig, CropStage } from './sprite-helper';
// esbuild 的 json loader 会把此文件直接内联为 JS 对象
import CROPS_RAW from '../stardew-habit/Crops.json';


/** Crops.json 单条目的结构（只声明我们需要的字段） */
interface CropsEntry {
  DaysInPhase: number[];
  IsRaised: boolean;
  HarvestItemId: string;
  Texture: string;
  SpriteIndex: number;
}

/**
 * 物品 ID → 中文名映射表。
 * 仅覆盖常见作物，其余回退为 "作物 {HarvestItemId}"。
 */
const HARVEST_NAMES: Record<string, string> = {
  '24':  '防风草 (Parsnip)',
  '188': '绿豆 (Green Bean)',
  '190': '椰菜 (Cauliflower)',
  '192': '土豆 (Potato)',
  '248': '郁金香 (Tulip)',
  '250': '甘蓝 (Kale)',
  '252': '大蒜 (Garlic)',
  '254': '大黄 (Rhubarb)',
  '256': '甜瓜 (Melon)',
  '258': '番茄 (Tomato)',
  '260': '蓝莓 (Blueberry)',
  '262': '向日葵 (Sunflower)',
  '264': '辣椒 (Hot Pepper)',
  '266': '杨桃 (Starfruit)',
  '268': '玉米 (Corn)',
  '270': '茄子 (Eggplant)',
  '272': '南瓜 (Pumpkin)',
  '276': '山药 (Yam)',
  '278': '蔓越莓 (Cranberry)',
  '280': '朝鲜蓟 (Artichoke)',
  '281': '小白菜 (Bok Choy)',
  '300': '苋菜 (Amaranth)',
  '304': '啤酒花 (Hops)',
  '398': '葡萄 (Grape)',
  '400': '草莓 (Strawberry)',
  '433': '咖啡豆 (Coffee Bean)',
  '90':  '仙人掌果 (Cactus Fruit)',
  '271': '稻米 (Rice)',
  '830': '芋头 (Taro Root)',
  '832': '香蕉 (Banana)',
};

/**
 * 已知成熟阶段为 32px 高（双行）的 SpriteIndex 集合。
 * 判断依据：IsRaised=true（藤蔓），或目视 crops.png 确认有大型成熟贴图。
 *
 * 规则：
 *  - IsRaised=true 的作物（攀爬型）成熟态必为 32px
 *  - 其余通过目视 crops.png 逐行确认
 *
 * 保守策略：不确定的默认 16px，避免截断下一行。
 */
const DOUBLE_HEIGHT_SPRITE_INDEXES = new Set<number>([
  1,  // 绿豆（IsRaised）
  2,  // 椰菜
  4,  // 郁金香（成熟有大花）
  7,  // 大黄
  8,  // 甜瓜
  9,  // 番茄（IsRaised）
  10, // 蓝莓
  11, // 向日葵
  12, // 辣椒（IsRaised）
  13, // 杨桃
  14, // 玉米（IsRaised 类型）
  15, // 茄子（IsRaised）
  16, // 南瓜
  19, // 朝鲜蓟
  20, // 蔓越莓
  37, // 啤酒花（IsRaised）
  38, // 葡萄（IsRaised）
]);

/** 模块级缓存，避免重复计算 */
let _cachedConfigs: CropConfig[] | null = null;

/**
 * 从内联的 Crops.json 数据派生完整的 CropConfig 列表。
 * 结果被缓存，多次调用无额外开销。
 *
 * @returns 按 SpriteIndex 升序排列的作物配置数组
 */
export function getCropConfigs(): CropConfig[] {
  if (_cachedConfigs) return _cachedConfigs;

  const data = CROPS_RAW as Record<string, CropsEntry>;
  const result: CropConfig[] = [];

  for (const [seedId, entry] of Object.entries(data)) {
    // 仅处理使用标准作物贴图的条目
    if (!entry.Texture?.toLowerCase().includes('crops')) continue;

    const spriteIndex: number = entry.SpriteIndex ?? 0;
    // 核心公式：crops.png 每视觉行 32px = 2个16px基础网格行
    const row: number = spriteIndex * 2;

    const phaseCount: number = entry.DaysInPhase?.length ?? 4;
    const isDoubleAtMaturity: boolean =
      entry.IsRaised === true || DOUBLE_HEIGHT_SPRITE_INDEXES.has(spriteIndex);

    // 生成各生长阶段的精灵坐标
    // 阶段 0 = 种子（col=0），阶段 phaseCount = 最终成熟（col=phaseCount）
    const stages: CropStage[] = [];
    for (let i = 0; i <= phaseCount; i++) {
      const isMature = i === phaseCount;
      stages.push({
        col: i,
        row,
        // 成熟且判定为双行高度时使用 32px，其余一律 16px
        height: isMature && isDoubleAtMaturity ? 32 : 16,
      });
    }

    const name = HARVEST_NAMES[entry.HarvestItemId] ?? `作物 ${entry.HarvestItemId}`;

    result.push({ id: seedId, name, stages });
  }

  // 按 SpriteIndex（row/2）升序排列，确保下拉列表顺序稳定
  result.sort((a, b) => (a.stages[0]?.row ?? 0) - (b.stages[0]?.row ?? 0));

  _cachedConfigs = result;
  return result;
}
