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

/** AI 难度：简单（只会眼前棋）/ 中等（一档棋型贪心）/ 困难（α-β 深 4）/ 专家（迭代加深） */
export type AiLevel = 'easy' | 'medium' | 'hard' | 'expert';

/** 对战模式：人机（AI 难度可选）/ 双人（本地同屏） */
export type GameMode = 'ai' | 'local';

/** 玩家执子（人机模式）：黑先 / 白后 */
export type PlayerColor = 'black' | 'white';

export const AI_ORDER: readonly AiLevel[] = ['easy', 'medium', 'hard', 'expert'];

export const AI_LABELS: Record<AiLevel, string> = {
  easy: '简单',
  medium: '中等',
  hard: '困难',
  expert: '专家',
};

export const MODE_LABELS: Record<GameMode, string> = {
  ai: '人机对战',
  local: '双人',
};

/** 棋子颜色常量：0 空 / 1 黑 / 2 白（盘面与存档通用） */
export const BLACK = 1;
export const WHITE = 2;
export const COLOR_LABELS: Record<number, string> = { [BLACK]: '黑', [WHITE]: '白' };

export interface GomokuOptions {
  /** 对战模式 */
  mode: GameMode;
  /** AI 难度（仅人机模式） */
  aiLevel: AiLevel;
  /** 玩家执子（仅人机模式；双人固定黑先） */
  playerColor: PlayerColor;
}

export const DEFAULT_GAME_OPTIONS: GomokuOptions = {
  mode: 'ai',
  aiLevel: 'medium',
  playerColor: 'black',
};

export function isAiLevel(value: unknown): value is AiLevel {
  return value === 'easy' || value === 'medium' || value === 'hard' || value === 'expert';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 防御性解析 options[PLUGIN_ID]：手改 .xdb 或旧版本数据可能缺字段/类型漂移 */
export function parseGameOptions(raw: unknown): GomokuOptions {
  if (!isRecord(raw)) return { ...DEFAULT_GAME_OPTIONS };
  const { mode, aiLevel, playerColor } = raw;
  return {
    mode: mode === 'local' ? 'local' : 'ai',
    aiLevel: isAiLevel(aiLevel) ? aiLevel : 'medium',
    playerColor: playerColor === 'white' ? 'white' : 'black',
  };
}

// ═════════════════════════════════════════════════════════════
// 战绩统计（持久化在 viewDefinition.options[PLUGIN_ID].stats）
// 人机模式按玩家视角计胜负；双人模式只计总局数与和棋数
// ═════════════════════════════════════════════════════════════

export interface GomokuStatsRecord {
  /** 总局数 */
  games: number;
  /** 玩家胜（仅人机模式） */
  wins: number;
  /** 玩家负（仅人机模式） */
  losses: number;
  /** 和棋 */
  draws: number;
  lastDate?: string;
}

export function parseGameStats(raw: unknown): GomokuStatsRecord | null {
  if (!isRecord(raw)) return null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const games = Math.max(0, Math.round(num(raw.games)));
  if (games <= 0) return null;
  return {
    games,
    wins: Math.max(0, Math.round(num(raw.wins))),
    losses: Math.max(0, Math.round(num(raw.losses))),
    draws: Math.max(0, Math.round(num(raw.draws))),
    lastDate: typeof raw.lastDate === 'string' ? raw.lastDate : undefined,
  };
}

// ═════════════════════════════════════════════════════════════
// 进度存档（options.save：任意有效落子后防抖快照，终局清除）
// ═════════════════════════════════════════════════════════════

export interface GomokuSaveSlot {
  v: 1;
  /** 本局的模式 / 玩家执子快照；aiLevel 为最近一次生效的难度（可中途切换） */
  mode: GameMode;
  aiLevel: AiLevel;
  playerColor: PlayerColor;
  /** 着法序列（x * size + y），按落子顺序 */
  moves: number[];
  /** 终局状态：0 进行中 / BLACK 黑胜 / WHITE 白胜 / 3 和棋 */
  over: 0 | 1 | 2 | 3;
  savedAt: string;
}

const SIZE = 15;

/** 防御性解析存档：结构不符/版本未知一律视为无存档 */
export function parseGameSave(raw: unknown): GomokuSaveSlot | null {
  if (!isRecord(raw) || raw.v !== 1) return null;
  if (raw.mode !== 'ai' && raw.mode !== 'local') return null;
  if (!isAiLevel(raw.aiLevel)) return null;
  if (raw.playerColor !== 'black' && raw.playerColor !== 'white') return null;
  const over = raw.over;
  if (over !== 0 && over !== BLACK && over !== WHITE && over !== 3) return null;
  if (!Array.isArray(raw.moves) || raw.moves.length === 0) return null;
  const moves: number[] = [];
  const seen = new Set<number>();
  for (const m of raw.moves) {
    if (typeof m !== 'number' || !Number.isInteger(m) || m < 0 || m >= SIZE * SIZE) return null;
    if (seen.has(m)) return null; // 同格重复落子属非法存档
    seen.add(m);
    moves.push(m);
  }
  if (over !== 0 && moves.length >= SIZE * SIZE) return null;
  return {
    v: 1,
    mode: raw.mode,
    aiLevel: raw.aiLevel,
    playerColor: raw.playerColor,
    moves,
    over,
    savedAt: typeof raw.savedAt === 'string' ? raw.savedAt : new Date().toISOString(),
  };
}

/** 棋盘边长（固定 15×15 无禁手） */
export const BOARD_SIZE = SIZE;

// ═════════════════════════════════════════════════════════════
// 宿主注入的 props（完整字段以 skill references/types/database.md 为准）
// 游戏不读取行数据，使用 registerView() 的 ViewProps 形状。
// ═════════════════════════════════════════════════════════════

/** Plain View props：container / api / viewId / viewDefinition / 非持久化 state */
export interface GomokuViewProps {
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
