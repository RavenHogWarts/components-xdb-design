import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const validatorPath = join(process.cwd(), 'docs/skills/xdb-user-skills/scripts/validate-xdb.mjs');

function validate(definition: unknown) {
  const directory = mkdtempSync(join(tmpdir(), 'xdb-validator-'));
  const filePath = join(directory, 'database.xdb');
  writeFileSync(filePath, JSON.stringify(definition));

  try {
    return spawnSync(process.execPath, [validatorPath, filePath], {
      encoding: 'utf8',
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('validate-xdb aggregate configuration', () => {
  it('accepts canonical aggregate objects in metric, charts, group and table summaries', () => {
    const result = validate({
      source: 'file',
      fields: [
        { name: 'amount', type: 'number' },
        { name: 'status', type: 'select' },
      ],
      views: [
        { id: 'dashboard', name: 'Dashboard', type: 'group', options: { groupType: 'dashboard' } },
        {
          id: 'table',
          name: 'Table',
          type: 'table',
          parentId: 'dashboard',
          group: {
            by: [{ field: 'status' }],
            summary: { type: 'count', field: 'file.path' },
          },
          summary: {
            amount: { type: 'sum' },
          },
        },
        {
          id: 'metric',
          name: 'Total amount',
          type: 'metric',
          parentId: 'dashboard',
          aggregate: { type: 'sum', field: 'amount' },
        },
        {
          id: 'charts',
          name: 'Records by status',
          type: 'charts',
          parentId: 'dashboard',
          category: { field: 'status' },
          measures: [{ aggregate: { type: 'count', field: 'file.path' }, label: 'Records' }],
        },
        {
          id: 'list-without-summary',
          name: 'List without summary',
          type: 'list',
          parentId: 'dashboard',
          group: {
            by: [{ field: 'status' }],
            summary: null,
          },
        },
      ],
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('✓ 无问题');
  });

  it('warns about malformed aggregate objects without treating evaluation as a validator error', () => {
    const result = validate({
      source: 'file',
      fields: [{ name: 'amount', type: 'number' }],
      views: [
        {
          id: 'table',
          name: 'Table',
          type: 'table',
          group: {
            by: [{ field: 'amount' }],
            summary: { type: 'unknown', field: 'amount' },
          },
          summary: {
            amount: { type: 'expression', expression: 1 },
          },
        },
        {
          id: 'metric',
          name: 'Metric',
          type: 'metric',
          aggregate: { type: 'sum' },
        },
        {
          id: 'charts',
          name: 'Charts',
          type: 'charts',
          measures: [{ aggregate: { type: 'expression', expression: '' } }],
        },
      ],
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("group.summary 的 aggregate type 'unknown' 不受支持");
    expect(result.stdout).toContain('summary.amount 的 expression 应为非空字符串');
    expect(result.stdout).toContain('metric.aggregate 的内置计算缺少 field');
    expect(result.stdout).toContain('measures[0].aggregate 的 expression 应为非空字符串');
  });

  it('accepts legacy expressions for reading but tells generators to write canonical objects', () => {
    const result = validate({
      source: 'file',
      fields: [{ name: 'amount', type: 'number' }],
      views: [
        {
          id: 'table',
          name: 'Table',
          type: 'table',
          group: { by: [{ field: 'amount' }], summary: '$items.length' },
          summary: { amount: 'sum($values)' },
        },
        { id: 'metric', name: 'Metric', type: 'metric', expression: '$items.length' },
        {
          id: 'charts',
          name: 'Charts',
          type: 'charts',
          measures: [{ aggregate: '$items.length' }],
        },
      ],
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('group.summary 使用旧字符串表达式');
    expect(result.stdout).toContain('summary.amount 使用旧字符串表达式');
    expect(result.stdout).toContain('metric）仍使用旧 expression');
    expect(result.stdout).toContain('measures[0].aggregate 使用旧字符串表达式');
  });
});

describe('validate-xdb view style', () => {
  it('accepts the same flat style contract on Root Group', () => {
    const result = validate({
      source: 'file',
      fields: [],
      rootGroup: {
        type: 'dashboard',
        style: {
          light: {
            '--xdb-background-primary': '#F4FAF3',
            '--xdb-font-family': 'var(--font-monospace)',
          },
          dark: {
            '--xdb-background-primary': '#06140A',
          },
          css: ':scope { background: #EAF5E9; }',
        },
      },
      views: [],
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('✓ 无问题');
  });

  it('accepts Light, Dark, advanced CSS and plugin-owned custom tokens inside style', () => {
    const result = validate({
      source: 'file',
      fields: [],
      views: [
        {
          id: 'dashboard',
          name: 'Dashboard',
          type: 'group',
          options: { groupType: 'dashboard' },
          style: {
            light: {
              '--xdb-background-primary': '#F7F7F9',
              '--example-card-accent': '#FFDE59',
            },
            dark: {
              '--xdb-background-primary': '#1C1C1E',
            },
            css: ':scope {\n  --xdb-border-radius: 14px;\n}',
          },
        },
      ],
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('✓ 无问题');
  });

  it('rejects misplaced and malformed style configuration', () => {
    const result = validate({
      source: 'file',
      fields: [],
      views: [
        {
          id: 'table',
          name: 'Table',
          type: 'table',
          css: ':scope {}',
          style: {
            light: {
              background: '#fff',
              '--xdb-text-primary': 123,
            },
            dark: [],
            css: {},
            tokens: {},
          },
        },
      ],
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('把 css 写在视图顶层；改用 style.css');
    expect(result.stdout).toContain('style.tokens 不受支持');
    expect(result.stdout).toContain('style.light.background 不是 CSS Token');
    expect(result.stdout).toContain('style.light.--xdb-text-primary 应为非空字符串');
    expect(result.stdout).toContain('style.dark 应为 Token 对象');
    expect(result.stdout).toContain('style.css 应为字符串');
  });

  it('rejects malformed Root Group type and style configuration', () => {
    const result = validate({
      source: 'file',
      fields: [],
      rootGroup: {
        type: 'stack',
        css: ':scope {}',
        style: {
          light: { background: '#fff' },
        },
      },
      views: [],
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('rootGroup.type 非法');
    expect(result.stdout).toContain('Root Group 把 css 写在视图顶层；改用 style.css');
    expect(result.stdout).toContain('Root Group 的 style.light.background 不是 CSS Token');
  });
});

describe('validate-xdb current creation and root layout contracts', () => {
  it('allows a task source to expose create through a custom newRowAction', () => {
    const result = validate({
      source: 'task',
      fields: [],
      views: [
        {
          id: 'task-inbox',
          name: 'Task inbox',
          type: 'table',
          newRowAction: {
            type: 'prompt',
            content: '- [ ] ',
            filePath: 'Tasks/Inbox.md',
            position: 'append',
          },
        },
      ],
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('✓ 无问题');
  });

  it('keeps new-row actions aligned with the current picker scopes', () => {
    const result = validate({
      source: 'file',
      fields: [],
      views: [
        {
          id: 'form-create',
          name: 'Form create',
          type: 'table',
          newRowAction: { type: 'cform', template: 'Forms/Project.cform' },
        },
      ],
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("内置 type 'cform' 不支持当前入口");
  });

  it('treats rootGroup as the owner of multiple root views', () => {
    const result = validate({
      source: 'file',
      fields: [],
      rootGroup: { type: 'dashboard', options: { locked: false } },
      views: [
        { id: 'summary', name: 'Summary', type: 'metric' },
        { id: 'details', name: 'Details', type: 'table' },
      ],
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('✓ 无问题');
    expect(result.stdout).not.toContain('顶层视图散落');
  });

  it('checks waterfall option ranges', () => {
    const result = validate({
      source: 'file',
      fields: [],
      views: [
        {
          id: 'cards',
          name: 'Cards',
          type: 'waterfall',
          options: {
            minCardWidth: 50,
            maxCardWidth: 900,
            cardMaxHeight: 100,
            hideFieldName: 'yes',
          },
        },
      ],
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('minCardWidth 应在 100–800 之间');
    expect(result.stdout).toContain('maxCardWidth 应在 100–800 之间');
    expect(result.stdout).toContain('cardMaxHeight 应在 180–1200 之间');
    expect(result.stdout).toContain('hideFieldName 应为 boolean');
  });
});

describe('validate-xdb binding view', () => {
  it('accepts top-level file/items with property and task bindings', () => {
    const result = validate({
      source: 'file',
      fields: [],
      views: [
        {
          id: 'console',
          name: '控制台',
          type: 'binding',
          file: { path: 'Daily/{{date:YYYY-MM-DD}}.md', template: 'Templates/Daily.md' },
          items: [
            {
              id: 'item-status',
              binding: { type: 'file-property', property: 'status' },
              control: { type: 'radio', options: ['doing', 'done'] },
            },
            {
              id: 'item-review',
              binding: { type: 'task', text: 'Review {{date}}', blockId: 'review', insert: { position: 'append' } },
            },
          ],
        },
        { id: 'host-panel', name: '本页面板', type: 'binding' },
      ],
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('✓ 无问题');
  });

  it('flags ignored data-view fields and malformed binding items', () => {
    const result = validate({
      source: 'file',
      fields: [{ name: 'status', type: 'select' }],
      views: [
        {
          id: 'bad-console',
          name: '控制台',
          type: 'binding',
          filter: { type: 'group', id: 'g', join: 'and', items: [] },
          visibleFields: ['status'],
          options: { file: 'thisFile' },
          file: 'Projects/Plan.md',
          items: [
            { id: 'item-status', binding: { type: 'file-property', property: '' } },
            { id: 'item-status', binding: { type: 'file-property', property: 'status' }, control: { type: 'slider' } },
            { id: 'item-daily', binding: { type: 'task', text: 'Review {{date:YYYY-MM-DD}}' } },
          ],
        },
      ],
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('的绑定项 id 重复：item-status');
    expect(result.stdout).toContain('配置了 options，但专属字段在视图顶层（file/items）');
    expect(result.stdout).toContain('配置了 filter，但 binding 不读 source、会忽略该字段');
    expect(result.stdout).toContain('配置了 visibleFields，但 binding 不读 source、会忽略该字段');
    expect(result.stdout).toContain("file 'Projects/Plan.md' 不是 'thisFile'/'activeFile'；固定路径要写成");
    expect(result.stdout).toContain('items[0] 的 property 为空，该绑定项会被忽略');
    expect(result.stdout).toContain('items[1] 的 control.type 非法："slider"');
    expect(result.stdout).toContain('items[2] 的 text 使用日期时间变量但缺 blockId');
  });
});
