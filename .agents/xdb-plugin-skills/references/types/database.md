# Database API

这页只回答两类问题：

1. `props.api`（也就是 `Database`）能做什么
2. 行数据 `$item` 到底长什么样

## `Database`

view / settings / cover / Field Renderer / Field Settings 里拿到的 `api` 都是 `Database`。

```ts
interface Database extends XdbFieldApi, XdbViewApi, XdbSourceApi {
  readonly definition: DatabaseDefinition;
  readonly eventBus: DatabaseEventBus;
  readonly lastModifiedTime: number;

  getId(): string;
  getDefinition(): DatabaseDefinition;
  getData(filter?: FilterItem): Promise<DatabaseData>;
  matchesFilter(item: Record<string, unknown>, filter: FilterItem): boolean;
  evaluateFormula(expression: string, item: Record<string, unknown>): unknown;
  getViewData(id: string, query?: { text: string }): Promise<DatabaseViewData | null>;
  getAllViewData(): Promise<DatabaseViewData[]>;
  getRowLink(rowId: string): { href: string; label: string } | null;
  resolveRowIdReference?(row: DatabaseRow, fieldName: string): string | null;

  updateRow(id: string, values: Record<string, unknown>): Promise<string>;
  updateCell(rowId: string, fieldName: string, value: unknown): Promise<string>;
  moveRow?(rowId: string, targetFolder: string): Promise<string>;
  deleteRow(id: string): Promise<void>;
  deleteRows(ids: string[], options?: DatabaseDeleteRowsOptions): Promise<DatabaseDeleteRowsResult>;

  updateFilter(filter: FilterItem | undefined): Promise<void>;

  handleActiveFileChange?(activeFilePath: string | null): void;

  changeSource(source: string): Promise<void>;
  flush(): Promise<void>;
  unload(): Promise<void>;
}
```

## 组合接口

### 视图：`XdbViewApi`

```ts
interface XdbViewApi {
  updateView(view: DatabaseViewDefinition): Promise<void>;
  createView(view: DatabaseViewDefinition): Promise<void>;
  moveView(viewId: string, targetParentId: string | null): Promise<void>;
  deleteView(id: string): Promise<void>;
  reorderViews(fromIndex: number, toIndex: number): Promise<void>;
}
```

> `DatabaseViewDefinition` 的完整结构见 [xdb-view.md](../xdb-view.md#viewdefinition)。

`moveView()` 是移动视图层级的原子写入：`targetParentId = null` 表示移到根；非空目标必须存在且 `type === 'group'`。它拒绝把视图移入自己的子树，并会清掉被移动视图旧的 `layouts`，让新 dashboard 重新分配位置。不要用 `updateView({ parentId }) + reorderViews()` 拼装移动流程。

`deleteView(id)` 只删除指定 id。宿主 UI 的级联删除由上层 command 遍历子孙后逐个调用；插件如果要删除整个 group 子树，必须先自行收集后代，不能假设 `api.deleteView()` 会级联。

### 字段：`XdbFieldApi`

```ts
interface XdbFieldApi {
  createField(field: DatabaseFieldDefinition): Promise<void>;
  renameField(oldName: string, newName: string): Promise<void>;
  updateField(name: string, field: DatabaseFieldDefinition): Promise<void>;
  deleteField(name: string): Promise<void>;
  deleteFields(names: string[]): Promise<void>;
  getAvailableFields(): DatabaseAvailableField[];
  getFieldValueSuggestions(fieldName: string): Promise<string[]>;
  supportsFieldType(type: DatabaseFieldType, fieldName?: string): boolean;
  getFieldType(fieldName: string): { type: DatabaseFieldType; isBuiltIn: boolean };
  canUpdateCell(fieldName: string): boolean;
  canDeleteCell(fieldName: string): boolean;
}
```

`updateRow()`、`updateCell()` 和可选的 `moveRow()` 返回操作后的最终 `rowId`。文件改名或移动会改变行 id；后续操作必须使用返回值，不能继续使用旧路径。`moveRow` 只在支持移动的数据源上存在。

### 数据源：`XdbSourceApi`

```ts
interface XdbSourceApi {
  changeSource(source: string): Promise<void>;
}
```

## 常用 supporting types

### `DatabaseData` / `DatabaseViewData`

```ts
interface DatabaseData {
  fields: DatabaseFieldDefinition[];
  rows: DatabaseRow[];
}

interface DatabaseViewData {
  name: string;
  type: DatabaseViewType;
  visibleFields: DatabaseFieldDefinition[];
  allFields: DatabaseFieldDefinition[];
  groups: DatabaseViewGroup[];
  options?: Record<string, unknown>;
  summary?: Record<string, string>;
}

interface DatabaseRow {
  id: string;
  $item: Record<string, unknown>;
}
```

### 字段定义

```ts
type DatabaseFieldType =
  | 'text'
  | 'number'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'select'
  | 'multi-select'
  | 'button'
  | string;

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
```

字段类型目录不再由 `Database` 返回；插件通过 `registerFieldType()` 注册目录项，宿主使用
`supportsFieldType()` 询问当前 source 的写入能力。完整注册契约见 [field-type](../field-type.md)。

Field Renderer/Settings 的插件配置放在 `field.options` 下（推荐用一个稳定 key 收纳），并通过 Field Settings 的 `setFieldDefinition()` 写回：

```yaml
- name: Summary
  options:
    example-heading-content:
      enabled: true
      heading: '## Summary'
      includeSubHeadings: true
```

需要定位当前行对应文件时，使用 `api.getRowLink(row.id)`：文件库返回该文件，任务库返回任务所在文件；返回值的 `href` 是 vault 相对路径，可直接传给 `markdown.readUnderHeading()` 等文件 API。

### 删除进度 / 结果

```ts
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

## `FilterItem`

`viewDefinition.filter`、`matchesFilter(item, filter)` 里的 `filter` 都是 `FilterItem`。

```ts
type FilterJoin = 'and' | 'or';

interface FilterItemBase {
  id: string;
  type: string;
}

interface FilterGroup extends FilterItemBase {
  type: 'group';
  join: FilterJoin;
  items: FilterItem[];
}

interface ExpressionFilterItem extends FilterItemBase {
  type: 'expression';
  expression: string;
}

type FilterLeafItem = ExpressionFilterItem | FilterItemBase;
type FilterItem = FilterGroup | FilterLeafItem;
```

筛选叶节点使用 `expression`。表达式必须返回 `boolean`；包含空格或符号的字段名使用 `field("Due Date")` 读取。

运行时只识别 `group` 和 `expression`。旧 `condition` 节点只在设置 UI 的迁移流程中可能被转换，直接交给 `matchesFilter()` 会按不匹配处理；插件不得生成旧节点。

`tags` / `file.tags` 是普通字符串数组：匹配保留原始 `#`、大小写和层级，不会自动归一化或展开。例如 `"#Project/Alpha"` 不等于 `"project"`。

## 行数据 `$item`

插件读到的每一行数据都在 `$item` 上，但结构由数据源决定。

| 数据源 | 一行是什么         | row id                  | `$item` 的主结构 |
| ------ | ------------------ | ----------------------- | ---------------- |
| 文件库 | vault 里的一个文件 | `file.path`             | `FileIndex`      |
| 任务库 | vault 里的一个任务 | `${file.path}::${行号}` | `TaskRowItem`    |

> 凡是拿到行数据的地方都遵循这套结构：`viewData.groups[].rows[].$item`、Field Renderer 的 `row.$item`、row-style provider 的 `item`。

### 文件库

```ts
interface FileIndex {
  [key: string]: any;
  aliases: string[];
  cssclasses: string[];
  file: FileMetadata;
}

interface FileMetadata extends FileRef {
  indexHash: string;
  textStats: TextStats;
  tasks: TaskIndex[];
  links: LinkData[];
  backlinks: string[];
  headings?: CachedMetadata['headings'];
  sections?: CachedMetadata['sections'];
  embeds?: CachedMetadata['embeds'];
  listItems?: CachedMetadata['listItems'];
  footnotes?: CachedMetadata['footnotes'];
  footnoteRefs?: CachedMetadata['footnoteRefs'];
  referenceLinks?: CachedMetadata['referenceLinks'];
  frontmatterPosition?: CachedMetadata['frontmatterPosition'];
  blocks?: CachedMetadata['blocks'];
}

interface FileRef {
  path: string;
  name: string;
  basename: string;
  extension: string;
  parent: string;
  tags: string[];
  ctime: number;
  mtime: number;
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
  key?: string;
  inFrontmatter: boolean;
}
```

说明：

- frontmatter 字段平铺在根上，例如 `$item.status`
- 文件元信息集中在 `file.*`
- `LinkData.position` 的 `Pos` 结构见 [tasks.md](tasks.md#pos--loc)

内置可查询字段：

- `file.path`
- `file.name`
- `file.basename`
- `file.extension`
- `file.parent`
- `file.tags`
- `file.ctime`
- `file.mtime`
- `file.size`
- `file.textStats.chars`
- `file.textStats.words`
- `file.backlinks`
- `file.tasks`
- `aliases`
- `cssclasses`
- 所有 frontmatter key

读写规则：

- 可写：`file.basename`、frontmatter 字段
- 只读：`file.path`、其余 `file.*` 内置字段、公式字段

### 任务库

```ts
interface TaskIndex {
  file: FileRef;
  number: number;
  parent: number;
  status: string;
  text: string;
  position: Pos;
  tags: string[];
  [key: string]: unknown;
}

type TaskRowItem = TaskIndex & {
  content: string;
  note: Omit<FileIndex, 'file'>;
};
```

说明：

- `content`：`text` 去掉 `- [ ]` 这类状态前缀后的纯文本
- `note`：所属笔记的 frontmatter 上下文
- `position` 的 `Pos` 结构见 [tasks.md](tasks.md#pos--loc)
- 行内 emoji 日期字段（`✅`、`📅`、`🛫` 等）平铺在根上

内置可查询字段：

- `status`
- `content`
- `text`
- `tags`
- `number`
- `parent`
- `file.path`
- `file.name`
- `file.basename`
- `file.extension`
- `file.parent`
- `file.tags`
- `file.ctime`
- `file.mtime`
- emoji 日期字段

读写规则：

- 可写：`status`、`content`、`text`
- 只读：`number`、`parent`、`file.*`、emoji 日期字段
- 不支持 `createRow`

## `row id`

- 文件库：`id === $item.file.path`
- 任务库：`id === "${file.path}::${行号}"`（行号为 0 起）
