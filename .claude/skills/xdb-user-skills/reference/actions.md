# Action

Action 是点击入口后执行的一份可序列化调用描述：`{ "type": "...", ...payload }`。它本身没有行为；运行时由已注册的同名 Action extension 解释。按钮字段、Button View 和 `newRowAction` 共用这套模型，但 scope 和配置数量不同。

## 三个入口

| 入口        | 配置位置                | 数量           | 是否有当前行       |
| ----------- | ----------------------- | -------------- | ------------------ |
| 按钮字段    | `field.options.actions` | 多个，串行执行 | 有 `row` / `$item` |
| Button View | `view.actions`          | 多个，串行执行 | 无；它不加载行数据 |
| 新建记录    | `view.newRowAction`     | 单个           | 无                 |

按钮字段和 Button View 的每个 Action 都需要稳定且唯一的 `id`：

```ts
type ActionItem = Action & { id: string };
```

列表严格按数组顺序执行。某个 Action 抛错时，当前列表立即停止，后面的 Action 不再运行；运行时提示会指出失败的序号和类型，并把原始错误写入控制台。

## 内置 Action 的可用范围

| Action                   | 按钮字段           | Button View | newRowAction |
| ------------------------ | ------------------ | ----------- | ------------ |
| `update-row`             | 是                 | 否          | 否           |
| `move-row`               | 仅支持移动的数据源 | 否          | 否           |
| `delete-row`             | 是                 | 否          | 否           |
| `create-file`            | 是                 | 是          | 是           |
| `open-file` / `open-url` | 是                 | 是          | 否           |
| `command`                | 是                 | 是          | 是           |
| `cform` / `templater`    | 是                 | 否          | 否           |
| `prompt`                 | 是                 | 是          | 是           |
| `script`                 | 是                 | 是          | 是           |

表格描述当前 picker 会提供的内置 type。`*.xdb.js` 插件可以通过 `registerAction()` 注册其它 type，由对应插件的 `match` 决定在哪些入口可选：

```json
{
  "id": "notify",
  "type": "example:notify",
  "message": "Done"
}
```

- 第三方 type 与 payload schema 由对应插件拥有，通常使用 `plugin-id:action-name` 命名。
- 插件可通过 `match` 限制可选入口（配置面 + 数据源）；省略 `match` 表示全部入口可选。
- 按钮字段和 Button View 的列表项仍必须有唯一 `id`；`newRowAction` 不需要 `id`。
- 插件未安装或已卸载时，配置仍会保留，但编辑器显示不支持，执行时报 `Unsupported action: <type>`。`match` 返回 false 只会从 picker 隐藏该 type；已持久化的 Action 仍会执行。
- 不要仅凭文档发明未知 type；使用自定义 Action 时同时说明所依赖的插件。

需要实现插件 Action 时切换到 [XDB Plugin Action reference](../../xdb-plugin-skills/references/action.md)；本页只负责 `.xdb` 中的配置语义。

Button View 的多 Action 是一组全局快捷操作，不是批量行操作。需要修改当前行时用按钮字段；需要处理多行时，在 table/kanban/list 等数据视图中选择记录，再运行按钮字段。批量运行会逐行执行同一 Action 列表：一行内首错停止，记录失败后继续下一行，并支持取消。

只有不依赖现有选择交互时，才在 Button View 的 Script 中自行读取 `database` 并实现循环；此时 `$item` 仍为 `undefined`，选择范围、逐行错误和取消都需要脚本自己处理。

## 行级 Action

### `update-row`

只用于按钮字段。所有写操作经过 Database API，不直接调用 Obsidian FileManager。

```ts
type UpdateRowAction = {
  id: string;
  type: 'update-row';
  updates: Array<
    | { id: string; field: string; operation: 'delete' }
    | { id: string; field: string; operation: 'set' | 'append'; mode: 'literal'; value: unknown }
    | { id: string; field: string; operation: 'set' | 'append'; mode: 'formula'; formula: string }
  >;
};
```

一个 Action 可以同时更新多个字段。每个字段只能出现一次；执行器先校验并计算全部 `updates`，再通过一次 `row.update()` 提交。所有公式都读取 Action 开始时的同一份行快照。

| operation | 作用               | 配置                                                          |
| --------- | ------------------ | ------------------------------------------------------------- |
| `set`     | 替换属性值         | `mode: "literal"` + `value`，或 `mode: "formula"` + `formula` |
| `append`  | 追加到列表，不去重 | 与 `set` 相同；公式的结果作为待追加值                         |
| `delete`  | 删除这个属性       | 不需要 `mode` / `value`；仅可删除的字段可用                   |

```json
{
  "id": "complete",
  "type": "update-row",
  "updates": [
    {
      "id": "status",
      "field": "status",
      "operation": "set",
      "mode": "literal",
      "value": "done"
    },
    {
      "id": "completed-at",
      "field": "completedAt",
      "operation": "set",
      "mode": "formula",
      "formula": "moment().format('YYYY-MM-DDTHH:mm:ss')"
    }
  ]
}
```

删除属性和删除记录是两件事：`update-row` 中某项 `operation: "delete"` 删除指定属性；`delete-row` 删除整条记录。两者都按危险 Action 处理，运行前会确认。

### `move-row`

只用于按钮字段，并且只有数据库实现 `moveRow()` 时才能配置。文件源支持；不支持的数据源运行手工配置时会报错。

```json
{ "id": "archive-file", "type": "move-row", "targetFolder": "Archive/Projects" }
```

### `delete-row`

删除当前记录。它是危险 Action，点击按钮时会先确认。

```json
{ "id": "delete-record", "type": "delete-row" }
```

删除后 `row` 不再可用，因此通常把 `delete-row` 放在列表最后。

## 通用 Action

```ts
type CommandAction = {
  type: 'command';
  commandId: string;
  commandName: string;
};

type CreateFileAction = {
  type: 'create-file';
  filePath: string;
  template?: string;
  openMode?: ObsidianLinkOpenMode;
};

type OpenFileAction = {
  type: 'open-file';
  filePath: string;
  openMode?: ObsidianLinkOpenMode;
};

type OpenUrlAction = { type: 'open-url'; url: string };
type CFormAction = { type: 'cform'; template: string };
type TemplaterAction = { type: 'templater'; template: string };
type ScriptAction = { type: 'script'; script: string };
```

`create-file.filePath` 支持 `{{date}}`、`{{time}}` 和 `variables` 中的标量占位符；`{{title}}` 只有在调用方明确提供 `variables.title` 时才有值，普通视图的内置「+ 新建」和 Button View 不会询问标题。目标已存在时自动生成可用路径。`openMode` 省略或设为 `"none"` 时只创建、不打开。

`cform` 需要 Form Flow；`templater` 需要 Templater。插件未安装或模板不存在时运行失败。

`prompt` 的完整字段：

```ts
type PromptAction = {
  type: 'prompt';
  content: string;
  autoSubmit?: boolean;
  filePath: string;
  createIfMissing?: boolean;
  fileTemplate?: string;
  position?: 'append' | 'prepend' | 'append-under-heading' | 'prepend-under-heading';
  heading?: string;
  openMode?: ObsidianLinkOpenMode;
};
```

| 字段              | 必填 | 默认与约束                                                                                           |
| ----------------- | ---- | ---------------------------------------------------------------------------------------------------- |
| `content`         | 是   | 输入框预填内容；允许空字符串。                                                                       |
| `autoSubmit`      | 否   | 默认 `false`；只有显式 `true` 且 `content` 非空时才跳过输入框。                                      |
| `filePath`        | 是   | 非空 vault 相对路径；没有扩展名时补 `.md`，其它扩展名报错。                                          |
| `createIfMissing` | 否   | 默认 `false`；目标不存在时只有显式 `true` 才创建。                                                   |
| `fileTemplate`    | 否   | 只在创建缺失目标时使用。                                                                             |
| `position`        | 否   | 默认 `append`；也可 prepend 或写到 heading 内。                                                      |
| `heading`         | 条件 | 两种 `*-under-heading` 位置必填，并使用 Markdown heading 形态，例如 `## Inbox`；不存在时会创建标题。 |
| `openMode`        | 否   | 省略或 `none` 时写入后不打开。                                                                       |

## Script Action

Script 是 async function 的函数体，多行语句直接按顺序执行，不需要 IIFE。复杂条件、动态值、循环和跨字段逻辑优先放在 Script 中。

### 运行时绑定

| 绑定                          | 说明                                            |
| ----------------------------- | ----------------------------------------------- |
| `database`                    | 当前 Database API                               |
| `variables`                   | 调用方传入的变量；newRowAction 可收到新建表单值 |
| `row`                         | 当前行适配器；只有按钮字段有值                  |
| `$item`                       | `row.item`；只有按钮字段有值                    |
| `app`                         | Obsidian App，高级 fallback                     |
| `moment`                      | Moment.js                                       |
| `files`                       | 文件创建与移动 API                              |
| `markdown`                    | Markdown 读写 API                               |
| `tasks`                       | 任务 API                                        |
| `dailyNotes`                  | 日记 API                                        |
| `confirm` / `prompt` / `open` | 确认、输入、打开链接                            |

按钮字段的 `row` 提供：

```ts
row.id;
row.item;
await row.set(fieldName, value);
await row.move(targetFolder);
await row.delete();
```

`row` 只提供保持行身份同步所需的最小修改原语。单字段写入调用 `row.set(fieldName, value)`；多字段写入调用 `row.update(values)`。追加列表值时，读取 `row.item[fieldName]` 后组合新值；内置 `update-row + append` 已封装该过程。

修改当前行必须优先使用 `row`，这样写入会经过 Database API、数据源校验、缓存和事件通知。`app.fileManager` 只作为没有 Database 能力覆盖时的高级 fallback。

### 移动、改名后的身份

同一个 Action 列表复用同一个行适配器。更新 `file.basename` 或执行 `move-row` 后：

- `row.id` 更新为最终 row id。
- `row.item['file.path']`、`file.basename`、`file.parent` 更新。
- `$item` 指向同一个最新 item 对象。

因此先移动再运行 Script 时，`$item.file.path` 是移动后的路径：

```json
{
  "name": "归档",
  "type": "button",
  "options": {
    "actions": [
      { "id": "move", "type": "move-row", "targetFolder": "Archive" },
      { "id": "log", "type": "script", "script": "console.log($item.file.path)" }
    ]
  }
}
```

在同一段 Script 内调用 `await row.move(...)` 后，继续读取 `$item.file.path` 也会得到新路径。

## 选择建议

- 固定值更新、移动、删除：优先标准行级 Action。
- 当前时间或依赖其它字段的值：`update-row` update 的 `mode: "formula"`。
- 条件、循环、多个动态操作：Script。
- 多 Action 里会改变路径的操作放在前面，后续通过 `row.id` / `$item.file.path` 取最新身份。
- `delete-row` 通常放最后。
