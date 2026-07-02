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
 *
 * 数据来源：从游戏原始解包数据派生（scripts/build-crop-names.mjs 自动生成）：
 *   Crops.json (HarvestItemId) → Objects.json (Name) → Strings/Objects.zh-CN.json ({Name}_Name)
 * 这是星露谷官方简体中文译名，覆盖全部 50 株使用标准 crops 贴图的作物。
 *
 * 历史问题：旧表为手写，多处错误，例如：
 *   - '248' 误标为「郁金香」，实为「蒜」（郁金香是 591）
 *   - '262' 误标为「向日葵」，实为「小麦」（向日葵是 421）
 *   - '272' 误标为「南瓜」，实为「茄子」（南瓜是 276）
 *   - '280' 误标为「朝鲜蓟」，实为「山药」（朝鲜蓟是 274）
 *   - '832' 误标为「香蕉」，实为「菠萝」（香蕉不在 crops 贴图里）
 */
const HARVEST_NAMES: Record<string, string> = {
  '24':   '防风草',       // Parsnip
  '188':  '青豆',         // Green Bean
  '190':  '花椰菜',       // Cauliflower
  '192':  '土豆',         // Potato
  '248':  '蒜',           // Garlic
  '250':  '甘蓝菜',       // Kale
  '252':  '大黄',         // Rhubarb
  '254':  '甜瓜',         // Melon
  '256':  '西红柿',       // Tomato
  '258':  '蓝莓',         // Blueberry
  '260':  '辣椒',         // Hot Pepper
  '262':  '小麦',         // Wheat
  '264':  '萝卜',         // Radish
  '266':  '红叶卷心菜',   // Red Cabbage
  '268':  '杨桃',         // Starfruit
  '270':  '玉米',         // Corn
  '272':  '茄子',         // Eggplant
  '274':  '洋蓟',         // Artichoke
  '276':  '南瓜',         // Pumpkin
  '278':  '小白菜',       // Bok Choy
  '280':  '山药',         // Yam
  '282':  '蔓越莓',       // Cranberries
  '284':  '甜菜',         // Beet
  '16':   '野山葵',       // Wild Horseradish (春季种子混合)
  '396':  '香味浆果',     // Spice Berry (夏季种子混合)
  '404':  '普通蘑菇',     // Common Mushroom (秋季种子混合)
  '412':  '冬根',         // Winter Root (冬季种子混合)
  '454':  '上古水果',     // Ancient Fruit
  '591':  '郁金香',       // Tulip
  '597':  '蓝爵',         // Blue Jazz
  '376':  '虞美人花',     // Poppy
  '593':  '夏季亮片',     // Summer Spangle
  '421':  '向日葵',       // Sunflower
  '595':  '玫瑰仙子',     // Fairy Rose
  '417':  '宝石甜莓',     // Sweet Gem Berry
  '271':  '未碾米',       // Unmilled Rice
  '400':  '草莓',         // Strawberry
  '304':  '啤酒花',       // Hops
  '398':  '葡萄',         // Grape
  '300':  '苋菜',         // Amaranth
  '433':  '咖啡豆',       // Coffee Bean
  '90':   '仙人掌果子',   // Cactus Fruit
  '830':  '芋头',         // Taro Root
  '832':  '菠萝',         // Pineapple
  '771':  '纤维',         // Fiber
  '889':  '齐瓜',         // Qi Fruit
  'Carrot':         '胡萝卜',       // Carrot (1.6 新增)
  'SummerSquash':   '金皮西葫芦',   // Summer Squash (1.6 新增)
  'Broccoli':       '西蓝花',       // Broccoli (1.6 新增)
  'Powdermelon':    '霜瓜',         // Powdermelon (1.6 新增)
};

// ─────────────────────────────────────────────────────────────
// crops.png 布局说明（2026-07-02 像素扫描重写，旧公式完全错误）
// ─────────────────────────────────────────────────────────────
// 图 256×1024 = 16 列 × 64 行（16px 网格）。**两大列布局**：
//   - 左半边 cols 0–7（8列）承载偶数 SpriteIndex
//   - 右半边 cols 8–15（8列）承载奇数 SpriteIndex
// 每个 SpriteIndex 占 2 行（32px），行对索引 = floor(SpriteIndex/2)。
// 坐标公式：
//   pairIdx   = floor(SpriteIndex / 2)
//   baseRow   = pairIdx * 2
//   colOffset = (SpriteIndex % 2 === 0) ? 0 : 8
//   col       = colOffset + i          (i = 阶段序号)
//   16px 阶段：row = baseRow + 1（奇数行/底部主行）
//   32px 双高：row = baseRow（偶数行起向下跨两行），height = 32
//
// 阶段数 = phaseCount + 2（phaseCount = DaysInPhase.length）：
//   i = 0 .. phaseCount-1        生长阶段
//   i = phaseCount               成熟可摘取（倒数第二）
//   i = phaseCount + 1           一次性作物=待摘取饱满态；多生循环=已摘等待重生
//
// 双高判定（数据驱动，来自 scripts/verify-crop-stages.mjs 像素扫描）：
//   - IsRaised=true（攀爬型 si 1/37/38）→ 所有阶段双高（全程带支架）
//   - 成熟阶段(i=pc) 且 si ∈ MATURITY_DOUBLE_HEIGHT_SI → 双高
//   - 最后阶段(i=pc+1) 且 si ∈ LAST_STAGE_DOUBLE_HEIGHT_SI → 双高
//   - 其余单行 16px
// ─────────────────────────────────────────────────────────────

/** 成熟态（i=phaseCount，倒数第二格）为 32px 双高的 SpriteIndex 集合 */
const MATURITY_DOUBLE_HEIGHT_SI = new Set<number>([
  1, 5, 7, 8, 9, 10, 11, 14, 15, 16, 17, 18, 20, 21, 24,
  29, 30, 31, 32, 34, 36, 37, 38, 39, 40, 41, 42, 43, 44, 47, 49, 50, 51,
]);

/** 最后态（i=phaseCount+1，最末格）为 32px 双高的 SpriteIndex 集合 */
const LAST_STAGE_DOUBLE_HEIGHT_SI = new Set<number>([
  0, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17, 18, 19, 20, 21, 24,
  30, 31, 32, 34, 36, 37, 38, 39, 40, 41, 42, 43, 44, 47, 48, 49, 50, 51,
]);

/** 模块级缓存，避免重复计算 */
let _cachedConfigs: CropConfig[] | null = null;

/**
 * 判断某 SpriteIndex 的第 i 阶段是否为 32px 双高。
 */
function isStageDoubleHeight(spriteIndex: number, phaseCount: number, i: number, isRaised: boolean): boolean {
  if (isRaised) return true; // 攀爬型全程带支架
  if (i === phaseCount) return MATURITY_DOUBLE_HEIGHT_SI.has(spriteIndex);
  if (i === phaseCount + 1) return LAST_STAGE_DOUBLE_HEIGHT_SI.has(spriteIndex);
  return false;
}

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
    const phaseCount: number = entry.DaysInPhase?.length ?? 4;
    const isRaised: boolean = entry.IsRaised === true;

    // 两大列布局坐标
    const pairIdx: number = Math.floor(spriteIndex / 2);
    const baseRow: number = pairIdx * 2;
    const colOffset: number = spriteIndex % 2 === 0 ? 0 : 8;

    // 生成各生长阶段的精灵坐标：0..phaseCount 共 phaseCount+2 个阶段
    const stages: CropStage[] = [];
    for (let i = 0; i <= phaseCount + 1; i++) {
      const isDoubleHeight = isStageDoubleHeight(spriteIndex, phaseCount, i, isRaised);
      stages.push({
        col: colOffset + i,
        // 32px 双高从偶数行（顶部）起跨两行；16px 精灵位于奇数行（底部）
        row: isDoubleHeight ? baseRow : baseRow + 1,
        height: isDoubleHeight ? 32 : 16,
      });
    }

    const name = HARVEST_NAMES[entry.HarvestItemId] ?? `作物 ${entry.HarvestItemId}`;

    result.push({ id: seedId, name, stages });
  }

  // 按 (baseRow, colOffset) 升序排列，等价于 SpriteIndex 升序，确保下拉列表顺序稳定。
  // 注意：stages[0].row 受首阶段是否双高影响（双高→row=baseRow，单行→row=baseRow+1），
  // 故需先还原 baseRow 再排序，否则 IsRaised 作物会错排到上一对行。
  const baseRowOf = (c: CropConfig): number => {
    const s0 = c.stages[0];
    if (!s0) return 0;
    return (s0.height ?? 16) === 32 ? s0.row : s0.row - 1;
  };
  result.sort((a, b) => {
    const ra = baseRowOf(a);
    const rb = baseRowOf(b);
    if (ra !== rb) return ra - rb;
    return (a.stages[0]?.col ?? 0) - (b.stages[0]?.col ?? 0);
  });

  _cachedConfigs = result;
  return result;
}
