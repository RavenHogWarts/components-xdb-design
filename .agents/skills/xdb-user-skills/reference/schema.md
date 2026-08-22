# `.xdb` Schema

本页是 `.xdb` 持久化结构的总入口。先按这里确定大框架和共享小结构，再到 [View Schema](view-schema.md) 选择具体视图；专题页只解释用法。

## 四层结构

```text
DatabaseDefinition
├─ 固定根字段：source / fields / filter / views / rootGroup / options
├─ DatabaseViewDefinition：每个 View 都有的固定外壳
├─ 内置 View 扩展：由 type 决定的专属字段
└─ 插件扩展：开放的 View type、Field type、Action type 及其私有配置
```

判断字段归属时按这个顺序：

1. 先找根级或共享 View 字段。
2. 再查对应内置 View 的专属 schema。
3. 仍未定义的内容只能来自已安装插件；没有插件 schema 就不生成。

修改已有 `.xdb` 时，只改目标字段。未知 View、Field、Action 及未知 `options` key 原样保留，不把“不认识”当成“无效”。

## DatabaseDefinition

```ts
interface DatabaseDefinition {
  source?: string;
  fields: DatabaseFieldDefinition[];
  filter?: FilterItem;
  views?: DatabaseViewDefinition[];
  rootGroup?: RootGroupDefinition;
  options?: Record<string, unknown>;
}
```

| 字段        | 必填 | 含义与约束                                                                                                        |
| ----------- | ---- | ----------------------------------------------------------------------------------------------------------------- |
| `source`    | 否   | 数据源 id。内置值为 `file`、`task`；省略按 `file`。不要生成未安装的数据源 id。                                    |
| `fields`    | 是   | 全库共享字段数组。`name` 必须非空且唯一；完整字段 schema 见 [fields.md](fields.md)。                              |
| `filter`    | 否   | 全库范围，先于所有 View filter 执行。必须以 `group` 为根；见 [filter.md](filter.md)。                             |
| `views`     | 否   | 扁平 View 数组。每项的 `id` 必须非空且唯一；层级由 `parentId` 建立。省略或空数组表示没有 View。                   |
| `rootGroup` | 否   | 组织所有根 View；它不是 `views` 中的 View。省略时使用 tabs。                                                      |
| `options`   | 否   | 数据库实现拥有的扩展袋，按实现名分区，例如 `options.vaultFiles`。不要把普通 View 配置写到这里，也不要改未知分区。 |

最小有效结构：

```json
{
  "fields": []
}
```

实际交付通常显式写出 `source` 和 `views`，让用途更容易读懂。

## DatabaseFieldDefinition

```ts
interface DatabaseFieldDefinition {
  name: string;
  type?: string;
  formula?: string;
  options?: Record<string, unknown>;
}
```

| 字段      | 必填 | 含义与约束                                                                                                    |
| --------- | ---- | ------------------------------------------------------------------------------------------------------------- |
| `name`    | 是   | 属性名，在 `fields` 内唯一。                                                                                  |
| `type`    | 否   | Field type id；省略按文本处理。内置类型及值形态见 [fields.md](fields.md)。这是开放字符串，插件可注册新 type。 |
| `formula` | 否   | 行级计算表达式。存在时字段只读；新建公式字段同时写 `type: "formula"`。已有其它 type + formula 的配置仍兼容。  |
| `options` | 否   | 当前 Field type 拥有的配置。内置类型按 [fields.md](fields.md)；第三方类型按插件 schema。                      |

## DatabaseViewDefinition

每个 View 先满足这个固定外壳，再叠加 [View Schema](view-schema.md) 中由 `type` 决定的专属字段。

```ts
interface DatabaseViewDefinition {
  id: string;
  name: string;
  type: string;

  parentId?: string | null;
  icon?: string;
  style?: DatabaseViewStyle;
  layouts?: Record<string, Layout>;

  visibleFields?: string[];
  filter?: FilterItem;
  sort?: SortDefinition[];
  group?: DatabaseViewGroupDefinition;
  summary?: Record<string, AggregateConfiguration>;
  newRowAction?: Action;
  newRowFile?: DatabaseViewNewRowFileDefinition;
  linkOpenMode?: ObsidianLinkOpenMode;
  tree?: DatabaseViewTreeDefinition;
  limit?: number;

  options?: Record<string, unknown>;
}
```

### 固定身份与布局

| 字段       | 必填 | 含义与约束                                                                                                                                                                               |
| ---------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`       | 是   | 稳定且非空，在 `views` 中唯一。引用关系和布局都依赖它；修改已有 View 时不要顺手重建 id。                                                                                                 |
| `name`     | 是   | 用户看到的名称。Reference View 的 `targetViewName` 也按名称定位目标根 View。                                                                                                             |
| `type`     | 是   | View type id。内置值见 [View Schema](view-schema.md)；它是开放字符串，但新 type 必须由已安装插件注册。                                                                                   |
| `parentId` | 否   | 省略或 `null` 表示根 View；字符串必须指向已存在的 `type: "group"` View。不能指向自身或形成环。                                                                                           |
| `icon`     | 否   | Lucide 图标名，用于 tab、标题或设置入口。                                                                                                                                                |
| `style`    | 否   | 当前 View 的局部主题与 CSS；只含 `light`、`dark`、`css`，见 [view-style.md](view-style.md)。                                                                                             |
| `layouts`  | 否   | 当前 View 在其 dashboard 父容器中的位置。内置断点只有 `laptop`、`mobile`；tabs 和 vertical-tabs 不读取布局，但修改已有文件时仍保留未知值。把 View 移到其它父容器后，重新检查这里的坐标。 |

### 数据投影与交互

| 字段            | 必填 | 含义与约束                                                                                                                              |
| --------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `visibleFields` | 否   | 字段名及顺序。只影响展示，不改变全局 `fields`；不同 View 会把第一项当标题或主标签。                                                     |
| `filter`        | 否   | 当前 View 的附加筛选，在全局 filter 之后执行；见 [filter.md](filter.md)。                                                               |
| `sort`          | 否   | 排序优先级数组；先写的规则优先。`direction` 省略为 `asc`。                                                                              |
| `group`         | 否   | 行分组定义，不是布局容器；`by` 顺序就是嵌套顺序。见 [group.md](group.md)。                                                              |
| `summary`       | 否   | `字段名 -> 聚合配置`。当前内置 UI 由 table 显示为列汇总；内置聚合的字段由外层 key 确定，因此对象里省略 `field`。                        |
| `newRowAction`  | 否   | 替代 source 默认创建的单个 Action，没有当前行；见 [new-row-action.md](new-row-action.md)。                                              |
| `newRowFile`    | 否   | `file` source 当前 View 默认创建时的文件草稿。与 `newRowAction` 独立；后者存在时本次创建不使用它。                                      |
| `linkOpenMode`  | 否   | `tab`、`split`、`window`、`current`、`none`、`modal-center`、`modal-right`、`modal-left`；数据 View 默认新 tab。                        |
| `tree`          | 否   | 树形关系；`parentField` 指向能解析父行引用的字段。是否能拖拽改父级还取决于该字段是否可写。                                              |
| `limit`         | 否   | 初始显示行数；只对实现了分页/Load more 的数据 View 有意义。                                                                             |
| `options`       | 否   | 当前 View type 拥有的扩展袋。内置结构见 [View Schema](view-schema.md)；第三方结构必须以插件文档为准。修改时合并并保留未知 sibling key。 |

`DatabaseViewDefinition` 允许这些字段存在，不表示每个 View 都会消费它们。Plain View 不读取行数据；数据 View 的实际能力见 [View 能力矩阵](view-schema.md#view-能力矩阵)。

## 共享小 Schema

### SortDefinition

```ts
interface SortDefinition {
  field: string;
  direction?: 'asc' | 'desc';
}
```

- `field` 必须是可用字段名。
- `direction` 省略为升序。
- 空数组等同于没有排序；不要把 `group.by[].sort` 和行排序混为一谈。

### Layout

```ts
interface Layout {
  x: number;
  y: number;
  w: number;
  h: number;
}
```

Dashboard 使用 `laptop` 24 列、`mobile` 4 列。保证 `x >= 0`、`y >= 0`、`w > 0`、`h > 0`，且 `x + w` 不超过当前列数；同一父容器的卡片不要重叠。

### DatabaseViewStyle

```ts
interface DatabaseViewStyle {
  light?: Record<string, string>;
  dark?: Record<string, string>;
  css?: string;
}
```

- `light` 是所有主题的基础 CSS custom property map；每个 value 必须是非空 CSS 字符串。
- `dark` 只覆盖 Dark 模式下的同名 key；没有写的 key 继续使用 `light`。
- `css` 是限定在当前 View root 的原生 CSS，不要把它写到 `style` 外层。
- 三项都可省略。完整继承、Token 和 CSS scope 见 [view-style.md](view-style.md)。

### RootGroupDefinition

```ts
interface RootGroupDefinition {
  type?: 'tabs' | 'vertical-tabs' | 'dashboard';
  options?: {
    sidebarWidth?: number;
    locked?: boolean;
  };
  style?: DatabaseViewStyle;
}
```

- `type` 省略为 `tabs`。
- `sidebarWidth` 只用于 vertical-tabs；`locked` 只用于 dashboard。
- `rootGroup` 只组织根 View。局部嵌套才使用 `type: "group"`，见 [view-group.md](view-group.md)。

### DatabaseViewNewRowFileDefinition

```ts
interface DatabaseViewNewRowFileDefinition {
  path?: string;
  properties?: Record<string, unknown>;
  content?: string;
}
```

- `path` 是 vault 相对路径模板；省略时由 source 推导。
- `properties` 是完整 frontmatter 草稿，不是 patch。省略才允许 source 从 filter 推导；空对象表示明确不写属性。
- `content` 是不含 frontmatter 的 Markdown 正文；省略时使用 source 默认正文。

### DatabaseViewTreeDefinition

```ts
interface DatabaseViewTreeDefinition {
  parentField: string;
}
```

`parentField` 必须能解析出另一行的 id。只有 Table 和 List 内置展示树形层级。

Filter、Group、Aggregate、Action 和 Style 各自结构较大，直接使用对应权威页：

- [filter.md](filter.md)
- [group.md](group.md)
- [aggregate.md](aggregate.md)
- [actions.md](actions.md)
- [view-style.md](view-style.md)

## 固定与扩展边界

| 层级       | 固定部分                                                | 扩展部分                                                                     |
| ---------- | ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Database   | `fields`、共享 filter、`views`、`rootGroup` 的含义      | `source` 可由宿主增加；根 `options` 由数据库实现按名字分区                   |
| Field      | `name/type/formula/options` 外壳                        | `type` 是已注册 id；`options` schema 由该 type 拥有                          |
| View       | `id/name/type`、层级、布局和共享数据字段                | `type` 是已注册 id；专属顶层字段或 `options` schema 由该 View extension 拥有 |
| Action     | 扁平 `{ type, ...payload }`；列表入口另加稳定唯一 `id`  | `type` 和 payload 由 Action extension 拥有                                   |
| Card cover | `cover` 选择 extension；`coverAspectRatio` 等为公共外壳 | `extensionData` 只属于当前 cover extension                                   |

操作规则：

- 新建配置：只使用内置 schema，或用户明确提供的已安装插件 schema。
- 修改配置：保留所有不在本次目标内的未知 key，包括未知 `type` 对应的完整对象。
- 插件缺失：不要猜测 payload，不要替换为“相近”内置 type；列出依赖并在真实宿主验证。
- Validator 对未知 View/Action 只能提示，不能证明插件 schema 正确。
