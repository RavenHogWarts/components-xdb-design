// habit.ts —— 打卡数据层（docs/checkin-design.md §2/§3 的实现）
// 习惯 = 本 database（file source）的一行：一个 vault 文件，元数据在 frontmatter。
// 打卡 = 先往 daily note 写 checkbox 留痕（失败不阻断），再 updateRow 写
// last/streak/best；宿主随后重发数据驱动视图刷新，视图不自建订阅。
//
// 字段约定（frontmatter 根级键）：
//   type: habit    插件识别标记（幂等 filter）
//   skill          farming|mining|foraging|fishing|combat（主题分类）
//   crop           图鉴作物 seedId（crop-faces.json 的键）→ 生长可视化
//   goal           目标连续天数（成熟阈值）
//   streak / best  当前连续 / 历史最长（打卡时更新，以本字段为渲染源）
//   last           最后打卡日 ISO（YYYY-MM-DD），防重复 + 连续性判定

import { DatabaseViewProps, PLUGIN_ID } from '../types';

export const HABIT_TYPE = 'habit';
/** 默认作物：防风草（Parsnip Seeds，seedId 472；477 实为羽衣甘蓝） */
export const DEFAULT_CROP = '472';
export const DEFAULT_GOAL = 30;
export const TRACE_TAG = '#stardew/habit';

export type SkillId = 'farming' | 'mining' | 'foraging' | 'fishing' | 'combat';

export const SKILLS: { id: SkillId; label: string; color: string }[] = [
  { id: 'farming', label: '耕种', color: '#6cae3f' },
  { id: 'mining', label: '采矿', color: '#8a8f9a' },
  { id: 'foraging', label: '采集', color: '#d08b2f' },
  { id: 'fishing', label: '钓鱼', color: '#4f8fc0' },
  { id: 'combat', label: '战斗', color: '#c0453b' },
];

export function skillOf(id: unknown): { id: SkillId; label: string; color: string } {
  return SKILLS.find((s) => s.id === id) ?? SKILLS[0];
}

export interface HabitData {
  rowId: string;
  /** 习惯名（file basename） */
  name: string;
  skill: SkillId;
  crop: string;
  goal: number;
  streak: number;
  best: number;
  last: string | null;
}

export interface CheckinConfig {
  /** 打卡时往 daily note 写 checkbox 留痕 */
  trace: boolean;
  /** 留痕所在 heading（完整标题行） */
  traceHeading: string;
}

/** 从 viewDefinition.options[pluginId] 读打卡配置（缺省全兜底） */
export function readCheckinConfig(viewDefinition: any): CheckinConfig {
  const o = viewDefinition?.options?.[PLUGIN_ID];
  return {
    trace: typeof o?.trace === 'boolean' ? o.trace : true,
    traceHeading:
      typeof o?.traceHeading === 'string' && o.traceHeading.trim() ? o.traceHeading : '🌱 星露谷农场',
  };
}

// ── 纯计算 ──

export const todayIso = (props: DatabaseViewProps) => props.moment().format('YYYY-MM-DD');
export const yesterdayIso = (props: DatabaseViewProps) =>
  props.moment().subtract(1, 'day').format('YYYY-MM-DD');

export function isDoneToday(h: HabitData, today: string): boolean {
  return h.last === today;
}

/** 漏卡不清档：昨天有打卡则 +1，否则从 1 重新开始（对齐"作物不浇水只是不长"） */
export function nextStreak(h: HabitData, yesterday: string): number {
  return h.last === yesterday ? h.streak + 1 : 1;
}

/** streak → 生长阶段索引：0 = 种子，达成 goal = 成熟（封顶） */
export function stageIndex(streak: number, goal: number, stageCount: number): number {
  const g = Math.max(goal, 1);
  const idx = Math.floor((Math.min(streak, g) / g) * stageCount);
  return Math.min(idx, stageCount - 1);
}

// ── 行数据解析 ──

function parseHabit(row: any): HabitData | null {
  const item = row?.$item;
  if (!item || item.type !== HABIT_TYPE) return null;
  const name = item.file?.basename ?? String(row.id ?? '').split('/').pop()?.replace(/\.md$/, '') ?? '未命名';
  return {
    rowId: String(row.id),
    name,
    skill: (SKILLS.find((s) => s.id === item.skill)?.id ?? 'farming') as SkillId,
    crop: typeof item.crop === 'string' && item.crop ? item.crop : DEFAULT_CROP,
    goal: Number.isFinite(item.goal) && item.goal > 0 ? item.goal : DEFAULT_GOAL,
    streak: Number.isFinite(item.streak) ? Math.max(0, item.streak) : 0,
    best: Number.isFinite(item.best) ? Math.max(0, item.best) : 0,
    last: typeof item.last === 'string' && item.last ? item.last : null,
  };
}

/**
 * 读取全部习惯：走 api.getAllData()（越过当前 View filter，打卡视图不受用户
 * 视图筛选影响），再按 type=habit 过滤。宿主数据变化会重新调 onUpdate，
 * 每轮 here 一次性查询，不自建订阅缓存。
 */
export async function loadHabits(props: DatabaseViewProps): Promise<HabitData[]> {
  const api = props.api;
  if (typeof api?.getAllData !== 'function') return [];
  const data = await api.getAllData();
  const habits = (data?.rows ?? [])
    .map(parseHabit)
    .filter((h: HabitData | null): h is HabitData => h !== null);
  habits.sort((a: HabitData, b: HabitData) => a.name.localeCompare(b.name, 'zh'));
  return habits;
}

/** task source 没有 createRow/updateRow 能力，农场页需降级为只读 */
export function isReadonlySource(props: DatabaseViewProps): boolean {
  try {
    const def = props.api?.getDefinition?.();
    return def?.source === 'task';
  } catch {
    return false;
  }
}

// ── 写操作 ──

/** file.source 行 id（路径）→ wikilink 目标（去 .md） */
function wikilink(rowId: string): string {
  return rowId.replace(/\.md$/i, '');
}

/**
 * daily note 留痕：今日笔记固定 heading 下追加一条已完成 checkbox。
 * 幂等：已有同习惯留痕则跳过。任何失败都只返回 false，不抛出（不阻断打卡）。
 */
export async function leaveTrace(
  props: DatabaseViewProps,
  habit: HabitData,
  cfg: CheckinConfig
): Promise<boolean> {
  try {
    const dn = props.dailyNotes;
    if (!dn?.get || !dn?.create || !props.tasks?.add) return false;
    const today = todayIso(props);
    const file = (await dn.get(today)) ?? (await dn.create(today));
    if (!file?.path) return false;

    const content = `${habit.name} [[${wikilink(habit.rowId)}]] ${TRACE_TAG}`;
    // 幂等检查：当天已留痕（无论勾没勾）则不再追加
    const existing = await props.tasks.getFromFile(file.path).catch(() => []);
    if (Array.isArray(existing) && existing.some((t: any) => t.text?.includes(TRACE_TAG) && t.text?.includes(habit.name))) {
      return true;
    }
    try {
      await props.tasks.add(file.path, content, {
        position: 'BottomUnderHeading',
        headingLine: cfg.traceHeading,
      });
    } catch {
      // heading 不存在等场景：退化为笔记末尾追加
      await props.tasks.add(file.path, content, { position: 'BottomOfNote' });
    }
    // tasks.add 新增的是未勾选任务，补一次勾选（找不到就不强求）
    const tasks = await props.tasks.getFromFile(file.path).catch(() => []);
    const mine = Array.isArray(tasks)
      ? tasks.find((t: any) => t.status === ' ' && t.text?.includes(content.slice(0, habit.name.length + 2)) && t.text?.includes(TRACE_TAG))
      : null;
    if (mine && props.tasks.setStatus) {
      await props.tasks.setStatus(file.path, mine.pos, 'x').catch(() => undefined);
    }
    return true;
  } catch {
    return false;
  }
}

export interface CheckinResult {
  ok: boolean;
  message: string;
  /** 留痕是否成功（ok=true 时有意义；false = 未配置/失败，打卡本身成功） */
  traced: boolean;
  /** 打卡后的连击数与历史最长（写库值，供游戏结算复用；失败路径为当前值） */
  streak: number;
  best: number;
}

/**
 * 打卡链路（docs/checkin-design.md §3）：留痕 → updateRow(last/streak/best)。
 * 返回新 row id 由调用方接住（文件重命名等可能改变 id），随后主动 reload
 * 一次以便即时反馈（宿主 republish 也会再驱动一轮）。
 */
export async function checkIn(
  props: DatabaseViewProps,
  habit: HabitData,
  cfg: CheckinConfig
): Promise<CheckinResult & { rowId: string }> {
  const today = todayIso(props);
  if (isDoneToday(habit, today)) {
    return { ok: false, message: '今天已经打过卡啦', traced: false, rowId: habit.rowId, streak: habit.streak, best: habit.best };
  }
  const api = props.api;
  if (typeof api?.updateRow !== 'function' && typeof api?.updateCell !== 'function') {
    return { ok: false, message: '当前数据源不支持写入打卡数据', traced: false, rowId: habit.rowId, streak: habit.streak, best: habit.best };
  }
  if (typeof api.canUpdateCell === 'function' && !api.canUpdateCell('streak')) {
    return { ok: false, message: '字段 streak 不可写，无法打卡', traced: false, rowId: habit.rowId, streak: habit.streak, best: habit.best };
  }

  // 1) 留痕（失败不阻断）
  const traced = cfg.trace ? await leaveTrace(props, habit, cfg) : false;

  // 2) 写 frontmatter（updateRow 优先；返回可能变化后的新 row id）
  const streak = nextStreak(habit, yesterdayIso(props));
  const best = Math.max(habit.best, streak);
  const values = { last: today, streak, best };
  let rowId = habit.rowId;
  try {
    if (typeof api.updateRow === 'function') {
      rowId = await api.updateRow(habit.rowId, values);
    } else {
      for (const [field, value] of Object.entries(values)) {
        rowId = await api.updateCell(rowId, field, value);
      }
    }
  } catch (e: any) {
    return {
      ok: false,
      message: `打卡写入失败：${e?.message ?? e}`,
      traced,
      rowId: habit.rowId,
      streak: habit.streak,
      best: habit.best,
    };
  }
  return {
    ok: true,
    message: traced ? `${habit.name} 打卡成功` : `${habit.name} 打卡成功（日记未留痕）`,
    traced,
    rowId,
    streak,
    best,
  };
}

export interface NewHabitInput {
  name: string;
  skill: SkillId;
  crop: string;
  goal: number;
}

/** 创建习惯 = api.createRow（file source 可选能力，缺省时提示用原生表格） */
export async function createHabit(
  props: DatabaseViewProps,
  input: NewHabitInput
): Promise<{ ok: boolean; message: string }> {
  const name = input.name.trim();
  if (!name) return { ok: false, message: '习惯名不能为空' };
  const api = props.api;
  if (typeof api?.createRow !== 'function') {
    return { ok: false, message: '当前数据源不支持新建，请在表格视图手动添加（frontmatter 加 type: habit）' };
  }
  try {
    await api.createRow({
      viewId: props.viewId,
      values: {
        'file.basename': name,
        type: HABIT_TYPE,
        skill: input.skill,
        crop: input.crop,
        goal: Math.max(1, Math.round(input.goal) || DEFAULT_GOAL),
        streak: 0,
        best: 0,
      },
    });
    return { ok: true, message: `已创建习惯「${name}」` };
  } catch (e: any) {
    return { ok: false, message: `创建失败：${e?.message ?? e}` };
  }
}

/** 打开习惯文件（M2：行 ↔ 笔记互跳） */
export function openHabitNote(props: DatabaseViewProps, habit: HabitData): void {
  try {
    const link = props.api?.getRowLink?.(habit.rowId);
    const target = link?.href ?? habit.rowId;
    props.app?.workspace?.openLinkText?.(target, '', false);
  } catch {
    // 打开失败静默（预览环境无 workspace）
  }
}
