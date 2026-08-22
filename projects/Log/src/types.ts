import type { App, Component } from 'obsidian';
import type { CropStage } from './sprite-helper';

// ═════════════════════════════════════════════════════════════
// 插件元数据常量
// ═════════════════════════════════════════════════════════════

/** XDB 插件唯一 ID */
export const PLUGIN_ID = 'stardew-farm-habit';

/** 插件显示名称 */
export const PLUGIN_NAME = '星露谷农场打卡';

/** 插件描述 */
export const PLUGIN_DESCRIPTION =
  '将打卡数据渲染为星露谷风格的农场视图，作物随连续打卡天数生长。';

/** 插件版本 */
export const PLUGIN_VERSION = '1.0.0';

// ═════════════════════════════════════════════════════════════
// 路径与文件夹默认值
// ═════════════════════════════════════════════════════════════

/** 打卡单文件的默认保存文件夹（Vault 内相对路径） */
export const DEFAULT_HABIT_FOLDER = 'Log';

/** 自动创建今日日记时写入的默认 tag */
export const DEFAULT_DAILY_NOTE_TAG = 'daily-note';

// ═════════════════════════════════════════════════════════════
// 作物成长相关常量
// ═════════════════════════════════════════════════════════════

/**
 * 作物各成长阶段的中文名称列表。
 * 索引由 getCropStageIndex() 计算，数组长度需 >= 最大阶段数。
 */
export const STAGE_NAMES: readonly string[] = [
  '种子', '初芽', '成长中', '抽苗', '成熟期',
  '大丰收', '大丰收', '大丰收', '大丰收',
];

/**
 * 作物枯萎判定阈值（天）。
 * 若距最后一次浇水或种植日期超过此天数，且作物未成熟，则标记为枯萎。
 */
export const WITHER_DAYS_THRESHOLD = 7;

// ═════════════════════════════════════════════════════════════
// 习惯配置接口与默认值（唯一真源）
// ═════════════════════════════════════════════════════════════

/**
 * 单条习惯的配置结构。
 * - `field`：Obsidian 日记 YAML Frontmatter 中的属性名，同时也是打卡单文件的文件名（basename）。
 * - `crop`：该习惯对应的默认作物种子 ID（来自 Crops.json 的键）。
 * - `customStages`：可选的自定义精灵坐标阶段数组，设置后覆盖 crop-loader 计算结果。
 */
export interface HabitOption {
  field: string;
  crop: string;
  customStages?: CropStage[];
}

/**
 * 默认习惯列表（用户未配置时使用）。
 * crop id 与 Crops.json 的键一一对应。
 */
export const DEFAULT_HABITS: HabitOption[] = [
  { field: '锻炼', crop: '24'  },  // 防风草
  { field: '阅读', crop: '282' },  // 蔓越莓
  { field: '日记', crop: '276' },  // 南瓜
];

// ═════════════════════════════════════════════════════════════
// 习惯单文件数据结构
// ═════════════════════════════════════════════════════════════

/**
 * 习惯单文件（如 `Log/锻炼.md`）中 `# 打卡` 部分的单条任务记录。
 */
export interface HabitTask {
  /** 是否已完成打卡 */
  isDone: boolean;
  /** 标准化日期字符串 YYYY-MM-DD */
  dateStr: string;
  /** 原始 Wiki 链接内的日期文本（用于回写时保持原始 dateFormat） */
  originalLink: string;
  /** 打卡时间戳，格式 HH:mm:ss */
  timeStr?: string;
  /** 用户手写备注 */
  note?: string;
}

/**
 * 作物当前状态快照（`current_crop` YAML 块）。
 */
export interface CropState {
  /** 种子物品 ID，对应 Crops.json 的键 */
  id: string;
  /** 种植日期，YYYY-MM-DD */
  start_date: string;
  /** 已累计的浇水/打卡天数（从种植日到最后一次打卡的已完成数） */
  watered_days: number;
  /** 最后一次打卡的日期，YYYY-MM-DD；从未打卡时为 null */
  last_watered_date: string | null;
  /** 作物当前状态；省略时表示正常生长中 */
  status?: 'withered' | 'harvested';
}

/**
 * 作物历史记录条目（`crop_history` YAML 列表项）。
 */
export interface CropHistoryEntry {
  id: string;
  start_date: string;
  end_date: string;
  status: 'harvested' | 'withered';
  watered_days: number;
}

/**
 * 习惯单文件的完整解析结果（metadata + tasks 的组合体）。
 */
export interface HabitFileData {
  metadata: {
    current_crop: CropState | null;
    crop_history: CropHistoryEntry[];
  };
  tasks: HabitTask[];
}

// ═════════════════════════════════════════════════════════════
// XDB 宿主接口（由 XDB 平台注入，勿修改）
// ═════════════════════════════════════════════════════════════

export interface XdbContextProps {
  app: App;
  moment: any;
  PluginComponent: Component;
  obsidian: any;
  MarkdownRenderer?: any;
  echarts?: any;
}

export interface ViewDefinition {
  id: string;
  name: string;
  type: string;
  parentId?: string | null;
  icon?: string;
  layouts?: Record<string, any>;
  visibleFields?: string[];
  filter?: any;
  sort?: Array<{ field: string; direction?: 'asc' | 'desc' }>;
  group?: any;
  summary?: Record<string, string>;
  defaultTemplateId?: string;
  linkOpenMode?: string;
  tree?: { parentField: string };
  limit?: number;
  options?: Record<string, any>;
}

export interface XdbViewApi {
  updateView(view: ViewDefinition): Promise<void>;
  createView(view: ViewDefinition): Promise<void>;
  deleteView(id: string): Promise<void>;
  reorderViews(fromIndex: number, toIndex: number): Promise<void>;
}

export interface XdbFieldApi {
  createField(field: any): Promise<void>;
  renameField(oldName: string, newName: string): Promise<void>;
  updateField(name: string, field: any): Promise<void>;
  deleteField(name: string): Promise<void>;
  deleteFields(names: string[]): Promise<void>;
  getAvailableFields(): any[];
  getFieldValueSuggestions(fieldName: string): Promise<string[]>;
  getSupportedFieldTypes(): any[];
  getFieldType(fieldName: string): { type: string; isBuiltIn: boolean };
}

export interface XdbTemplateApi {
  getTemplateSuggestions(): Promise<any[]>;
  setDefaultTemplate(viewId: string, templateId: string | null): Promise<void>;
  createRowByTemplate(templateId: string, values?: Record<string, unknown>): Promise<void>;
}

export interface XdbSourceApi {
  changeSource(source: string): Promise<void>;
}

export interface Database extends XdbFieldApi, XdbTemplateApi, XdbViewApi, XdbSourceApi {
  readonly definition?: any;
  readonly eventBus?: any;
  readonly lastModifiedTime?: number;
  getId(): string;
  getDefinition(): any;
  getData(filter?: any): Promise<any>;
  matchesFilter(item: Record<string, unknown>, filter: any): boolean;
  getViewData(id: string, query?: { text: string }): Promise<any>;
  getAllViewData(): Promise<any[]>;
  getRowLink(rowId: string): { href: string; label: string } | null;
  updateRow(id: string, values: Record<string, unknown>): Promise<void>;
  updateCell(rowId: string, fieldName: string, value: unknown): Promise<void>;
  deleteRow(id: string): Promise<void>;
  deleteRows(ids: string[], options?: any): Promise<any>;
  flush(): Promise<void>;
  unload(): Promise<void>;
}

export interface DatabaseViewProps extends XdbContextProps {
  container: HTMLElement;
  api: Database;
  viewId: string;
  viewDefinition: ViewDefinition;
  viewData: {
    name: string;
    type: string;
    visibleFields: any[];
    allFields: any[];
    groups: Array<{
      field: string | null;
      value: unknown;
      rows: Array<{
        id: string;
        $item: Record<string, any>;
      }>;
      groups?: any[];
      summary?: string;
      rowSummary?: Record<string, string>;
    }>;
    options?: Record<string, unknown>;
    summary?: Record<string, string>;
  };
}

export interface ViewSettingsProps extends XdbContextProps {
  container: HTMLElement;
  api: Database;
  viewDefinition: ViewDefinition;
  setViewDefinition: (updater: (current: ViewDefinition) => ViewDefinition) => Promise<void>;
}

export interface ViewSettingsTabProps extends ViewSettingsProps {
  close?: () => void;
}

/** @deprecated 已被 HabitOption 替代，仅用于向后兼容旧配置数据读取 */
export interface HabitStat {
  field: string;
  label: string;
  crop: string;
  isDoneToday: boolean;
  streak: number;
  history: Array<{ date: string; status: boolean }>;
}
