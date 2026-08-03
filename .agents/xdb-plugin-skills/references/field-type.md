# Field Type

注册一个可出现在字段类型选择器中的类型。Field Type 只负责类型目录与可选择性；渲染和设置通过
`registerFieldRenderer()` / `registerFieldSettings()` 独立注册，并按运行时字段组合。

## 注册契约

```ts
type DatabaseFieldTypeMatchContext = {
  api: Database;
  fieldName?: string;
};

type DatabaseFieldTypeExtension = {
  /** 持久化到 field.type 的稳定身份；同一 registry 内唯一。 */
  type: string;
  label: string;
  /** camelCase Lucide 名称，例如 star。 */
  icon: string;
  /** 越小越靠前；省略为 0。 */
  order?: number;
  /**
   * 只控制 picker 可用性；省略表示全部可选。
   * 同步、无副作用。
   */
  match?(context: DatabaseFieldTypeMatchContext): boolean;
};
```

`registerFieldType()` 返回 `boolean`。shape 不合法或 `type` 重复时返回 `false`；插件不应继续假设类型已经安装：

```js
const registered = ctx.registerFieldType({
  type: 'rating',
  label: 'Rating',
  icon: 'star',
  order: 50,
  match: ({ api }) => api.getDefinitionSnapshot().source !== 'task',
});
if (!registered) throw new Error('Could not register rating field type');
```

注册成功后，宿主持有一份不可变的 metadata 快照。不要在注册后修改原对象；变更 label、icon、order 或
match 时应更新插件文件并重新加载。

## 独立组合

三种字段扩展没有注册依赖：

- Field Type 可以没有专用 renderer；此时已持久化值使用 Text fallback。
- renderer 可以匹配 reserved、formula 或特定字段名，不要求存在同名 Field Type。
- settings 可以叠加到任意字段，不要求存在同名 Field Type 或 renderer。
- 三者不靠 id 绑定；Field Type 使用 `type` 作为身份，renderer/settings 各自使用 `id`。

一个完整类型通常在同一个 `install(ctx)` 中分别注册：

```js
const registered = ctx.registerFieldType({
  type: 'rating',
  label: 'Rating',
  icon: 'star',
});
if (!registered) throw new Error('Could not register rating field type');

ctx.registerFieldRenderer({
  id: 'my-plugin:rating-renderer',
  name: 'Rating renderer',
  match: ({ field }) => field.type === 'rating',
  isValueEmpty: (_field, value) => value == null,
  view: () => ({
    onUpdate(props) {
      props.container.textContent = String(props.value ?? '');
    },
    onDestroy() {},
  }),
});

ctx.registerFieldSettings({
  id: 'my-plugin:rating-settings',
  match: ({ field }) => field.type === 'rating',
  settings: () => ({
    onUpdate(props) {
      props.container.replaceChildren();
    },
    onDestroy() {},
  }),
});
```

## 可用性与卸载

`match()` 收到当前 `Database` 和可选 `fieldName`，适合按 source 或字段能力隐藏 picker 选项。返回 `false`
不会修改已持久化字段，也不会阻止 renderer/settings 继续匹配。matcher 抛错时宿主记录错误、跳过该类型并继续解析其它类型。

插件卸载后，宿主删除该插件拥有的类型注册。已有 `field.type` 保持原值：字段设置显示禁用的当前类型，
渲染找不到专用 renderer 时回退到 Text，不会静默改写 schema。

## 常见错误

- 把 renderer/settings 塞进 Field Type：它们是独立组合关系。
- 复用内置 `text / number / select / ...` type：内置 identity 已注册，第三方不能覆盖。
- 用动态或本地化文本作为 `type`：`type` 是持久化身份，必须稳定。
- 在 `match()` 中读文件或修改状态：matcher 必须同步且无副作用。
- 把 `match() === false` 当成权限拒绝：它只控制 picker，source 仍拥有实际写入能力。
