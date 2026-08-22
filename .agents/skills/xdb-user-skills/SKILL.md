---
name: xdb-user-skills
description: 'Use when a user wants to create, design, style, beautify, theme, or modify an xdb database, dashboard, task board, calendar, waterfall, date page, metric view, chart view, binding panel, or Obsidian knowledge-management system backed by .xdb files. Do not use for writing xdb plugins.'
version: '0.0.6'
author: 'vran'
---

# XDB User Skills

## 用途

本技能给**把用户需求落成 `.xdb` 的执行 Agent**使用，不是插件 SDK。交付目标是一个可开始使用的系统：`.xdb`、明确的数据边界、记录进入和新增方式，以及必要的模板/frontmatter/说明。

- 创建或修改 `.xdb`、dashboard、任务板、日历、指标、图表或瀑布流：使用本技能。
- 编写 `*.xdb.js`、注册 Action type 或扩展视图：改用 `xdb-plugin-skills`。
- 修改已有库：默认做最小增量，保留未被目标改变的字段名、view id、层级和布局。

## Schema 优先

生成或修改配置前，先读取：

1. [`.xdb` Schema](reference/schema.md)：Database 大框架、共享 View 小框架，以及固定/扩展边界。
2. [View Schema](reference/view-schema.md)：每种内置 View 的专属字段、约束和能力矩阵。
3. 与任务直接相关的专题页：只补充用法、表达式和示例。

Schema 是结构依据，专题散文不是第二份类型定义。遇到第三方 View、Field 或 Action 时，使用已安装插件提供的 schema；没有 schema 就不猜 payload。修改已有文件时保留未知 type 和未知 key。

## 工作流

1. **读取现状**：检查现有 `.xdb`、目标文件夹、frontmatter、模板和真实记录；区分事实与假设。
2. **建立结构**：按 [`.xdb` Schema](reference/schema.md) 定位根级、共享 View、内置扩展和插件扩展，先确认字段归属再写值。
3. **定义数据**：确定“一行是什么”，再选 `source`，并用 folder、tag 或 marker 限定范围。
4. **定义生命周期**：说明记录如何进入、新建、维护、完成和归档。
5. **组装界面**：先选 `rootGroup`，再让每个 View 回答一个具体问题；只有嵌套容器才建 `group` View。
6. **落地与验证**：输出完整 `.xdb` 和辅助文件，运行 validator；在源码仓用真实 FilterEngine 编译 filter，再用真实记录检查业务语义。

复杂系统按 [design-sop.md](reference/design-sop.md) 执行；可运行样例见 [project-dashboard.xdb](examples/project-dashboard.xdb)。

## 配置模型

结构分四层：

```text
Database 固定根字段
└─ View 固定共享字段
   └─ 内置 View 专属字段
      └─ 已安装插件拥有的扩展字段
```

完整字段以 [`.xdb` Schema](reference/schema.md) 和 [View Schema](reference/view-schema.md) 为准。下面只用于从用户问题选择配置。

| 配置                          | 决定什么                                             | 先问的问题                                  | 参考                                    |
| ----------------------------- | ---------------------------------------------------- | ------------------------------------------- | --------------------------------------- |
| `source`                      | 一行是文件还是 Markdown 任务                         | 用户维护的是长期对象，还是已有 checkbox？   | [design-sop](reference/design-sop.md)   |
| 全局 `filter`                 | 哪些行属于这个数据库                                 | 什么必须进入，什么必须排除？                | [filter](reference/filter.md)           |
| `fields`                      | 用户维护和系统计算的属性                             | 哪些是事实，哪些能由公式推出？              | [fields](reference/fields.md)           |
| `rootGroup`                   | 所有根 View 的 tabs、vertical-tabs 或 dashboard 布局 | 数据库首页怎样组织？                        | [view-group](reference/view-group.md)   |
| `views`                       | 用户怎样查看和操作数据                               | 每个 View 回答哪个高频问题？                | [视图路由](#视图路由)                   |
| `group` View                  | 在某个 View 内继续嵌套子 View                        | 根布局之外，是否还需要局部 tabs/dashboard？ | [view-group](reference/view-group.md)   |
| `newRowFile` / `newRowAction` | “+ 新建”怎样工作                                     | 用当前 View 创建，还是执行自定义流程？      | [新建记录](reference/new-row-action.md) |
| Action                        | 按钮字段、Button View、新建入口执行什么              | 入口有没有当前行？                          | [actions](reference/actions.md)         |
| `style`                       | Root Group 或单个 View 的外观                        | 改全局风格，还是局部覆盖？                  | [view-style](reference/view-style.md)   |

数据流：

```text
source -> 全局 filter -> View filter/sort/group -> View 渲染
```

`views` 是扁平数组。根 View 的 `parentId` 为空；只有嵌套 View 才把 `parentId` 指向一个 `type: "group"` 的 View。

## Schema 之外的隐藏约定

本节收录 schema 与各权威页无法直接表达的跨字段约定；字段位置、形状和默认值以 [`.xdb` Schema](reference/schema.md)、[View Schema](reference/view-schema.md) 及其指向的权威页为准。

- vault 内的所有路径（`newRowFile.path`、binding 的 `file.path`、模板与文件夹路径等）写成相对路径，如 `Projects/Plan.md`。

## 任务路由

| 任务                                          | 读取                                          |
| --------------------------------------------- | --------------------------------------------- |
| 顶层、共享 View、sort、layout、固定/扩展边界  | [`.xdb` Schema](reference/schema.md)          |
| 内置/第三方 View schema 与能力                | [View Schema](reference/view-schema.md)       |
| 从自然语言设计完整系统                        | [design-sop](reference/design-sop.md)         |
| 字段、内置字段、formula、button               | [fields](reference/fields.md)                 |
| formula / filter / aggregate 的表达式上下文   | [expressions](reference/expressions.md)       |
| 聚合配置和可用计算                            | [aggregate](reference/aggregate.md)           |
| 筛选                                          | [filter](reference/filter.md)                 |
| 分组和汇总                                    | [group](reference/group.md)                   |
| 根布局、嵌套 group、dashboard layouts         | [view-group](reference/view-group.md)         |
| 默认创建、`newRowFile`、自定义 `newRowAction` | [新建记录](reference/new-row-action.md)       |
| Action、脚本和行身份                          | [actions](reference/actions.md)               |
| 样式、Light/Dark、继承和 CSS 边界             | [view-style](reference/view-style.md)         |
| 卡片封面                                      | [card-cover](reference/card-cover.md)         |
| 常见设计模式                                  | [best-practices](reference/best-practices.md) |

## 视图路由

先读 [View Schema](reference/view-schema.md) 确认字段位置、默认值和是否生效，再按需读取下面的用法页。

| View        | 用途                                      | 参考                                          |
| ----------- | ----------------------------------------- | --------------------------------------------- |
| `table`     | 明细、编辑、列汇总、树形                  | [view-table](reference/view-table.md)         |
| `list`      | 紧凑列表、目录树                          | [view-list](reference/view-list.md)           |
| `kanban`    | 状态流转、分组拖拽                        | [view-kanban](reference/view-kanban.md)       |
| `gallery`   | 等高封面卡片                              | [view-gallery](reference/view-gallery.md)     |
| `waterfall` | 自适应列宽的高低卡片流                    | [view-waterfall](reference/view-waterfall.md) |
| `calendar`  | 日期事件、截止日、日程                    | [view-calendar](reference/view-calendar.md)   |
| `gantt`     | 起止时间、排期、项目计划                  | [view-gantt](reference/view-gantt.md)         |
| `metric`    | 单个统计指标                              | [view-metric](reference/view-metric.md)       |
| `charts`    | 分布、趋势、对比、热力图                  | [view-charts](reference/view-charts.md)       |
| `markdown`  | 说明、标题、Markdown 内容                 | [view-markdown](reference/view-markdown.md)   |
| `reference` | 嵌入其它 `.xdb` 的 View                   | [view-reference](reference/view-reference.md) |
| `button`    | 无当前行的快捷操作入口                    | [view-button](reference/view-button.md)       |
| `binding`   | 绑定外部 Markdown 文件属性/任务的控制面板 | [view-binding](reference/view-binding.md)     |
| `date-page` | 不进入数据源的按日临时记录                | [view-date-page](reference/view-date-page.md) |
| `group`     | 根布局内部的嵌套容器                      | [view-group](reference/view-group.md)         |

## 交付要求

最终输出包含：

1. 设计摘要：一行身份、source、scope、生命周期、字段、公式和 View。
2. 完整 `.xdb` JSON，以及保存到 vault 的相对路径。
3. 数据进入方式和新增方式；需要持续新增文件时，给 `newRowFile` 或模板/frontmatter。
4. 修改已有库时，列出保留、增加、改变和删除的内容。
5. 自定义 Action、外部模板或插件依赖。
6. 假设、validator 结果和至少一条真实业务检查。

最小结构：

```json
{
  "source": "file",
  "fields": [],
  "views": []
}
```

## 验证

先做结构检查（`<skill-dir>` 为本 skill 文件夹路径，安装后位于 agent 技能目录，如 `~/.zcode/skills/xdb-user-skills`）：

```bash
node <skill-dir>/scripts/validate-xdb.mjs path/to/your.xdb
```

在 database2 源码仓内，再用真实 FilterEngine 编译 filter：

```bash
XDB_VALIDATE_FILE=path/to/your.xdb npm test -- --runInBand <skill-dir>/scripts/compile-xdb-filters.test.ts
```

validator 不能确认运行时插件 registry、真实字段值类型或产品目标。自定义 Action 的 warning 需要人工确认插件和 scope；formula、aggregate、创建、编辑和布局仍要用真实记录验收。
