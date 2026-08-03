---
name: xdb-user-skills
description: 'Use when a user wants to create, design, or modify an xdb database, dashboard, task board, calendar, date page, metric view, chart view, or Obsidian knowledge-management system backed by .xdb files. Do not use for writing xdb plugins.'
version: '0.0.4'
author: 'vran'
---

# XDB User Skills

## 定位与目标方

本技能是给**把用户需求落成 `.xdb` 的执行 Agent**使用的产品建模与配置契约，不是插件 SDK。XDB 是 Obsidian 里的数据库系统；一个 `.xdb` 文件定义数据来源、字段、筛选、视图和布局。

使用这个 skill 时，目标不是只生成 `.xdb`，而是交付一个可开始使用的 xdb 系统：设计摘要、`.xdb` 定义、数据边界、记录新增方式，以及必要的模板/frontmatter/使用说明。

- 要创建或修改 `.xdb`、dashboard、任务板、日历、指标或图表：使用本技能。
- 要写 `*.xdb.js`、注册 Action type 或扩展视图：改用 `xdb-plugin-skills`。
- 修改已有库时，目标是最小、可解释的增量；不要借机重建用户未要求的结构。

## 使用方式

按以下顺序执行；复杂需求先给设计摘要，用户明确要直接生成时可在同一轮继续：

1. **发现**：读取现有 `.xdb`、目标文件夹 frontmatter、模板和任务样例；区分事实与假设。
2. **建模**：确定一行是什么、`source`、数据边界、生命周期、基础字段和 formula。
3. **组装**：每个视图回答一个问题；多视图用 `group` 组织；只加载相关 reference。
4. **落地**：输出完整 `.xdb`、模板/任务写法、vault 相对路径和增量说明。
5. **验收**：运行 validator；在 database2 源码仓内用真实 FilterEngine 编译筛选；再按真实数据进入、创建、编辑、筛选、Action 和视图问题做语义检查。

完整判断流程见 [design-sop.md](reference/design-sop.md)；可运行的端到端样例见 [project-dashboard.xdb](examples/project-dashboard.xdb)。

### 当前 schema 的硬约束

- filter 顶层使用 `group`，叶节点只写 `type: "expression"`；不得生成旧 `condition`。
- filter 是白名单 DSL，不是 JavaScript；tag 是保留 `#`、大小写和层级的普通字符串，不做归一化。
- `parentId` 只能指向 `group` 或为空；移动视图到新容器后要重新检查 dashboard `layouts`。
- `task` source 不支持内置「从当前视图创建」（无 `newRowFile`），但配置了自定义 `newRowAction` 时仍可通过该 Action 创建；Button View / newRowAction 没有当前行，行级归档必须用 button 字段。
- `create-file` / `prompt` 只有显式配置打开方式时才打开目标；省略或设为 `"none"` 都不打开。
- 自定义 Action type 必须有已安装的 `*.xdb.js` 插件，并匹配当前 scope；不能凭空发明。

## 核心概念

| 概念           | 作用                                                                                                                     | 参考                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `source`       | 决定一行是什么。`file` = 一个文件一行；`task` = 一个 markdown checkbox 任务一行。                                        | [design-sop.md](reference/design-sop.md), [fields.md](reference/fields.md) |
| `fields`       | 定义行上的属性。基础字段由用户维护；`formula` 字段由表达式计算。                                                         | [fields.md](reference/fields.md)                                           |
| `expressions`  | `formula`、`filter`、`summary`、`metric`、`charts` 都依赖表达式，但行级和聚合级上下文不同。                              | [expressions.md](reference/expressions.md)                                 |
| `filter`       | 收窄行集。全局 filter 影响所有视图；视图 filter 只影响当前视图。                                                         | [filter.md](reference/filter.md)                                           |
| `views`        | 用户看数据的入口，如 table、kanban、calendar、metric、charts。                                                           | 见下方视图参考                                                             |
| `newRowAction` | 视图「+ 新建」按钮做什么。仅 `file` 源有效；`task` 源不能新建。                                                          | [new-row-action.md](reference/new-row-action.md)                           |
| `actions`      | 按钮字段、Button View、newRowAction 共用的扁平调用描述；除内置 type 外，也可使用插件注册并匹配当前 scope 的自定义 type。 | [actions.md](reference/actions.md)                                         |
| `group`        | 按字段分组；kanban 的列也来自 group。                                                                                    | [group.md](reference/group.md)                                             |
| `group view`   | 容器视图，用 tabs、vertical-tabs 或 dashboard 组织多个视图。                                                             | [view-group.md](reference/view-group.md)                                   |
| `layouts`      | dashboard 子视图的位置和尺寸，写在子视图上。                                                                             | [view-group.md](reference/view-group.md)                                   |
| `summary`      | 聚合表达式。`group.summary` 显示在组头；视图 `summary` 用于表格列汇总。                                                  | [group.md](reference/group.md), [view-table.md](reference/view-table.md)   |
| `card cover`   | kanban、gallery、calendar 卡片封面。                                                                                     | [card-cover.md](reference/card-cover.md)                                   |
| `reference`    | 在当前 xdb 中嵌入另一个 `.xdb` 的视图。                                                                                  | [view-reference.md](reference/view-reference.md)                           |

## 功能能力

XDB 可以做这些事：

- 建 `file` 源数据库：一条记录对应一篇笔记，适合需要长期沉淀、附件、说明、模板和 frontmatter 的对象。
- 建 `task` 源数据库：一条记录对应一个 markdown checkbox 任务，适合聚合和查看已有任务；task 源不能新建任务。
- 设计字段：text、number、boolean、date、datetime、select、multi-select、reference、button；用 `formula` 属性定义计算字段。
- 写派生字段：倒计时、是否临期、月/周/年粒度、金额折算、完成率、状态标签。
- 写筛选：隐藏归档、只看本周、本月、逾期、临期、某状态、某标签。
- 配视图：table、list、kanban、gallery、calendar、gantt、metric、charts、markdown、reference、button、date-page。
- 组合布局：tabs、vertical-tabs、dashboard。
- 配统计：metric 单指标、charts 图表、group.summary 组头汇总、table summary 列汇总。
- 配卡片封面：笔记首图、字段图片、内容预览。
- 配模板和按钮：新建记录用的模板；按钮字段和 Button View 的多 Action；一键改属性、移动、归档、运行脚本或调用已安装插件注册的 Action。

## 工作规则

- 先识别用户意图，再选功能。不要先套领域字段模板。
- 先确定一行是什么，再选 source。source 选错，字段、视图和新增方式都会错。
- `file` 和 `task` 都默认从全库取数据；设计时必须给出数据边界，如 folder、tag、frontmatter marker 或任务 tag。
- 修改已有 `.xdb` 时，默认做最小改动：优先复用既有字段名、view id、parentId、layouts 和 group 结构，除非用户明确要重构。
- 能由其它字段推出来的值，优先做 `formula`，例如"距今天数"、"是否临期"、"月均成本"。
- 每个系统通常需要一个明细视图，优先用 `table`；多个视图用 `group` 组织。
- metric/charts 回答统计问题；table/kanban/list/gallery 浏览和操作记录；calendar/gantt 回答时间问题。
- 用户需要持续新增记录时，输出模板、示例 frontmatter、记录命名或任务写法。
- 使用非内置 Action type 时，必须说明依赖哪个 `*.xdb.js` 插件及其 scope；不要凭空发明未注册的 type。
- 不要生成 legacy filter `condition`；旧节点只有在 UI 迁移成功后才可能转换，运行时不会直接执行。
- 文件和任务 tag 精确匹配原始字符串；例如 `#Project/Alpha` 不等于 `project`。

## 合格输出

为用户创建或改造系统时，最终输出至少包含：

- 设计摘要：source、scope、生命周期、字段、formula、视图。
- `.xdb` JSON：能保存为 `.xdb` 的完整定义。
- 文件路径：`.xdb` 文件在 vault 中的路径，使用的到的筛选、模板等文件路径也应该使用相对路径（相对于 vault 跟目录，不能用 / 开头）。
- 数据进入方式：哪些文件/任务会被收进系统。
- 新增记录方式：模板/frontmatter 示例，或 task 源的 markdown 任务写法。
- 修改已有库时：说明这是增量修改还是重构，以及哪些既有字段 / 视图 / 布局会被保留。
- 假设和检查：列出默认假设，并给出 validate 命令。

## 参考路径

| 需要                                                         | 打开                                             |
| ------------------------------------------------------------ | ------------------------------------------------ |
| 从需求设计系统                                               | [design-sop.md](reference/design-sop.md)         |
| 字段、内置字段、formula、button                              | [fields.md](reference/fields.md)                 |
| 表达式上下文（formula / filter / summary / metric / charts） | [expressions.md](reference/expressions.md)       |
| 筛选和 expression filter                                     | [filter.md](reference/filter.md)                 |
| 分组和汇总                                                   | [group.md](reference/group.md)                   |
| 新建记录（newRowAction）                                     | [new-row-action.md](reference/new-row-action.md) |
| Action、按钮字段、脚本与行身份                               | [actions.md](reference/actions.md)               |
| 按钮视图（button view）                                      | [view-button.md](reference/view-button.md)       |
| dashboard / tabs / vertical-tabs                             | [view-group.md](reference/view-group.md)         |
| 卡片封面                                                     | [card-cover.md](reference/card-cover.md)         |
| 常见设计套路                                                 | [best-practices.md](reference/best-practices.md) |
| 完整可运行样例                                               | [project-dashboard.xdb](examples/project-dashboard.xdb) |

## 视图参考

| 视图        | 用途                         | 参考                                             |
| ----------- | ---------------------------- | ------------------------------------------------ |
| `table`     | 明细浏览、编辑、列汇总、树形 | [view-table.md](reference/view-table.md)         |
| `list`      | 紧凑列表、目录树             | [view-list.md](reference/view-list.md)           |
| `kanban`    | 状态流转、分组拖拽           | [view-kanban.md](reference/view-kanban.md)       |
| `gallery`   | 封面浏览、卡片网格           | [view-gallery.md](reference/view-gallery.md)     |
| `calendar`  | 日期事件、截止日、日程       | [view-calendar.md](reference/view-calendar.md)   |
| `gantt`     | 起止时间、排期、项目计划     | [view-gantt.md](reference/view-gantt.md)         |
| `metric`    | 单个统计指标                 | [view-metric.md](reference/view-metric.md)       |
| `charts`    | 分布、趋势、对比、热力图     | [view-charts.md](reference/view-charts.md)       |
| `markdown`  | 静态说明、标题、引导文本     | [view-markdown.md](reference/view-markdown.md)   |
| `reference` | 嵌入其它 `.xdb` 视图         | [view-reference.md](reference/view-reference.md) |
| `button`    | 快捷操作入口、一键脚本       | [view-button.md](reference/view-button.md)       |
| `date-page` | 快速临时记录、按日的随手页   | [view-date-page.md](reference/view-date-page.md) |

## `.xdb` 最小结构

```json
{
  "source": "file",
  "fields": [],
  "views": []
}
```

数据流：

```text
source -> 全局 filter -> 视图 filter/sort/group -> 视图渲染
```

`views` 是扁平数组。父子关系通过 `parentId` 表示；dashboard 是一个 `type: "group"` 的视图，其它视图用 `parentId` 挂到它下面。

## 检查

生成 `.xdb` 后可做结构检查：

```bash
node docs/skills/xdb-user-skills/scripts/validate-xdb.mjs path/to/your.xdb
```

校验脚本检查 JSON、结构和确定不属于 filter DSL 的常见写法；它不是完整表达式编译器。在 database2 源码仓内，再执行真实 FilterEngine 检查：

```bash
XDB_VALIDATE_FILE=path/to/your.xdb npm test -- --runInBand docs/skills/xdb-user-skills/scripts/compile-xdb-filters.test.ts
```

formula/metric/summary 语义、运行时字段值类型、字段选择和视图是否符合用户目标，仍需要按设计和真实记录判断。完整验收顺序见 [filter.md#验证](reference/filter.md#验证)。

自定义 Action type 会产生提示而不是硬错，因为 validator 无法读取用户运行时已安装的插件 registry。看到该提示时，必须人工确认插件已安装且 `scopes` 包含配置入口。
