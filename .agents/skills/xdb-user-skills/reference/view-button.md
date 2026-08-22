# button

## 视图简介

Button View 渲染一个全局快捷按钮，点击后按顺序执行多个 Action。它不加载行数据，也不消费 filter / sort / group。

适合：创建文件、打开文件或 URL、执行命令、调用集成、运行不依赖当前行的脚本，以及把这些操作组合成一个顺序流程。

Button View 不是行批量入口。需要更新、移动或删除数据库记录时，使用按钮字段；多行场景先选择记录，再批量运行该按钮字段。

## 专属配置

完整定义以 [View Schema](view-schema.md#button) 为准。Button View 的专属字段都在视图顶层，不在 `options`。

```ts
interface ButtonViewDefinition extends DatabaseViewDefinition {
  type: 'button';
  image?: string;
  actions?: ButtonViewActionItem[];
}

type ButtonViewActionItem = Action & { id: string };
```

`image` 是可选背景图片，接受 vault 路径、wikilink 或 URL。`actions` 是扁平 Action 数组；每项必须有稳定且唯一的 `id`，数组顺序就是执行顺序。共享 `linkOpenMode` 会传入 Action context；内置 Action 仍按自己的 `openMode` 与默认值执行。未配置 Action 或正在运行时，按钮禁用。

```json
{
  "id": "capture-and-open",
  "name": "记录灵感",
  "type": "button",
  "icon": "Lightbulb",
  "actions": [
    {
      "id": "capture",
      "type": "prompt",
      "content": "",
      "filePath": "Inbox.md",
      "position": "append",
      "createIfMissing": true
    },
    {
      "id": "open-inbox",
      "type": "open-file",
      "filePath": "Inbox.md"
    }
  ]
}
```

首个错误会停止列表，后面的 Action 不再运行。按钮显示失败状态和 Notice，原始异常与失败 Action 信息写入控制台。

## 内置 Action

| type          | 用途                           |
| ------------- | ------------------------------ |
| `create-file` | 创建文件，可使用模板和模板变量 |
| `open-file`   | 打开 vault 文件                |
| `open-url`    | 打开外部 URL                   |
| `command`     | 执行 Obsidian command          |
| `prompt`      | 输入内容并写入目标 Markdown    |
| `script`      | 运行复杂或动态逻辑             |

Button View 不支持 `update-row`、`move-row`、`delete-row`。即使手工写入，运行时也会报告不支持。

插件注册并支持 `button-view` 无当前行上下文的自定义 type 也可以出现在 `actions` 中。它与内置 Action 一样需要稳定唯一的列表 `id`；payload 字段由插件拥有。插件的 `match` 只控制 picker；插件未安装时执行会报告 unsupported。

完整字段见 [actions.md](actions.md)。

## Script 的能力边界

Script 中可用 `database`、`variables`、`app`、`moment`、`files`、`markdown`、`tasks`、`dailyNotes`、`confirm`、`prompt` 和 `open`。

`row` 与 `$item` 绑定存在，但在 Button View 中为 `undefined`，因为这个视图没有当前行。不要写：

```js
await row.set('status', 'done');
console.log($item.file.path);
```

如果确实要让全局按钮批量处理数据，可以在 Script 中通过 `database.getData()` 读取行并显式循环，同时自己处理选择范围、最终 row id、逐行错误和取消。常规交互优先使用数据视图的多选 + 按钮字段批量运行。

`database.getData()` 返回 `{ fields, rows }`，每行是 `{ id, $item }`。`updateCell()` 和可选的 `moveRow()` 都返回操作后的最终 row id：

```js
const data = await database.getData();
if (!database.moveRow) throw new Error('Current source cannot move rows');

for (const sourceRow of data.rows) {
  let rowId = await database.updateCell(sourceRow.id, 'status', 'done');
  rowId = await database.moveRow(rowId, 'Archive');
  console.log(rowId);
}
```

这段脚本处理数据库全局 filter 后的全部行，不代表当前视图选择。若要“用户选哪些就处理哪些”，仍使用多选 + 按钮字段。

## 最佳实践

- 每个 Action 只承担一个清楚的操作；复杂条件集中到 Script。
- 后一步依赖前一步结果时保持串行，并让失败中断流程。
- 需要当前行就用按钮字段，不要在 Button View 中假设 `$item` 存在。
- 调用 Form Flow / Templater 时使用它们提供的 Obsidian command，或安装明确支持 `button-view` 的 Action 插件。
