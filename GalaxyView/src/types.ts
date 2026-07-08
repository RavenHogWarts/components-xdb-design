import type { App, Component } from 'obsidian';
import type * as THREE from 'three';

// ═════════════════════════════════════════════════════════════
// 插件元数据常量
// ═════════════════════════════════════════════════════════════

export const PLUGIN_ID = 'galaxy-view';
export const VIEW_TYPE = 'galaxy';

export const PALETTE: readonly string[] = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308',
  '#84cc16', '#22c55e', '#10b981', '#14b8a6',
  '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6',
  '#a855f7', '#d946ef', '#ec4899', '#f43f5e'
];

// ═════════════════════════════════════════════════════════════
// XDB 宿主接口 (与 Log 保持一致)
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
    groups: Array<GroupData>;
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

// ═════════════════════════════════════════════════════════════
// GalaxyView 星系视图特定类型定义
// ═════════════════════════════════════════════════════════════

export interface GroupData {
  field: string | null;
  value: unknown;
  rows: Array<RowData>;
  groups?: GroupData[];
  summary?: string;
  rowSummary?: Record<string, string>;
}

export interface RowData {
  id: string;
  $item: Record<string, any>;
  file?: {
    path: string;
  };
  filePath?: string;
}

export interface GalaxyOptions {
  titleField: string;
  tagField: string;
  folderDepth: number;
  ringThreshold: number;
  assetsPath: string;
}

export interface GroupRowResult {
  key: string;
  label: string;
  rows: RowData[];
  ci: number;
}

export interface PlanetData {
  data: GroupRowResult;
  color: string;
  pivot: THREE.Group;
  grp: THREE.Group;
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  atmMesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  glow: THREE.SpriteMaterial;
  atm: THREE.ShaderMaterial;
  orbitMat: THREE.LineBasicMaterial;
  radius: number;
  orbR: number;
  speed: number;
  spin: number;
  hover: boolean;
  scl: number;
  label: HTMLDivElement;
}

export interface MoonData {
  pivot: THREE.Group;
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  label: HTMLDivElement;
  speed: number;
  row: RowData;
  scl: number;
}

export interface CameraAnimation {
  t: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
  lookFrom: THREE.Vector3;
  planet?: PlanetData;
  mode: 'in' | 'out';
}

export interface GalaxySceneInstance {
  destroy: () => void;
  updateData: (props: DatabaseViewProps) => void;
}

export interface GalaxyViewInstance {
  onUpdate: (props: DatabaseViewProps) => void;
  onDestroy: () => void;
}
