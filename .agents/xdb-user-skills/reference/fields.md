# 字段（fields）

字段（属性）是数据库的列定义，全局共享，所有视图使用同一套字段。

## Schema

`fields` 为对象数组：

```ts
interface DatabaseFieldDefinition {
  name: string; // 属性名，在 fields 中唯一
  type?: DatabaseFieldType; // 属性类型，默认 'text'
  options?: Record<string, unknown>; // 类型相关配置
  formula?: string; // 公式表达式。填写后该字段为只读计算字段
}

type DatabaseFieldType =
  | 'text'
  | 'number'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'select'
  | 'multi-select'
  | 'reference'
  | 'button';
```

| 字段      | 类型                | 必填 | 说明                               |
| --------- | ------------------- | ---- | ---------------------------------- |
| `name`    | `string`            | 是   | 属性名，在 `fields` 中唯一         |
| `type`    | `DatabaseFieldType` | 否   | 属性类型，默认 `text`              |
| `options` | `object`            | 否   | 类型相关配置，见下                 |
| `formula` | `string`            | 否   | 公式表达式，见 [formula](#formula) |

### 类型与 options

| 类型           | 单元格值         | options 形态                          |
| -------------- | ---------------- | ------------------------------------- |
| `text`         | 字符串           | 无                                    |
| `number`       | 数字             | 无                                    |
| `boolean`      | `true` / `false` | 无                                    |
| `date`         | 日期             | `{ format?: string }`                 |
| `datetime`     | 时间戳           | `{ format?: string }`                 |
| `select`       | 字符串 / `null`  | `{ items: [{ value, color }] }`       |
| `multi-select` | 字符串数组       | `{ items: [{ value, color }] }`       |
| `reference`    | 查询投影值       | `{ filter?, valueField?, multiple? }` |
| `button`       | ——               | `{ icon?, actions?[] }`               |

> 没有 `formula` 类型。只要字段写了 `formula`，它就是公式字段；`type` 表示公式结果应该按什么类型处理（如 `number` / `boolean` / `date`），可省略。也没有 `status` 类型。任务库的"状态"是 `text`（值为状态字符）；文件库的"状态"通常是 `select`。

## 内置字段

内置字段按名称自动识别，无需声明 `type`。可用字段随 source 不同。

### file 源

一行 = 一个文件。frontmatter 的每个 key 平铺在行根上（可直接当属性名用）。

> `file` 是系统保留命名空间，始终表示当前记录的文件元数据。Markdown 中已有的同名 `file:` 属性会保留原文，但不会作为 Database2 字段显示、筛选或写入；请使用其他属性名保存业务数据。
>
> 如果 `.xdb` 的 `fields` 中已经存在名为 `file` 的字段，数据库仍会加载，但该字段只显示保留名称提示，不参与取值、公式或筛选。请将它重命名或删除。

| 字段名                 | 类型         | 说明                      | 可写                    |
| ---------------------- | ------------ | ------------------------- | ----------------------- |
| `file.name`            | text         | 文件名（含后缀）          | 否                      |
| `file.basename`        | text         | 文件名（不含后缀）        | 是（改名，会改变行 id） |
| `file.extension`       | text         | 后缀                      | 否                      |
| `file.path`            | text         | 完整路径                  | 否                      |
| `file.parent`          | text         | 所在文件夹路径            | 否                      |
| `file.tags`            | multi-select | 文件标签                  | 否                      |
| `file.ctime`           | datetime     | 创建时间                  | 否                      |
| `file.mtime`           | datetime     | 修改时间                  | 否                      |
| `file.size`            | number       | 文件大小（字节）          | 否                      |
| `file.textStats.chars` | number       | 正文字符数                | 否                      |
| `file.textStats.words` | number       | 正文单词数                | 否                      |
| `file.backlinks`       | multi-select | 反链文件路径              | 否                      |
| `file.tasks`           | multi-select | 文件内任务列表            | 否                      |
| `aliases`              | multi-select | frontmatter 的 aliases    | 是                      |
| `cssclasses`           | multi-select | frontmatter 的 cssclasses | 是                      |

### task 源

一行 = 一个任务（markdown checkbox 行）。行 id 为 `"文件路径::行号"`。

| 字段名                                                                         | 类型         | 说明                                                                                                                      | 可写 |
| ------------------------------------------------------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------- | ---- |
| `status`                                                                       | text         | 状态字符：`' '`(待办) / `'x'`(完成) / `'-'`(取消) / `'/'`(进行中) / `'>'`(转发) / `'!'`(重要) / `'?'`(疑问) / `'<'`(计划) | 是   |
| `content`                                                                      | text         | 任务正文（去掉状态标记）                                                                                                  | 是   |
| `text`                                                                         | text         | 原始整行（含 `- [ ]` 前缀）                                                                                               | 是   |
| `tags`                                                                         | multi-select | 行内 `#tags`                                                                                                              | 否   |
| `number`                                                                       | number       | 文件内 0 起行号                                                                                                           | 否   |
| `parent`                                                                       | number       | 父任务行号（-1 = 顶层）                                                                                                   | 否   |
| `file.path` / `file.name` / `file.basename` / `file.extension` / `file.parent` | text         | 所属文件信息                                                                                                              | 否   |
| `file.tags`                                                                    | multi-select | 所属文件标签                                                                                                              | 否   |
| `file.ctime` / `file.mtime`                                                    | datetime     | 所属文件时间                                                                                                              | 否   |

任务行还附带 Tasks 插件的 emoji 日期字段（`✅` 完成时间、`➕` 创建时间、`📅` / `📆` / `🗓` 截止、`🛫` 开始、`⏳` / `⌛` 计划、`❌` 取消），只读。task 源**不支持新建任务**。

### 可写性规则

| 场景                                                          | 可写                        |
| ------------------------------------------------------------- | --------------------------- |
| 文件库 frontmatter 字段（自定义属性）                         | 是（写回文件 frontmatter）  |
| `file.basename`                                               | 是（改文件名，会改变行 id） |
| `aliases`、`cssclasses`                                       | 是                          |
| 其余 `file.*` 内置字段                                        | 否                          |
| formula 字段                                                  | 否（计算得出）              |
| 任务库 `status` / `content` / `text`                          | 是                          |
| 任务库其余字段（`number` / `parent` / `file.*` / emoji 日期） | 否                          |

## select / multi-select

选项存在 `options.items`，每项为 `{ value, color }`：

```json
{
  "name": "priority",
  "type": "select",
  "options": {
    "items": [
      { "value": "高", "color": "red" },
      { "value": "中", "color": "yellow" },
      { "value": "低", "color": "gray" }
    ]
  }
}
```

| 字段    | 说明                                                                                                                         |
| ------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `value` | 字符串，选项的值，同时也是显示文本                                                                                           |
| `color` | 可选，默认 `default`。枚举：`default` / `gray` / `orange` / `yellow` / `green` / `teal` / `blue` / `purple` / `pink` / `red` |

multi-select 的单元格值为字符串数组（单值自动包成数组）。选项按 `value` 去重。

## reference

`reference`（查询引用）是 file source 的查询候选字段。它不是另一个数据库的外键，也不会在来源变化时自动改写已保存的值。进入单元格编辑时，它根据 `options.filter` 查询当前 source 和字段定义建模出的全部记录，不继承数据库全局筛选、视图筛选、搜索、排序、分组或行数限制；再从每条记录投影 `options.valueField` 作为候选值。

```json
{
  "name": "city",
  "type": "reference",
  "options": {
    "valueField": "city",
    "multiple": false,
    "filter": {
      "id": "city-candidates",
      "type": "group",
      "join": "and",
      "items": [
        {
          "id": "china-cities",
          "type": "expression",
          "expression": "country == \"CN\""
        }
      ]
    }
  }
}
```

| 字段                 | 说明                                                   |
| -------------------- | ------------------------------------------------------ |
| `options.filter`     | 可选 `FilterItem`；省略时查询全部建模记录              |
| `options.valueField` | 从查询结果投影的字段名，默认 `file.path`               |
| `options.multiple`   | 是否允许多选，默认 `false`；只决定最终写入标量还是数组 |

筛选表达式与数据库的普通 filter 使用相同语义：裸字段和 `$item` 都表示当前接受筛选的记录。例如 `status == "active"`。`status` 字段也可以通过 `valueField: "status"` 收集查询结果中的已有状态。

普通 `valueField` 保持其标量类型；数组字段会展开为独立候选并按“类型 + 值”去重。空值和对象不进入候选。`multiple: true` 把最终选择写成数组，不会把数字、布尔值静默转换为字符串。

`file.path`、`file.basename`、`file.name` 是特殊文件标记：三者都会根据候选记录的真实文件和当前行路径生成 Obsidian 双链，而不是写入普通路径或文件名字符串。双链可能为了消歧包含路径或别名，不应手工拼接。

候选列表不能创建任意值；已经保存但后来不再满足查询的值仍会保留，用户可继续查看或删除。查询集和来源属性变化只影响下一次打开时的候选，不自动更新、清理或替换已写入的 frontmatter。V1 不包含 Lookup 或反向关系。

## date / datetime

```json
{ "name": "deadline", "type": "date", "options": { "format": "YYYY-MM-DD" } }
```

`options.format` 为 [moment.js](https://momentjs.com/docs/#/displaying/format/) 格式串，可选。常用预设：

- date：`YYYY-MM-DD`、`YYYY-MM-DD ddd`、`GGGG-[W]WW`、`YYYY-MM`、`MMMM YYYY`、`YYYY-[Q]Q`、`LL`
- datetime：`YYYY-MM-DD HH:mm`、`YYYY-MM-DD HH:mm:ss`、`LLL`、`LLLL`

## button

单元格里渲染一个按钮，点击后串行执行 `actions`。按钮字段是唯一具有当前行上下文的 Action 入口。

```json
{
  "name": "完成",
  "type": "button",
  "options": {
    "icon": "Check",
    "actions": [
      {
        "id": "complete",
        "type": "update-row",
        "updates": [
          { "id": "status", "field": "status", "operation": "set", "mode": "literal", "value": "DONE" },
          {
            "id": "done-time",
            "field": "doneTime",
            "operation": "set",
            "mode": "formula",
            "formula": "moment().format('YYYY-MM-DDTHH:mm:ss')"
          }
        ]
      }
    ]
  }
}
```

| 字段              | 说明                                                           |
| ----------------- | -------------------------------------------------------------- |
| `options.icon`    | 按钮图标，camelCase Lucide 名。按钮文本为字段 `name`           |
| `options.actions` | Action 数组，每项必须有唯一 `id`；按顺序串行执行，首个错误中断 |

内置支持更新/删除属性、移动/删除记录、创建/打开文件、命令、集成、Prompt 和 Script；也可使用插件注册且 scopes 包含 `button-field` 的自定义 Action。完整 schema、入口能力矩阵、Script bindings，以及移动/重命名后的 `$item.file.path` 语义见 [actions.md](actions.md)。不再使用 `options.steps`、`inline-formula` 或直接操作 Obsidian FileManager 的动作函数。

## formula

填写 `formula` 的字段为只读计算字段，其值由一段表达式算出。

```json
{ "name": "总价", "type": "number", "formula": "price * quantity" }
```

formula 字段**只读**，不能编辑。`type` 不是必须，但建议给日期、数字、布尔结果补上结果类型，方便筛选、日历、甘特等视图正确理解它。先理解几类表达式的区别，可看 [expressions.md](expressions.md)。

### 求值上下文（行级）

formula 在**行级上下文**求值（对每一行求值一次）。作用域变量：

| 变量         | 说明                                                               |
| ------------ | ------------------------------------------------------------------ |
| `$item`      | 当前行数据对象                                                     |
| 所有字段名   | 直接作为变量，等价于从 `$item` 取值（如 `price` 即 `$item.price`） |
| `moment`     | Moment.js                                                          |
| `thisFile`   | 数据库所在笔记（FileIndex），不一定可用                            |
| `activeFile` | 当前打开的笔记（FileIndex），不一定可用                            |

表达式是一段 JavaScript，**不带 `return`、不带分号**，会被包成 `return (<表达式>)` 求值。结果为 `null` / `undefined` 时单元格显示为空。

### 聚合函数

行级上下文注入以下函数（常配合数组字面量使用）：

| 函数                    | 作用          |
| ----------------------- | ------------- |
| `sum(arr)`              | 数值求和      |
| `avg(arr)`              | 数值平均      |
| `min(arr)` / `max(arr)` | 最小 / 最大值 |
| `count(arr)`            | 元素个数      |
| `distinct(arr)`         | 去重数组      |
| `countEmpty(arr)`       | 空元素个数    |
| `countNotEmpty(arr)`    | 非空元素个数  |

### `$item.file.*`

```js
$item.file.basename; // 文件名（不含后缀）
$item.file.path; // 完整路径
$item.file.tags; // 标签数组
$item.file.ctime; // 创建时间（毫秒）
$item.file.mtime; // 修改时间
$item.file.size; // 字节大小
$item.file.textStats.words; // 单词数
$item.file.tasks; // 任务列表
$item.file.backlinks; // 反链文件路径
```

完整字段见上文 file 源内置字段表。

### `thisFile` / `activeFile`

Vault Files 数据库可以在 formula 和筛选中读取数据库所在文件与当前活动文件。对象形状与 FileIndex 一致：

```js
thisFile.file.basename;
activeFile.file.path;
thisFile.author; // frontmatter 键平铺在 FileIndex 根部
```

formula 使用这里展示的 JavaScript 属性访问。筛选使用独立的动态公式 DSL，并额外提供 `thisFile.frontmatter.author` 这一只读兼容视图；详见 [filter.md#字段与对象](filter.md#字段与对象)。上下文无法解析到文件时，变量值为 null。

### 示例

```js
// 跨字段计算
price * quantity;

// 格式化日期
moment($item.file.ctime).format('YYYY-MM-DD');

// 带单位的格式化
(((revenue - cost) / revenue) * 100).toFixed(1) + '%';

// 距今天数
moment($item.renewDate).diff(moment(), 'days');

// 状态标记
moment($item.renewDate).diff(moment(), 'days') <= 7 && $item.status !== 'cancelled';

// 聚合判断单个值
countNotEmpty([$item.file.tags]) > 0;
```

> `group.summary` 由 formula 表达式引擎在聚合上下文中求值（见 [group.md#summary](group.md#summary)）。筛选 `expression` 使用单独的动态公式 DSL，只执行白名单 Operation，不执行 JavaScript（见 [filter.md#expression-dsl](filter.md#expression-dsl)）。
