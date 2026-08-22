# Database API

`props.api` 是当前 `Database`。先使用扩展点已经提供的数据；只有任务超出当前 props 时才调用这里的方法。

## 目录

- [先选读取入口](#先选读取入口)
- [定义和数据](#定义和数据)
- [View](#view)
- [Row](#row)
- [Field、Filter 与 Root Group](#fieldfilter-与-root-group)
- [生命周期和 source](#生命周期和-source)
- [Definition schema](#definition-schema)
- [数据结构](#数据结构)
- [FilterItem](#filteritem)
- [不同 source 的行](#不同-source-的行)

## 先选读取入口

| 任务                               | 使用                                             |
| ---------------------------------- | ------------------------------------------------ |
| Database View 渲染当前 View 的结果 | `props.viewData`                                 |
| 读取当前定义                       | `api.getDefinition()`                            |
| 同步读取最近一次数据               | `api.getDataSnapshot()`；首次加载前可能为 `null` |
| 读取应用全局 filter 后的行         | `await api.getData()`                            |
| 读取 source 产生的全部建模行       | `await api.getAllData()`                         |
| 查询指定 View                      | `await api.getViewData(viewId, query?)`          |

Database View 已由宿主管理查询和更新，不要为了 `props.viewData` 再建立一套 `subscribeData()` 缓存。

## 定义和数据

```ts
interface Database {
  /** 当前 source-scoped Database 的稳定身份。 */
  getId(): string;

  /** 持久化 `.xdb` definition 的 vault 相对路径，也是 Obsidian sourcePath。 */
  getDefinitionPath(): string;

  /** 返回当前 definition；按只读数据使用，不要原地修改。 */
  getDefinition(): Readonly<DatabaseDefinition>;

  /**
   * 订阅 definition 发布。listener 只是失效信号；回调后重新调用 getDefinition()。
   * 返回 unsubscribe，实例销毁时必须调用。
   */
  subscribeDefinition(listener: () => void): () => void;

  /**
   * 同步返回最近一次已发布的 data + matching definition；首次加载或失效时为 null。
   * 这两个字段属于同一轮结果，避免把新 definition 与旧 rows 混用。
   */
  getDataSnapshot(): {
    data: DatabaseData;
    definition: Readonly<DatabaseDefinition>;
  } | null;

  /** 订阅 data snapshot 发布；回调后重新调用 getDataSnapshot()。返回 unsubscribe。 */
  subscribeData(listener: () => void): () => void;

  /** 返回应用 Database 全局 filter 后的行；filter 参数是额外条件。 */
  getData(filter?: FilterItem): Promise<DatabaseData>;

  /** 返回 source 产生的全部建模行，不应用 Database 全局 filter；filter 参数是额外条件。 */
  getAllData(filter?: FilterItem): Promise<DatabaseData>;

  /**
   * 查询指定 View 的 filter/sort/group/summary 投影；query.text 追加文本搜索。
   * id 不存在时返回 null。
   */
  getViewData(id: string, query?: { text: string }): Promise<DatabaseViewData | null>;

  /** 查询当前 definition 中所有 View；结果顺序跟随 definition.views。 */
  getAllViewData(): Promise<DatabaseViewData[]>;

  /** 用当前字段 schema 和表达式上下文判断一条原始 item 是否匹配 filter。 */
  matchesFilter(item: Record<string, unknown>, filter: FilterItem): boolean;

  /** 在当前 Database 表达式上下文中求值；返回类型由表达式决定，错误会抛出。 */
  evaluateFormula(expression: string, item: Record<string, unknown>): unknown;
}
```

- `getDefinition()` 返回当前定义。把返回值当作只读数据；修改时调用对应的 `update*()` 方法。没有 `api.definition`、`eventBus` 或 `lastModifiedTime`。
- View / Settings 已直接收到 `viewDefinition` 时优先读 props。
- `getData()` 应用数据库的全局 filter；`getAllData()` 不应用全局 filter。两者的可选参数都是额外 filter。
- 自己订阅时保存并调用返回的 unsubscribe；实例销毁时取消。

## View

```ts
interface XdbViewApi {
  /** 创建一个 View；id 为空时实现可能生成 id，第三方仍应主动提供稳定 id。 */
  createView(view: DatabaseViewDefinition): Promise<void>;

  /** 整批验证并在一次 definition mutation 中创建；任一非法时整批不发布。 */
  createViews(views: DatabaseViewDefinition[]): Promise<void>;

  /** 返回当前 definition 中 parentId 与参数相等的直接子 View；null 表示根 View。 */
  getViewsByParentId(parentId: string | null): DatabaseViewDefinition[];

  /** 用同 id 的完整定义替换当前 View；调用方必须保留不属于自己的字段。 */
  updateView(view: DatabaseViewDefinition): Promise<void>;

  /** 移动 View 到父 group，null 表示根；实现负责层级校验和布局清理。 */
  moveView(viewId: string, targetParentId: string | null): Promise<void>;

  /** 只删除指定 id，不自动删除后代。 */
  deleteView(id: string): Promise<void>;

  /** 在扁平 views 数组中移动条目；索引越界或两个索引相同时不做修改。 */
  reorderViews(fromIndex: number, toIndex: number): Promise<void>;
}
```

- 多个 View 应一起出现时使用 `createViews()`；整批先验证，再一次发布。
- `getViewsByParentId(null)` 返回根 View；传 group id 返回直接子 View。
- `moveView()` 负责层级校验和旧 dashboard layout 清理。不要用 `updateView({ parentId })` 拼装移动。
- `deleteView(id)` 只删除该 id；删除整个 group 子树前先收集后代。
- View 内部要写配置时，先从当前 definition 找到目标 View，再调用 `updateView()`；不要拿早先闭包里的定义覆盖并发修改。

## Row

```ts
interface XdbRowApi {
  /**
   * 可选的 source-owned 创建能力。viewId 决定创建上下文；values 是字段初值。
   * 返回 item.href 用于通知和打开；不保证新行满足当前 View filter。
   */
  createRow?(input: {
    viewId: string;
    values?: Readonly<Record<string, unknown>>;
  }): Promise<{ item: { href: string } }>;

  /** 更新一组字段，返回更新后规范 row id；文件重命名等操作可能改变 id。 */
  updateRow(id: string, values: Record<string, unknown>): Promise<string>;

  /** updateRow 的单字段形式，返回更新后规范 row id。 */
  updateCell(rowId: string, fieldName: string, value: unknown): Promise<string>;

  /** 可选移动能力；targetFolder 是 vault 相对文件夹路径，返回移动后规范 row id。 */
  moveRow?(rowId: string, targetFolder: string): Promise<string>;

  /** 删除一行；不存在或 source 拒绝时会抛错。 */
  deleteRow(id: string): Promise<void>;

  /** 按输入顺序逐项删除，并返回成功、失败、取消和剩余项。 */
  deleteRows(ids: string[], options?: DatabaseDeleteRowsOptions): Promise<DatabaseDeleteRowsResult>;

  /** 把规范 row id 转为可打开的 vault href/label；无法解析时返回 null。 */
  getRowLink(rowId: string): { href: string; label: string } | null;

  /** 可选的行引用解析能力；空值、非法引用或无法解析时返回 null。 */
  resolveRowIdReference?(row: DatabaseRow, fieldName: string): string | null;

  /** 当前 source 是否允许写此字段。实际写入仍可能因权限、冲突或 I/O 失败。 */
  canUpdateCell(fieldName: string): boolean;

  /** 当前 source 是否允许删除此字段值。 */
  canDeleteCell(fieldName: string): boolean;
}
```

先做 capability 检查：

```js
if (props.api.createRow) {
  const result = await props.api.createRow({
    viewId: props.viewId,
    values: { status: 'todo' },
  });
  console.log(result.item.href);
}
```

- `createRow`、`moveRow`、`resolveRowIdReference` 是可选能力。
- 写字段前用 `canUpdateCell()`；删除字段值前用 `canDeleteCell()`。
- `updateRow()`、`updateCell()`、`moveRow()` 返回操作后的最终 row id。文件改名或移动后，后续操作使用返回值。
- `getRowLink()` 把 row id 转为用户可打开的 vault 链接；文件和任务 source 都支持。

批量删除：

```ts
type DatabaseDeleteRowsOptions = {
  /** abort 后停止处理尚未开始的 id，并返回 status: cancelled。 */
  signal?: AbortSignal;

  /** 每处理完一个 id 调用一次；processed 包含成功和失败项。 */
  onProgress?: (progress: { processed: number; total: number; currentId: string }) => void;
};

type DatabaseDeleteRowsResult = {
  /** 所有输入都已尝试时为 success；被 signal 中止时为 cancelled。 */
  status: 'success' | 'cancelled';
  /** 已尝试项数量，等于 deletedIds.length + failedItems.length。 */
  processed: number;
  /** 输入 ids 的总数。 */
  total: number;
  /** 成功删除的 row id，保持处理顺序。 */
  deletedIds: string[];
  /** 删除失败的 id 与可选错误说明；单项失败不会终止整批。 */
  failedItems: Array<{ rowId: string; message?: string }>;
  /** 取消时尚未尝试的 id；success 时为空。 */
  remainingIds: string[];
};
```

## Field、Filter 与 Root Group

```ts
interface XdbFieldApi {
  /** 创建一个自定义字段；name 必须唯一且 source 必须支持 type。 */
  createField(field: DatabaseFieldDefinition): Promise<void>;

  /** 重命名字段，并更新 definition 中由宿主维护的字段引用。 */
  renameField(oldName: string, newName: string): Promise<void>;

  /** 用完整 field 定义替换指定字段；name 参数定位旧字段。 */
  updateField(name: string, field: DatabaseFieldDefinition): Promise<void>;

  /** 删除一个自定义字段及由宿主维护的定义引用。 */
  deleteField(name: string): Promise<void>;

  /** 一次删除多个自定义字段。 */
  deleteFields(names: string[]): Promise<void>;

  /** 返回 source 字段与 .xdb 自定义字段组成的当前可用字段目录。 */
  getAvailableFields(): DatabaseAvailableField[];

  /** 返回字段 schema 静态选项与 source 动态建议的去重字符串列表。 */
  getFieldValueSuggestions(fieldName: string): Promise<string[]>;

  /** 当前 source 是否支持此 field type；fieldName 用于已有字段的上下文检查。 */
  supportsFieldType(type: string, fieldName?: string): boolean;

  /**
   * 返回字段的规范 type，以及它是否由 source 提供。
   * 未知/空字段名回退为 { type: 'text', isBuiltIn: false }，不能用它判断字段是否存在。
   */
  getFieldType(fieldName: string): { type: string; isBuiltIn: boolean };
}

interface XdbGlobalFilterApi {
  /** 替换 Database 全局 filter；undefined 清除。 */
  updateFilter(filter: FilterItem | undefined): Promise<void>;
}

interface Database {
  /** 替换完整 Root Group 定义；调用方保留自己不修改的 options/style 字段。 */
  updateRootGroup(rootGroup: RootGroupDefinition): Promise<void>;
}
```

- Field Type 目录由 `registerFieldType()` 扩展；`supportsFieldType()` 只回答当前 source 是否支持该类型。
- Field 插件配置放在 `field.options[pluginId]`，通过 Field Settings 的 `setFieldDefinition()` 写回。
- `updateFilter(undefined)` 清除全局 filter。
- `updateRootGroup()` 一次写入根 tabs / vertical-tabs / dashboard 的定义；不要创建包装用 group View 代替它。

## 生命周期和 source

```ts
interface Database {
  /**
   * 持久化新的 source 值。当前具体 Database 不原地变成另一种实现；
   * 宿主观察 definition 文件后负责替换实例。
   */
  updateSource(source: string): Promise<void>;

  /** 恢复 source 工作并发布当前 definition；由宿主挂载生命周期调用。 */
  activate(): Promise<void>;

  /** 停止 source 工作并撤销当前行读取；保留 definition。由宿主调用。 */
  freeze(): Promise<void>;

  /** 等待已排队的 definition 写入完成。 */
  flush(): Promise<void>;

  /** 永久释放 Database、订阅和待处理工作；调用后不再使用该实例。 */
  unload(): Promise<void>;
}
```

- `updateSource()` 持久化新的 source，但不会把当前 `Database` 实例切换为另一种实现；通常由宿主完成后续替换。
- `activate()` / `freeze()` 是 source 工作生命周期，通常由宿主的挂载状态控制。View 插件不要自行切换。
- `flush()` 等待定义写入；`unload()` 释放整个 Database。普通 ViewInstance 不拥有 Database，不应在 `onDestroy()` 调用 `unload()`。

## Definition schema

```ts
/**
 * 内置字段类型，加上第三方 registerFieldType() 注册的稳定字符串。
 * 自定义 type 不会自动获得 renderer、settings 或 source 写入能力。
 */
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
  /**
   * 字段稳定名称，也是 row.$item 的访问 key。Database 内必须唯一。
   * 第三方配置引用字段时保存 name，不保存 label 或数组索引。
   */
  name: string;

  /** 字段类型；省略时按 text 处理。自定义 type 使用注册的稳定 type id。 */
  type?: DatabaseFieldType;

  /** 可选公式表达式；存在时字段值由表达式求得，通常不可直接写入。 */
  formula?: string;

  /**
   * 字段级扩展配置。第三方把数据放在 options[pluginId]，并保留其它 key。
   * 值必须是可写入 .xdb 的普通 JSON 数据。
   */
  options?: Record<string, unknown>;
}

interface DatabaseDefinition {
  /** source 实现 id；省略/空白由宿主按 file 处理。插件不要硬编码未知 source 行为。 */
  source?: string;

  /** .xdb 自定义字段集合；source 字段由 getAvailableFields() 额外提供。 */
  fields: DatabaseFieldDefinition[];

  /** 应用于所有 View 的全局 filter。 */
  filter?: FilterItem;

  /** 扁平 View 集合；层级由每个 View 的 parentId 表达。 */
  views?: DatabaseViewDefinition[];

  /** 所有根 View 的 tabs / vertical-tabs / dashboard 容器配置。 */
  rootGroup?: RootGroupDefinition;

  /**
   * source/实现级配置。由实现名或插件 id 分区；第三方不要修改不属于自己的 key。
   */
  options?: Record<string, unknown>;
}

interface DatabaseViewDefinition {
  /** View 稳定 id；在本 Database 内唯一，供 viewId、parentId 和命令定位。 */
  id: string;

  /** 用户可见 View 名。 */
  name: string;

  /** View renderer type；内置值或第三方 ViewExtension.id。 */
  type: string;

  /**
   * 扁平层级中的父 View id。省略/null 表示根 View；字符串表示由该父 View 渲染。
   * 移动层级优先调用 api.moveView()，不要只改这个字段。
   */
  parentId?: string | null;

  /** View tab/设置图标的 Lucide 名。 */
  icon?: string;

  /** 当前 View 的共享视觉定制；style-only 变化不必重新查询行数据。 */
  style?: DatabaseViewStyle;

  /** Dashboard 等父 View 使用的断点布局；key 是宿主识别的 breakpoint 名。 */
  layouts?: Record<string, Layout>;

  /** 要显示的字段 name 列表；省略时由 View/宿主选择默认字段。 */
  visibleFields?: string[];

  /** 只应用于此 View 的 filter，在 Database 全局 filter 之后执行。 */
  filter?: FilterItem;

  /** 多级排序规则，数组顺序就是优先级。 */
  sort?: SortDefinition[];

  /** 多级分组、折叠与 group summary 配置。 */
  group?: DatabaseViewGroupDefinition;

  /** 每个字段/列的 summary 配置；key 是字段 name。 */
  summary?: Record<string, AggregateConfigurationValue>;

  /** 可选自定义新建 Action；省略时 source createRow 使用当前 View 默认创建流程。 */
  newRowAction?: Action;

  /** File source 的当前 View 新建草稿；与 newRowAction 相互独立。 */
  newRowFile?: DatabaseViewNewRowFileDefinition;

  /**
   * 此 View 中链接的打开方式。
   * 值为 tab/split/window/modal-center/modal-right/modal-left/current/none；省略默认 tab。
   */
  linkOpenMode?: ObsidianLinkOpenMode;

  /** Tree 投影配置；需要 source 提供 resolveRowIdReference。 */
  tree?: DatabaseViewTreeDefinition;

  /** 当前 View 最多投影的行数。使用正的有限整数；无效值按未设置处理。 */
  limit?: number;

  /**
   * View type 与第三方插件配置。第三方把数据放在 options[pluginId]，并保留其它 key。
   * DatabaseViewData.options 是本字段在当前查询结果中的同一份 View options。
   */
  options?: Record<string, unknown>;
}

interface DatabaseViewStyle {
  /** 所有主题的 CSS custom property 基础值。 */
  light?: Record<string, string>;
  /** dark theme 覆盖；缺失 key 继续使用 light。 */
  dark?: Record<string, string>;
  /** 作用于此已挂载 View root 的原生 CSS。 */
  css?: string;
}

interface Layout {
  /** Grid 横向起点。 */
  x: number;
  /** Grid 纵向起点。 */
  y: number;
  /** Grid 宽度单位。 */
  w: number;
  /** Grid 高度单位。 */
  h: number;
}

interface DatabaseViewTreeDefinition {
  /**
   * 其值解析为父 row id 的字段 name。渲染需要 resolveRowIdReference；
   * 交互式改父还要求该字段可写。
   */
  parentField: string;
}

interface SortDefinition {
  /** 排序字段 name。 */
  field: string;
  /** 方向；省略默认 asc。 */
  direction?: 'asc' | 'desc';
}

interface DatabaseViewGroupDefinition {
  /** 分组层级，数组顺序从外到内。 */
  by: GroupByDefinition[];
  /** 持久化折叠的完整 group path selector。 */
  collapsed?: GroupSelector[];
  /** 每个 group header 的 summary；null 明确关闭。 */
  summary?: AggregateConfigurationValue | null;
}

/**
 * count 是行数；filled/empty/unique 是非空值统计；sum/average/minimum/maximum 是数值统计；
 * filledRows/emptyRows/optionCount/uniqueOptions 用于多值字段；checked/unchecked 用于 boolean；
 * earliest/latest 与 uniqueDays/longestStreak 用于 date/datetime。可用值仍受字段类型约束。
 */
type AggregateType =
  | 'count'
  | 'sum'
  | 'average'
  | 'minimum'
  | 'maximum'
  | 'filled'
  | 'empty'
  | 'unique'
  | 'filledRows'
  | 'emptyRows'
  | 'optionCount'
  | 'uniqueOptions'
  | 'checked'
  | 'unchecked'
  | 'earliestDate'
  | 'latestDate'
  | 'earliestDateTime'
  | 'latestDateTime'
  | 'uniqueDays'
  | 'longestStreak';

type AggregateConfiguration =
  | {
      /** 内置聚合算法。算法必须与字段值类型兼容。 */
      type: AggregateType;
      /** 被聚合的字段 name；外层 summary key 已指定字段时可以省略。 */
      field?: string;
    }
  | {
      /** 自定义表达式聚合。 */
      type: 'expression';
      /** 对当前聚合上下文求值的 XDB 表达式。 */
      expression: string;
    };

/** 结构化聚合配置；string 是旧版表达式写法，按 { type: 'expression' } 解释。新配置优先用结构化形式。 */
type AggregateConfigurationValue = AggregateConfiguration | string;

interface GroupByDefinition {
  /** 此层使用的字段 name。 */
  field: string;
  /**
   * group value 顺序；asc/desc 或手工顺序数组。手工数组不是白名单，未列值仍会显示。
   */
  sort?: 'asc' | 'desc' | Array<string | null>;
  /** 此 View 中隐藏的 group value。 */
  hidden?: Array<string | null>;
  /** 即使当前无行也显示的固定 group value。 */
  pinned?: Array<string | null>;
}

/** 完整 group path；key 是每层 field name，value 是该层 value。 */
type GroupSelector = Record<string, string | null>;

interface RootGroupDefinition {
  /** 根布局；省略时使用 tabs。 */
  type?: 'tabs' | 'vertical-tabs' | 'dashboard';
  /** 根布局私有选项。 */
  options?: {
    /** vertical-tabs 侧栏宽度。 */
    sidebarWidth?: number;
    /** dashboard 是否锁定布局编辑。 */
    locked?: boolean;
  };
  /** 根布局边界的共享视觉定制。 */
  style?: DatabaseViewStyle;
}

interface DatabaseViewNewRowFileDefinition {
  /** 原始 Obsidian 路径模板；省略时 source 从 View 与 Database 位置推导。 */
  path?: string;
  /**
   * 完整 Frontmatter 草稿，不是 patch。undefined 使用 source 推导；{} 明确不创建属性。
   */
  properties?: Record<string, unknown>;
  /** 不含 Frontmatter 的 Markdown 正文；省略使用 source 默认内容。 */
  content?: string;
}
```

## 数据结构

```ts
interface DatabaseData {
  /** 与 rows 同一轮投影使用的字段 schema。 */
  fields: DatabaseFieldDefinition[];
  /** 当前查询结果行。 */
  rows: DatabaseRow[];
}

interface DatabaseRow {
  /** source 规范 row id；File 为路径，Task 为 filePath::0-based-line。 */
  id: string;
  /** 当前行字段值与 source metadata；按只读数据使用。 */
  $item: Record<string, unknown>;
}

interface DatabaseViewGroup {
  /** 当前 group 层使用的字段 name；未分组根为 null。 */
  field: string | null;
  /** 当前 group value；类型由字段值决定。 */
  value: unknown;
  /** 此 group 节点直接包含的行。多值分组可能让同一 row.id 出现在多个节点。 */
  rows: DatabaseRow[];
  /** 下一层子 group；没有下一层时省略。 */
  groups?: DatabaseViewGroup[];
  /** 当前 group header 的格式化 summary。 */
  summary?: string;
  /** 当前 group 内按字段 name 计算的格式化 summary。 */
  rowSummary?: Record<string, string>;
}

interface DatabaseViewData {
  /** 当前 View 名，来自 DatabaseViewDefinition.name。 */
  name: string;
  /** 当前 View type。 */
  type: string;
  /** 已按 view.visibleFields 解析的字段定义。 */
  visibleFields: DatabaseFieldDefinition[];
  /** 当前 Database 的完整字段 schema，不受可见性影响。 */
  allFields: DatabaseFieldDefinition[];
  /** 当前 View 已完成 filter/sort/group 投影的 group tree。 */
  groups: DatabaseViewGroup[];
  /** 当前 View definition.options。按只读数据使用。 */
  options?: Record<string, unknown>;
  /** 当前整个 View 按字段 name 计算的格式化 summary。 */
  summary?: Record<string, string>;
}

interface DatabaseAvailableField {
  /** 字段稳定 name。 */
  name: string;
  /** 可选用户显示名。 */
  label?: string;
  /** 可选说明。 */
  description?: string;
  /** 可选字段 type。 */
  type?: DatabaseFieldType;
}
```

`viewData.groups` 已是当前 View 的投影。一行可能因多值分组出现在多个组；做全局汇总或扁平列表时按 `row.id` 去重。要按层级展示时递归读取 `groups`，不要把父节点与子节点的 `rows` 无条件相加。

## FilterItem

```ts
type FilterItem =
  | {
      /** 当前 filter tree 内稳定且唯一的节点 id。 */
      id: string;
      /** group 节点字面量。 */
      type: 'group';
      /** 子节点全部满足或任一满足。 */
      join: 'and' | 'or';
      /** 有序子节点；可以继续嵌套 group。 */
      items: FilterItem[];
    }
  | {
      /** 当前 filter tree 内稳定且唯一的节点 id。 */
      id: string;
      /** 当前运行时支持的叶节点字面量。 */
      type: 'expression';
      /** 必须返回 boolean 的 XDB 表达式。 */
      expression: string;
    };
```

插件生成 filter 时：

- 每个节点使用稳定且唯一的 `id`。
- 叶节点使用 `expression`；不要生成旧 `condition`。
- 表达式必须返回 boolean；特殊字段名使用 `field("Due Date")`。
- tag 按包含 `#`、大小写和层级的原字符串匹配。

## 不同 source 的行

| source | 一行                   | row id                   | 常用可写字段                 | `createRow` |
| ------ | ---------------------- | ------------------------ | ---------------------------- | ----------- |
| `file` | 一个 vault 文件        | 文件路径                 | `file.basename`、frontmatter | 有          |
| `task` | 一个 Markdown checkbox | `filePath::0-based-line` | `status`、`content`、`text`  | 无          |

文件 `$item`：frontmatter 位于根级，文件元信息位于 `file.*`，例如 `$item.status`、`$item.file.path`。

任务 `$item`：任务字段位于根级，所属文件元信息位于 `file.*`，所属笔记 frontmatter 位于 `note.*`。常用字段有 `status`、`content`、`text`、`tags`、`number`、`parent`、`file.path`。
