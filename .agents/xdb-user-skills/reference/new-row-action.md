# 新建记录（newRowAction）

`newRowAction` 定义一个数据视图里的「+ 新建」按钮做什么。它是视图级配置，并且只接受一个 Action。

> **source 差异**：`file` source 内置「从当前视图创建」——不配 `newRowAction` 时，「+ 新建」会按下方 [newRowFile](#newrowfile) 草稿或 source 默认值创建文件。`task` source 不实现内置创建，因此**不配 `newRowAction` 时没有「+ 新建」按钮**；但只要配置了 `newRowAction`（即便是内置的 `create-file` / `command` / `script`），task 视图也能通过该自定义 Action 创建记录。「+ 新建」按钮的可见条件是 `newRowAction != null` 或 source 支持内置创建。

## Schema

```ts
type NewRowAction = Action;
```

内置 Action 是按 `type` 判别的扁平对象，没有 `id`，也不要求通用 `data` / `params` / `options` 包装。第三方 payload schema 由插件拥有。`newRowAction` 不支持 Action 列表；需要多个内置步骤时使用一个 Script。

内置支持 `create-file`、`command`、`cform`、`templater`、`prompt`、`script`。此外可使用已安装 `*.xdb.js` 插件注册、且 scopes 包含 `new-row` 的自定义 type：

```json
{
  "newRowAction": {
    "type": "example:notify",
    "message": "Create a row"
  }
}
```

自定义 payload 由插件定义。插件未安装或 scope 不匹配时，运行会失败；因此交付 `.xdb` 时要同时说明插件依赖。

## newRowFile

`newRowFile` 是**另一个独立字段**，用于 `file` source 不配 `newRowAction` 时的「从当前视图创建」草稿。它和 `newRowAction` 互不覆盖：切换到自定义 Action 时，这份草稿仍保留，便于切回。

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

| 字段 | 说明 |
| --- | --- |
| `path` | 目标 vault 路径模板；支持 `{{date}}` / `{{date:FORMAT}}` 等占位符，创建时才解析。省略时由 source 按当前视图和数据库位置推导。 |
| `properties` | 完整的 frontmatter 对象。`undefined`（缺省）保留 source 推导的默认值；空对象 `{}` 表示显式不带任何属性。 |
| `content` | Markdown 正文（不含 frontmatter）。省略时用 source 默认内容。 |

`properties` 里的值会被字段类型规范化，并在创建时解析其中的日期/时间模板（草稿/预览阶段保持未解析）。若视图或数据库 filter 是简单的 `字段 == 值` 或 `contains` 条件，对应值会自动预填进 `properties`（例如 filter 为 `status == "todo"` 时新建记录默认带 `status: todo`）。

> 需要复用一个模板文件、或走 Templater/Form Flow 时，改用 [`create-file`](#create-file) / [`templater`](#cform--templater) 等自定义 `newRowAction`。`newRowFile` 是内联草稿，不是模板文件引用。



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

## `cform` / `templater`

```json
{
  "newRowAction": {
    "type": "cform",
    "template": "Forms/Project.cform"
  }
}
```

```json
{
  "newRowAction": {
    "type": "templater",
    "template": "Templates/Project.md"
  }
}
```

`cform` 需要 Form Flow；`templater` 需要 Templater。插件未安装或模板不存在时运行失败。

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

| 字段              | 说明                                                                    |
| ----------------- | ----------------------------------------------------------------------- |
| `content`         | 预填内容，支持日期/时间模板                                             |
| `autoSubmit`      | `true` 且 `content` 非空时跳过输入弹窗                                  |
| `filePath`        | 目标 Markdown 路径                                                      |
| `position`        | `append` / `prepend` / `append-under-heading` / `prepend-under-heading` |
| `heading`         | heading 模式必填，如 `## Inbox`                                         |
| `createIfMissing` | 目标不存在时是否创建                                                    |
| `fileTemplate`    | 创建目标时使用的模板                                                    |
| `openMode`        | 写入后如何打开；省略或设为 `none` 时不打开                              |

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

| 需求                    | Action                                             |
| ----------------------- | -------------------------------------------------- |
| file 源：从当前视图创建 | 不配 `newRowAction`，按需配 [`newRowFile`](#newrowfile) |
| 从标准模板创建记录      | `create-file`                                      |
| 复用现有命令            | `command`                                          |
| 表单引导                | `cform`                                            |
| 使用 Templater 流程     | `templater`                                        |
| 捕获内容到固定 Markdown | `prompt`                                           |
| 多步骤、条件或动态逻辑  | `script`                                           |
| 插件提供的专用流程      | 对应自定义 Action type（必须支持 `new-row` scope） |
