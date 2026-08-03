# metric

## 视图简介

指标视图，显示单个统计值。常用于仪表盘的 KPI 卡片。

## 适用场景

- 总数、总额、均值、完成率等单值统计。
- 仪表盘摘要卡片。

## Schema

```ts
interface MetricViewDefinition extends DatabaseViewDefinition {
  type: 'metric';
  expression?: string;   // 顶层字段，聚合表达式
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `expression` | `string` | 否 | 聚合表达式，默认 `'$items.length'`（行数）。错误 / null 显示 `N/A` |

> `expression` 是**顶层字段**，不在 `options` 里。

标签为视图 `name`，图标为视图 `icon`（显示在标签旁）。

### 求值上下文（聚合）

`expression` 在聚合上下文求值。作用域、聚合函数与 [group.md#summary](group.md#summary) 相同：`$items` / `$values` / `moment` + `sum` / `avg` / `min` / `max` / `count` / `distinct` / `countEmpty` / `countNotEmpty`。如果先要理解几类表达式的区别，先看 [expressions.md](expressions.md)。

表达式是一段 JavaScript，不带 `return` / 分号。metric 无单位 / 前缀 / 小数位 / 趋势选项，格式化写进表达式。

metric 主要靠 `filter` 圈定统计范围，不消费 `sort` / `group` / `tree`。

## 最佳实践

- 格式化写进表达式：`` `¥${sum($items.map(i => i.price)).toFixed(0)}` `` → `¥12345`；`(sum(...)/10000).toFixed(2) + "W"` → `12.34W`。
- 同比 / 环比：用多个相同 expression 的 metric 配不同时间区间的 expression filter（本月 / 上月 / 上周…）。见 [best-practices.md](best-practices.md#2-同比环比一组-metric--表达式筛选)。
