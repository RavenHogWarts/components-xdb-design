# gallery

## 视图简介

画廊视图，以响应式卡片网格呈现行数据，主打封面视觉浏览。

## 适用场景

- 图片库、设计稿库、相册。
- 书影音媒体库（封面海报）。
- 任何以封面图为主的浏览场景。

## Schema

```ts
interface GalleryViewDefinition extends DatabaseViewDefinition {
  type: 'gallery';
  options?: CardViewOptions;   // 共享卡片配置，见 card-cover.md
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `options.cardSize` | `number` | 否 | 卡片目标宽度（像素），100–600，默认 `220`。列数据此自动计算（响应式，非固定列数） |
| `options.hideFieldName` | `boolean` | 否 | 卡片上是否隐藏字段名只显示值，默认 `false` |
| 卡片封面相关 | | 否 | `cover` / `coverAspectRatio` / `coverObjectFit` / `extensionData`，见 [card-cover.md](card-cover.md) |

`visibleFields` 决定卡片上显示的字段。

gallery 支持 `filter` / `sort` / `group`（可选，配了显示分组头）/ `limit` / `linkOpenMode`，不支持 `tree`。

## 最佳实践

- 配 `cover`（`first-image` / `field-image`）+ `coverAspectRatio` 做图墙。封面配置见 [card-cover.md](card-cover.md)。
- `cardSize` 控制每行卡片数：调小则每行多放，调大则卡片更大。
