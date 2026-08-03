# Field Settings

为字段详情面板追加插件设置。Field Settings 与 renderer 解耦：它拿到最新字段 definition，自己决定是否匹配，并把配置写回字段。

## 注册契约

```ts
type DatabaseFieldSettingsMatchContext = {
  api: Database;
  field: DatabaseFieldDefinition;
  isBuiltInField: boolean;
};

type DatabaseFieldSettingsExtension = {
  id: string;
  /** 越小越靠前；省略为 0。 */
  order?: number;
  /** 同步、无副作用。 */
  match(context: DatabaseFieldSettingsMatchContext): boolean;
  settings: () => ViewInstance<DatabaseFieldSettingsProps>;
};
```

## 匹配与顺序

Field Settings 是**叠加**关系，不是 renderer 的首个命中关系：

1. 宿主执行全部 matcher。
2. matcher 抛错时记录错误并跳过该扩展。
3. 所有命中项按 `order` 升序渲染；同值保持注册顺序。

通常 renderer 与 settings 复用同一个 matcher，但两者不靠 id 绑定：

```js
const matchesSummary = ({ field }) => field.name === 'Summary';
```

## Settings props

[公共上下文 props](conventions.md#公共上下文-props) 外加：

```ts
type FieldDefinitionUpdate = DatabaseFieldDefinition | ((current: DatabaseFieldDefinition) => DatabaseFieldDefinition);

type DatabaseFieldSettingsProps = XdbContextProps & {
  container: HTMLElement;
  api: Database;
  viewId: string;
  field: DatabaseFieldDefinition;
  setFieldDefinition(update: FieldDefinitionUpdate): void | Promise<void>;
  /** 复用宿主标准 setting 组件的命令式 builder。 */
  setting: SettingUi;
};
```

优先使用 functional updater。宿主会在执行时解析最新 definition，避免长生命周期 settings 用旧快照覆盖其他更新：

```js
void props.setFieldDefinition((current) => ({
  ...current,
  options: {
    ...(current.options ?? {}),
    'my-plugin': {
      heading: '## Summary',
    },
  },
}));
```

## 使用标准设置项

普通输入、开关、选择器等设置必须优先通过 `props.setting` 声明，由宿主渲染为标准设置组件。不要手工拼
`setting-item` DOM：

```js
settings: () => ({
  onUpdate(props) {
    const options = props.field.options?.['heading-content-field'] ?? {};

    props.setting.input({
      key: 'heading',
      label: 'Heading',
      placeholder: '## Summary',
      value: typeof options.heading === 'string' ? options.heading : '',
      onChange: (heading) => {
        void props.setFieldDefinition((current) => ({
          ...current,
          options: {
            ...(current.options ?? {}),
            'heading-content-field': {
              ...(current.options?.['heading-content-field'] ?? {}),
              heading,
            },
          },
        }));
      },
    });

    props.setting.switch({
      key: 'includeSubHeadings',
      label: 'Include subheadings',
      value: options.includeSubHeadings === true,
      onChange: (includeSubHeadings) => {
        void props.setFieldDefinition((current) => ({
          ...current,
          options: {
            ...(current.options ?? {}),
            'heading-content-field': {
              ...(current.options?.['heading-content-field'] ?? {}),
              includeSubHeadings,
            },
          },
        }));
      },
    });
  },
  onDestroy() {},
});
```

`onUpdate` 是一次设置声明：相同 `key` 会更新已有项，本轮没有再次声明的项会被移除。只有标准组件无法表达
的定制内容才使用 `props.container`。

Field Settings 与 View Settings、Action editor 复用同一个 `SettingUi`。完整方法包括
`switch / input / numberInput / select / picker / combobox / autocomplete / fileAutocomplete / fileCombobox /
imageAutocomplete / folderAutocomplete / folderCombobox / propertyAutocomplete / propertyCombobox /
fieldAutocomplete / action / popover / title / description / divider / custom`；参数和选择建议见
[View Settings 的 Setting UI 参考](view-settings.md#复用宿主-setting-组件propssetting)。

## 配置位置

Field Renderer/Settings 的私有配置放在 `field.options` 下。推荐用一个稳定的 key（例如插件 id）收纳，避免覆盖其他插件或宿主的配置：

```yaml
- name: Summary
  type: heading-content
  options:
    heading-content-field:
      heading: '## Summary'
      includeSubHeadings: true
```

settings 只由宿主提供持久化出口，不解释 `options` 内容，更新时必须保留其他 `field.options` key。

不要把配置写入模块变量或 DOM dataset。

## 宿主仍负责的设置

字段名、Field Type 选择器、view 可见性、换行、排序、冻结、插入和删除仍由宿主控制。插件可以通过
`registerFieldType()` 向类型目录贡献选项，但选择器布局和字段 definition 更新仍由宿主负责。匹配的第三方
settings 渲染在通用字段设置之后、危险操作之前。

rename 只执行普通字段重命名；宿主不会迁移、删除或重写插件配置。新的字段 definition 会重新触发 settings 和 renderer 匹配。

## 完整示例

[heading-content-field.xdb.js](../examples/heading-content-field.xdb.js) 使用标准 Heading 输入和 Include
subheadings 开关，并通过 functional update 只更新自己拥有的 `field.options` key。

## 常见错误

- 只取第一个匹配项：Field Settings 会渲染全部命中扩展。
- settings 直接修改 `props.field`：它是当前快照，必须通过 `setFieldDefinition()` 持久化。
- settings 用旧 `props.field` 构造完整对象：优先 functional updater。
- settings 覆盖整个 `options`：要保留其他 key。
- 为普通输入/开关手写 `setting-item` DOM：优先使用 `props.setting.input()` / `props.setting.switch()`。
