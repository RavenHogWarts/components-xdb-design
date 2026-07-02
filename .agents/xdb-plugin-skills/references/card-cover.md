# Card Cover

为 gallery / card 视图提供封面渲染能力，以及对应的设置面板。两者通过**同一个 `id`** 绑定。

## 配置位置

`extensionData`，通过 `getData()` 读、`updateData()` 写。

## registerCardCoverView

渲染封面。props = [公共上下文](conventions.md#公共上下文-props) 外加：

```ts
type CardCoverProps = XdbContextProps & {
  /** 当前 cover 的挂载容器 */
  container: HTMLElement;
  /** 数据库读写入口，能力见 types.md */
  api: Database;
  /** 读私有配置 */
  getData: () => Readonly<Record<string, unknown>>;
  /** 写私有配置 */
  updateData: (update: unknown) => void;
  /** 当前卡片对应的原始行数据 */
  $item: Record<string, unknown>;
};
```

## registerCardCoverViewSettings

封面设置面板。`id` 必须等于对应 cover 扩展的 `id`。props = 公共上下文外加 `container`、`api`、`getData`、`updateData`。

## 示例

封面读 `$item` 里某个字段作为图片地址；设置面板让用户指定字段名，写回私有配置：

```js
const COVER_ID = 'image-cover';

ctx.registerCardCoverView({
  id: COVER_ID,
  name: 'Image Cover',
  view() {
    return {
      onUpdate(props) {
        const field = props.getData().field ?? 'cover';
        const url = props.$item[field];
        props.container.replaceChildren();
        if (!url) return;
        const img = document.createElement('img');
        img.src = String(url);
        props.container.appendChild(img);
      },
      onDestroy() {},
    };
  },
});

// 同一 id 绑定设置面板
ctx.registerCardCoverViewSettings({
  id: COVER_ID,
  settings() {
    return {
      onUpdate(props) {
        const current = props.getData().field ?? 'cover';
        props.container.replaceChildren();
        const input = document.createElement('input');
        input.value = current;
        input.placeholder = '字段名，如 cover';
        input.addEventListener('change', () => {
          props.updateData({ field: input.value });
        });
        props.container.appendChild(input);
      },
      onDestroy() {},
    };
  },
});
```
