# table

## 视图简介

行列表格视图，以表格形式浏览和编辑行数据。最通用的视图类型。

## 适用场景

- 管理、浏览、批量编辑记录。
- 需要列汇总（求和、计数）。
- 需要分组、树形层级展示。

## 专属配置

完整定义以 [View Schema](view-schema.md#table) 为准。这里说明 Table 专属配置和用法。

```ts
interface TableViewDefinition extends DatabaseViewDefinition {
  type: 'table';
  summary?: Record<string, AggregateConfiguration>;
  options?: TableViewOptions;
}

// table 专属 options
interface TableViewOptions {
  table?: {
    columnSizing?: Record<string, number>; // key=字段名，value=像素宽
    frozenColumnCount?: number; // 冻结前 N 列
  };
}
```

| 字段                              | 类型                                     | 必填 | 说明                                                                        |
| --------------------------------- | ---------------------------------------- | ---- | --------------------------------------------------------------------------- |
| `options.table.columnSizing`      | `Record<string, number>`                 | 否   | 列宽，key 为字段名，value 为像素宽。未配置的字段默认 180px，有效范围 72–720 |
| `options.table.frozenColumnCount` | `number`                                 | 否   | 冻结前 N 列（钉在左侧），默认 `0`                                           |
| `summary`                         | `Record<string, AggregateConfiguration>` | 否   | 表格底部列汇总；key 是字段名，内置计算对象不再重复写 `field`                |

冻结列按 `visibleFields` 顺序计前 N 列。调整 `visibleFields` 顺序会改变哪些列被冻结。

table 支持全部公共能力：`filter` / `sort` / `group` / `tree` / `summary`（表格底部列汇总）/ `limit` / `linkOpenMode`。

```json
"summary": {
  "amount": { "type": "sum" },
  "status": { "type": "unique" }
}
```

删除某个字段 key 表示该列选择“无”；没有任何列汇总时省略整个 `summary`。需要格式化时使用 `{ "type": "expression", "expression": "..." }`。完整规则见 [aggregate.md](aggregate.md)。

## 最佳实践

- 用 `summary` 配合时间分组做报表：`group.by[0].field = "month"`（month 为 formula 字段），`summary` 列求和。见 [best-practices.md](best-practices.md#4-汇总组头用-groupsummary表底用-summary)。
- 列宽按内容给：标题列宽一些（260+），状态/数值列窄一些（90–120）。
