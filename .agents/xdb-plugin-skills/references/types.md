# 类型参考（types）

跨多个扩展点都用、但别处没展开的类型，集中在这里供查阅。所有定义都是完整的，不省略字段。

- 公共上下文 `XdbContextProps`：所有扩展点 props 都带的宿主注入字段（`app` / `moment` / `PluginComponent` / `obsidian` / `echarts`）
- `Database`：view / settings / cover / button step 拿到的 `api`，数据库读写入口
- `FilterItem`：过滤条件的结构
- 行数据 `$item`：每一行的结构（`FileIndex` / `TaskIndex`），由数据源决定

## 公共上下文（XdbContextProps）

所有扩展点回调（view / settings / cover / button step）的 `props` 都带这组宿主注入字段。其中 `app` / `obsidian` / `echarts` 各是一个完整的外部命名空间，下面只列最常用的入口，完整能力查对应官方文档。

### app：Obsidian App 实例

```ts
app: App;
```

Obsidian 核心 `App`，常用三块：

- `app.vault` —— 文件读写：`getAbstractFileByPath(path)` 按路径取文件、`cachedRead(file)` 读正文、`getResourcePath(file)` 取可在 `<img src>` 直接用的资源 URL
- `app.metadataCache` —— 文件元信息：`getFirstLinkpathDest(link, sourcePath)` 解析 wikilink、`getFileCache(file)?.embeds` 取内嵌资源
- `app.workspace` —— `openLinkText(href, '', newLeaf)` 打开一篇笔记

完整定义见 obsidian.d.ts。

### moment

```ts
moment: typeof moment;
```

Moment.js 实例，日期解析与格式化。文档 momentjs.com。

### PluginComponent：插件根 Component

```ts
PluginComponent: Component;
```

插件根 `Component`，插件卸载时会连带卸载挂在其下的子组件。

> 设计原则：需要组件生命周期时（例如渲染 markdown 要传一个 `component`），优先 `const component = new props.obsidian.Component()` 自建一个，再按 Obsidian 的 `addChild` / `unload` 语义挂载或回收，不要直接复用 `PluginComponent`。

### obsidian：Obsidian API 命名空间

```ts
obsidian: typeof import('obsidian');
```

整个 obsidian 模块。常用：

```js
// 渲染 markdown：5 个参数，最后一个 component 管渲染产物的生命周期
props.obsidian.MarkdownRenderer.render(app, '## 标题', el, sourcePath, component);

// 发请求 / 解析 yaml / 弹通知
props.obsidian.requestUrl({ url: 'https://api.example.com/data' });
const obj = props.obsidian.parseYaml('key: value');
new props.obsidian.Notice('已完成');
```

完整定义见 obsidian.d.ts。

### MarkdownRenderer（@deprecated）

```ts
/** @deprecated 改用 obsidian.MarkdownRenderer */
MarkdownRenderer: typeof MarkdownRenderer;
```

改用 `props.obsidian.MarkdownRenderer`。

### echarts：预配置的 ECharts

```ts
echarts: typeof import('echarts/core');
```

已注册好下列图表与组件，**不要**再自行 `import` / `use()`：

- 图表：Bar / Line / Pie / Radar / Heatmap / Funnel / Tree
- 组件：Title / Tooltip / Grid / Dataset / Legend / Calendar / VisualMap / MarkLine
- 渲染器：CanvasRenderer

```js
const chart = props.echarts.init(container);
chart.setOption({
  xAxis: { type: 'category', data: ['Mon', 'Tue', 'Wed'] },
  yAxis: { type: 'value' },
  series: [{ data: [120, 200, 150], type: 'bar' }],
});
```

图表实例的生命周期（`ResizeObserver` 驱动 `resize()`、`onDestroy` 里 `dispose()`）见 [lifecycle.md](lifecycle.md#echarts-的稳定写法)。文档 echarts.apache.org。

## Database

`api` 是当前数据库的读写入口。完整定义如下（`Pos`、`CachedMetadata` 来自 Obsidian，插件可直接使用）：

```ts
interface Database extends XdbFieldApi, XdbTemplateApi, XdbViewApi, XdbSourceApi {
  /** 完整定义的只读快捷访问，等价于 getDefinition() */
  readonly definition: DatabaseDefinition;
  /**
   * 数据事件总线：
   * 'xdb.load' | 'xdb.data.change' | 'xdb.filter.change' | 'xdb.fields.change' |
   * 'xdb.field.change' | 'xdb.views.change' | 'xdb.view.change' | 'xdb.source.change'
   */
  readonly eventBus: DatabaseEventBus;
  /** 最后一次自写的时间戳，用于区分自写与外部改动 */
  readonly lastModifiedTime: number;

  /* ── 读数据 ── */
  /** 数据库 id */
  getId(): string;
  /** 完整定义（字段、视图等） */
  getDefinition(): DatabaseDefinition;
  /** 读全部行，可按 filter 过滤 */
  getData(filter?: FilterItem): Promise<DatabaseData>;
  /** 判断一行原始数据是否匹配过滤条件 */
  matchesFilter(item: Record<string, unknown>, filter: FilterItem): boolean;
  /** 某个视图的投影数据，结构见 database-view.md 的 viewData */
  getViewData(id: string, query?: { text: string }): Promise<DatabaseViewData | null>;
  /** 所有视图的投影 */
  getAllViewData(): Promise<DatabaseViewData[]>;
  /** 行的链接：文件库→文件路径；任务库→'文件 (L行号)' */
  getRowLink(rowId: string): { href: string; label: string } | null;

  /* ── 写数据（行）── */
  /** 更新一行的多个字段 */
  updateRow(id: string, values: Record<string, unknown>): Promise<void>;
  /** 更新单个单元格 */
  updateCell(rowId: string, fieldName: string, value: unknown): Promise<void>;
  /** 删除一行 */
  deleteRow(id: string): Promise<void>;
  /** 批量删除 */
  deleteRows(ids: string[], options?: DatabaseDeleteRowsOptions): Promise<DatabaseDeleteRowsResult>;

  /* ── 写视图 / 定义 ── */
  /** 更新数据库 filter */
  updateFilter(filter: FilterItem | undefined): Promise<void>;

  /* ── 其余：多为宿主内部使用，插件一般用不到 ── */
  /** 切换数据源（如 'file' → 'task'） */
  changeSource(source: string): Promise<void>;
  /** 把内存里的改动刷盘（一般不用手动调） */
  flush(): Promise<void>;
  /** 卸载数据库实例（一般不用手动调） */
  unload(): Promise<void>;
}
```

`Database` 还组合了下面四个能力接口（视图 / 字段 / 模板 / 数据源），插件按需用：

```ts
interface XdbViewApi {
  /** 更新视图定义——插件改 view 配置最常用（见 conventions.md 的"状态更新"） */
  updateView(view: DatabaseViewDefinition): Promise<void>;
  /** 新增视图 */
  createView(view: DatabaseViewDefinition): Promise<void>;
  /** 删除视图 */
  deleteView(id: string): Promise<void>;
  /** 调整视图顺序 */
  reorderViews(fromIndex: number, toIndex: number): Promise<void>;
}

interface XdbFieldApi {
  createField(field: DatabaseFieldDefinition): Promise<void>;
  renameField(oldName: string, newName: string): Promise<void>;
  updateField(name: string, field: DatabaseFieldDefinition): Promise<void>;
  deleteField(name: string): Promise<void>;
  deleteFields(names: string[]): Promise<void>;
  /** 所有可用字段（含内置 file.*、status 等） */
  getAvailableFields(): DatabaseAvailableField[];
  /** 字段历史值建议 */
  getFieldValueSuggestions(fieldName: string): Promise<string[]>;
  /** 支持的字段类型 */
  getSupportedFieldTypes(): FieldTypeOption[];
  /** 字段类型与是否内置 */
  getFieldType(fieldName: string): { type: DatabaseFieldType; isBuiltIn: boolean };
}

interface XdbTemplateApi {
  /** 可用模板列表 */
  getTemplateSuggestions(): Promise<DatabaseTemplate[]>;
  /** 设置视图默认模板（新建行时使用） */
  setDefaultTemplate(viewId: string, templateId: string | null): Promise<void>;
  /** 按模板新建行（任务库不支持，会抛错） */
  createRowByTemplate(templateId: string, values?: Record<string, unknown>): Promise<void>;
}

interface XdbSourceApi {
  /** 切换数据源（如 'file' → 'task'），持久化并发 xdb.source.change 事件 */
  changeSource(source: string): Promise<void>;
}
```

`Database` 用到的字段 / 值类型：

```ts
type DatabaseFieldType =
  | 'text' | 'number' | 'boolean' | 'date' | 'datetime'
  | 'select' | 'multi-select' | 'button' | string;

interface DatabaseFieldDefinition {
  name: string;
  type?: DatabaseFieldType;
  formula?: string;
  options?: Record<string, unknown>;
}

interface DatabaseAvailableField {
  name: string;
  label?: string;
  description?: string;
  type?: DatabaseFieldType;
}

interface FieldTypeOption {
  value: DatabaseFieldType;
  label: string;
}

interface DatabaseTemplate {
  id: string;
  name: string | (() => string);
  icon?: string;
}

interface DatabaseDeleteRowsProgress {
  processed: number;
  total: number;
  currentId: string;
}

interface DatabaseDeleteRowsFailedItem {
  rowId: string;
  message?: string;
}

interface DatabaseDeleteRowsResult {
  status: 'success' | 'cancelled';
  processed: number;
  total: number;
  deletedIds: string[];
  failedItems: DatabaseDeleteRowsFailedItem[];
  remainingIds: string[];
}

interface DatabaseDeleteRowsOptions {
  signal?: AbortSignal;
  onProgress?: (progress: DatabaseDeleteRowsProgress) => void;
}
```

## FilterItem

`viewDefinition.filter`、`matchesFilter(item, filter)` 里的 `filter` 都是 `FilterItem`——一个由 `group` 和叶子条件（`condition` / `expression`）组成的递归结构：

```ts
type FilterJoin = 'and' | 'or';

interface FilterItemBase {
  id: string;
  type: string;
}

/** 用 join 组合多个子条件 */
interface FilterGroup extends FilterItemBase {
  type: 'group';
  join: FilterJoin;
  items: FilterItem[];
}

/** 单字段条件 */
interface ConditionFilterItem extends FilterItemBase {
  type: 'condition';
  field: string;
  operator: string;
  value?: unknown;
}

/** 表达式条件 */
interface ExpressionFilterItem extends FilterItemBase {
  type: 'expression';
  expression: string;
}

type FilterLeafItem = ConditionFilterItem | ExpressionFilterItem | FilterItemBase;

type FilterItem = FilterGroup | FilterLeafItem;
```

## 行数据 $item

插件读到的每一行数据是一个 `$item`，结构由**数据源**决定。xdb 有两个数据源：

| 数据源 | 一行是什么 | row id | `$item` 来源 |
| --- | --- | --- | --- |
| 文件库 | vault 里的一个文件 | `file.path` | `FileIndex` |
| 任务库 | vault 里的一个任务（checkbox） | `"${file.path}::${行号}"` | `TaskIndex` + 派生字段 |

> 凡是拿到行数据的地方——`viewData.groups[].rows[].$item`、行样式的 `item`、按钮步骤的 `$item`——都遵循下面的结构。

### FileIndex（文件库）

一行 = 一个文件。`$item` 本身就是 `FileIndex`：**frontmatter 字段平铺在根上**，文件元信息集中在 `file.*`。

```ts
interface FileIndex {
  /** 文件 frontmatter 的每个 key 都直接挂在根上；例如 frontmatter 有 status: done，则 $item.status === 'done' */
  [key: string]: any;
  /** frontmatter 的 aliases */
  aliases: string[];
  /** frontmatter 的 cssclasses */
  cssclasses: string[];
  /** 文件元信息，通过 file.xxx 访问 */
  file: FileMetadata;
}
```

```ts
interface FileMetadata extends FileRef {
  /** 内容哈希 */
  indexHash: string;
  /** 正文字符 / 单词统计 */
  textStats: TextStats;
  /** 文件内的任务列表 */
  tasks: TaskIndex[];
  /** 出链 */
  links: LinkData[];
  /** 反链文件路径列表 */
  backlinks: string[];
  /** 透传 Obsidian CachedMetadata */
  headings?: CachedMetadata['headings'];
  /** 透传 Obsidian CachedMetadata */
  sections?: CachedMetadata['sections'];
  /** 透传 Obsidian CachedMetadata */
  embeds?: CachedMetadata['embeds'];
  /** 透传 Obsidian CachedMetadata */
  listItems?: CachedMetadata['listItems'];
  /** 透传 Obsidian CachedMetadata */
  footnotes?: CachedMetadata['footnotes'];
  /** 透传 Obsidian CachedMetadata */
  footnoteRefs?: CachedMetadata['footnoteRefs'];
  /** 透传 Obsidian CachedMetadata */
  referenceLinks?: CachedMetadata['referenceLinks'];
  /** 透传 Obsidian CachedMetadata */
  frontmatterPosition?: CachedMetadata['frontmatterPosition'];
  /** 透传 Obsidian CachedMetadata */
  blocks?: CachedMetadata['blocks'];
}

interface FileRef {
  /** 完整路径，同时也是 row id */
  path: string;
  /** 带后缀的文件名，如 'Meeting.md' */
  name: string;
  /** 不带后缀的文件名 */
  basename: string;
  /** 后缀，如 'md' */
  extension: string;
  /** 所在文件夹路径，根目录为 '' */
  parent: string;
  /** 文件级标签（frontmatter + 行内），已去重 */
  tags: string[];
  /** 创建时间（毫秒时间戳） */
  ctime: number;
  /** 修改时间（毫秒时间戳） */
  mtime: number;
  /** 文件大小（字节） */
  size: number;
}

interface TextStats {
  chars: number;
  words: number;
}

interface LinkData {
  link: string;
  original: string;
  displayText: string;
  position: Pos;
  /** 出现在 frontmatter 时为对应 key 名 */
  key?: string;
  inFrontmatter: boolean;
}
```

文件库可查询的内置字段：`file.path`、`file.name`、`file.basename`、`file.extension`、`file.parent`、`file.tags`、`file.ctime`、`file.mtime`、`file.size`、`file.textStats.chars`、`file.textStats.words`、`file.backlinks`、`file.tasks`、`aliases`、`cssclasses`，外加所有 frontmatter key（平铺在根）。

读写规则：

- `file.basename` 可写 → 改文件名（注意：会改变 row id）
- frontmatter 字段可写 → 写回文件 frontmatter
- `file.path`、其余 `file.*` 内置字段、公式字段 → 只读

### TaskIndex（任务库）

一行 = 一个任务（markdown checkbox 行）。任务行的 `$item` 在 `TaskIndex` 基础上叠加了派生字段 `content`、`file`、`note`：

```ts
interface TaskIndex {
  /** 所属文件，便于按文件属性过滤任务 */
  file: FileRef;
  /** 文件内 0 起行号，是文件内的稳定身份 */
  number: number;
  /** 父任务行号；-1 表示顶层任务 */
  parent: number;
  /** 状态字符：' '(待办) / 'x'(完成) / '-'(取消) */
  status: string;
  /** 原始整行文本（含 - [ ] 前缀和行内 emoji 元数据） */
  text: string;
  /** 该任务行在文件中的精确位置 */
  position: Pos;
  /** 行内 #tags，如 ['#work', '#urgent'] */
  tags: string[];
  /**
   * Tasks 插件 emoji 日期字段平铺在根，存在时为日期字符串 'YYYY-MM-DD'：
   * ✅ 完成时间 / ➕ 创建时间 / 📅📆🗓 截止 / 🛫 开始 / ⏳⌛ 计划 / ❌ 取消时间
   */
  [key: string]: unknown;
}

/** 任务库一行的 $item：TaskIndex 字段平铺在根，外加下面派生字段 */
type TaskRowItem = TaskIndex & {
  /** text 去掉状态标记后的纯文本 */
  content: string;
  /** 所属笔记的 frontmatter 上下文（FileIndex 去掉 file 后的剩余字段，如 note.project） */
  note: Omit<FileIndex, 'file'>;
};
```

任务库可查询的内置字段：`status`、`content`、`text`、`tags`、`number`、`parent`，以及 `file.path`、`file.name`、`file.basename`、`file.extension`、`file.parent`、`file.tags`、`file.ctime`、`file.mtime`。emoji 日期字段（`✅`、`📅` 等）也可直接取。

读写规则：

- 可写：`status`（切换状态）、`content` / `text`（改任务文本）
- 只读：`number`、`parent`、`file.*`、emoji 日期字段
- 不支持新建任务（`createRow` 会抛错）

### row id

- 文件库：`id === $item.file.path`
- 任务库：`id === "${file.path}::${行号}"`（行号为 0 起）
