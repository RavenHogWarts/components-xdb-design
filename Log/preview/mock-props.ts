/**
 * 组装 DatabaseViewProps，喂给 src/view.tsx 的 createFarmRenderer()。
 *
 * 关键点：
 *  1. PNG 资源通过 Vite 的 ?url 后缀导入，让 SpriteSheet.getResourcePath() 拿到本地文件 URL。
 *  2. vault.getAbstractFileByPath() 总返回非空对象，让 checkAssetFiles() 全部通过。
 *  3. api.updateCell/updateRow 直接修改 state.rows，并通过 onMutate 回调触发预览重渲染。
 *
 * 这样 view.tsx 完全不知道自己在预览环境里，零侵入。
 */
import type { DatabaseViewProps, ViewSettingsProps, ViewDefinition } from '../src/types';
import { Notice } from './obsidian-mock';
import { DEFAULT_PREVIEW_HABITS, type MockRow, type ScenarioKey } from './mock-data';

// Vite 原生支持 png 导入为 URL；与 sprite-helper.ts 的 vault 路径一一对应
import cropsUrl from '../stardew-habit/crops.png?url';
import housesUrl from '../stardew-habit/houses.png?url';
import hoeDirtUrl from '../stardew-habit/hoeDirt.png?url';

// path → url 映射（key 是 normalizePath 后的形态，'Log/stardew-habit/xxx.png'）
const URL_BY_PATH: Record<string, string> = {
  'Log/stardew-habit/crops.png': cropsUrl,
  'Log/stardew-habit/houses.png': housesUrl,
  'Log/stardew-habit/hoeDirt.png': hoeDirtUrl,
};

// 复刻 sprite-helper.ts 的 normalizePath，避免循环依赖
function normalizePath(p: string): string {
  let s = p.trim().replace(/\\/g, '/');
  if (s.startsWith('./')) s = s.slice(2);
  while (s.startsWith('/')) s = s.slice(1);
  while (s.endsWith('/')) s = s.slice(0, -1);
  return s.replace(/\/+/g, '/');
}

/**
 * 构造可复用的 mock Obsidian App 实例。
 *  - getAbstractFileByPath() 总返回非空，让 checkAssetFiles() 通过
 *  - getResourcePath() 把 vault 路径映射到 Vite 导出的本地 PNG URL
 *
 * 农场视图 / 设置面板 / 贴图测试页都通过它访问「vault 资源」。
 */
const VIRTUAL_FILES: Record<string, string> = {};

export function createMockApp(): any {
  return {
    vault: {
      getAbstractFileByPath: (p: string) => {
        const norm = normalizePath(p);
        const basename = norm.split('/').pop()?.replace(/\.md$/, '') || '';
        return { path: norm, basename };
      },
      getResourcePath: (file: { path: string }) =>
        URL_BY_PATH[normalizePath(file.path)] ?? '',
      createFolder: async (p: string) => {
        console.log('[mock vault] createFolder:', p);
        return null;
      },
      create: async (p: string, content: string) => {
        const norm = normalizePath(p);
        VIRTUAL_FILES[norm] = content;
        console.log('[mock vault] create file:', norm, content);
        const basename = norm.split('/').pop()?.replace(/\.md$/, '') || '';
        return { path: norm, basename };
      },
      read: async (file: { path: string }) => {
        return VIRTUAL_FILES[file.path] || '';
      },
      modify: async (file: { path: string }, content: string) => {
        VIRTUAL_FILES[file.path] = content;
        console.log('[mock vault] modify file:', file.path, content);
      },
      process: async (file: { path: string }, callback: (content: string) => string) => {
        const current = VIRTUAL_FILES[file.path] || '';
        const next = callback(current);
        VIRTUAL_FILES[file.path] = next;
        console.log('[mock vault] process file:', file.path, next);
        return next;
      },
      rename: async (file: { path: string }, newPath: string) => {
        const normNew = normalizePath(newPath);
        if (VIRTUAL_FILES[file.path] !== undefined) {
          VIRTUAL_FILES[normNew] = VIRTUAL_FILES[file.path];
          delete VIRTUAL_FILES[file.path];
        }
        file.path = normNew;
        (file as any).basename = normNew.split('/').pop()?.replace(/\.md$/, '') || '';
        console.log('[mock vault] rename file:', file.path, '->', normNew);
      }
    },
    internalPlugins: {
      plugins: {
        'daily-notes': {
          enabled: true,
          instance: { options: { format: 'YYYY-MM-DD', folder: '' } },
        },
      },
    },
  };
}

/**
 * 把任意 vault 相对路径转成本地预览 URL（找不到返回空串）。
 * 供贴图测试页等不经过 SpriteSheet 的场景直接使用。
 */
export function resolveVaultPathToUrl(vaultPath: string): string {
  return URL_BY_PATH[normalizePath(vaultPath)] ?? '';
}

export interface MockState {
  rows: MockRow[];
  /**
   * 视图定义（含 habits / assetsPath 等配置）。
   * 农场视图与设置面板共享同一份，模拟真实 XDB 中设置改动立即反映到视图的行为。
   * 切换数据场景时 rows 会重建，但 viewDefinition 保留用户在设置面板里的修改。
   */
  viewDefinition: ViewDefinition;
}

/** 构造默认 viewDefinition（与 src/view.tsx DEFAULT_HABITS 对齐） */
export function createDefaultViewDefinition(scenario: ScenarioKey): ViewDefinition {
  return {
    id: 'preview',
    name: `预览·${scenario}`,
    type: 'stardew-farm-habit',
    options: { habits: DEFAULT_PREVIEW_HABITS },
  };
}

export interface MockPropsOptions {
  state: MockState;
  container: HTMLElement;
  /** 数据写回时触发，用于驱动 React 重新渲染 */
  onMutate?: () => void;
}

export function createMockProps(opts: MockPropsOptions): DatabaseViewProps {
  const { state, container, onMutate } = opts;

  const mockApp = createMockApp();

  const mockApi = {
    async updateCell(rowId: string, field: string, value: any) {
      const row = state.rows.find(r => r.id === rowId);
      if (row) {
        row.$item[field] = value;
        console.log('[mock api] updateCell', { rowId, field, value });
        onMutate?.();
      }
    },
    async updateRow(rowId: string, values: Record<string, any>) {
      const row = state.rows.find(r => r.id === rowId);
      if (row) {
        Object.assign(row.$item, values);
        console.log('[mock api] updateRow', { rowId, values });
        onMutate?.();
      }
    },
    async updateView() {
      /* 预览环境不持久化 view 定义 */
    },
  };

  return {
    app: mockApp as any,
    moment: (window as any).moment,
    PluginComponent: { load() {}, unload() {} } as any,
    obsidian: { Notice } as any,
    container,
    api: mockApi as any,
    viewId: state.viewDefinition.id,
    viewDefinition: state.viewDefinition,
    viewData: { groups: [{ rows: state.rows }] },
  };
}

// ─────────────────────────────────────────────────────────────
// 设置面板 props 工厂
// ─────────────────────────────────────────────────────────────
export interface MockSettingsOptions {
  state: MockState;
  container: HTMLElement;
  /** viewDefinition 写回时触发，驱动重渲染（农场视图也会读到最新配置） */
  onMutate?: () => void;
}

export function createMockSettingsProps(opts: MockSettingsOptions): ViewSettingsProps {
  const { state, container, onMutate } = opts;

  const mockApi = {
    async updateCell() {},
    async updateRow() {},
    async updateView() {},
  };

  // setViewDefinition 接收一个 updater；在 mock 中直接替换 state.viewDefinition
  const setViewDefinition = async (
    updater: (current: ViewDefinition) => ViewDefinition
  ) => {
    state.viewDefinition = updater(state.viewDefinition);
    console.log('[mock api] setViewDefinition → options =', state.viewDefinition.options);
    onMutate?.();
  };

  return {
    container,
    api: mockApi as any,
    viewDefinition: state.viewDefinition,
    setViewDefinition: setViewDefinition as any,
  };
}
