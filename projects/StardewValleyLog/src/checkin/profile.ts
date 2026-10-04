// profile.ts —— 玩家存档（checkin-design.md §3.3/§4.1）
// 多存档槽（对齐原版"存档选择"体验）：
//   options[PLUGIN_ID].saves       槽位 → PlayerProfile（3 槽：slot-1/2/3）
//   options[PLUGIN_ID].activeSlot  当前进入的槽；null = 停在存档选择界面
//   options[PLUGIN_ID].defaultSlot 默认进入的槽（下次打开跳过选择）
// 兼容迁移：v1 的单槽 options[PLUGIN_ID].player 视为 slot-1。
// 所有写回都走"重读 definition → updateView"，保留同对象其它字段。

import { DatabaseViewProps, PLUGIN_ID } from '../types';
import { PlayerLook } from './farmerRenderer';

export interface PlayerProfile {
  look: PlayerLook;
  name: string;
  farmName: string;
  /** 动物偏好：类型 + 品种 id（Pets.json，开局可选猫 5 / 狗 5 品种） */
  pet: { type: 'Cat' | 'Dog'; breed: string };
  /** 五技能累计 XP */
  skills: Record<string, number>;
  gold: number;
  unlocked: { crops: string[]; buildings: string[] };
  /** 上次结算日（ISO），防重复结算 */
  lastSettle: string | null;
  /** 待展示的当日结算（打卡即时入账，次日首开展示后清除） */
  pending?: PendingReport;
  /** 仓库：物品 id → 数量（收获物按种子 id 记账，材料按 Objects id） */
  warehouse: Record<string, number>;
  /** 种子库存：种子 id → 数量（商店购买，新建习惯/补种消耗） */
  seeds: Record<string, number>;
  /** 已饲养动物（FarmAnimals.json 条目键） */
  animals: { id: string }[];
  createdAt: string;
}

export interface PendingReport {
  date: string;
  /** 出货明细：收获物名 × 金额 */
  items: { n: string; p: number }[];
  /** 各技能经验增量 */
  xp: Record<string, number>;
  /** 材料产出明细：材料名 × 数量 */
  mats: { n: string; c: number }[];
  /** 升级/解锁事件文案 */
  events: string[];
}

export interface SaveSlotIndex {
  saves: Record<string, PlayerProfile>;
  activeSlot: string | null;
  defaultSlot: string | null;
  /** v1 单槽迁移标记（内存态）：player 存在而 saves 不存在 */
  migrated: boolean;
}

export const SLOT_IDS = ['slot-1', 'slot-2', 'slot-3'] as const;

/** 开局解锁的春季基础作物（checkin-design.md §5.2；G3 消费） */
export const STARTER_CROPS = ['472', '473', '474', '475', '476'];

/** 原版 XP 曲线（Farmer.cs checkForLevelGain，Lv.1-10 累计阈值） */
export const XP_THRESHOLDS = [100, 380, 770, 1300, 2150, 3300, 4800, 6900, 10000, 15000];

export function levelFromXp(xp: number): number {
  let lv = 0;
  for (let i = 0; i < XP_THRESHOLDS.length; i++) {
    if (xp >= XP_THRESHOLDS[i]) lv = i + 1;
  }
  return lv;
}

// ── 读取 ──

function pluginOptionsOf(viewDefinition: any): Record<string, any> {
  return viewDefinition?.options?.[PLUGIN_ID] ?? {};
}

/** 读槽位索引；旧单槽 player 惰性迁移为 slot-1（migrated=true 表示尚需持久化） */
export function readSlotIndex(viewDefinition: any): SaveSlotIndex {
  const o = pluginOptionsOf(viewDefinition);
  const saves = (o.saves && typeof o.saves === 'object' ? { ...o.saves } : undefined) ?? null;
  if (saves) {
    return {
      saves,
      activeSlot: typeof o.activeSlot === 'string' ? o.activeSlot : null,
      defaultSlot: typeof o.defaultSlot === 'string' ? o.defaultSlot : null,
      migrated: false,
    };
  }
  if (o.player && typeof o.player === 'object') {
    return { saves: { 'slot-1': o.player as PlayerProfile }, activeSlot: null, defaultSlot: null, migrated: true };
  }
  return { saves: {}, activeSlot: null, defaultSlot: null, migrated: false };
}

export function readActiveProfile(viewDefinition: any): { slot: string; profile: PlayerProfile } | null {
  const idx = readSlotIndex(viewDefinition);
  if (!idx.activeSlot || !idx.saves[idx.activeSlot]) return null;
  return { slot: idx.activeSlot, profile: idx.saves[idx.activeSlot] };
}

// ── 写回（重读 definition → updateView，保留其它字段）──

async function patchPluginOptions(props: DatabaseViewProps, patch: Record<string, unknown>): Promise<void> {
  const api = props.api;
  const current = api.getDefinition?.().views?.find((v: any) => v.id === props.viewId);
  if (!current || typeof api.updateView !== 'function') {
    throw new Error('无法写入存档（当前环境不支持 updateView）');
  }
  await api.updateView({
    ...current,
    options: {
      ...(current.options ?? {}),
      [PLUGIN_ID]: {
        ...(current.options?.[PLUGIN_ID] ?? {}),
        ...patch,
      },
    },
  });
}

/** 保存指定槽位（新建或覆盖） */
export async function saveSlotProfile(
  props: DatabaseViewProps,
  slotId: string,
  profile: PlayerProfile
): Promise<void> {
  const idx = readSlotIndex(props.viewDefinition);
  const saves = { ...idx.saves, [slotId]: profile };
  await patchPluginOptions(props, { saves, activeSlot: slotId });
}

/** 激活槽位（进入游戏）；顺带把惰性迁移的旧单槽持久化 */
export async function activateSlot(props: DatabaseViewProps, slotId: string): Promise<void> {
  const idx = readSlotIndex(props.viewDefinition);
  const patch: Record<string, unknown> = { activeSlot: slotId };
  if (idx.migrated) patch.saves = idx.saves;
  await patchPluginOptions(props, patch);
}

/** 退出到存档选择 */
export async function exitToSlots(props: DatabaseViewProps): Promise<void> {
  await patchPluginOptions(props, { activeSlot: null });
}

/** 设置默认进入的槽位（再次传同槽 = 取消默认） */
export async function setDefaultSlot(props: DatabaseViewProps, slotId: string | null): Promise<void> {
  const idx = readSlotIndex(props.viewDefinition);
  const patch: Record<string, unknown> = { defaultSlot: idx.defaultSlot === slotId ? null : slotId };
  if (idx.migrated) patch.saves = idx.saves;
  await patchPluginOptions(props, patch);
}

/** 删除槽位存档（若为默认/激活槽一并清除） */
export async function deleteSlot(props: DatabaseViewProps, slotId: string): Promise<void> {
  const idx = readSlotIndex(props.viewDefinition);
  const saves = { ...idx.saves };
  delete saves[slotId];
  const patch: Record<string, unknown> = { saves };
  if (idx.activeSlot === slotId) patch.activeSlot = null;
  if (idx.defaultSlot === slotId) patch.defaultSlot = null;
  if (idx.migrated) patch.saves = saves;
  await patchPluginOptions(props, patch);
}

/** 清空全部存档（设置页） */
export async function clearAllSaves(props: DatabaseViewProps): Promise<void> {
  await patchPluginOptions(props, { saves: {}, activeSlot: null, defaultSlot: null });
}

/** 新档默认值 */
export function newProfile(
  look: PlayerLook,
  name: string,
  farmName: string,
  pet: { type: 'Cat' | 'Dog'; breed: string },
  today: string
): PlayerProfile {
  return {
    look,
    name: name.trim() || '农夫',
    farmName: farmName.trim() || '新农场',
    pet,
    skills: { farming: 0, mining: 0, foraging: 0, fishing: 0, combat: 0 },
    gold: 0,
    unlocked: { crops: [...STARTER_CROPS], buildings: [] },
    warehouse: {},
    seeds: {},
    animals: [],
    lastSettle: today,
    createdAt: today,
  };
}
