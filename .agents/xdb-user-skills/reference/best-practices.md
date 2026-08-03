# 最佳实践（从真实数据库提炼）

以下模式提炼自真实使用的 xdb 数据库，都是可复用的设计套路。配合 [design-sop.md](design-sop.md) 使用：SOP 负责意图、标准、上下文和构建流程，本文提供已经验证过的做法。

## 1. 时间层级：用 formula 字段做多粒度分组

这是最高频、最实用的模式。**给一个时间字段派生出一组"时间粒度"formula 字段**，然后用它们做分组、图表分类轴、筛选：

```json
{ "name": "month", "formula": "moment(createTime).format('YYYY-MM')" },
{ "name": "week",  "formula": "moment(createTime).format('gggg [W]ww')" },
{ "name": "day",   "formula": "moment(createTime).format('YYYY/MM/DD')" },
{ "name": "year",  "formula": "moment(createTime).format('YYYY')" }
```

派生出来后，`month`/`week`/`day` 就能当：

- **表格分组字段**：`group.by[0].field = "month"`，按月折叠，每月带汇总 → 月度报表。
- **图表分类轴**：charts 的 `category.field = "month"` → 月营收柱状图；`week` → 周趋势折线。
- **筛选值**：按时间粒度过滤。

> 一旦有"按时间看统计"的需求，第一反应就建这套时间粒度 formula 字段。比每次用 filter 表达式干净得多。

## 2. 同比/环比：一组 metric + 表达式筛选

想对比"本期 vs 上期"？**用几个相同表达式的 metric，各自配不同时间区间的 expression filter**，组成一组：

| metric              | filter（expression 条件）                                                      | 看什么         |
| ------------------- | ------------------------------------------------------------------------------ | -------------- |
| `M`（本月）         | `createTime >= today().startOf("month")`                                     | 本月营收       |
| `M-1`（上月）       | 本月起点之前 **且** 上月起点（含）之后                                         | 上月营收       |
| `W` / `W-1`         | 同理用 `today().startOf("week")` 和 `duration(1, "week")`                  | 本周/上周      |
| `Y` / `Y-1` / `Y-2` | 同理用 `today().startOf("year")` 和 `duration(1, "year")`                  | 今年/去年/前年 |

上月区间的标准写法（"上月起点之后 且 本月起点之前"）：

```json
{
  "id": "previous-month",
  "type": "group",
  "join": "and",
  "items": [
    {
      "id": "before-this-month",
      "type": "expression",
      "expression": "createTime < today().startOf(\"month\")"
    },
    {
      "id": "from-previous-month",
      "type": "expression",
      "expression": "createTime >= today().startOf(\"month\") - duration(1, \"month\")"
    }
  ]
}
```

> Filter 不是 JavaScript：只使用双引号、`today()` / `now()` / `duration(...)` 等 DSL 能力，每个节点都要有稳定 `id`。把这组 metric 放进一个 `group`(tabs) 容器（如“年/月/周”各一组 tab），就能整齐对比。完整语法见 [filter.md](filter.md#expression)。

## 3. 仪表盘网格尺寸（laptop 24 列基准）

dashboard 用 24 列网格（laptop）。真实布局里，不同视图的合理尺寸有规律——照着配，出来不挤不空：

| 视图                         | 典型 w × h    | 说明                                |
| ---------------------------- | ------------- | ----------------------------------- |
| **metric**（单数字）         | 4–5 × 4–6     | 小格，一行能并排 4–5 个             |
| **charts**（图表）           | 7–8 × 8–12    | 中格，要给图留高                    |
| **calendar**（日历）         | 14 × 11       | 大格，周/月视图需要宽度             |
| **table / kanban**（明细）   | 18–24 × 20–25 | 占满宽的大格，放 dashboard 下半部分 |
| **markdown**（说明）         | 4–6 × 2       | 窄矮的标题条                        |
| **group 嵌套**（装一组视图） | 4–9 × 6–12    | 按里面的内容给                      |

**布局套路**（从上到下）：

1. **顶部一排 metric**：y=0，几个 4–5 宽的指标并排（如总数/本月/上月/日均）。
2. **中部图表**：y=6 起，charts 7–8 宽。
3. **底部明细**：y=10–18 起，table/kanban 占满 24 宽、高度 20+。

> mobile（4 列）则是全宽堆叠：每个视图 w=4，y 纵向递增。生成时 laptop 和 mobile 都要给 `layouts`。

## 4. 汇总：组头用 group.summary，表底用 summary

两种汇总都靠表达式，注意变量指向不同：

- **组头汇总** `group.summary`：`$values` 是 `$items` 的兼容别名（整行数组）。
  ```json
  "group": { "by": [{ "field": "month", "sort": "desc" }],
             "summary": "\"¥\" + sum($values.map(f => f.price)) + \"元\"" }
  ```
- **列汇总** `summary[字段]`：`$values` 是该列的值数组。
  ```json
  "summary": { "price": "sum($values) + \" ¥\"", "file.basename": "$values.length" }
  ```

> 时间分组（按 month/week）+ 组头金额汇总 = 月度/周度报表，是最常用组合。

## 5. button 字段：多步骤一键流转

一个按钮串联多个动作（改状态 + 打时间戳），用户一点完成流转：

```json
{
  "name": "完成",
  "type": "button",
  "options": {
    "actions": [
      {
        "id": "complete",
        "type": "update-row",
        "updates": [
          { "id": "status", "field": "status", "operation": "set", "mode": "literal", "value": "DONE" },
          {
            "id": "done-time",
            "field": "doneTime",
            "operation": "set",
            "mode": "formula",
            "formula": "moment().format('YYYY-MM-DDTHH:mm:ss')"
          }
        ]
      }
    ]
  }
}
```

> 适合“完成/归档/确认”这类一键动作。固定更新用标准 Action，复杂条件用 Script；见 [actions.md](actions.md)。

## 6. 嵌套 group：dashboard 里再套 tabs

dashboard 的格子里可以放另一个 `group`(tabs)，用来把一组相关视图（如"年/去年/前年"三个 metric）收进一个格子：

```json
{
  "id": "yearly",
  "name": "年度",
  "type": "group",
  "parentId": "<dashboard>",
  "options": { "groupType": "tabs" },
  "layouts": { "laptop": { "x": 0, "y": 0, "w": 4, "h": 6 }, "mobile": { "x": 0, "y": 0, "w": 2, "h": 6 } }
}
```

> 让 dashboard 既有大图，也有"可切换的小卡片组"。见 [view-group.md](view-group.md)。

## 7. reference：跨库聚合

一个总览 dashboard，用 `reference` 视图把别的 .xdb 的视图嵌进来：

```json
{ "name": "订单", "type": "reference", "options": { "targetLink": "[[订单系统.xdb]]", "targetViewName": "仪表盘" } }
```

> 适合"主库 + 多个子库"的结构：每个子库自管数据，主库 reference 它们的关键视图。见 [view-reference.md](view-reference.md)。

## 8. 带格式的金额 metric

metric 没有单位/精度选项，格式化写进 `expression`。真实用法：

```json
{ "name": "总营收", "type": "metric", "expression": "(sum($items.map(i => i.price))/10000).toFixed(2) + \"W\"" }
```

→ 显示 `12.34W`。其它格式：`` `¥${sum(...).toFixed(0)}` `` → `¥12345`。

## 9. 新建记录（newRowAction）

视图里的「+ 新建」按钮由 `newRowAction` 驱动——一个按 `type` 判别的 Action 对象（仅 `file` 源有效，`task` 源不能新建）。除下列内置 type 外，也可使用插件注册且支持 `new-row` scope 的自定义 type。完整字段、插值规则见 [new-row-action.md](new-row-action.md)，这里只给最常用写法：

- `{ "type": "create-file", "filePath": "Tasks/{{date:YYYY-MM}}/{{date:YYYY-MM-DD}}-{{time:HHmmss}}.md", "template": "Templates/Task.md" }` —— 用普通模板建笔记，默认用时间生成唯一文件名。
- `{ "type": "command", "commandId": "daily-notes", "commandName": "Daily notes" }` —— 调 Obsidian 命令。
- `{ "type": "cform", "template": "Forms/Capture.cform" }` —— 打开 form-flow 表单引导填写。
- `{ "type": "prompt", "content": "", "filePath": "Inbox.md", "position": "append" }` —— 弹窗捕获一段文本写入目标文件。
- `{ "type": "script", "script": "await files.create('Notes/today.md')" }` —— 运行脚本，组合多个 API。

```json
"newRowAction": { "type": "create-file", "filePath": "Tasks/{{date:YYYY-MM}}/{{date:YYYY-MM-DD}}-{{time:HHmmss}}.md", "template": "Templates/Task.md" }
```

> 普通视图的内置「+ 新建」和 Button View 不会先询问标题；只有表单或自定义流程显式提供 `variables.title` 时才用 `{{title}}`。配套还要交付模板文件和 frontmatter 骨架——如果靠 frontmatter marker 收数据（如 `xdbType: task`），模板里要带上这个 marker，否则新建的笔记不会被视图收进来。

## 常见字段设计套路

- **select 的 value 用 wikilink**（如 `"[[工作]]"`）：值既是分类又是内链，点击可跳。
- **datetime + format**：`doneTime` 用 `datetime` + `options.format: "YYYY/MM/DD"`，显示整洁。
- **file.tasks 字段**：在 file 源里用内置 `file.tasks`，把笔记里的任务带进来（可配是否展开任务列表）。
