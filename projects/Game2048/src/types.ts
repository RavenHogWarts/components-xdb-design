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

/** 盘面边长（n × n） */
export type BoardSize = 3 | 4 | 5;

/** 胜利目标方块数值；0 表示无尽模式（只拼分数） */
export type WinTarget = 2048 | 4096 | 0;

export interface GameOptions {
  boardSize: BoardSize;
  target: WinTarget;
  /** 移动 / 生成动画（关闭可降低动效、加快节奏） */
  animation: boolean;
  /** 每局终局把战绩写入当前数据库（需要 source 支持 createRow） */
  recordScores: boolean;
}

export interface GameStatsRecord {
  bestScore: number;
  bestTile: number;
  totalScore: number;
  games: number;
  lastDate?: string;
}

export const DEFAULT_GAME_OPTIONS: GameOptions = {
  boardSize: 4,
  target: 2048,
  animation: true,
  recordScores: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 防御性解析 options[PLUGIN_ID]：手改 .xdb 或旧版本数据可能缺字段/类型漂移 */
export function parseGameOptions(raw: unknown): GameOptions {
  if (!isRecord(raw)) return { ...DEFAULT_GAME_OPTIONS };
  const { boardSize, target, animation, recordScores } = raw;
  return {
    boardSize: boardSize === 3 || boardSize === 5 ? boardSize : 4,
    target: target === 4096 || target === 0 ? target : 2048,
    animation: animation !== false,
    recordScores: recordScores === true,
  };
}

export function parseGameStats(raw: unknown): GameStatsRecord | null {
  if (!isRecord(raw)) return null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const bestScore = num(raw.bestScore);
  const bestTile = num(raw.bestTile);
  if (bestScore <= 0 && num(raw.games) <= 0) return null;
  return {
    bestScore: Math.max(0, Math.round(bestScore)),
    bestTile: Math.max(0, Math.round(bestTile)),
    totalScore: Math.max(0, Math.round(num(raw.totalScore))),
    games: Math.max(0, Math.round(num(raw.games))),
    lastDate: typeof raw.lastDate === 'string' ? raw.lastDate : undefined,
  };
}

// ═════════════════════════════════════════════════════════════
// 进度存档（持久化在 viewDefinition.options[PLUGIN_ID].save，
// 有效移动后快照；终局清除，退出重进可继续）
// ═════════════════════════════════════════════════════════════

/** 存档中的方块（只保留恢复必需字段，isNew/isMerged 等动画标记不落盘） */
export interface SaveTile {
  id: number;
  r: number;
  c: number;
  value: number;
}

export interface GameSaveSlot {
  v: number;
  /** 开局时的盘面边长与目标（设置改动不影响进行中的一局） */
  n: number;
  target: number;
  tiles: SaveTile[];
  score: number;
  moves: number;
  /** 本局是否已达成过目标（避免恢复后重复弹出胜利面板） */
  won: boolean;
  savedAt: string;
}

/** 防御性解析存档：结构不符/版本未知一律视为无存档 */
export function parseGameSave(raw: unknown): GameSaveSlot | null {
  if (!isRecord(raw) || raw.v !== 1) return null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const n = Math.round(num(raw.n));
  if (n < 2 || n > 6) return null;
  if (!Array.isArray(raw.tiles) || raw.tiles.length === 0) return null;
  const tiles: SaveTile[] = [];
  const seen = new Set<number>();
  for (const t of raw.tiles) {
    if (!isRecord(t)) continue;
    const id = Math.round(num(t.id));
    const r = Math.round(num(t.r));
    const c = Math.round(num(t.c));
    const value = Math.round(num(t.value));
    if (id < 0 || r < 0 || r >= n || c < 0 || c >= n) return null;
    if (value < 2 || value > 1 << 20 || value % 2 !== 0) return null;
    if (seen.has(r * n + c)) return null; // 同格两块属非法状态
    seen.add(r * n + c);
    tiles.push({ id, r, c, value });
  }
  if (tiles.length >= n * n) return null; // 满盘无路可走，不可能是有效进行中局面
  return {
    v: 1,
    n,
    target: num(raw.target) === 4096 || num(raw.target) === 0 ? num(raw.target) : 2048,
    tiles,
    score: Math.max(0, Math.round(num(raw.score))),
    moves: Math.max(0, Math.round(num(raw.moves))),
    won: raw.won === true,
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
  maxTile: number;
  moves: number;
  boardSize: number;
  /** win = 达成目标方块；over = 无路可走 */
  result: 'win' | 'over';
  date: string;
}
