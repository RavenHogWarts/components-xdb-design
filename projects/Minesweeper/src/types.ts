// ═════════════════════════════════════════════════════════════
// 插件元数据常量（规范见 .agents/skills/xdb-plugin-skills）
// 本文件是唯一读取构建注入常量（__PLUGIN_*__）的地方，
// 其余源码一律从本文件导入，不要直接使用注入常量。
// ═════════════════════════════════════════════════════════════

/** XDB 插件唯一 ID（全局唯一、稳定；来源 package.json 的 id 字段） */
export const PLUGIN_ID: string = __PLUGIN_ID__;

/** 插件显示名称（来源 package.json 的 name 字段） */
export const PLUGIN_NAME: string = __PLUGIN_NAME__;

/** 插件描述（来源 package.json 的 description 字段） */
export const PLUGIN_DESCRIPTION: string = __PLUGIN_DESCRIPTION__;

/** 插件作者（来源 package.json 的 author 字段） */
export const PLUGIN_AUTHOR: string = __PLUGIN_AUTHOR__;

/** 插件版本（来源 package.json 的 version 字段） */
export const PLUGIN_VERSION: string = __PLUGIN_VERSION__;

/** 插件图标，Lucide PascalCase（来源 package.json 的 icon 字段） */
export const PLUGIN_ICON: string = __PLUGIN_ICON__;

/** 视图类型 ID（View registry 内唯一，带插件命名空间） */
export const VIEW_TYPE = `${PLUGIN_ID}:view`;

/** 设置 Tab ID */
export const SETTINGS_TAB_ID = `${PLUGIN_ID}:settings`;

/**
 * 样式类名前缀：由插件 id 派生（kebab → camel + --），与 style.css 中的选择器一致。
 * components-- 为宿主保留前缀，不可使用；若修改 package.json 的 id 需同步更新 style.css。
 */
export const CSS_PREFIX = `${PLUGIN_ID.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())}--`;

// ═════════════════════════════════════════════════════════════
// 游戏选项（持久化在 viewDefinition.options[PLUGIN_ID]）
// ═════════════════════════════════════════════════════════════

/** 难度：初级 9×9×10 / 中级 16×16×40 / 高级 30×16×99（经典配置） */
export type MineLevel = 'beginner' | 'intermediate' | 'expert';

/** 模式：每日一局（同日同难度，同首击同雷局）/ 自由练习 */
export type MineMode = 'daily' | 'free';

/** 难度展示顺序（设置页与切换器共用） */
export const LEVEL_ORDER: readonly MineLevel[] = ['beginner', 'intermediate', 'expert'];

export const LEVEL_LABELS: Record<MineLevel, string> = {
  beginner: '初级',
  intermediate: '中级',
  expert: '高级',
};

export const LEVEL_CONFIG: Record<MineLevel, { cols: number; rows: number; mines: number }> = {
  beginner: { cols: 9, rows: 9, mines: 10 },
  intermediate: { cols: 16, rows: 16, mines: 40 },
  expert: { cols: 30, rows: 16, mines: 99 },
};

export const MODE_LABELS: Record<MineMode, string> = {
  daily: '每日一局',
  free: '自由练习',
};

export interface MineGameOptions {
  /** 自由模式默认难度（下一局生效；每日难度按日轮换不可设） */
  level: MineLevel;
  /** 上次游玩的模式（重新进入视图时恢复） */
  mode: MineMode;
  /** 完成后把战绩写入当前数据库（需要 source 支持 createRow） */
  recordScores: boolean;
  /** 最近完成每日一局的日期键（YYYY-MM-DD）：当天重进显示完成标记 */
  dailyDone?: string;
}

export const DEFAULT_GAME_OPTIONS: MineGameOptions = {
  level: 'beginner',
  mode: 'free',
  recordScores: false,
};

export function isMineLevel(value: unknown): value is MineLevel {
  return value === 'beginner' || value === 'intermediate' || value === 'expert';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 防御性解析 options[PLUGIN_ID]：手改 .xdb 或旧版本数据可能缺字段/类型漂移 */
export function parseGameOptions(raw: unknown): MineGameOptions {
  if (!isRecord(raw)) return { ...DEFAULT_GAME_OPTIONS };
  const { level, mode, recordScores, dailyDone } = raw;
  return {
    level: isMineLevel(level) ? level : 'beginner',
    mode: mode === 'daily' ? 'daily' : 'free',
    recordScores: recordScores === true,
    dailyDone: typeof dailyDone === 'string' && dailyDone.length > 0 ? dailyDone : undefined,
  };
}

// ═════════════════════════════════════════════════════════════
// 战绩统计（持久化在 viewDefinition.options[PLUGIN_ID].stats）
// ═════════════════════════════════════════════════════════════

export interface MineStatsRecord {
  /** 胜利局数 */
  solved: number;
  /** 总局数（含失败） */
  games: number;
  /** 各难度最佳用时（ms，仅胜利局） */
  best: Partial<Record<MineLevel, number>>;
  lastDate?: string;
}

export function parseGameStats(raw: unknown): MineStatsRecord | null {
  if (!isRecord(raw)) return null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const solved = Math.max(0, Math.round(num(raw.solved)));
  const games = Math.max(0, Math.round(num(raw.games)));
  if (solved <= 0 && games <= 0) return null;
  const best: Partial<Record<MineLevel, number>> = {};
  if (isRecord(raw.best)) {
    for (const l of LEVEL_ORDER) {
      const v = num(raw.best[l]);
      if (v > 0) best[l] = Math.round(v);
    }
  }
  return {
    solved,
    games,
    best,
    lastDate: typeof raw.lastDate === 'string' ? raw.lastDate : undefined,
  };
}

// ═════════════════════════════════════════════════════════════
// 进度存档（自由模式存 options.save，每日模式存 options.dailySave；
// 每次翻格/插旗后防抖快照，终局清除，退出重进可继续）
// ═════════════════════════════════════════════════════════════

export interface MineSaveSlot {
  v: 1;
  mode: MineMode;
  level: MineLevel;
  /** daily 模式的日期键 YYYY-MM-DD（本地时区），跨日作废 */
  day?: string;
  /** 已布雷（false = 尚未首击，盘面无雷） */
  placed: boolean;
  /** 雷格索引（仅 placed 时有效） */
  mines: number[];
  /** 已翻开格索引 */
  revealed: number[];
  /** 已插旗格索引 */
  flags: number[];
  /** 终局状态 */
  state: 'ready' | 'playing' | 'won' | 'lost';
  /** 触雷格（lost 时有效） */
  explodedAt: number;
  elapsedMs: number;
  savedAt: string;
}

function parseIndices(raw: unknown, max: number): number[] | null {
  if (!Array.isArray(raw)) return null;
  const out: number[] = [];
  const seen = new Set<number>();
  for (const v of raw) {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v >= max || seen.has(v)) {
      return null;
    }
    seen.add(v);
    out.push(v);
  }
  return out;
}

/** 防御性解析存档：结构不符/版本未知一律视为无存档 */
export function parseGameSave(raw: unknown): MineSaveSlot | null {
  if (!isRecord(raw) || raw.v !== 1) return null;
  if (raw.mode !== 'daily' && raw.mode !== 'free') return null;
  if (!isMineLevel(raw.level)) return null;
  if (
    raw.state !== 'ready' &&
    raw.state !== 'playing' &&
    raw.state !== 'won' &&
    raw.state !== 'lost'
  ) {
    return null;
  }
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const cfg = LEVEL_CONFIG[raw.level];
  const total = cfg.cols * cfg.rows;
  let mines: number[] = [];
  if (raw.state !== 'ready') {
    const parsed = parseIndices(raw.mines, total);
    if (parsed === null || parsed.length !== cfg.mines) return null;
    mines = parsed;
  }
  const revealed = parseIndices(raw.revealed, total);
  const flags = parseIndices(raw.flags, total);
  if (revealed === null || flags === null) return null;
  if (raw.state === 'won') {
    // 胜利局：翻开的必须恰为全部非雷格
    if (revealed.length !== total - cfg.mines) return null;
    if (revealed.some((i) => mines.includes(i))) return null;
  }
  const exploded = raw.explodedAt;
  if (
    raw.state === 'lost' &&
    (typeof exploded !== 'number' || !Number.isInteger(exploded) || exploded < 0 || exploded >= total)
  ) {
    return null;
  }
  return {
    v: 1,
    mode: raw.mode,
    level: raw.level,
    day: typeof raw.day === 'string' ? raw.day : undefined,
    placed: raw.state !== 'ready' ? true : raw.placed === true,
    mines,
    revealed,
    flags,
    state: raw.state,
    explodedAt: raw.state === 'lost' ? Math.max(0, Math.round(num(raw.explodedAt))) : 0,
    elapsedMs: Math.max(0, Math.round(num(raw.elapsedMs))),
    savedAt: typeof raw.savedAt === 'string' ? raw.savedAt : new Date().toISOString(),
  };
}

// ═════════════════════════════════════════════════════════════
// 宿主注入的 props（完整字段以 skill references/types/database.md 为准）
// 游戏不读取行数据，使用 registerView() 的 ViewProps 形状。
// ═════════════════════════════════════════════════════════════

/** Plain View props：container / api / viewId / viewDefinition / 非持久化 state */
export interface MineViewProps {
  container: HTMLElement;
  viewId: string;
  /** 当前一轮的完整持久化 View 定义；按只读数据使用 */
  viewDefinition: any;
  api: any;
  state: {
    get(key: string): unknown;
    set(key: string, value: unknown): void;
    delete(key: string): void;
  };
  app: any;
  moment: any;
}

/** View Settings props：读写当前 view 的插件配置 */
export interface ViewSettingsProps {
  container: HTMLElement;
  viewDefinition: any;
  /** 写回完整 View 定义（返回 Promise）；优先函数形式并保留未知字段 */
  setViewDefinition: (updater: (current: any) => any) => Promise<void>;
  /** 宿主标准设置控件 builder（声明式，见 skill references/types/setting-ui.md） */
  setting: any;
  api?: any;
  viewId?: string;
  moment?: any;
}
