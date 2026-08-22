# 聚合配置（aggregate）

Metric、Charts、分组汇总和表格列汇总共用同一种聚合配置。可视化配置与自由表达式最终进入同一个表达式求值器；`.xdb` 只保存下面的配置对象，不保存额外的 `mode` 或生成后的 expression。

## 规范结构

```ts
type AggregateConfiguration = { type: AggregateType; field?: string } | { type: 'expression'; expression: string };
```

新建或修改 `.xdb` 时必须写对象。运行时仍能读取旧的字符串表达式和 `metric.expression`，但不要继续生成这些旧写法，也不要尝试把自由表达式反向解析成可视化配置。

### 内置计算

```json
{ "type": "sum", "field": "amount" }
```

`field` 的归属取决于使用位置：

| 使用位置                      | 内置计算的 `field`        |
| ----------------------------- | ------------------------- |
| `metric.aggregate`            | 必填                      |
| `charts.measures[].aggregate` | 必填                      |
| `group.summary`               | 必填                      |
| `view.summary[fieldName]`     | 省略；外层 key 已经确定列 |

统计记录数时选择稳定存在的 `file.path`：

```json
{ "type": "count", "field": "file.path" }
```

`count` 是计算方法，不是特殊属性；不要创建“全部记录”等伪字段。

### 自由表达式

```json
{
  "type": "expression",
  "expression": "($items.length ? Math.round($items.filter(i => i.status === 'done').length / $items.length * 100) : 0) + '%'"
}
```

自由表达式不写 `field`。表达式语法和作用域见 [expressions.md](expressions.md)。

## 放置位置与默认值

| 场景       | 配置位置                    | 省略时                                         | 置空方式           |
| ---------- | --------------------------- | ---------------------------------------------- | ------------------ |
| Metric     | `view.aggregate`            | 记录数：`count(file.path)`                     | 不支持             |
| Charts     | `view.measures[].aggregate` | 生成一个记录数 measure；数据名显示“数据”       | 删除 measure       |
| 分组汇总   | `view.group.summary`        | 记录数：`count(file.path)`                     | `summary: null`    |
| 表格列汇总 | `view.summary[fieldName]`   | 该列不显示汇总；没有任何列时省略整个 `summary` | 删除对应的字段 key |

`group.summary` 区分省略与显式 `null`：省略表示使用默认记录数，`null` 表示不显示组头汇总。清空 Group Summary 的自由表达式也保存为 `null`，不会把空表达式交给求值器。

## Field type 与可用计算

| Field type                              | AggregateType                                                                                   |
| --------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `number`                                | `sum`, `average`, `minimum`, `maximum`, `count`, `filled`, `empty`, `unique`                    |
| `text`, `select`                        | `count`, `filled`, `empty`, `unique`                                                            |
| `boolean`                               | `count`, `checked`, `unchecked`, `filled`, `empty`                                              |
| `multi-select`, 多值 `reference`        | `count`, `filledRows`, `emptyRows`, `optionCount`, `uniqueOptions`                              |
| `date`                                  | `earliestDate`, `latestDate`, `count`, `filled`, `empty`, `uniqueDays`, `longestStreak`         |
| `datetime`                              | `earliestDateTime`, `latestDateTime`, `count`, `filled`, `empty`, `uniqueDays`, `longestStreak` |
| 单值 `reference`、formula、未知扩展字段 | `count`, `filled`, `empty`                                                                      |
| `button`                                | 无                                                                                              |

含义：

- `count`：记录数；包括属性为空的行。
- `filled` / `empty`：已填写数 / 空值数。
- `unique`：唯一非空值数。
- `filledRows` / `emptyRows`：多值属性已填写 / 空行数。
- `optionCount` / `uniqueOptions`：所有行的选项总数 / 唯一选项数。
- `checked` / `unchecked`：已勾选 / 未勾选数。
- `uniqueDays` / `longestStreak`：唯一日期数 / 最长连续天数。

内置计算的可选结果类型还受消费方约束：Metric 和 Summary 接受 number、date、datetime；Charts 默认只接受 number，`measureValueType: "datetime"` 时只接受 datetime。Metric 和 Summary 的自由表达式还可以返回用于显示的字符串。热力图的 category 是日期字段，但 measure 仍应返回 number。

## 四个场景

### Metric

```json
{
  "type": "metric",
  "name": "总金额",
  "aggregate": { "type": "sum", "field": "amount" }
}
```

### Charts

```json
{
  "type": "charts",
  "name": "按状态统计",
  "category": { "field": "status" },
  "measures": [{ "label": "记录数", "aggregate": { "type": "count", "field": "file.path" } }]
}
```

### 分组汇总

```json
"group": {
  "by": [{ "field": "status" }],
  "summary": { "type": "sum", "field": "amount" }
}
```

不显示组头汇总：

```json
"group": {
  "by": [{ "field": "status" }],
  "summary": null
}
```

### 表格列汇总

```json
"summary": {
  "amount": { "type": "sum" },
  "file.path": { "type": "count" }
}
```

需要格式化或跨字段计算时，把对应值改成 `{ "type": "expression", "expression": "..." }`。

## 失效与错误

配置不会因为字段或类型变化而被自动改写。设置页会按当前 Field type 限制可选计算；运行时聚合函数则容忍实际值漂移，例如数值列没有任何有效 number 时 `sum` / `average` / `minimum` / `maximum` 返回 `0`。

aggregate type 无法识别、缺少必要 field、自由表达式抛错或返回空值时，Metric/Summary 显示 `N/A`，Charts 产生空数据点，并在 console 中记录包含 view id 和 view name 的 warning；不会让视图抛错。显式 `group.summary: null` 是正常的关闭状态，不属于求值失败，也不会显示 `N/A`。
