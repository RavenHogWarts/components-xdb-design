# Waterfall

## 何时使用

瀑布流把每行显示成自适应宽度、不同高度的卡片。适合内容预览、研究资料、灵感、作品或长短不一的笔记；需要固定等高封面网格时使用 `gallery`。

Waterfall 会先显示文件内容预览，再显示 `visibleFields`。它按 View 的 filter、sort 和 limit 读取数据，但不展示 group 层级。

## 专属配置

完整定义以 [View Schema](view-schema.md#waterfall) 为准。这里说明 Waterfall 的卡片用法。

```json
{
  "id": "research-waterfall",
  "name": "研究资料",
  "type": "waterfall",
  "visibleFields": ["file.basename", "status", "tags"],
  "sort": [{ "field": "file.mtime", "direction": "desc" }],
  "options": {
    "minCardWidth": 220,
    "maxCardWidth": 300,
    "cardMaxHeight": 480,
    "hideFieldName": false
  }
}
```

| option          | 默认值  | 范围 / 说明                                           |
| --------------- | ------- | ----------------------------------------------------- |
| `minCardWidth`  | `220`   | `100–800` px，卡片最小宽度；越界读取时钳制            |
| `maxCardWidth`  | `300`   | `100–800` px；若小于 min，有效 max 在布局时提升到 min |
| `cardMaxHeight` | `480`   | `180–1200` px，内容预览最大高度；越界读取时钳制       |
| `hideFieldName` | `false` | `true` 时只显示字段值                                 |

内置尺寸预设对应：small `160–220`、medium `220–300`、large `300–420`。

## 使用建议

- 把最重要的 2–4 个字段放进 `visibleFields`；字段过多会让卡片失去浏览效率。
- 内容差异大时用 Waterfall；需要稳定对齐、统一封面比例时用 Gallery。
- 用 `sort` 决定阅读顺序；不要依赖列间的视觉位置表达严格全局顺序。
- 数据量大时配 `limit`，由界面的 Load more 继续加载。
