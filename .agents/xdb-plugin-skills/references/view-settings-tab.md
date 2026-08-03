# View Settings Tab

为数据库视图的 settings 面板**新增一个独立的 tab item**——每个 tab 有自己的 `label` / `icon`，点进去是独立内容页。

settings 面板统一是 tab 结构：

- 所有视图都自带共享的 `View` tab（不可注册替换）。
- `registerViewSettings()` 只能往共享 `View` tab 里**加内容**，不会新增 tab item——见 [view-settings](view-settings.md)。
- `registerViewSettingsTab()` 才用于**新增一个独立 tab item**，`tabId` 只属于这个接口。

| 接口                        | 做什么                       | 有没有自己的 tab item |
| --------------------------- | ---------------------------- | --------------------- |
| `registerViewSettings()`    | 扩展共享 `View` tab 里的内容 | 否                    |
| `registerViewSettingsTab()` | 新增一个独立 tab item        | 是                    |

## 配置位置

`viewDefinition.options`

## 注册接口

```ts
type ViewSettingsTabExtension = {
  /** tab 扩展自身的唯一注册 id */
  id: string;
  /**
   * tab UI 和 defaultTab 路由使用的稳定值；省略时使用 id。
   * 多个 view type 可以各自注册 id 不同但 tabId 相同的 tab，例如 'filter'。
   */
  tabId?: string;
  /** tab item 显示文案 */
  label: string;
  /** camelCase 的 Lucide 名称 */
  icon?: string;
  /** 声明适用于哪些 view type；省略表示对所有 view type 生效（通用 tab） */
  viewTypes?: string[];
  settings: () => {
    /** 首次渲染和后续配置变化时调用 */
    onUpdate: (props: ViewSettingsTabProps) => void;
    onDestroy: () => void;
  };
};
```

## props

[公共上下文 props](conventions.md#公共上下文-props) 外加（`ViewSettingsTabProps` 继承自 `ViewSettingsProps`）：

> 公共上下文 API（`dailyNotes` / `markdown` / `files` / `tasks`）统一见 [types.md 的「公共上下文」](types.md#公共上下文xdbcontextprops)。

```ts
type ViewSettingsTabProps = ViewSettingsProps & {
  /** 关闭整个 settings 面板 */
  close?: () => void;
};

type ViewSettingsProps = XdbContextProps & {
  /** 当前 tab 内容的挂载容器 */
  container: HTMLElement;
  /** 数据库读写入口，能力见 types/database.md */
  api: Database;
  /** 结构见 xdb-view.md#viewdefinition */
  viewDefinition: viewDefinition;
  /** 传完整 viewDefinition 或 updater 函数，持久化写回 */
  setViewDefinition: (updater: unknown) => Promise<void>;
  /** 复用宿主 setting 组件的命令式 builder，见下文「优先使用 props.setting」 */
  setting: SettingUi;
};
```

> `ViewSettingsTabProps` 继承自 `ViewSettingsProps`，因此也拥有 `setting`。

## 优先使用 `props.setting`

和 View Settings、Field Settings、Action editor 一样，普通输入/开关/选择器等设置项**必须优先**通过 `props.setting.*` 声明，由宿主渲染为标准设置组件；不要手工拼 `setting-item` DOM。完整方法表见 [view-settings 的「复用宿主 setting 组件」](view-settings.md#复用宿主-setting-组件propsetting)。只有图表、第三方库挂载等 `props.setting` 表达不了的渲染，才退回 `props.container` 裸 DOM。

## 示例

为 chart 视图新增一个 "Advanced" tab，里面放一个开关，通过 `props.setting` 写回 view 配置：

```js
ctx.registerViewSettingsTab({
  id: 'chart-settings:advanced',
  tabId: 'advanced',
  label: 'Advanced',
  icon: 'Code2',
  viewTypes: ['chart'],
  settings() {
    return {
      onUpdate(props) {
        const options = props.viewDefinition.options ?? {};
        props.setting.switch({
          key: 'debug',
          label: 'Debug',
          value: options.debug === true,
          onChange: (v) => {
            void props.setViewDefinition((current) => ({
              ...current,
              options: { ...(current.options ?? {}), debug: v },
            }));
          },
        });
      },
      onDestroy() {},
    };
  },
});
```

## 实现要求

- 适用范围用 `viewTypes` 声明，**不要**在 `onUpdate(props)` 里手写 `if (props.viewDefinition.type !== 'xxx') return;`
- 持久化写入通过 `setViewDefinition(...)`
- 普通设置项优先 `props.setting.*`，不要手工拼 `setting-item` DOM；仅图表/第三方库挂载等场景才用 `props.container`
- **不要**注册 `tabId: 'view'` 来替换共享 `View` tab——每个视图天然拥有 `View` tab，额外的配置入口才走本接口

```js
// 只对 chart 视图生效
ctx.registerViewSettingsTab({
  id: 'chart-advanced',
  tabId: 'advanced',
  label: 'Advanced',
  viewTypes: ['chart'],
  settings: () => ({ onUpdate() {}, onDestroy() {} }),
});

// 对所有视图生效（省略 viewTypes）
ctx.registerViewSettingsTab({
  id: 'common-notes',
  tabId: 'notes',
  label: 'Notes',
  settings: () => ({ onUpdate() {}, onDestroy() {} }),
});
```
