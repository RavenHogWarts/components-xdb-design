# Row Style Provider

根据行数据和当前 view 配置输出样式描述。

## 配置位置

通常读取 `viewDefinition.options`

## 注册接口

```ts
type RowStyleProvider = {
  /** provider 的唯一 id */
  id: string;
  name: string;
  /** 返回内联 style */
  style?: (ctx: RowStyleProviderContext) => Record<string, string | number> | null;
  /** 返回 className */
  className?: (ctx: RowStyleProviderContext) => string | string[] | null;
  /** 返回 data-* 这类根节点属性 */
  attributes?: (ctx: RowStyleProviderContext) => Record<string, string | number | boolean | null | undefined> | null;
};

type RowStyleProviderContext = {
  /** 结构见 database-view.md#viewdefinition */
  viewDefinition: viewDefinition;
  /** 当前行的原始数据 $item（结构见 types.md） */
  item: Record<string, unknown>;
  /** 判断当前行是否匹配某个过滤条件 */
  matchesFilter(filter: FilterItem): boolean;
};
```

## 实现要求

- 输出 `className`、`style`、`attributes`
- **不直接操作 DOM**（这是扩展点的硬约束）
- 优先返回语义属性，再配合 `registerStyleSheet()`

推荐写法：

```js
ctx.registerDatabaseViewRowStyleProvider({
  id: 'status-row-style',
  name: 'Status Row Style',
  attributes({ item, viewDefinition }) {
    const options = viewDefinition.options ?? {};
    const field = options.statusField;
    if (!field) return null;

    const value = item[field];
    if (value == null) return null;

    return { 'data-row-status': String(value) };
  },
});
```

> 注意方法名是完整的 `registerDatabaseViewRowStyleProvider()`，没有更短的别名。
