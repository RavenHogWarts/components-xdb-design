# 新建记录

数据视图里的「+ 新建」有两条路线：source 默认创建，或 `newRowAction` 自定义流程。不要同时把两者当成一条流程。

> **source 差异**：`file` source 内置「从当前视图创建」——不配 `newRowAction` 时，「+ 新建」会按下方 [newRowFile](#newrowfile) 草稿或 source 默认值创建文件。`task` source 不实现内置创建，因此**不配 `newRowAction` 时没有「+ 新建」按钮**；配置 `newRowAction` 后可提供“+ 新建”入口并执行自定义流程，但只有 Action 真正写出满足 source / filter 的 checkbox，才会产生可见任务记录。「+ 新建」按钮的可见条件是 `newRowAction != null` 或 source 支持内置创建。

## Schema

```ts
type NewRowAction = Action;
```

内置 Action 是按 `type` 判别的扁平对象，没有 `id`，也不要求通用 `data` / `params` / `options` 包装。第三方 payload schema 由插件拥有。`newRowAction` 不支持 Action 列表；需要多个内置步骤时使用一个 Script。

当前 picker 提供 `create-file`、`command`、`prompt`、`script`。此外可使用已安装 `*.xdb.js` 插件注册、并设计为支持 `new-row` 入口的自定义 type：

```json
{
  "newRowAction": {
    "type": "example:notify",
    "message": "Create a row"
  }
}
```

自定义 payload 由插件定义。插件未安装时运行会失败；插件的 `match` 只控制 picker 是否显示，持久化 Action 仍会执行。因此交付 `.xdb` 时要说明插件依赖，并确认 handler 确实支持 `new-row` 没有当前行的上下文。

## newRowFile

`newRowFile` 是**另一个独立字段**，用于 `file` source 不配 `newRowAction` 时的「从当前 View 创建」草稿。配置 `newRowAction` 后，点击会改走 Action，`newRowFile` 不参与本次执行；它仍保留在定义里，便于切回默认创建。

仅 `file` source 有效；`task` source 用不到它。

```json
{
  "newRowFile": {
    "path": "Projects/{{date:YYYY-MM}}/{{date:YYYY-MM-DD}}.md",
    "properties": {
      "status": "todo",
      "xdbType": "project"
    },
    "content": "## 目标\n\n"
  }
}
```

| 字段         | 说明                                                                                                                          |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `path`       | 目标 vault 路径模板；支持 `{{date}}` / `{{date:FORMAT}}` 等占位符，创建时才解析。省略时由 source 按当前视图和数据库位置推导。 |
| `properties` | 完整的 frontmatter 草稿，不是 partial patch。缺省时才使用 source / filter 推导值；空对象 `{}` 表示显式不带任何属性。          |
| `content`    | Markdown 正文（不含 frontmatter）。省略时用 source 默认内容。                                                                 |

`properties` 里的值会被字段类型规范化，并在创建时解析其中的日期/时间模板（草稿/预览阶段保持未解析）。

只有**省略 `properties`** 时，source 才会从数据库和当前 View 的可写、无冲突条件推导默认值。常见可推导条件是 `and` 链中的字段等值与 multi-select 包含；`or`、范围、动态日期、只读字段或互相冲突的条件不会生成默认值。显式写了 `properties` 后，它就是完整草稿；需要保留 `status: "todo"` 等 filter 值时，也要把它写进该对象。

> 需要复用模板文件时，使用 [`create-file`](#create-file)；需要 Templater/Form Flow 时，通过 `command` 或支持 `new-row` 的插件 Action 启动。`newRowFile` 是内联草稿，不是模板文件引用。

## `create-file`

创建普通文件，是标准记录最常用的新建方式。

```json
{
  "newRowAction": {
    "type": "create-file",
    "filePath": "Projects/{{date:YYYY-MM}}/{{date:YYYY-MM-DD}}-{{time:HHmmss}}.md",
    "template": "Templates/Project.md",
    "openMode": "tab"
  }
}
```

| 字段       | 说明                                    |
| ---------- | --------------------------------------- |
| `filePath` | 目标 vault 相对路径；无扩展名时补 `.md` |
| `template` | 可选模板路径                            |
| `openMode` | 可选；省略或设为 `none` 时不打开        |

`filePath` 支持 `{{date}}`、`{{date:FORMAT}}`、`{{time}}`、`{{time:FORMAT}}`，以及 `variables` 中的标量占位符。`{{title}}` 本质上也是 `variables.title`：普通视图的内置「+ 新建」和 Button View 不提供标题输入，所以默认不要依赖它；只有表单或自定义流程明确传入 `title` 时才使用。目标已存在时自动生成可用路径，不覆盖文件。

## `command`

```json
{
  "newRowAction": {
    "type": "command",
    "commandId": "daily-notes",
    "commandName": "Daily notes"
  }
}
```

`commandName` 是显示名快照；真正执行使用 `commandId`。是否创建记录由命令自身决定。

## `prompt`

弹出输入框，把内容写入目标 Markdown。

```json
{
  "newRowAction": {
    "type": "prompt",
    "content": "",
    "filePath": "Inbox.md",
    "position": "append",
    "createIfMissing": true,
    "fileTemplate": "Templates/Inbox.md",
    "openMode": "tab"
  }
}
```

| 字段              | 说明                                                                             |
| ----------------- | -------------------------------------------------------------------------------- |
| `content`         | 预填内容，支持日期/时间模板                                                      |
| `autoSubmit`      | 默认 `false`；`true` 且 `content` 非空时跳过输入弹窗                             |
| `filePath`        | 非空 vault 相对路径；无扩展名补 `.md`，其它扩展名报错                            |
| `position`        | 默认 `append`；也可 `prepend` / `append-under-heading` / `prepend-under-heading` |
| `heading`         | 两种 heading 模式必填，如 `## Inbox`；目标标题不存在时创建                       |
| `createIfMissing` | 默认 `false`；目标不存在时只有显式 `true` 才创建                                 |
| `fileTemplate`    | 只在创建缺失目标时使用                                                           |
| `openMode`        | 写入后如何打开；省略或设为 `none` 时不打开                                       |

## `script`

需要组合多个步骤、条件或动态路径时，使用一个 Script Action：

```json
{
  "newRowAction": {
    "type": "script",
    "script": "const path = `Projects/${variables.title || moment().format('YYYY-MM-DD')}.md`;\nconst note = await files.createFromTemplate(path, 'Templates/Project.md');\nawait open(note.path)"
  }
}
```

Script 是 async function 的函数体。它可使用 `database`、`variables`、`app`、`moment`、`files`、`markdown`、`tasks`、`dailyNotes`、`confirm`、`prompt`、`open`。

newRowAction 没有当前行，因此 `row` / `$item` 为 `undefined`。完整 Script 规则见 [actions.md](actions.md#script-action)。

## 与系统设计的关系

`newRowAction` 只决定点击「+ 新建」后执行什么。系统仍必须定义：

- scope：新文件如何进入当前 `.xdb`。
- 模板：frontmatter marker、默认字段和正文骨架。
- 生命周期：创建后用户维护什么、何时归档。

例如系统用 `xdbType: project` 收窄数据时，创建模板也必须包含这个 marker，否则文件创建成功但不会出现在视图里。

## 选择建议

| 需求                    | Action                                                  |
| ----------------------- | ------------------------------------------------------- |
| file 源：从当前视图创建 | 不配 `newRowAction`，按需配 [`newRowFile`](#newrowfile) |
| 从标准模板创建记录      | `create-file`                                           |
| 复用现有命令            | `command`                                               |
| 表单或 Templater 流程   | `command`，或支持 `new-row` 的插件 Action               |
| 捕获内容到固定 Markdown | `prompt`                                                |
| 多步骤、条件或动态逻辑  | `script`                                                |
| 插件提供的专用流程      | 对应自定义 Action type（必须支持 `new-row` scope）      |
