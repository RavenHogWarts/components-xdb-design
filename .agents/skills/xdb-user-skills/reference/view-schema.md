# View Schema

所有 View 都先继承 [DatabaseViewDefinition](schema.md#databaseviewdefinition)。本页只列每个 `type` 增加或特别解释的字段；行为、选择建议和示例再读对应专题页。

## 两类 View

- **数据 View**：读取 source 经过全局/View filter 后的行数据。包括 `table`、`list`、`kanban`、`gallery`、`waterfall`、`calendar`、`gantt`、`metric`、`charts`。
- **Plain View**：只读取自己的定义或外部内容，不读取当前数据库行。包括 `markdown`、`reference`、`button`、`binding`、`date-page`、`group`。

Plain View 仍使用共享的身份、层级、布局、图标和样式字段，但忽略 `visibleFields/filter/sort/group/summary/tree/limit/newRowFile/newRowAction/linkOpenMode`，除非它自己的 schema 明确复用其中某项。

## View 能力矩阵

| type        | 行数据 | 展示字段 | filter | sort | group | tree | limit | 创建入口 | 专属配置位置     |
| ----------- | ------ | -------- | ------ | ---- | ----- | ---- | ----- | -------- | ---------------- |
| `table`     | 是     | 是       | 是     | 是   | 是    | 是   | 是    | 是       | `options.table`  |
| `list`      | 是     | 是       | 是     | 是   | 是    | 是   | 是    | 是       | 无               |
| `kanban`    | 是     | 是       | 是     | 是   | 必需  | 否   | 是    | 是       | `options`        |
| `gallery`   | 是     | 是       | 是     | 是   | 是    | 否   | 是    | 是       | `options`        |
| `waterfall` | 是     | 是       | 是     | 是   | 否    | 否   | 是    | 是       | `options`        |
| `calendar`  | 是     | 是       | 是     | 是   | 否    | 否   | 否    | 是       | `options`        |
| `gantt`     | 是     | 是       | 是     | 是   | 是    | 否   | 是    | 是       | `options`        |
| `metric`    | 是     | 否       | 是     | 否   | 否    | 否   | 否    | 否       | 顶层 `aggregate` |
| `charts`    | 是     | 否       | 是     | 否   | 否    | 否   | 否    | 否       | 视图顶层字段     |
| Plain View  | 否     | 否       | 否     | 否   | 否    | 否   | 否    | 否       | 各自定义         |

`summary` 顶层列汇总由 `table` 展示；分组 View 使用 `group.summary`。`linkOpenMode` 对会打开行/链接的数据 View 生效。Calendar 的创建入口还会把点击日期作为开始值。

## 数据 View

### table

```ts
interface TableViewDefinition extends DatabaseViewDefinition {
  type: 'table';
  options?: {
    table?: {
      columnSizing?: Record<string, number>;
      frozenColumnCount?: number;
    };
  };
}
```

| 字段                              | 约束与用途                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `options.table.columnSizing`      | key 是字段名，value 是像素宽；未配置默认 180，渲染时钳制到 72–720。修改单列时保留其它列宽和 table key。 |
| `options.table.frozenColumnCount` | 非负数字，省略/非法按 0；实际冻结数不会超过当前可见列数。                                               |
| `summary`                         | `字段名 -> AggregateConfiguration`，显示表格底部列汇总。                                                |

用法见 [view-table.md](view-table.md)。

### list

```ts
interface ListViewDefinition extends DatabaseViewDefinition {
  type: 'list';
}
```

没有专属配置。`visibleFields[0]` 是标题，其余字段内联显示；`tree.parentField` 建立目录树。用法见 [view-list.md](view-list.md)。

### kanban

```ts
interface KanbanViewDefinition extends DatabaseViewDefinition {
  type: 'kanban';
  group: DatabaseViewGroupDefinition;
  options?: CardViewOptions;
}
```

`group` 在基础类型中可选，但 Kanban 要产生列就必须配置：`by[0]` 是列，`by[1]` 是可选泳道，最多使用两层。`options.cardSize` 默认 280，范围 100–600；其它卡片字段见 [card-cover.md](card-cover.md)。用法见 [view-kanban.md](view-kanban.md)。

### gallery

```ts
interface GalleryViewDefinition extends DatabaseViewDefinition {
  type: 'gallery';
  options?: CardViewOptions;
}
```

`options.cardSize` 默认 220，范围 100–600；`visibleFields` 决定卡片字段。其它卡片字段见 [card-cover.md](card-cover.md)，用法见 [view-gallery.md](view-gallery.md)。

### waterfall

```ts
interface WaterfallViewDefinition extends DatabaseViewDefinition {
  type: 'waterfall';
  options?: {
    minCardWidth?: number;
    maxCardWidth?: number;
    cardMaxHeight?: number;
    hideFieldName?: boolean;
  };
}
```

| 字段            | 默认  | 约束与用途                                                                                       |
| --------------- | ----- | ------------------------------------------------------------------------------------------------ |
| `minCardWidth`  | 220   | 100–800px，越界在读取时钳制。                                                                    |
| `maxCardWidth`  | 300   | 100–800px，越界在读取时钳制；若结果小于 min，布局时有效 max 提升到 min。界面会同步两项保持关系。 |
| `cardMaxHeight` | 480   | 180–1200px，越界在读取时钳制。                                                                   |
| `hideFieldName` | false | `true` 时只显示字段值。                                                                          |

Waterfall 展示文件内容预览和 `visibleFields`，不展示 group 层级。用法见 [view-waterfall.md](view-waterfall.md)。

### calendar

```ts
interface CalendarViewDefinition extends DatabaseViewDefinition {
  type: 'calendar';
  options?: CardViewOptions & {
    viewType?: 'days' | 'week' | 'month' | 'list';
    dayCount?: 1 | 2 | 3 | 4 | 5 | 6;
    weekStartsOn?: 'monday' | 'sunday';
    startField?: string;
    endField?: string;
  };
}
```

| 字段           | 结构必填 | 默认/生效条件                                                                                                  |
| -------------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| `viewType`     | 否       | 省略或非法按 `week`。                                                                                          |
| `dayCount`     | 否       | 只在 `days` 生效，值为 1–6。通过界面切换到 days 时写入 3；直接持久化 `viewType: "days"` 却省略时，运行时按 1。 |
| `weekStartsOn` | 否       | 只在 week/month 生效；省略或非法按 `monday`。                                                                  |
| `startField`   | 否       | 结构上可省略；要显示事件则必须指向日期、日期时间或可解析的公式字段。省略时显示空状态。                         |
| `endField`     | 否       | 指向结束字段；省略或该行值为空时按单日事件。                                                                   |

未配置 `endField` 时会使用卡片外观/封面字段。用法见 [view-calendar.md](view-calendar.md)。

### gantt

```ts
interface GanttViewDefinition extends DatabaseViewDefinition {
  type: 'gantt';
  options?: {
    startField?: string;
    endField?: string;
    zoom?: 'year' | 'month' | 'week' | 'day';
  };
}
```

- `startField` 结构上可省略，但有内容的 Gantt 必须配置；省略显示空状态。
- `endField` 省略时显示单日点条；`end < start` 也退化为点条。
- `zoom` 省略为 month；非法值不使用。

用法见 [view-gantt.md](view-gantt.md)。

### metric

```ts
interface MetricViewDefinition extends DatabaseViewDefinition {
  type: 'metric';
  aggregate?: AggregateConfiguration;
}
```

`aggregate` 是视图顶层字段，不在 `options`。省略时为 `{ "type": "count", "field": "file.path" }`。旧 `expression` 只为读取历史配置；新配置不要生成。用法见 [view-metric.md](view-metric.md)。

### charts

```ts
interface ChartsViewDefinition extends DatabaseViewDefinition {
  type: 'charts';
  chartType?: 'bar' | 'stackedBar' | 'horizontalBar' | 'stackedHorizontalBar' | 'line' | 'pie' | 'heatmap';
  category?: { field: string } | null;
  seriesBy?: { field: string } | null;
  measures?: Array<{ aggregate: AggregateConfiguration; label?: string }>;
  measureValueType?: 'number' | 'datetime';
  dateRange?:
    | { type: 'fixed'; startDate: string; endDate: string }
    | { type: 'recent'; value?: number; unit?: 'day' | 'week' | 'month' | 'year' };
  heatmap?: ChartsHeatmapOptions;
  axis?: ChartsAxisOptions;
  echartsOption?: Record<string, unknown>;
}
```

Charts 专属字段全部在 View 顶层，通用 `options` 不承载 Charts 配置。`chartType` 默认 bar；`measures` 省略时生成一个 `count(file.path)`。`pie`、`heatmap` 和 `seriesBy` 拆系列时只使用第一项 measure。完整子结构见 [view-charts.md](view-charts.md)。

## Plain View

### markdown

```ts
interface MarkdownViewDefinition extends DatabaseViewDefinition {
  type: 'markdown';
  options?: { markdown?: string };
}
```

`options.markdown` 是静态 Markdown；没有 `$item` 或模板注入。省略为空。用法见 [view-markdown.md](view-markdown.md)。

### reference

```ts
interface ReferenceViewDefinition extends DatabaseViewDefinition {
  type: 'reference';
  options?: {
    targetLink?: string;
    targetViewName?: string;
  };
}
```

`targetLink` 结构上可省略，但要显示内容必须提供指向 `.xdb` 的 Obsidian 链接。`targetViewName` 是目标根 View 的名称，不是 id；省略时嵌入整个目标库。用法见 [view-reference.md](view-reference.md)。

### button

```ts
interface ButtonViewDefinition extends DatabaseViewDefinition {
  type: 'button';
  image?: string;
  actions?: Array<Action & { id: string }>;
}
```

`actions` 是 View 顶层数组；每项 `id` 必须稳定且唯一，按数组顺序串行执行。Button View 没有当前行。`image` 是可选的背景图片路径、wikilink 或 URL。共享 `linkOpenMode` 会传入 Action context；内置 Action 仍按自己的 `openMode` 与默认值执行。Action payload 见 [actions.md](actions.md)。

### binding

```ts
interface BindingViewDefinition extends DatabaseViewDefinition {
  type: 'binding';
  file?: 'thisFile' | 'activeFile' | { path: string; template?: string };
  items?: Array<{
    id: string;
    binding:
      | { type: 'file-property'; property: string }
      | { type: 'task'; text: string; blockId?: string; insert?: { position: string; heading?: string } };
    control?: {
      type: 'toggle' | 'text' | 'number' | 'select' | 'radio' | 'time' | 'date' | 'datetime';
      multiple?: boolean;
      options?: string[];
    };
  }>;
}
```

专属字段是视图顶层的 `file` 和 `items`。`file` 省略为 `thisFile`；`path` 支持 `{{date}}` / `{{time}}` 变量，目标缺失时首次写入自动创建（可用 `template`）。属性绑定按精确 frontmatter key 读写；任务绑定按 `blockId`（优先）或任务全文匹配，渲染为开关。`control` 省略时按 vault 属性类型推断。用法见 [view-binding.md](view-binding.md)。

### date-page

```ts
interface DatePageViewDefinition extends DatabaseViewDefinition {
  type: 'date-page';
  options?: {
    folder?: string;
    template?: string;
  };
}
```

`folder` 省略或空时为 `Date Pages`；`template` 只在新建日期文件时使用，不覆盖已有文件。用法见 [view-date-page.md](view-date-page.md)。

### group

```ts
interface GroupViewDefinition extends DatabaseViewDefinition {
  type: 'group';
  options?: {
    groupType?: 'tabs' | 'vertical-tabs' | 'dashboard';
    sidebarWidth?: number;
    locked?: boolean;
  };
}
```

`groupType` 省略为 tabs；`sidebarWidth` 只用于 vertical-tabs，`locked` 只用于 dashboard。子 View 通过 `parentId` 指向它；dashboard 布局写在各子 View 的 `layouts`。用法见 [view-group.md](view-group.md)。

## 第三方 View

```json
{
  "id": "vendor-overview",
  "name": "Overview",
  "type": "vendor:view-type",
  "options": {
    "pluginOwnedKey": "value"
  }
}
```

- `type` 必须等于已安装插件注册的 View id。
- 它是数据 View 还是 Plain View，由插件选择 `registerDatabaseView` 或 `registerView` 决定。
- 专属字段可能位于顶层，也可能位于 `options`；没有统一 payload，必须按插件 schema。
- 新建时没有插件 schema 就不生成。修改已有文件时完整保留未知专属字段和 `options`。
- 插件未安装时宿主无法渲染该 View；配置仍应保留，不能替换或删除。Validator 的未知 type warning 只表示需要确认依赖。
