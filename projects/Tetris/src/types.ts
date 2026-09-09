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

import type { PieceType } from './game/pieces';

/** 开局等级（影响新局的重力速度与计分倍率） */
export type StartLevel = 1 | 3 | 5 | 10 | 15;

export interface GameOptions {
  startLevel: StartLevel;
  /** 幽灵投影（硬降落点预览，立即生效） */
  ghost: boolean;
  /** 消行闪烁 / 落定脉冲动画（关闭可降低动效、加快节奏） */
  animation: boolean;
  /** 每局终局把战绩写入当前数据库（需要 source 支持 createRow） */
  recordScores: boolean;
}

export interface GameStatsRecord {
  bestScore: number;
  bestLines: number;
  totalScore: number;
  games: number;
  lastDate?: string;
}

export const DEFAULT_GAME_OPTIONS: GameOptions = {
  startLevel: 1,
  ghost: true,
  animation: true,
  recordScores: false,
};

const START_LEVELS: StartLevel[] = [1, 3, 5, 10, 15];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 防御性解析 options[PLUGIN_ID]：手改 .xdb 或旧版本数据可能缺字段/类型漂移 */
export function parseGameOptions(raw: unknown): GameOptions {
  if (!isRecord(raw)) return { ...DEFAULT_GAME_OPTIONS };
  const { startLevel, ghost, animation, recordScores } = raw;
  return {
    startLevel: START_LEVELS.includes(startLevel as StartLevel) ? (startLevel as StartLevel) : 1,
    ghost: ghost !== false,
    animation: animation !== false,
    recordScores: recordScores === true,
  };
}

export function parseGameStats(raw: unknown): GameStatsRecord | null {
  if (!isRecord(raw)) return null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const bestScore = num(raw.bestScore);
  const bestLines = num(raw.bestLines);
  if (bestScore <= 0 && num(raw.games) <= 0) return null;
  return {
    bestScore: Math.max(0, Math.round(bestScore)),
    bestLines: Math.max(0, Math.round(bestLines)),
    totalScore: Math.max(0, Math.round(num(raw.totalScore))),
    games: Math.max(0, Math.round(num(raw.games))),
    lastDate: typeof raw.lastDate === 'string' ? raw.lastDate : undefined,
  };
}

// ═════════════════════════════════════════════════════════════
// 进度存档（持久化在 viewDefinition.options[PLUGIN_ID].save，
// 每块结算后快照；终局清除，退出重进可继续）
// ═════════════════════════════════════════════════════════════

/** 存档中的活动方块（t = 方块字母，r = 旋转态） */
export interface SavePiece {
  t: PieceType;
  r: number;
  x: number;
  y: number;
}

export interface GameSaveSlot {
  v: number;
  /** 盘面序列化：每格一个字符（. 或方块字母），行优先、共 24 × 10 格 */
  board: string;
  current: SavePiece | null;
  /** 待出场方块（7-bag 序列，字母串） */
  queue: string;
  /** 当前袋剩余（字母串） */
  bag: string;
  /** 暂存方块（空串 = 无） */
  hold: string;
  canHold: boolean;
  score: number;
  lines: number;
  pieces: number;
  startLevel: number;
  combo: number;
  b2b: boolean;
  lockSeq: number;
  savedAt: string;
}

const PIECE_CHARS = 'IOTSZJL';

/** 防御性解析存档：结构不符/版本未知一律视为无存档 */
export function parseGameSave(raw: unknown): GameSaveSlot | null {
  if (!isRecord(raw) || raw.v !== 1) return null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const int = (v: unknown) => Math.round(num(v));

  // 盘面：24 行 × 10 列，字符只允许 . 或方块字母
  if (typeof raw.board !== 'string' || raw.board.length !== 240) return null;
  for (const ch of raw.board) {
    if (ch !== '.' && !PIECE_CHARS.includes(ch)) return null;
  }

  const parsePieces = (v: unknown, allowEmpty: boolean): string | null => {
    if (typeof v !== 'string' || v.length > 32) return null;
    if (v.length === 0 && !allowEmpty) return null;
    for (const ch of v) {
      if (!PIECE_CHARS.includes(ch)) return null;
    }
    return v;
  };
  const queue = parsePieces(raw.queue, false);
  const bag = parsePieces(raw.bag, true);
  if (queue === null || bag === null) return null;
  if (typeof raw.hold !== 'string' || raw.hold.length > 1) return null;
  if (raw.hold && !PIECE_CHARS.includes(raw.hold)) return null;

  let current: SavePiece | null = null;
  if (raw.current != null) {
    if (!isRecord(raw.current)) return null;
    const t = raw.current.t;
    if (typeof t !== 'string' || !PIECE_CHARS.includes(t)) return null;
    const r = int(raw.current.r);
    const x = int(raw.current.x);
    const y = int(raw.current.y);
    if (r < 0 || r > 3 || x < -2 || x > 9 || y < 0 || y > 23) return null;
    current = { t: t as PieceType, r, x, y };
  }

  return {
    v: 1,
    board: raw.board,
    current,
    queue,
    bag,
    hold: raw.hold,
    canHold: raw.canHold === true,
    score: Math.max(0, int(raw.score)),
    lines: Math.max(0, int(raw.lines)),
    pieces: Math.max(0, int(raw.pieces)),
    startLevel: Math.min(15, Math.max(1, int(raw.startLevel) || 1)),
    combo: Math.min(20, Math.max(-1, int(raw.combo))),
    b2b: raw.b2b === true,
    lockSeq: Math.max(0, int(raw.lockSeq)),
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

/** 引擎上报的终局结果（view 层据此写战绩行） */
export interface GameOverStats {
  score: number;
  lines: number;
  level: number;
  pieces: number;
  result: 'over';
  date: string;
}
