# markdown

## 视图简介

富文本视图，在视图中渲染一段自由编写的 Markdown。常用于仪表盘的标题、说明、引言。

## 适用场景

- 仪表盘的标题 / 引言 / 使用说明。
- 分组分隔（在 dashboard 里用一段标题文字隔开区块）。

## Schema

```ts
interface MarkdownViewDefinition extends DatabaseViewDefinition {
  type: 'markdown';
  options?: MarkdownViewOptions;
}

interface MarkdownViewOptions {
  markdown?: string;   // Markdown 文本
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `options.markdown` | `string` | 否 | Markdown 文本，缺省为空（该 key 被删除，不存空串） |

内容由 Obsidian MarkdownRenderer 渲染，支持标准 Markdown（标题 / 列表 / 表格 / 代码块）、`[[wikilink]]`、`![[嵌入]]`、图片。

**不支持**模板 / 字段注入（无 `$item` / 表达式）。要动态内容用 [metric](view-metric.md) / [charts](view-charts.md)。

markdown 不消费 `filter` / `sort` / `group` / `tree`。

## 最佳实践

- 在 dashboard 顶部用一行窄矮（如 6×2）的 markdown 作区块标题。
