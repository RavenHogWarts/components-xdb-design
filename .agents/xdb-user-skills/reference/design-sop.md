# 设计 SOP：从需求到可用系统

这份 reference 规定 Agent 如何把自然语言需求变成可验收的 XDB 系统。语法按需查其它 reference；不要在这里猜 schema。

一个完整交付包含：

- `.xdb`：source、fields、filter、views、layout 和 Action。
- 数据边界：哪些文件或任务进入系统。
- 生命周期：如何新建、维护、归档。
- 辅助物：模板/frontmatter、任务写法、路径和使用说明。
- 验收证据：validator 结果与业务语义检查。

## 1. 先确定系统要回答什么

不要先套领域字段模板。把需求拆成用户会反复完成的工作：

| 用户工作 | 常用能力 |
| --- | --- |
| 维护一批对象 | `file`、table、template、newRowAction |
| 推进事项状态 | select、kanban、**button 字段一键流转** |
| 看截止日和排期 | date/datetime、calendar、gantt |
| 浏览资料或作品 | list/gallery、card cover |
| 看数量、金额、完成率 | formula、metric、charts、summary |
| 快速、临时地随手记录 | **date-page**（不起标题、不进数据源、按日归档） |
| 对同一对象切换不同维度 | **group(tabs)** 收拢多视图（年/月/周、本期/上期） |
| 组合多个入口 | group、dashboard、reference |

每个视图必须能回答一个高频问题。回答不了问题的视图不要加。识别出「切换维度」「快速记录」这类工作时，优先用上表对应的组合能力，而不是堆更多独立视图或让用户手动操作。

## 2. 构建前需要的上下文

优先从现有 vault 读取；缺失时做最小假设并公开说明。

| 决策 | 要确认什么 | 无上下文时的默认 |
| --- | --- | --- |
| 一行身份 | 一条记录是文件还是 checkbox 任务 | 需要长期正文的一物一文件；纯待办才用 task |
| scope | folder、frontmatter marker、file/task tag | file 使用 folder + marker；task 使用精确 `#tag` |
| 生命周期 | 如何新建、维护、归档 | file 给模板和 newRowAction；task 说明在 Markdown 中新增 |
| 基础字段 | 用户维护哪些事实 | 状态、日期、分类、负责人等稳定事实 |
| formula | 哪些值可由事实推出 | 时间差、是否逾期、完成率拆成 formula/聚合 |
| 高频问题 | 打开系统最先看什么 | 至少一个 table，再按问题补其它视图 |
| 现有结构 | fields、view id、parentId、layouts、group | 修改时全部保留，除非目标要求改变 |

如果可访问 vault：先查现有 `.xdb`、目标文件夹 frontmatter、模板、任务行和命名约定。只问会改变结构的关键问题；其它缺口用假设推进。

## 3. 固定构建顺序

顺序不要跳：

1. **意图**：管理、推进、计划、浏览、统计还是组合？
2. **source**：一行是 file 还是 task？
3. **scope**：用 folder/path、marker 或精确 tag 限定行集。
4. **生命周期**：新建、维护、完成、归档分别怎么做？同时审视两点：
   - **高频操作是否该自动化**：完成、归档、确认、打时间戳等反复发生的状态流转，默认配 button 字段一键完成（多步 update-row 串联），不要让用户手动改 select 再填日期。见 [best-practices.md](best-practices.md#5-button-字段多步骤一键流转)。
   - **是否需要随手记录入口**：如果用户会临时记一笔（灵感、速记、当日杂事）而不想创建一条结构化记录，加一个 date-page 视图作为低摩擦入口。见 [view-date-page.md](view-date-page.md)。
5. **基础字段**：只放用户维护的事实。
6. **formula**：从事实推导的值，必要时声明结果 `type`。
7. **filter**：全局只放所有视图共享的数据边界；视图 filter 回答局部问题。
8. **views**：明细、状态、时间、指标各司其职，多视图用 group 收拢。编排遵循两条规则：
   - **同类视图用 tabs 收进 dashboard**：为同一对象配的多个维度视图（年/月/周、本期/上期、不同筛选的明细），默认收进一个 `group`(tabs)，让用户切 tab 快速切换维度，而不是在顶层并排成多个独立视图。
   - **顶层不散落**：顶层只放少数高频入口；其余视图挂到 group 下。dashboard 布局见 [best-practices.md](best-practices.md#3-仪表盘网格尺寸laptop-24-列基准)。
9. **layout**：dashboard 子视图给 laptop/mobile 位置；移动容器后重新布局。
10. **输出与验证**：写完整文件和辅助物，跑 validator；在源码仓用真实 FilterEngine 编译筛选；再做业务检查。

### 当前 schema 不可妥协项

- filter 顶层为 `group`，叶节点只用 `expression`；不生成旧 `condition`。
- filter 表达式是 DSL：双引号、`==` / `!=`、`&&` / `||`，不是 JavaScript。
- tag 精确匹配原始字符串。例如 task tag 用 `tags.contains("#work")`。
- `parentId` 为空表示根；非空只能指向 `type: "group"`，不能形成环。
- `task` source 不能新建任务。
- Button View 和 newRowAction 没有 row；`update-row` / `move-row` / `delete-row` 放在 button 字段。
- vault 路径使用相对路径，不以 `/` 开头。

## 4. 修改已有 `.xdb`

默认是增量修改：

- 保留已有字段名、view id、parentId、layouts、顶层 filter 和 group。
- 只改目标范围内的字段/视图；不要顺手重排整个 `views`。
- 新视图优先挂到现有 group；新增 id 必须稳定且唯一。
- 移动视图只到根或 group，不能移入自身子树；新 parent 下重新生成/检查 layouts。
- 修改 scope、字段含义或 Action 时，明确影响哪些旧记录和视图。
- 最终交付基于原定义合并，并列出保留、增加、改变和删除项。

## 5. 输出契约

最终回答按这个顺序，方便目标方 review：

1. **设计摘要**：意图、source、一行身份、scope、生命周期、字段、formula、视图。
2. **变更说明**：新建/增量/重构；保留和改变什么。
3. **文件清单**：`.xdb`、模板等 vault 相对路径。
4. **完整 `.xdb` JSON**：不是孤立片段。
5. **数据进入方式**：模板/frontmatter 或 task 写法。
6. **使用说明**：如何新建、编辑、归档和读取关键视图。
7. **假设与依赖**：未确认事实、自定义 Action 插件与 scope。
8. **验证**：validator 与 FilterEngine compile 命令、结果，以及至少一条进入/边界/排除/操作路径。

设计摘要模板：

```text
【系统名】设计摘要

意图：要反复完成什么工作。
source：file/task；一行是什么。
scope：哪些记录进入，哪些明确排除。
生命周期：如何新建、维护、完成和归档。
字段：事实字段与 formula 的分工。
视图：每个视图回答的问题。
交付：.xdb、模板/任务写法、说明和验证。
假设：哪些信息尚未确认。
```

## 6. 一份可执行样例

[project-dashboard.xdb](../examples/project-dashboard.xdb) 展示当前完整链路：

- file source；`Projects/` 路径 + `xdbType: project` 双重边界。
- table、kanban、calendar、overdue table、completion metric。
- dashboard group 与子视图 layouts。
- create-file newRowAction 与 button 字段 move-row 归档。
- 全部 filter 使用 `group + expression`。

配套模板是 [project-template.md](../examples/project-template.md)。样例不是领域模板；它只示范如何让 scope、生命周期、视图、Action 和验证闭环。

## 7. 语义自检

validator 通过后仍要逐项回答：

- 数据边界是否真的排除了无关记录？至少举一个进入和一个排除样例。
- 模板创建出的记录是否立刻满足全局 scope？
- formula、filter、metric/charts 是否使用了各自正确的表达式上下文？
- tag 是否包含真实的 `#` 和大小写？日期逾期是否用 `today()` 而不是 `now()` 误伤今天？
- 所有 field 引用、parentId、Action id 是否存在且唯一？层级是否无环？
- Button View/newRowAction 是否错误使用了 row / `$item`？
- 同一对象的多个维度视图是否散落在顶层，而非收进 group(tabs)？
- 高频状态流转（完成/归档/确认）是否还要求用户手动改字段，而非一键 button？
- 用户有随手记录需求时，是否提供了 date-page 这类低摩擦入口？
- 移动、改名后后续 Action 是否读取最新 row id/path？
- 自定义 Action 是否声明插件依赖和 scope？
- 修改已有库时，是否无故改变了既有 id、parentId、layouts 或 scope？
- 最终是否包含 `.xdb`、辅助物、相对路径、假设和验证结果？
