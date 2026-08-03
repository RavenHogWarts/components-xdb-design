# charts

## 视图简介

图表视图，把行聚合成可视化图表。

## 适用场景

- 分布（柱 / 饼）、趋势（折线）、多维对比（堆叠柱）。
- 时间活跃度（热力图）。

## Schema

charts 的配置**全部为视图顶层字段**，不在 `options` 里。

```ts
interface ChartsViewDefinition extends DatabaseViewDefinition {
  type: 'charts';
  chartType?: ChartType;
  category?: { field: string } | null;
  seriesBy?: { field: string } | null;
  measures?: ChartsMeasure[];
  measureValueType?: 'number' | 'datetime';
  axis?: ChartsAxisOptions;
  heatmap?: ChartsHeatmapOptions;
  dateRange?: ChartsDateRange;
  echartsOption?: Record<string, unknown>;
}

type ChartType =
  | 'bar' | 'stackedBar' | 'horizontalBar' | 'stackedHorizontalBar'
  | 'line' | 'pie' | 'heatmap';
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `chartType` | `ChartType` | 否 | 图表类型，默认 `'bar'` |
| `category` | `{ field } \| null` | 否 | 主维度。轴图=X 轴 / 饼图=切片 / 热力图=日期字段 |
| `seriesBy` | `{ field } \| null` | 否 | 次维度，每个不同值一条系列（轴图 / 热力图生效，饼图忽略） |
| `measures` | `ChartsMeasure[]` | 否 | 度量数组，默认 `[{ aggregate: '$items.length' }]` |
| `measureValueType` | `'number' \| 'datetime'` | 否 | 值轴类型，默认 `'number'`（JSON-only，无 UI） |
| `axis` | `ChartsAxisOptions` | 否 | 轴图显示选项 |
| `heatmap` | `ChartsHeatmapOptions` | 否 | 热力图选项 |
| `dateRange` | `ChartsDateRange` | 否 | 热力图日期窗口 |
| `echartsOption` | `object` | 否 | ECharts option，深合并覆盖生成结果（逃逸口） |

### ChartType

| 值 | 类型 |
| --- | --- |
| `bar` | 柱状图（默认） |
| `stackedBar` | 堆叠柱状图 |
| `horizontalBar` | 横向柱状图 |
| `stackedHorizontalBar` | 堆叠横向柱状图 |
| `line` | 折线图（平滑） |
| `pie` | 饼图 |
| `heatmap` | 热力图（贡献日历风格） |

### measures

```ts
interface ChartsMeasure {
  aggregate: string;   // 聚合表达式（必填）
  label?: string;      // 系列名，缺省用 aggregate
}
```

`measures[].aggregate` 为聚合表达式，求值上下文与 [group.md#summary](group.md#summary) 相同（`$items` / `$values` + 聚合函数 + `moment`）。非数值结果塌成 0。`pie` / `heatmap` 只用 `measures[0]`。如果先要理解几类表达式的区别，先看 [expressions.md](expressions.md)。

### 数据映射

| 情况 | 结果 |
| --- | --- |
| 无 `category` 无 `seriesBy` | 一个系列，X 轴为各 measure 的 label |
| 有 `category` 无 `seriesBy` | 每个 measure 一条系列，X 轴为 category 值 |
| 有 `category` + `seriesBy` | 每个 seriesBy 值一条系列（只用 `measures[0]`） |
| `pie` | 一片 = category 一个值，值 = `measures[0]` |
| `heatmap` | category = 日期字段，按天分桶，值 = `measures[0]` |

### axis（轴图）

| 字段 | 类型 | 默认 |
| --- | --- | --- |
| `showLegend` | `boolean` | 自动（多系列 / 多 measure 时显示） |
| `valueAxisFromZero` | `boolean` | `false` |
| `showDataLabels` | `boolean` | `false` |

### heatmap（热力图）

| 字段 | 类型 | 默认 |
| --- | --- | --- |
| `cellSize` | `number`（6–40） | `14` |
| `firstDayOfWeek` | `0`(周日) / `1`(周一) | `1` |
| `showVisualMap` | `boolean` | `true` |
| `showSplitLine` | `boolean` | `false` |
| `fullWidth` | `boolean` | `true` |
| `valueRange` | `{ min?, max?, segments? }` | min/max 取自数据 |

### dateRange（热力图）

判别联合：

```json
{ "type": "fixed", "startDate": "2026-01-01", "endDate": "2026-12-31" }
{ "type": "recent", "value": 365, "unit": "day" }   // 默认近 365 天
```

`unit`：`'day'` / `'week'` / `'month'` / `'year'`。

charts 支持 `filter`，不消费 `sort` / `group` / `tree`。

## 最佳实践

- 时间维度做 `category`：用 `month` / `week` 等 formula 字段做分类轴，做月 / 周营收趋势。见 [best-practices.md](best-practices.md#1-时间层级用-formula-字段做多粒度分组)。
- 堆叠柱 + `seriesBy` 做多维对比（如按平台分系列的月营收）。
- `echartsOption` 深合并覆盖任意生成结果（颜色、标题等）。
