# 筛选（filter）

筛选决定视图看到哪些行。数据库可以有一个全局 `filter`，每个视图也可以有自己的 `filter`。数据依次经过全局筛选和视图筛选，两者都满足的行才会显示。

## Schema

filter 由 group 和 expression 两类节点递归组成。顶层固定为 group。

```ts
type FilterItem = FilterGroup | ExpressionFilterItem;

interface FilterGroup {
  id: string;
  type: 'group';
  join: 'and' | 'or';
  items: FilterItem[];
}

interface ExpressionFilterItem {
  id: string;
  type: 'expression';
  expression: string;
}
```

示例：

```json
{
  "id": "root",
  "type": "group",
  "join": "and",
  "items": [
    { "id": "f1", "type": "expression", "expression": "status == \"done\"" },
    { "id": "f2", "type": "expression", "expression": "priority >= 3" }
  ]
}
```

## expression DSL

筛选表达式使用动态公式 DSL，不是 JavaScript。运行时会根据字段的实际值选择已注册操作；最终结果必须是 boolean。

常用语法：

```text
status == "pending"
priority >= 3 && !archived
name.contains("draft")
tags.containsAny(["#project", "#urgent"])
deadline < today() + "7 days"
isEmpty(assignee)
```

主要规则：

- 字符串只使用双引号。
- 相等运算是 `==` / `!=`，没有 `===` / `!==`。
- 逻辑运算是 `&&`、`||`、`!`。
- 数值支持 `+`、`-`、`*`、`/`、`%` 和关系比较。
- 数组使用 `[value1, value2]`；支持 `contains`、`notContains`、`containsAny`、`containsAll`、`anyMatch`、`allMatch`。
- 日期使用 `date(...)`、`now()`、`today()`；时间跨度使用 `duration(7, "days")` 或可转换的字符串 `"7 days"`。
- `null` 表示字段缺失；`isEmpty` 同时识别 null、空字符串和空数组。

隐式转换是运行时语言特性：精确匹配优先；没有精确候选时，只允许一次直接转换；转换更少的候选优先；等优候选会报告歧义。内置支持常见的 `string -> number/date/duration`，不执行链式转换。

## 字段与对象

合法标识符字段可以直接使用，也可以通过 `$item` 访问：

```text
status == "done"
$item.status == "done"
file.basename == "notes"
```

包含空格或需要保留字面点号的字段名使用 `field(...)`：

```text
field("review status") == "done"
field("release.name") == "v1"
```

在支持文件上下文的 Vault Files 数据库中，还可以读取：

```text
thisFile.file.basename == "dashboard"
activeFile.file.path.contains("projects/")
thisFile.author == "Ada"
thisFile.frontmatter.author == "Ada"
```

`thisFile` 是包含数据库嵌入的文件，`activeFile` 是工作区当前活动文件。上下文不存在时它们为 null。

## 操作速查

| 值类型  | 常用操作                                                                  |
| ------- | ------------------------------------------------------------------------- |
| string  | `==`、`!=`、`contains`、`notContains`、`startsWith`、`endsWith`、`length` |
| number  | `==`、`!=`、`<`、`<=`、`>`、`>=`、算术运算                              |
| boolean | `==`、`!=`、`&&`、`\|\|`、`!`                                          |
| array   | `contains`、`notContains`、`containsAny`、`containsAll`、`length`         |
| date    | `==`、`!=`、`<`、`<=`、`>`、`>=`、`add`、`subtract`、`startOf`、`endOf`   |

Tags 是普通字符串数组，保留原始 `#`、大小写和层级，不会自动归一化或展开。例如数组中的 `#Project/Alpha` 只精确匹配 `"#Project/Alpha"`，不会同时匹配 `"project"`、`"#project"` 或 `"#Project"`。

## 可视化与源码模式

筛选编辑器可以在可视化单条件与 DSL 源码之间切换。只有能无损表示为“一个字段 + 一个操作 + 字面量”的表达式才能切回可视化模式；组合表达式和 lambda 会保留在源码模式。

持久化 schema 只使用 `group` 和 `expression`。旧 `condition` 可能在打开设置 UI 时被迁移，但运行时 `ObjectFilters` 不执行它；生成文件时不得依赖迁移。

语法/link、字段解码或运行时分派失败的记录按“不匹配”处理，并显示带精确位置的诊断。compile 只解析名称和语法，部分参数问题要读取实际记录后才能发现。表达式不会执行任意 JavaScript。

## 验证

先跑可移植的结构与高置信语法检查：

```bash
node docs/skills/xdb-user-skills/scripts/validate-xdb.mjs path/to/your.xdb
```

在 database2 源码仓内，再用当前宿主的真实 FilterEngine 编译所有 filter expression：

```bash
XDB_VALIDATE_FILE=path/to/your.xdb npm test -- --runInBand docs/skills/xdb-user-skills/scripts/compile-xdb-filters.test.ts
```

两者都通过仍不等于业务正确。最后在宿主里准备至少三条记录：应进入、边界值、应排除；打开 filter 源码模式确认无诊断，并核对实际行数。字段的真实值类型只有在读取记录时才能完全验证。

## 与 formula 的区别

formula 仍使用数据库的行级表达式上下文，可以返回任意显示值；筛选 DSL 只执行白名单公式操作，并在求值结束时检查 boolean。不要在筛选中使用 `moment(...)`、三元表达式、`.map(...)` 或 JavaScript 单引号。更多上下文区别见 [expressions.md](expressions.md)。
