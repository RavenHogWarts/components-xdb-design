// game.ts —— 游戏化结算层（checkin-design.md §4/§5/§6，G2+G3）
// XP/金币/解锁的全部数值集中在常量，UI 不暴露配置。
// 语义（对齐原版）：
//   XP：打卡 = 照料 + 收获；连击越高经验越多，成熟日双倍；曲线 = Farmer.checkForLevelGain。
//   出货：收获 1 件作物按 Objects.json 原版售价入当日出货箱；成熟日丰收 +3 倍。
//   睡觉结算：次日首开展示"上次结算"报告（出货明细 + 经验 + 升级），数据在打卡时
//   即时入账 profile.pending，展示后清除——不丢单日数据，无待结算队列。
//   解锁：耕种等级解锁新作物（Lv2/4/6/8/10 各一档，按售价升序）；建筑金币购买
//   （连续打卡赠送线保留：7 天筒仓 / 30 天温室 / 100 天祝尼魔屋）。

import { PlayerProfile, XP_THRESHOLDS, STARTER_CROPS, levelFromXp } from './profile';
import { HabitData } from './habit';
import FARMER_INDEX from '../assets/data/farmer-index.json';
import BUILDINGS_INDEX from '../assets/data/buildings-index.json';

interface GameIndex {
  crops: Record<string, { price: number; i: number; sheet: 'so' | 'o2'; n: string; seedBuy?: number; seasons?: string; year2?: boolean }>;
  materials: Record<string, { n: string; price: number; i: number }>;
  animals: { id: string; n: string; house: string; price: number; icon: string }[];
}
const IDX = FARMER_INDEX as unknown as GameIndex;

/** 材料元数据（名/卖价/图标索引，Objects.json 权威数据） */
export const MATERIAL_META: Record<string, { n: string; price: number; i: number }> =
  IDX.materials as any;

/** 建筑材料需求（Data/Buildings.json BuildMaterials）：type → [材料id, 数量][] */
export function buildingMaterials(type: string): [string, number][] {
  return (BUILDINGS_INDEX as any)[type]?.bm ?? [];
}

/** 可购买动物（Pets 之外的第二类商品，FarmAnimals.json 权威数据） */
export const BUYABLE_ANIMALS = IDX.animals ?? [];

// ── 数值配置 ──

export const XP_CONFIG = {
  base: 12, // 每次打卡基础经验
  comboCap: 30, // 连击加成封顶天数
  comboDiv: 60, // 加成除数：×(1 + min(streak,30)/60)，最高 ×1.5
  matureMult: 2, // 成熟日双倍
  harvestBonusMult: 3, // 丰收出货额外倍数
};

/** 单次打卡经验（streakAfter = 打卡后的连击数） */
export function xpForCheckIn(streakAfter: number, goal: number): number {
  let xp = XP_CONFIG.base * (1 + Math.min(streakAfter, XP_CONFIG.comboCap) / XP_CONFIG.comboDiv);
  if (streakAfter >= goal) xp *= XP_CONFIG.matureMult;
  return Math.round(xp);
}

/** 技能等级内进度（0-1，Lv.10 满级返回 1） */
export function levelProgress(xp: number): { level: number; pct: number } {
  const level = levelFromXp(xp);
  if (level >= 10) return { level: 10, pct: 1 };
  const floor = level === 0 ? 0 : XP_THRESHOLDS[level - 1];
  const next = XP_THRESHOLDS[level];
  return { level, pct: Math.min(1, (xp - floor) / (next - floor)) };
}

// ── 作物解锁（种子店）：无解锁费，按耕种等级自动解锁；档位按收获物价升序 ──

export interface CropInfo {
  seedId: string;
  name: string;
  /** 收获物卖价（出货收入；同时是解锁档位的分级键） */
  price: number;
  /** 种子买价 = Objects.Price × 2（SeedShop DefaultMarkup）；0 = 特殊途径（绿洲/节日） */
  seedBuy: number;
  /** 原版季节（S/SF/W 首字母缩写，参考展示） */
  seasons: string;
  year2: boolean;
  /** 收获物图标：sheet + SpriteIndex */
  i: number;
  sheet: 'so' | 'o2';
}

const ALL_CROPS: CropInfo[] = Object.entries(IDX.crops ?? {})
  .map(([seedId, c]) => ({
    seedId,
    name: c.n,
    price: c.price,
    seedBuy: c.seedBuy ?? 0,
    seasons: c.seasons ?? '',
    year2: !!c.year2,
    i: c.i,
    sheet: c.sheet,
  }))
  .sort((a, b) => a.price - b.price || a.seedId.localeCompare(b.seedId));

/** 耕种等级 → 可选作物（开局 5 种 + Lv2/4/6/8/10 依次按种子买价升序解锁 5 档） */
export function cropsUnlockedFor(farmingLevel: number): CropInfo[] {
  const rest = ALL_CROPS.filter((c) => !STARTER_CROPS.includes(c.seedId));
  const per = Math.ceil(rest.length / 5);
  const tiers = Math.max(0, Math.min(5, Math.floor(farmingLevel / 2)));
  const out: CropInfo[] = ALL_CROPS.filter((c) => STARTER_CROPS.includes(c.seedId));
  for (let t = 0; t < tiers; t++) out.push(...rest.slice(t * per, (t + 1) * per));
  return out;
}

/** 升级提示：达到的耕种等级是否带来新解锁 */
export function unlockHintFor(farmingLevel: number): string | null {
  const lv = Math.min(farmingLevel, 10);
  return farmingLevel >= 2 && lv % 2 === 0 ? `新作物种子已解锁（耕种 Lv.${lv}）` : null;
}

// ── 建筑价目（金币购买；赠送线三条并行）──

export interface BuildingOffer {
  type: string;
  name: string;
  price: number;
  /** 连续打卡 N 天免费赠送（0 = 仅购买） */
  giftDays: number;
}

const PRICES: [string, number][] = [
  ['Shipping Bin', 300],
  ['Silo', 500],
  ['Pet Bowl', 600],
  ['Well', 800],
  ['Stable', 1200],
  ['Coop', 1600],
  ['Barn', 2200],
  ['Shed', 2600],
  ['Big Coop', 3200],
  ['Big Shed', 3600],
  ['Big Barn', 4200],
  ['Mill', 4000],
  ['Stone Cabin', 4600],
  ['Fish Pond', 5200],
  ['Slime Hutch', 6000],
  ['Deluxe Coop', 6400],
  ['Deluxe Barn', 7600],
  ['Greenhouse', 8800],
  ['Gold Clock', 10000],
  ['Earth Obelisk', 11000],
  ['Water Obelisk', 11000],
  ['Desert Obelisk', 12000],
  ['Island Obelisk', 13000],
  ['Junimo Hut', 15000],
];

const GIFT_DAYS: Record<string, number> = { Silo: 7, Greenhouse: 30, 'Junimo Hut': 100 };

/** 建筑购买目录（售价升序；giftDays = 连续打卡赠送线） */
export const BUILDING_CATALOG: BuildingOffer[] = PRICES.map(([type, price]) => ({
  type,
  name: type,
  price,
  giftDays: GIFT_DAYS[type] ?? 0,
})).sort((a, b) => a.price - b.price);

// ── 结算（打卡奖励入账 + 待展示报告）──

export interface PendingReport {
  date: string;
  /** 出货明细：收获物名 × 价格 */
  items: { n: string; p: number }[];
  /** 各技能经验增量 */
  xp: Record<string, number>;
  /** 升级与解锁事件文案 */
  events: string[];
}

/** 连击赠送线：任一习惯 best 跨过阈值 → 免费赠送对应建筑（未拥有才返回） */
export function giftsForBest(best: number, owned: string[]): BuildingOffer[] {
  return BUILDING_CATALOG.filter((b) => b.giftDays > 0 && best >= b.giftDays && !owned.includes(b.type));
}

// ── 材料产出（S1：打卡按技能产建造材料，farm-systems-design §3.1）──

const MAT_PRODUCE: Record<string, { base: [string, number][]; chance: [string, number][] }> = {
  mining: { base: [['390', 2]], chance: [['382', 1], ['378', 1], ['380', 1]] },
  foraging: { base: [['388', 2]], chance: [['709', 1], ['771', 2]] },
  farming: { base: [['330', 1]], chance: [['388', 1]] },
  fishing: { base: [], chance: [['330', 1], ['152', 1]] },
  combat: { base: [['382', 1]], chance: [['338', 1]] },
};

const chance35 = () => Math.random() < 0.35;
const choose = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

/** 打卡材料产出：[{材料id, 数量}]（入仓库 + 结算报告） */
export function materialsForCheckIn(skill: string): { id: string; count: number }[] {
  const rule = MAT_PRODUCE[skill];
  if (!rule) return [];
  const out = new Map<string, number>();
  for (const [id, n] of rule.base) out.set(id, (out.get(id) ?? 0) + n);
  if (chance35()) {
    const [id, n] = choose(rule.chance);
    out.set(id, (out.get(id) ?? 0) + n);
  }
  return [...out.entries()].map(([id, count]) => ({ id, count }));
}

// ── 建筑购买（金币 + 材料，S1）──

/** 材料缺口：返回 [材料id, 还缺数量][]，空数组 = 可购买 */
export function buildingMaterialShortage(
  profile: PlayerProfile,
  type: string
): [string, number][] {
  return buildingMaterials(type)
    .map(([id, need]) => [id, need - (profile.warehouse?.[id] ?? 0)] as [string, number])
    .filter(([, lack]) => lack > 0);
}

/** 支付建筑材料（扣仓库；调用前先用 shortage 校验） */
export function payBuildingMaterials(profile: PlayerProfile, type: string): void {
  profile.warehouse ??= {};
  for (const [id, need] of buildingMaterials(type)) {
    profile.warehouse[id] = (profile.warehouse[id] ?? 0) - need;
  }
}

// ── 种子库存（S1：商店购买 → 新建习惯消耗）──

export function seedStock(profile: PlayerProfile, seedId: string): number {
  return profile.seeds?.[seedId] ?? 0;
}

export function buySeed(profile: PlayerProfile, seedId: string, seedBuy: number): boolean {
  if ((profile.gold ?? 0) < seedBuy) return false;
  profile.gold = (profile.gold ?? 0) - seedBuy;
  profile.seeds ??= {};
  profile.seeds[seedId] = (profile.seeds[seedId] ?? 0) + 1;
  return true;
}

/** 新建习惯消耗一颗种子；库存不足返回 false（老习惯不受影响） */
export function consumeSeed(profile: PlayerProfile, seedId: string): boolean {
  profile.seeds ??= {};
  if ((profile.seeds[seedId] ?? 0) <= 0) return false;
  profile.seeds[seedId] -= 1;
  return true;
}

/** 打卡奖励入账（直接改 profile；调用方负责持久化）。
 *  habit 需为打卡后状态（streak/best 已更新）。 */
export function applyCheckInRewards(profile: PlayerProfile, habit: HabitData, today: string): {
  xp: number;
  gold: number;
  matured: boolean;
  levelUps: string[];
  cropName: string;
} {
  const streakAfter = Math.max(0, habit.streak);
  const matured = streakAfter >= habit.goal;
  const xp = xpForCheckIn(streakAfter, habit.goal);
  const skill = habit.skill;
  const crop = (IDX.crops ?? {})[habit.crop];
  const cropName = crop?.n ?? '作物';
  const price = crop?.price ?? 20;
  const gold = price + (matured ? price * XP_CONFIG.harvestBonusMult : 0);

  const before = levelFromXp(profile.skills?.[skill] ?? 0);
  profile.skills ??= { farming: 0, mining: 0, foraging: 0, fishing: 0, combat: 0 };
  profile.skills[skill] = (profile.skills[skill] ?? 0) + xp;
  const after = levelFromXp(profile.skills[skill]);

  profile.gold = (profile.gold ?? 0) + gold;

  const levelUps: string[] = [];
  if (after > before) {
    levelUps.push(`${skillLabel(skill)} Lv.${after}！`);
    const hint = unlockHintFor(after);
    if (skill === 'farming' && hint) levelUps.push(hint);
  }
  // 连击赠送线（best 跨阈值免费赠送）
  profile.unlocked ??= { crops: [], buildings: [] };
  const gifts = giftsForBest(Math.max(habit.best, 0), profile.unlocked.buildings);
  for (const g of gifts) {
    profile.unlocked.buildings.push(g.type);
    levelUps.push(`🎉 达成 ${g.giftDays} 天连击，「${g.name}」已入驻农场！`);
  }

  // 待展示报告（同日累计，跨日新建）
  if (!profile.pending || profile.pending.date !== today) {
    profile.pending = { date: today, items: [], xp: {}, mats: [], events: [] };
  }
  profile.pending.items.push({ n: cropName, p: gold });
  profile.pending.xp[skill] = (profile.pending.xp[skill] ?? 0) + xp;
  profile.pending.events.push(...levelUps);

  return { xp, gold, matured, levelUps, cropName };
}

/** 打卡材料产出入仓库，并记入待展示结算报告 */
export function addPendingMaterials(
  profile: PlayerProfile,
  produced: { id: string; count: number }[]
): { n: string; c: number }[] {
  profile.warehouse ??= {};
  const named: { n: string; c: number }[] = [];
  for (const { id, count } of produced) {
    profile.warehouse[id] = (profile.warehouse[id] ?? 0) + count;
    const n = MATERIAL_META[id]?.n ?? id;
    named.push({ n, c: count });
  }
  if (named.length) {
    profile.pending ??= { date: '', items: [], xp: {}, mats: [], events: [] };
    for (const { n, c } of named) {
      profile.pending.mats.push({ n, c });
    }
  }
  return named;
}

function skillLabel(id: string): string {
  return { farming: '耕种', mining: '采矿', foraging: '采集', fishing: '钓鱼', combat: '战斗' }[id] ?? id;
}

// ── 材料产出（S1：打卡按技能产建造材料，farm-systems-design §3.1）──
