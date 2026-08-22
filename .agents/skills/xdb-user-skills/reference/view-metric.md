# metric

## 视图简介

指标视图，显示单个统计值。常用于仪表盘的 KPI 卡片。

## 适用场景

- 总数、总额、均值、完成率等单值统计。
- 仪表盘摘要卡片。

## 专属配置

完整定义以 [View Schema](view-schema.md#metric) 为准。这里说明 Metric 的聚合用法。

```ts
interface MetricViewDefinition extends DatabaseViewDefinition {
  type: 'metric';
  aggregate?: AggregateConfiguration;
}
```

| 字段        | 类型                     | 必填 | 说明                                                                                         |
| ----------- | ------------------------ | ---- | -------------------------------------------------------------------------------------------- |
| `aggregate` | `AggregateConfiguration` | 否   | 聚合配置，默认 `{ "type": "count", "field": "file.path" }`（记录数）。错误 / null 显示 `N/A` |

> `aggregate` 是**顶层字段**，不在 `options` 里。旧 `expression` 只用于读取已有配置；新配置不要再生成。

标签为视图 `name`，图标为视图 `icon`（显示在标签旁）。

### 配置

优先使用内置计算：

```json
{ "type": "metric", "name": "总金额", "aggregate": { "type": "sum", "field": "amount" } }
```

需要完成率、跨字段计算或格式化时使用自由表达式：

```json
{
  "type": "metric",
  "name": "完成率",
  "aggregate": {
    "type": "expression",
    "expression": "($items.length ? Math.round($items.filter(i => i.status === 'done').length / $items.length * 100) : 0) + '%'"
  }
}
```

配置结构、Field type 对应的可用计算和失效行为见 [aggregate.md](aggregate.md)。自由表达式在聚合上下文求值，语法见 [expressions.md](expressions.md)。

metric 主要靠 `filter` 圈定统计范围，不消费 `sort` / `group` / `tree`。

## 最佳实践

- 格式化写进 `{ type: "expression", expression: "..." }`：`` `¥${sum($items.map(i => i.price)).toFixed(0)}` `` → `¥12345`。
- 同比 / 环比：用多个相同 aggregate 的 metric 配不同时间区间的 expression filter（本月 / 上月 / 上周…）。见 [best-practices.md](best-practices.md#2-同比环比一组-metric-表达式筛选)。
