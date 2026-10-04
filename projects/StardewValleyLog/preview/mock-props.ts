// mock-props.ts —— 构造与宿主 XDB 注入形状一致的 DatabaseViewProps。
// 「本地和实际环境一样」的原则：只有宿主边界是 mock，视图代码走 src/ 原路径。
// 宿主注入字段的权威定义见 .agents/skills/xdb-plugin-skills/references/types/database.md。
// 农场打卡的 mock：file source（frontmatter 行数据）+ Daily Note / 任务写回的内存实现，
// 覆盖四种场景：今日已打卡 / 昨日打卡（连击+1）/ 断卡（重置为 1）/ 无习惯新建。

import moment from 'moment';
import { DatabaseViewProps, PLUGIN_ID } from '../src/types';

// ── 内存 vault：习惯文件（frontmatter）──

const todayIso = moment().format('YYYY-MM-DD');
const yesterdayIso = moment().subtract(1, 'day').format('YYYY-MM-DD');
const staleIso = moment().subtract(3, 'day').format('YYYY-MM-DD');

interface MockFile {
  $item: Record<string, any>;
}

const habitFiles = new Map<string, MockFile>([
  ['Habits/晨跑.md', { $item: { type: 'habit', skill: 'farming', crop: '477', goal: 30, streak: 3, best: 12, last: yesterdayIso, file: { basename: '晨跑', path: 'Habits/晨跑.md' } } }],
  ['Habits/冥想.md', { $item: { type: 'habit', skill: 'foraging', crop: '479', goal: 14, streak: 8, best: 8, last: todayIso, file: { basename: '冥想', path: 'Habits/冥想.md' } } }],
  ['Habits/阅读.md', { $item: { type: 'habit', skill: 'fishing', crop: '480', goal: 20, streak: 0, best: 5, last: staleIso, file: { basename: '阅读', path: 'Habits/阅读.md' } } }],
  ['Habits/健身.md', { $item: { type: 'habit', skill: 'combat', crop: '482', goal: 50, streak: 6, best: 29, last: yesterdayIso, file: { basename: '健身', path: 'Habits/健身.md' } } }],
]);

// ── 内存 Daily Note / 任务行 ──

const noteLines = new Map<string, string[]>();
const ensureNote = (path: string) => {
  if (!noteLines.has(path)) noteLines.set(path, ['# 每日笔记']);
  return noteLines.get(path)!;
};

const dailyNotes = {
  getOptions: () => ({ autorun: false, folder: 'Daily', format: 'YYYY-MM-DD', template: '' }),
  getAll: async () => [],
  get: async (iso: string) => (noteLines.has(`Daily/${iso}.md`) ? { path: `Daily/${iso}.md` } : null),
  create: async (iso: string) => ({ path: ensureNote(`Daily/${iso}.md`).length ? `Daily/${iso}.md` : `Daily/${iso}.md` }),
};

const tasks = {
  getFromFile: async (filePath: string) => {
    const lines = noteLines.get(filePath) ?? [];
    return lines
      .map((text, line) => ({ text, line }))
      .filter((l) => /^- \[.\]/.test(l.text))
      .map(({ text, line }) => ({
        number: line,
        parent: -1,
        status: text.slice(3, 4),
        text,
        pos: { start: { line, col: 0 }, end: { line, col: text.length } },
        filePath,
      }));
  },
  extractContent: (t: { text: string }) => t.text.replace(/^- \[.\] /, ''),
  add: async (filePath: string, content: string, position?: any) => {
    const lines = ensureNote(filePath);
    const heading = position?.headingLine as string | undefined;
    if (position?.position === 'BottomUnderHeading') {
      const idx = lines.findIndex((l) => l === heading);
      if (idx === -1) throw new Error(`heading 不存在: ${heading}`);
      lines.splice(idx + 1, 0, `- [ ] ${content}`);
      return;
    }
    lines.push(`- [ ] ${content}`);
  },
  setStatus: async (filePath: string, pos: any, status: string) => {
    const lines = noteLines.get(filePath);
    const line = lines?.[pos?.start?.line];
    if (line && /^- \[.\]/.test(line)) lines![pos.start.line] = line.replace(/\[.\]/, `[${status}]`);
  },
  toggle: async (filePath: string, pos: any, current: string) =>
    tasks.setStatus(filePath, pos, current === ' ' ? 'x' : ' '),
  delete: async () => undefined,
  revealInFile: () => undefined,
  navigateTo: () => undefined,
};

// ── 内存 Database api（file source）──

const allRows = () => [...habitFiles.entries()].map(([id, f]) => ({ id, $item: f.$item }));

const stateStore = new Map<string, unknown>();

// viewDefinition 共享引用：updateView 原地合并 options，模拟宿主 republish。
// options[PLUGIN_ID] 经 sessionStorage 持久化（同标签页重载保留）——模拟真实 .xdb 持久化。
const STORE_KEY = 'sdvl-mock-options';
const restoredOptions = (() => {
  try {
    return JSON.parse(sessionStorage.getItem(STORE_KEY) ?? 'null') ?? {};
  } catch {
    return {};
  }
})();
const mockViewDefinition: Record<string, any> = {
  id: 'preview-view',
  name: '预览视图',
  type: `${PLUGIN_ID}:view`,
  options: { [PLUGIN_ID]: restoredOptions },
};

const persistOptions = (options: Record<string, any>) => {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(options?.[PLUGIN_ID] ?? {}));
  } catch {
    // 忽略（隐私模式等）
  }
};

export function createMockProps(container: HTMLElement): DatabaseViewProps {
  return {
    container,
    viewId: 'preview-view',
    // 真实环境是持久化的 View 定义；options[PLUGIN_ID] 为插件配置命名空间
    viewDefinition: mockViewDefinition,
    // 宿主已投影的行数据；图鉴不消费，打卡页走 api.getAllData()
    viewData: { groups: [{ rows: [] }] },
    api: {
      getDefinition: () => ({ source: undefined, fields: [], views: [mockViewDefinition] }),
      updateView: async (view: any) => {
        Object.assign(mockViewDefinition, view);
        persistOptions(mockViewDefinition.options);
      },
      getAllData: async () => ({ rows: allRows() }),
      getData: async () => ({ rows: allRows() }),
      createRow: async ({ values }: any) => {
        const name = values['file.basename'] ?? '未命名';
        const id = `Habits/${name}.md`;
        habitFiles.set(id, {
          $item: {
            ...values,
            file: { basename: name, path: id },
          },
        });
        return { item: { href: id } };
      },
      updateRow: async (id: string, values: Record<string, unknown>) => {
        const f = habitFiles.get(id);
        if (!f) throw new Error(`row 不存在: ${id}`);
        Object.assign(f.$item, values);
        return id;
      },
      updateCell: async (id: string, field: string, value: unknown) => {
        const f = habitFiles.get(id);
        if (!f) throw new Error(`row 不存在: ${id}`);
        f.$item[field] = value;
        return id;
      },
      deleteRow: async () => undefined,
      canUpdateCell: () => true,
      getRowLink: (id: string) => ({
        href: id.replace(/\.md$/, ''),
        label: id.split('/').pop()?.replace(/\.md$/, '') ?? id,
      }),
    },
    app: {
      workspace: {
        openLinkText: (target: string) => console.log('[preview] openLinkText:', target),
      },
    } as any,
    moment,
    obsidian: {
      Notice: class {
        constructor(msg: any) {
          console.log('[preview Notice]', String(msg));
        }
      },
    },
    dailyNotes,
    tasks,
    state: {
      get: (k: string) => stateStore.get(k),
      set: (k: string, v: unknown) => void stateStore.set(k, v),
      delete: (k: string) => void stateStore.delete(k),
    },
  };
}
