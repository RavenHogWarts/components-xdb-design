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

/** 难度（近似由提示数刻画：简单 40 / 中等 34 / 困难 30 / 专家 26） */
export type SudokuDifficulty = 'easy' | 'medium' | 'hard' | 'expert';

/** 模式：每日一题（同日同题、难度按日轮换）/ 自由练习 */
export type SudokuMode = 'daily' | 'free';

/** 难度展示顺序（设置页与切换器共用） */
export const DIFFICULTY_ORDER: readonly SudokuDifficulty[] = ['easy', 'medium', 'hard', 'expert'];

export const DIFFICULTY_LABELS: Record<SudokuDifficulty, string> = {
  easy: '简单',
  medium: '中等',
  hard: '困难',
  expert: '专家',
};

export const MODE_LABELS: Record<SudokuMode, string> = {
  daily: '每日一题',
  free: '自由练习',
};

export interface SudokuOptions {
  /** 自由模式默认难度（下一局生效；每日难度按日轮换不可设） */
  difficulty: SudokuDifficulty;
  /** 上次游玩的模式（重新进入视图时恢复） */
  mode: SudokuMode;
  /** 同数高亮：选中数字时高亮棋盘上所有同数字 */
  highlightSame: boolean;
  /** 错误高亮：与唯一解不符的填入标红 */
  showConflicts: boolean;
  /** 完成后把战绩写入当前数据库（需要 source 支持 createRow） */
  recordScores: boolean;
}

export const DEFAULT_GAME_OPTIONS: SudokuOptions = {
  difficulty: 'medium',
  mode: 'free',
  highlightSame: true,
  showConflicts: true,
  recordScores: false,
};

export function isSudokuDifficulty(value: unknown): value is SudokuDifficulty {
  return (
    value === 'easy' || value === 'medium' || value === 'hard' || value === 'expert'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 防御性解析 options[PLUGIN_ID]：手改 .xdb 或旧版本数据可能缺字段/类型漂移 */
export function parseGameOptions(raw: unknown): SudokuOptions {
  if (!isRecord(raw)) return { ...DEFAULT_GAME_OPTIONS };
  const { difficulty, mode, highlightSame, showConflicts, recordScores } = raw;
  return {
    difficulty: isSudokuDifficulty(difficulty) ? difficulty : 'medium',
    mode: mode === 'daily' ? 'daily' : 'free',
    highlightSame: highlightSame !== false,
    showConflicts: showConflicts !== false,
    recordScores: recordScores === true,
  };
}

// ═════════════════════════════════════════════════════════════
// 战绩统计（持久化在 viewDefinition.options[PLUGIN_ID].stats）
// ═════════════════════════════════════════════════════════════

export interface SudokuStatsRecord {
  /** 完成局数 */
  solved: number;
  /** 累计用时（ms） */
  totalTime: number;
  /** 各难度最佳用时（ms） */
  best: Partial<Record<SudokuDifficulty, number>>;
  lastDate?: string;
}

export function parseGameStats(raw: unknown): SudokuStatsRecord | null {
  if (!isRecord(raw)) return null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const solved = Math.max(0, Math.round(num(raw.solved)));
  if (solved <= 0) return null;
  const best: Partial<Record<SudokuDifficulty, number>> = {};
  if (isRecord(raw.best)) {
    for (const d of DIFFICULTY_ORDER) {
      const v = num(raw.best[d]);
      if (v > 0) best[d] = Math.round(v);
    }
  }
  return {
    solved,
    totalTime: Math.max(0, Math.round(num(raw.totalTime))),
    best,
    lastDate: typeof raw.lastDate === 'string' ? raw.lastDate : undefined,
  };
}

// ═════════════════════════════════════════════════════════════
// 进度存档（自由模式存 options.save，每日模式存 options.dailySave；
// 每次落子/铅笔/擦除后防抖快照，完成时清除，退出重进可继续）
// ═════════════════════════════════════════════════════════════

export interface SudokuSaveSlot {
  v: 1;
  mode: SudokuMode;
  difficulty: SudokuDifficulty;
  /** daily 模式的日期键 YYYY-MM-DD（本地时区），跨日作废 */
  day?: string;
  /** 81 格：题面，0 = 空 */
  puzzle: number[];
  /** 81 格：唯一解 */
  solution: number[];
  /** 81 格：玩家填入，0 = 空 */
  values: number[];
  /** 81 格：铅笔候选位掩码（bit d-1 → 数字 d） */
  pencils: number[];
  /** 已用提示次数 */
  hints: number;
  /** 提示填出的格索引（样式区分） */
  hinted: number[];
  /** 累计用时（ms） */
  elapsedMs: number;
  savedAt: string;
}

function parseGrid(raw: unknown, len: number, max: number): number[] | null {
  if (!Array.isArray(raw) || raw.length !== len) return null;
  const out: number[] = [];
  for (const v of raw) {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > max) return null;
    out.push(v);
  }
  return out;
}

/** 防御性解析存档：结构不符/版本未知一律视为无存档 */
export function parseGameSave(raw: unknown): SudokuSaveSlot | null {
  if (!isRecord(raw) || raw.v !== 1) return null;
  if (raw.mode !== 'daily' && raw.mode !== 'free') return null;
  if (!isSudokuDifficulty(raw.difficulty)) return null;
  const puzzle = parseGrid(raw.puzzle, 81, 9);
  const solution = parseGrid(raw.solution, 81, 9);
  const values = parseGrid(raw.values, 81, 9);
  const pencils = parseGrid(raw.pencils, 81, 0x1ff);
  if (!puzzle || !solution || !values || !pencils) return null;
  if (solution.some((v) => v === 0)) return null;
  // 题面非零格必须是解的子集（否则存档自相矛盾）
  for (let i = 0; i < 81; i++) {
    if (puzzle[i] !== 0 && puzzle[i] !== solution[i]) return null;
  }
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  let hints = Math.max(0, Math.round(num(raw.hints)));
  if (!Number.isFinite(num(raw.hints))) hints = 0;
  const hinted: number[] = [];
  if (Array.isArray(raw.hinted)) {
    for (const h of raw.hinted) {
      if (typeof h === 'number' && Number.isInteger(h) && h >= 0 && h < 81) hinted.push(h);
    }
  }
  return {
    v: 1,
    mode: raw.mode,
    difficulty: raw.difficulty,
    day: typeof raw.day === 'string' ? raw.day : undefined,
    puzzle,
    solution,
    values,
    pencils,
    hints,
    hinted,
    elapsedMs: Math.max(0, Math.round(num(raw.elapsedMs))),
    savedAt: typeof raw.savedAt === 'string' ? raw.savedAt : new Date().toISOString(),
  };
}

// ═════════════════════════════════════════════════════════════
// 宿主注入的 props（完整字段以 skill references/types/database.md 为准）
// 游戏不读取行数据，使用 registerView() 的 ViewProps 形状。
// ═════════════════════════════════════════════════════════════

/** Plain View props：container / api / viewId / viewDefinition / 非持久化 state */
export interface SudokuViewProps {
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
