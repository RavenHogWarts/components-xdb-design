# date-page

为每个日期打开一个普通 Markdown 页面，是系统里**快速、临时、低摩擦的记录入口**。它**不是数据视图**：不读 `source`、不响应 `filter` / `sort` / `group` / `visibleFields`，也没有「+ 新建」按钮。每个日期对应 vault 里的一个 `<folder>/<YYYY-MM-DD>.md` 文件，页面内嵌可直接编辑的 Markdown。

为什么它适合随手记录：

- **不用起标题、不用选文件夹**：打开就是今天的页，直接写。
- **自动按日归档**：文件名固定 `YYYY-MM-DD.md`，按日期自然累积，不用手动整理。
- **不占数据源**：记下的内容不会变成数据库记录，不需要 frontmatter 或字段，写完即走。
- **可嵌进任何布局**：放进 dashboard 或 tabs，和记录视图并排，随手就能切过去记一笔。

## 配置

```json
{
  "id": "journal",
  "name": "每日",
  "type": "date-page",
  "options": {
    "folder": "Date Pages",
    "template": "Templates/Date Page.md"
  }
}
```

```ts
interface DatePageViewDefinition extends DatabaseViewDefinition {
  type: 'date-page';
  options?: {
    /** 日期文件所在 vault 文件夹；省略或空时默认 "Date Pages"。 */
    folder?: string;
    /** 模板文件路径；仅创建新日期文件时应用，已存在的文件不会被覆盖。 */
    template?: string;
  };
}
```

| 字段 | 说明 |
| --- | --- |
| `options.folder` | 日期文件所在文件夹（vault 相对路径）。会被规范化（去首尾斜杠、trim）；省略或为空时默认 `Date Pages`。缺失的父文件夹会自动创建。 |
| `options.template` | 可选的 `.md` 模板路径。仅在该日期文件**还不存在**时套用；已存在的文件永不覆盖。 |

文件名固定为 `YYYY-MM-DD.md`（月、日补零），不可配置。一周内已有页面的日期会在周条上标记。

## 模板占位符

`template` 内容在创建新文件时通过 Obsidian 模板引擎处理，可用占位符：

- `{{title}}` — 当前日期的 `YYYY-MM-DD` 键。
- `{{date}}` / `{{date:FORMAT}}` — Moment 日期。
- `{{time}}` / `{{time:FORMAT}}` — Moment 时间。

> 模板路径不存在时，打开该日期会报错而不是创建空文件。`$item.*` 不可用（没有行上下文）。

## 何时用它

- 用户想**随手、临时**记一笔（灵感、速记、当日杂事、会议要点），不想为它创建一条会被数据库收录的结构化记录。
- 想要在 dashboard 里放一个永远指向"今天"的快速记录区，和明细视图并排。

### date-page vs newRowAction

这是最常见的归属判断——两者都能"记录东西"，但产物不同：

| | date-page | newRowAction (`create-file`) |
| --- | --- | --- |
| 产物 | 当天的自由 Markdown 页 | 一条带 frontmatter 的结构化记录 |
| 是否进数据库 | 否（不读 source） | 是（被 scope 收录，出现在视图里） |
| 摩擦 | 最低：打开即写，无需标题/字段 | 较高：要起文件名、按模板填字段 |
| 适合 | 临时、非结构化、按日累积 | 需要长期维护、查询、统计的对象 |

> 一句话：**要进库、要被查询统计的，用 newRowAction；只是随手记、不留结构化记录的，用 date-page。** 一个系统可以两者并存——结构化对象走 newRowAction，日常碎片走 date-page。

**不要**用它来做：按日期查看结构化记录（那是 [calendar](view-calendar.md) 或 [gantt](view-gantt.md) 的工作——它们读取 `source` 并把记录放到时间轴上）；或任何需要 `filter` / `group` 的场景（date-page 忽略这些字段）。

date-page 不依赖数据库的 `source`，因此即便整个 `.xdb` 主要服务别的 source，也可以把一个 date-page 视图作为辅助页面放进布局。
