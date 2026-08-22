# list

## 视图简介

紧凑单行列表视图，每行显示一个标题与内联属性。

## 适用场景

- 标题列表、大纲式概览。
- 树形层级浏览。

## 专属配置

完整定义以 [View Schema](view-schema.md#list) 为准。List 没有专属 `options`。

list 无专属 `options`，完全由公共字段驱动。

```ts
interface ListViewDefinition extends DatabaseViewDefinition {
  type: 'list';
}
```

渲染规则：

- `visibleFields` 第一个字段为行标题（主显示）。
- 其余字段作为内联属性显示在标题右侧（空值不显示）。
- 每行前有圆点标记；有子节点的行显示树形展开三角。

list 支持 `filter` / `sort` / `group` / `tree` / `limit` / `linkOpenMode`。list 不渲染列汇总 `summary`（用 `group.summary` 代替）。

## 最佳实践

- 把标题字段放在 `visibleFields` 第一位。
- 配 `tree` 做目录树 / 子任务列表。
