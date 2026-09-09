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

export type Difficulty = 'easy' | 'normal' | 'hard';
export type SwingSpeed = 'auto' | 'slow' | 'normal' | 'fast';

export interface GameOptions {
  difficulty: Difficulty;
  swingSpeed: SwingSpeed;
  /** 每关时间上限（秒） */
  timeLimit: number;
  sound: boolean;
  /** 每局结束把战绩写入当前数据库（需要 source 支持 createRow） */
  recordScores: boolean;
}

export interface GameStatsRecord {
  bestScore: number;
  bestLevel: number;
  totalCoins: number;
  games: number;
  lastDate?: string;
}

export const DEFAULT_GAME_OPTIONS: GameOptions = {
  difficulty: 'normal',
  swingSpeed: 'auto',
  timeLimit: 60,
  sound: true,
  recordScores: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 防御性解析 options[PLUGIN_ID]：手改 .xdb 或旧版本数据可能缺字段/类型漂移 */
export function parseGameOptions(raw: unknown): GameOptions {
  if (!isRecord(raw)) return { ...DEFAULT_GAME_OPTIONS };
  const { difficulty, swingSpeed, timeLimit, sound, recordScores } = raw;
  return {
    difficulty:
      difficulty === 'easy' || difficulty === 'hard' ? difficulty : 'normal',
    swingSpeed:
      swingSpeed === 'slow' || swingSpeed === 'normal' || swingSpeed === 'fast'
        ? swingSpeed
        : 'auto',
    timeLimit:
      typeof timeLimit === 'number' && Number.isFinite(timeLimit)
        ? Math.min(120, Math.max(30, Math.round(timeLimit)))
        : DEFAULT_GAME_OPTIONS.timeLimit,
    sound: sound !== false,
    recordScores: recordScores === true,
  };
}

export function parseGameStats(raw: unknown): GameStatsRecord | null {
  if (!isRecord(raw)) return null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const bestScore = num(raw.bestScore);
  if (bestScore <= 0 && num(raw.games) <= 0) return null;
  return {
    bestScore,
    bestLevel: Math.max(0, Math.round(num(raw.bestLevel))),
    totalCoins: Math.max(0, Math.round(num(raw.totalCoins))),
    games: Math.max(0, Math.round(num(raw.games))),
    lastDate: typeof raw.lastDate === 'string' ? raw.lastDate : undefined,
  };
}

// ═════════════════════════════════════════════════════════════
// 进度存档（持久化在 viewDefinition.options[PLUGIN_ID].save，
// 游戏未结束时退出重进可从菜单「继续游戏」恢复）
// ═════════════════════════════════════════════════════════════

/** 存档中的单个物品（相对坐标，恢复时按当前画布换算回像素） */
export interface GameSaveItem {
  kind: string;
  fx: number;
  fy: number;
  alive: boolean;
  carried: boolean;
  /** 鼹鼠横移参数（不含像素坐标 base，恢复时重算） */
  move?: { amp: number; speed: number; t: number };
}

export interface GameSaveSlot {
  v: number;
  /** 存档时的阶段：intro / playing 恢复到关卡介绍页，shop 恢复到商店 */
  phase: 'intro' | 'playing' | 'shop';
  level: number;
  bank: number;
  levelMoney: number;
  goal: number;
  timeLeft: number;
  /** 绳长相对静止绳长的倍数（跨分辨率稳定） */
  lenMul: number;
  hookPhase: number;
  hookState: 'swing' | 'extend' | 'retract';
  dynamiteStock: number;
  buffs: {
    engineActive: boolean;
    engineNext: boolean;
    cloverActive: boolean;
    cloverNext: boolean;
    bookActive: boolean;
    bookNext: boolean;
  };
  items: GameSaveItem[];
  savedAt: string;
}

/** 防御性解析存档：结构不符/版本未知一律视为无存档 */
export function parseGameSave(raw: unknown): GameSaveSlot | null {
  if (!isRecord(raw) || raw.v !== 1) return null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const level = Math.round(num(raw.level));
  if (level < 1) return null;
  const phase = raw.phase === 'playing' || raw.phase === 'shop' ? raw.phase : 'intro';
  const hookState =
    raw.hookState === 'extend' || raw.hookState === 'retract' ? raw.hookState : 'swing';
  const items: GameSaveItem[] = Array.isArray(raw.items)
    ? raw.items.filter(isRecord).map((it) => ({
        kind: typeof it.kind === 'string' ? it.kind : '',
        fx: num(it.fx),
        fy: num(it.fy),
        alive: it.alive !== false,
        carried: it.carried === true,
        move:
          isRecord(it.move) && typeof it.move.amp === 'number'
            ? { amp: num(it.move.amp), speed: num(it.move.speed), t: num(it.move.t) }
            : undefined,
      }))
    : [];
  const b = isRecord(raw.buffs) ? raw.buffs : {};
  const bool = (v: unknown) => v === true;
  return {
    v: 1,
    phase,
    level,
    bank: Math.max(0, num(raw.bank)),
    levelMoney: Math.max(0, num(raw.levelMoney)),
    goal: Math.max(0, num(raw.goal)),
    timeLeft: Math.max(0, num(raw.timeLeft)),
    lenMul: Math.max(1, num(raw.lenMul) || 1),
    hookPhase: num(raw.hookPhase),
    hookState,
    dynamiteStock: Math.max(0, Math.round(num(raw.dynamiteStock))),
    buffs: {
      engineActive: bool(b.engineActive),
      engineNext: bool(b.engineNext),
      cloverActive: bool(b.cloverActive),
      cloverNext: bool(b.cloverNext),
      bookActive: bool(b.bookActive),
      bookNext: bool(b.bookNext),
    },
    items,
    savedAt: typeof raw.savedAt === 'string' ? raw.savedAt : new Date().toISOString(),
  };
}

// ═════════════════════════════════════════════════════════════
// 宿主注入的 props（完整字段以 skill references/types/database.md 为准）
// 游戏不读取行数据，使用 registerView() 的 ViewProps 形状。
// ═════════════════════════════════════════════════════════════

/** Plain View props：container / api / viewId / viewDefinition / 非持久化 state */
export interface GameViewProps {
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

/** 引擎上报的一局结果（view 层据此持久化战绩） */
export interface GameOverStats {
  score: number;
  level: number;
  difficulty: Difficulty;
  date: string;
}
