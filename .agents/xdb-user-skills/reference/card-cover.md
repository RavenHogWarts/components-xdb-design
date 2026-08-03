# 卡片封面（card cover）

kanban / gallery / calendar（单日模式）的卡片可配置封面图。三者封面配置相同。

## 适用范围

| 视图 | 封面支持 | 说明 |
| --- | --- | --- |
| [kanban](view-kanban.md) | 支持 | 卡片顶部封面 |
| [gallery](view-gallery.md) | 支持 | 卡片顶部封面 |
| [calendar](view-calendar.md) | 支持 | 仅当未配 `endField`（单日卡片模式）时 |

## Schema

封面配置写在视图的 `options` 中（与 `cardSize` 同级）：

```ts
// 共享 CardViewOptions 的封面部分
interface CardCoverOptions {
  cover?: string;                          // 封面来源 id
  coverAspectRatio?: number;               // 宽高比（宽/高），0.5–3
  coverObjectFit?: string;                 // 'cover' | 'contain'
  extensionData?: Record<string, unknown>; // 当前封面来源的私有配置
  hideFieldName?: boolean;                 // 隐藏字段名只显示值
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `cover` | `string` | 否 | 封面来源 id，见下。缺省无封面 |
| `coverAspectRatio` | `number` | 否 | 宽高比，默认 `1.5`（1.6≈16:10，1.778≈16:9） |
| `coverObjectFit` | `'cover' \| 'contain'` | 否 | 图片填充方式，默认 `'cover'` |
| `extensionData` | `object` | 否 | 当前封面来源的私有配置，随 `cover` 而变 |
| `hideFieldName` | `boolean` | 否 | 卡片上隐藏字段名只显示值，默认 `false` |

切换 `cover` 来源时 `extensionData` 重置为 `{}`。

## 内置封面来源

### `first-image`

取笔记里的第一张图片作封面。无配置。

```json
"options": { "cover": "first-image", "coverAspectRatio": 1.5 }
```

### `content-preview`

预览笔记内容（图 / 视频 / 音频 / canvas / markdown）。

| extensionData key | 说明 |
| --- | --- |
| `heading` | Markdown 标题字符串（如 `"## 摘要"`），定位要预览的内容段落 |

```json
"options": { "cover": "content-preview", "extensionData": { "heading": "## 摘要" } }
```

### `field-image`

从某字段读取图片地址 / 路径作封面。

| extensionData key | 说明 |
| --- | --- |
| `field` | 字段名，该字段值为图片 URL / 路径 / wikilink |

```json
"options": { "cover": "field-image", "extensionData": { "field": "cover" } }
```

## 最佳实践

- 笔记正文嵌了图 → `first-image`。
- 预览笔记开头 / 某段内容 → `content-preview`。
- 有专门存图片路径的字段 → `field-image`。
