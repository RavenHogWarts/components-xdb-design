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

export interface GameOptions {
  /** 音效（原版内嵌 MP3：跳跃/撞击/里程碑，立即生效） */
  sound: boolean;
  /** 画面大小：画布宽度上限（窄面板自动收缩），引擎随 ResizeObserver 自适应 */
  size: GameSize;
}

/** 画面大小档位 → 画布宽度上限（px） */
export type GameSize = 'normal' | 'large' | 'xlarge';

export const GAME_SIZES: readonly GameSize[] = ['normal', 'large', 'xlarge'];

export const GAME_SIZE_WIDTH: Record<GameSize, number> = {
  normal: 600,
  large: 800,
  xlarge: 960,
};

export const GAME_SIZE_LABEL: Record<GameSize, string> = {
  normal: '标准 · 600px',
  large: '大 · 800px',
  xlarge: '特大 · 960px',
};

export interface GameStatsRecord {
  bestScore: number;
  totalScore: number;
  games: number;
  lastDate?: string;
}

export const DEFAULT_GAME_OPTIONS: GameOptions = {
  sound: true,
  size: 'large',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 防御性解析 options[PLUGIN_ID]：手改 .xdb 或旧版本数据可能缺字段/类型漂移 */
export function parseGameOptions(raw: unknown): GameOptions {
  if (!isRecord(raw)) return { ...DEFAULT_GAME_OPTIONS };
  const { size } = raw;
  return {
    sound: raw.sound !== false,
    size:
      size === 'normal' || size === 'xlarge' || size === 'large'
        ? size
        : DEFAULT_GAME_OPTIONS.size,
  };
}

export function parseGameStats(raw: unknown): GameStatsRecord | null {
  if (!isRecord(raw)) return null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const bestScore = num(raw.bestScore);
  if (bestScore <= 0 && num(raw.games) <= 0) return null;
  return {
    bestScore: Math.max(0, Math.round(bestScore)),
    totalScore: Math.max(0, Math.round(num(raw.totalScore))),
    games: Math.max(0, Math.round(num(raw.games))),
    lastDate: typeof raw.lastDate === 'string' ? raw.lastDate : undefined,
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
