# 分组（group）

分组（group）把行按字段归类成可折叠层级。视图通过 `group` 字段配置。kanban 看板的列也由 group 定义。

## Schema

```ts
interface DatabaseViewGroupDefinition {
  by: GroupByDefinition[];              // 分组规则，数组顺序即嵌套顺序
  collapsed?: GroupSelector[];          // 已折叠的分组选择器
  summary?: string;                     // 组头汇总表达式，见 summary
}

interface GroupByDefinition {
  field: string;                        // 分组字段名
  sort?: 'asc' | 'desc' | GroupValue[]; // 组值排序，默认 'asc'
  hidden?: GroupValue[];                // 隐藏的组值
  pinned?: GroupValue[];                // 固定显示的组值
}

type GroupValue = string | null;
type GroupSelector = Record<string, GroupValue>;
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `by` | `GroupByDefinition[]` | 是 | 分组规则，数组顺序即嵌套顺序（第一个为最外层） |
| `collapsed` | `GroupSelector[]` | 否 | 已折叠的分组，按完整前缀路径匹配 |
| `summary` | `string` | 否 | 组头汇总表达式，见 [summary](#summary) |

### GroupByDefinition

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `field` | `string` | 是 | 分组字段名。除 `button` 外的字段都可分组 |
| `sort` | `'asc' \| 'desc' \| GroupValue[]` | 否 | 组值排序，默认 `'asc'`。数组表示**手动顺序**（不是白名单，不在数组中的值会追加在后按升序排） |
| `hidden` | `GroupValue[]` | 否 | 隐藏的组值 |
| `pinned` | `GroupValue[]` | 否 | 固定显示的组值（即便无数据也出现） |

### collapsed

记录哪些分组折叠，按"完整前缀路径"匹配。元素为 `{ <字段名>: <组值> }`。

```json
"collapsed": [
  { "status": "done" },
  { "status": "doing", "area": "[[工作]]" }
]
```

### 分组值生成

- `select` / `multi-select`：预定义选项作为候选组值并带颜色。
- 其它类型：按数据中实际出现的值生成组。
- 空值（`null` / `undefined` / 空串 / 空数组）归入"无值"组。
- `multi-select` 的每个数组元素各成一组。

## 示例

```json
"group": {
  "by": [
    { "field": "status", "sort": ["Todo", "Doing", "Done"], "pinned": ["Todo"] },
    { "field": "priority", "sort": "desc" }
  ],
  "collapsed": [{ "status": "Done" }],
  "summary": "$items.length"
}
```

先按 `status` 分组（列序固定 Todo→Doing→Done，Todo 即使无数据也显示），每个 status 组内再按 priority 降序嵌套分组，Done 组默认折叠，组头显示行数。

## summary

`group.summary` 是组头汇总，值为一段**聚合表达式**。如果你先想分清“行级 vs 聚合级”，先看 [expressions.md](expressions.md)。

```json
"summary": "sum($items.map(i => i.estimate))"
```

### 求值上下文（聚合）

`group.summary` 在**聚合上下文**求值（对每个分组求值一次）。作用域变量：

| 变量 | 说明 |
| --- | --- |
| `$items` | 当前分组的全部行对象数组 |
| `$values` | `$items` 的兼容别名 |
| `moment` | Moment.js |

聚合函数：

| 函数 | 作用 |
| --- | --- |
| `sum(arr)` | 数值求和 |
| `avg(arr)` | 数值平均 |
| `min(arr)` / `max(arr)` | 最小 / 最大值 |
| `count(arr)` | 元素个数 |
| `distinct(arr)` | 去重数组 |
| `countEmpty(arr)` | 空元素个数 |
| `countNotEmpty(arr)` | 非空元素个数 |

表达式是一段 JavaScript，**不带 `return`、不带分号**。

### 示例

```js
// 组内行数
$items.length

// 对某列求和
sum($items.map(i => i.amount))

// 带格式
"¥" + sum($items.map(i => i.price)).toFixed(0)

// 非空计数
countNotEmpty($items.map(i => i.status))

// 去重计数
count(distinct($items.map(i => i.assignee)))
```

### 与列汇总的区别

视图顶层还有一个 `summary`（列汇总），结构与 group.summary 不同：

- `group.summary`（本文）：单个字符串，组头显示，`$items` / `$values` 为该组整行。
- 视图 `summary`（`Record<字段名, 表达式>`）：表格底部每列汇总，`$values` 为该列的值数组。

```json
"summary": { "price": "sum($values)", "file.basename": "$values.length" }
```

> 两者都由同一表达式引擎在聚合上下文求值，只是变量指向不同。聚合上下文与行级上下文的区别见 [fields.md#formula](fields.md#formula)。
