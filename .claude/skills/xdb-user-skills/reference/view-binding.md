# binding

## 视图简介

Binding View 渲染一列小控件（开关、输入框、下拉等），每个控件绑定到**一个 Markdown 文件**里的一个 frontmatter 属性或一个任务 checkbox。控件读取目标值展示，修改后立即写回目标文件。

它是 [Plain View](view-schema.md#两类-view)：整份配置就是「一个目标文件 + 一组绑定项」，直接读写目标文件本身；共享的身份、层级、布局和样式字段照常使用。整个视图只服务一个目标文件。

适合：

- **控制台面板**：在 dashboard 上不打开目标文件，就能查看并修改几个关键属性（项目状态、当前里程碑、计数器、开关）。
- **绑定宿主笔记**（`thisFile`）：把嵌入 XDB 的那篇笔记自身的属性和任务变成可操作面板。
- **跟随当前编辑的文件**（`activeFile`）：面板始终作用于正在编辑的笔记。
- **按日期解析的目标**（`path` + `{{date}}`）：每天自动指向当天的文件，配合 `template` 在首次写入时自动创建。

选型时按产物分流：批量查看或编辑记录用 [table](view-table.md)，统计用 [metric](view-metric.md) / [charts](view-charts.md)，时间轴用 [calendar](view-calendar.md) / [gantt](view-gantt.md)；binding 专注单个文件的操作面板。

## 专属配置

完整定义以 [View Schema](view-schema.md#binding) 为准。专属字段是视图顶层的 `file` 和 `items`。

```ts
interface BindingViewDefinition extends DatabaseViewDefinition {
  type: 'binding';
  file?: BindingFileTarget;
  items?: BindingViewItem[];
}

type BindingFileTarget =
  | 'thisFile'
  | 'activeFile'
  | {
      path: string;
      template?: string;
    };

interface BindingViewItem {
  id: string;
  binding: BindingTarget;
  control?: BindingControlConfig;
}
```

```json
{
  "id": "project-console",
  "name": "项目控制台",
  "type": "binding",
  "file": "thisFile",
  "items": [
    {
      "id": "item-status",
      "binding": { "type": "file-property", "property": "status" },
      "control": { "type": "radio", "options": ["planning", "doing", "done"] }
    },
    {
      "id": "item-milestone",
      "binding": { "type": "file-property", "property": "milestone" }
    },
    {
      "id": "item-review",
      "binding": { "type": "task", "text": "Review notes", "blockId": "task-1" }
    }
  ]
}
```

`file` 省略为 `thisFile`；`items` 省略为空（视图提示先配置）。每项 `id` 必须在视图内稳定且唯一，重新排序或修改绑定项时要保持不变。

## 目标文件 file

| 取值                                   | 行为                                                                                                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `thisFile`（默认）                     | 承载当前 XDB embed 的 Markdown 文件。XDB 单独打开、没有宿主文件时不可用，视图显示提示。                                                                            |
| `activeFile`                           | 当前激活的 Markdown 文件，切换文件时视图自动重读。没有打开 Markdown 文件时显示提示。                                                                               |
| `{ "path": "...", "template": "..." }` | 固定路径的文件。`path` 是以 `.md` 结尾的 vault 相对路径（如 `Daily/{{date:YYYY-MM-DD}}.md`），支持 Obsidian `{{date}}` / `{{time}}` 变量，**每次读写时重新解析**。 |

`path` 模式下目标文件不存在时：读取返回空值并提示「文件将在首次修改时创建」；首次写入时自动创建，有 `template` 则从模板创建（模板变量同 Obsidian 模板引擎），否则创建空文件。`template` 指向 vault 内已存在的 `.md` 模板。

## 两类绑定项

### 属性绑定 file-property

```json
{ "type": "file-property", "property": "status" }
```

`property` 是**精确的 frontmatter key**，按原字符串匹配——点号是普通字符，不表示嵌套。修改经 `processFrontMatter` 原子写回，不影响文件其它内容；日期类、数字控件清空时会删除该 key。

### 任务绑定 task

```json
{
  "type": "task",
  "text": "Review notes",
  "blockId": "task-1",
  "insert": { "position": "append-under-heading", "heading": "## Todo" }
}
```

| 字段      | 约束与用途                                                                                                                                                      |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `text`    | 任务内容（`- [ ] ` 之后的部分）。匹配任务时 `blockId` 优先，其次按 trim 后的全文精确匹配。支持 `{{date}}` / `{{time}}` 变量，每次读写时解析。                   |
| `blockId` | 可选的任务块锚点（`^task-1` 中的 `task-1`，不带 `^`）。文本或任务位置变化后绑定仍指向同一任务；含日期时间变量的 `text` 要配 `blockId`，靠锚点始终指向同一任务。 |
| `insert`  | 任务不存在时新建任务行的位置，`position` 默认 `append`，可选 `prepend` / `append-under-heading` / `prepend-under-heading`（后两者需要 `heading`）。             |

任务绑定固定渲染为开关：开 = `- [x]`，关 = `- [ ]`。目标任务不存在时翻转开关会按 `insert` 位置创建任务行；任务已存在时在最新文件快照上原位更新状态字符，状态没变不产生写操作。

## 控件类型与推断

属性绑定的 `control` 可省略，省略时按 vault 中该属性的 Obsidian 类型（并参考当前值）推断；显式 `control` 优先。

| vault 属性类型                   | 控件                         |
| -------------------------------- | ---------------------------- |
| `checkbox`（或布尔值）           | `toggle`                     |
| `number`（或数字值）             | `number`                     |
| `time` / `date` / `datetime`     | `time` / `date` / `datetime` |
| `tags` / `multitext`（或数组值） | `select`（多选）             |
| 其它                             | `text`                       |

`control.type` 可显式取 `toggle` / `text` / `number` / `select` / `radio` / `time` / `date` / `datetime`，覆盖推断结果。`select` 与 `radio` 可用 `options` 显式给选项；省略 `options` 时从数据库里同名属性的已有值取候选项（只读建议，不写入定义）。`radio` 是单选；`select` 配 `multiple: true` 时值为字符串数组。任务绑定固定渲染为开关，无需配置 `control`。

## 读写行为

- 读取走 metadataCache（frontmatter）加任务解析；目标文件变化时自动刷新，`activeFile` 模式在切换文件时刷新。
- 修改控件先乐观更新界面再写回；写失败回滚为文件最新状态并在控件上显示错误。
- `property` 为空或 `text` 为空的绑定项会被忽略；没有可渲染的绑定项时视图提示先在设置里添加。
- 文件级问题（目标缺失、模板不可用、非 Markdown 文件）以视图顶部提示呈现，其余控件照常可用。

## 何时用它

### binding vs 数据 View

两者都能「改东西」，但产物不同：数据 View 编辑的是进入行集的记录（受全局/View filter 收录）；binding 编辑的是**一个特定文件**的几个键或任务，结果直接写进该文件。

> 一句话：**要管理一批记录，用数据 View；要给一个文件（或宿主文件、当前文件、今天的文件）当快捷操作面板，用 binding。**

### 常见组合

- 项目 dashboard：[metric](view-metric.md)（进度统计）+ binding（状态开关、里程碑输入）+ [table](view-table.md)（明细）。
- 嵌入笔记：`thisFile` binding 把笔记自身的 frontmatter 和任务变成面板，与正文并排。
- 每日例程：`{ "path": "Daily/{{date:YYYY-MM-DD}}.md", "template": "Templates/Daily.md" }`，每天的面板自动指向当天文件。

## 最佳实践

- 一个 binding 视图只服务一个目标文件（`file` 是视图级配置）；不同目标拆成多个 binding 视图。
- 任务绑定配 `blockId` 锚定，尤其是含日期时间变量的 `text`。
- 用 `{{date}}` 路径指向每日文件时同时配 `template`，让首日写入从模板开始。
- 手写 `.xdb` 时给 `item.id` 用稳定的语义化字符串（如 `item-status`），增删、重排绑定项时沿用原值。
