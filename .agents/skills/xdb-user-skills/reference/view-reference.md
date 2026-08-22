# reference

## 视图简介

引用视图，把另一个 `.xdb` 文件的内容嵌入当前数据库。类似 Obsidian 的 `![[嵌入]]`。

## 适用场景

- 主库聚合多个子库的视图（"总览"页同时显示几个项目库的看板）。
- 复用一个已设计好的视图，不重复定义。

## 专属配置

完整定义以 [View Schema](view-schema.md#reference) 为准。这里说明目标链接和目标 View 的选择。

```ts
interface ReferenceViewDefinition extends DatabaseViewDefinition {
  type: 'reference';
  options?: XdbReferenceOptions;
}

interface XdbReferenceOptions {
  targetLink?: string; // 指向目标 .xdb 的 Obsidian 链接
  targetViewName?: string; // 目标视图名称
}
```

| 字段                     | 类型     | 必填 | 说明                                                                                    |
| ------------------------ | -------- | ---- | --------------------------------------------------------------------------------------- |
| `options.targetLink`     | `string` | 否   | 结构上可省略；要显示内容则必须提供指向 `.xdb` 的 Obsidian 链接（如 `"[[项目数据库]]"`） |
| `options.targetViewName` | `string` | 否   | 嵌入的目标视图**名称**（不是 id）。缺省嵌入整个目标（其标签组）                         |

- `targetLink` 用 Obsidian 链接（basename 级最短形式），随目标文件改文件夹保持有效，但目标文件**改名**时不自动同步。
- `targetViewName` 存的是视图名，对应 `![[file#viewName]]` 语义。
- 指定 `targetViewName` 时必须为目标库的**顶层视图**（`parentId` 为空）；嵌套视图不能单独嵌入。

reference 是引用型视图，不消费当前库的 `filter` / `sort` / `group` / `tree`。`name` / `icon` 用作当前库里这个引用面板的标题和图标。

## 最佳实践

- 总览仪表盘用 reference 聚合多个子库的视图。
- 目标文件改名后 `targetLink` 失效，需手动更新。
