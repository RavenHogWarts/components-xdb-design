# 表达式（expressions）

XDB 里很多能力都靠表达式，但**不是同一个上下文**。先分清你现在写的是哪一类，再写语法。

## 一览

| 场景            | 写在哪里                       | 上下文           | 典型变量                                          | 应返回什么           |
| --------------- | ------------------------------ | ---------------- | ------------------------------------------------- | -------------------- |
| 公式字段        | `field.formula`                | 行级             | `$item`、字段名、`moment`                         | 当前行的值           |
| 表达式筛选      | `filter.type = "expression"`   | 动态公式筛选 DSL | `$item`、字段名、`thisFile`、`activeFile`         | boolean              |
| 组头汇总        | `group.summary`                | 聚合             | `$items`、`$values`、`moment`                     | 显示在组头的值       |
| 表格列汇总      | `view.summary[field]`          | 聚合             | `$items`、`$values`、`moment`                     | 显示在表格底部的值   |
| metric 指标     | `metric.expression`            | 聚合             | `$items`、`$values`、`moment`                     | 单个统计值           |
| charts 度量     | `measures[].aggregate`         | 聚合             | `$items`、`$values`、`moment`                     | 数值，非数值会塌成 0 |
| Update Row 公式 | `update.mode = "formula"`      | 行级动作         | `$item`、字段名、`moment`                         | 写入当前属性的新值   |
| Script Action   | `action.type = "script"`       | 动作             | `database`、`variables`、`row`、`$item`、领域 API | 副作用或 Promise     |

## 1. 行级 formula 表达式

行级表达式对**每一行**单独求值一次。

适用场景：

- `field.formula`

可用变量：

- `$item`：当前整行对象
- 所有字段名：可直接写 `price`、`status`、`renewDate`
- `moment`
- formula 里还可用聚合辅助函数：`sum` / `avg` / `count` / `distinct` 等，见 [fields.md#formula](fields.md#formula)

### 常见写法

```js
price * quantity
```

```js
$item.renewDate ? moment($item.renewDate).diff(moment(), 'days') : null
```

```js
status !== 'done' && moment(deadline).isBefore(moment(), 'day')
```

筛选不是这一套 JavaScript 风格语法。对应的筛选 DSL 写法是：

```text
status != "done" && deadline < today()
```

筛选 DSL 只允许已注册的操作和一次直接隐式转换，并在求值结束时要求 boolean；完整语法见 [filter.md#expression-dsl](filter.md#expression-dsl)。

## 2. 聚合表达式

聚合表达式对**一组行**一起求值一次。

适用场景：

- `group.summary`
- `view.summary[field]`
- `metric.expression`
- `charts.measures[].aggregate`

可用变量：

- `$items`：当前这组行的对象数组
- `$values`：
  - 在 `group.summary` / `metric.expression` / `charts` 里，通常等同于 `$items`
  - 在表格 `summary[field]` 里，是该列的值数组
- `moment`
- `sum` / `avg` / `min` / `max` / `count` / `distinct` / `countEmpty` / `countNotEmpty`

### 常见写法

```js
$items.length
```

```js
sum($items.map((i) => Number(i.price || 0)))
```

```js
'¥' + sum($values).toFixed(0)
```

```js
count(distinct($items.map((i) => i.assignee)))
```

## 3. Action 表达式

按钮字段的 Update Row 可以用 `mode: "formula"` 计算动态值。它使用数据库的行级表达式上下文；同一 Action 的所有公式都对 Action 开始时的 `row.item` 快照求值：

```json
{
  "id": "set-time",
  "type": "update-row",
  "updates": [
    {
      "id": "completed-at",
      "field": "completedAt",
      "operation": "set",
      "mode": "formula",
      "formula": "moment().format('YYYY-MM-DDTHH:mm:ss')"
    }
  ]
}
```

需要条件、循环或多个动态操作时使用 Script Action。Script 注入 `app` / `database` / `variables` / `row` / `$item` / `moment` / `files` / `markdown` / `tasks` / `dailyNotes` / `confirm` / `prompt` / `open`。

`row` / `$item` 只有按钮字段可用；Button View 和 newRowAction 中它们为 `undefined`。完整 Action schema、Script bindings 和移动后行身份见 [actions.md](actions.md)。

## 4. 三个最常见的混淆

### 把行级写成聚合级

错误心智：

```js
sum(price)
```

这在 formula 里通常不对，因为 formula 处理的是一行，不是一组行。

正确思路：

- 行级就直接算当前行：`price * quantity`
- 聚合级才对数组做 `sum($items.map(...))`

### 在 metric / charts 里直接写字段名

错误心智：

```js
price
```

metric / charts measure 运行在聚合上下文，没有“当前这一行”的 `price` 概念。要先从 `$items` 取数组：

```js
sum($items.map((i) => Number(i.price || 0)))
```

### 把筛选 DSL 当成 formula

`filter.expression` 应该返回 boolean，不是返回一个显示值，也不会执行任意 JavaScript。

正确例子：

```text
status != "cancelled" && renewDate > now()
```

## 5. 选择哪一种

| 你想做什么                      | 用哪种                                                     |
| ------------------------------- | ---------------------------------------------------------- |
| 算“距续费天数”                  | `field.formula`                                            |
| 只看“7 天内到期”                | `filter.expression`（如 `deadline <= today() + "7 days"`） |
| 看“本月总支出”                  | `metric.expression`                                        |
| 表格底部统计“总金额”            | `view.summary.price`                                       |
| 图表按月显示“营收”              | `charts.measures[].aggregate`                              |
| 点击按钮把状态改成 done         | 按钮字段 `update-row`                                      |
| 点击按钮写入当前时间            | `update-row` update 的 `mode: "formula"`                   |
| 一键运行复杂脚本 / 组合多个 API | `script` Action                                            |

## 6. 建议

- 先判断你是在处理“一行”还是“一组行”，再决定表达式写法。
- formula、summary、metric 和 aggregate 都写成一个可返回值的表达式；不要在末尾加分号。
- 统计需求优先把复杂判断拆成“行级 formula + 简单聚合”，不要把所有逻辑都塞进一个 metric / charts 表达式。
- formula 的时间判断统一用 `moment(...)`；筛选 DSL 使用 `date` / `now` / `today` / `duration`。
- 如果你在写聚合表达式时开始频繁访问 `i.someField`，通常说明你应该用 `$items.map(...)`，而不是直接写字段名。

## 参考

- 公式字段：[fields.md#formula](fields.md#formula)
- 筛选表达式：[filter.md#expression](filter.md#expression)
- 组头汇总：[group.md#summary](group.md#summary)
- metric：[view-metric.md](view-metric.md)
- charts：[view-charts.md](view-charts.md)
- Action 与 Script：[actions.md](actions.md)
- 按钮字段：[fields.md#button](fields.md#button)
- Button View：[view-button.md](view-button.md)
