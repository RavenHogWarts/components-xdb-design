# kanban

## 视图简介

看板视图，按字段值分列、支持拖拽卡片在列间流转。

## 适用场景

- 状态流转（Todo → Doing → Done）。
- 阶段管理（招聘、审批流程）。
- 按分类拖拽归类。

## Schema

```ts
interface KanbanViewDefinition extends DatabaseViewDefinition {
  type: 'kanban';
  options?: CardViewOptions;   // 共享卡片配置，见 card-cover.md
}
```

kanban **必须配置 `group`**，否则显示空状态。分组规则映射为看板结构：

- `group.by[0]` → 列（每个不同组值 = 一列）。
- `group.by[1]`（可选）→ 泳道（横向行分组，最多 2 层）。

分组结构见 [group.md](group.md)。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group` | `DatabaseViewGroupDefinition` | 是 | 分组定义，`by[0]` 为列 |
| `options.cardSize` | `number` | 否 | 列宽（像素），100–600，默认 `280` |
| 卡片封面相关 | | 否 | `cover` / `coverAspectRatio` / `coverObjectFit` / `extensionData` / `hideFieldName`，见 [card-cover.md](card-cover.md) |

列的控制写在 `group.by[0]`：`sort`（列顺序，数组为手动顺序）、`hidden`（隐藏列）、`pinned`（固定空列）。

`select` / `multi-select` 字段的选项作为候选列值并带颜色；其它类型按实际数据生成列。

kanban 支持 `filter` / `sort`（卡片在列内的顺序）/ `limit` / `linkOpenMode`，不支持 `tree`。

## 最佳实践

- `select` 字段做列，配合 `by[0].sort` 数组固定列序（如 `["Todo","Doing","Done"]`），用 `pinned` 固定空列。
- 双层分组做泳道：`by[0]` = 状态列，`by[1]` = 优先级泳道。
