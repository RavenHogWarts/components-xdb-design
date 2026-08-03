# View Settings

为数据库视图的 settings 区域提供设置内容。

settings 面板统一是 tab 结构：

- 所有视图都自带共享的 `View` tab。
- `registerViewSettings()` 只扩展共享 `View` tab 里的内容，**不会新增 tab item**。
- 想新增一个独立 tab item（有自己的 label / icon），用 `registerViewSettingsTab()`——见 [view-settings-tab](view-settings-tab.md)。

| 接口                        | 做什么                       | 有没有自己的 tab item |
| --------------------------- | ---------------------------- | --------------------- |
| `registerViewSettings()`    | 扩展共享 `View` tab 里的内容 | 否                    |
| `registerViewSettingsTab()` | 新增一个独立 tab item        | 是                    |

## 配置位置

`viewDefinition.options`

## 注册共享 View tab 内容

```ts
type ViewSettingsExtension = {
  /** settings 扩展自身的唯一 id，推荐和对应 view 用同一常量 */
  id: string;
  /** 声明适用于哪些 view type；省略表示对所有 view type 生效（通用 settings） */
  viewTypes?: string[];
  settings: () => {
    /** 首次渲染和后续配置变化时调用 */
    onUpdate: (props: ViewSettingsProps) => void;
    onDestroy: () => void;
  };
};
```

> **设计原则**：settings 的适用范围属于扩展元数据（`viewTypes`）。只对某个 view 生效就声明 `viewTypes: ['xxx']`；对所有 view 生效就省略。**不要**在 `onUpdate(props)` 里手写 `if (props.viewDefinition.type !== 'xxx') return;`。
>
> `ViewSettingsExtension` 没有 `tabId`。如果要新增 tab item，请用下面的 `registerViewSettingsTab()`。

```js
// 只对 chart 视图生效
ctx.registerViewSettings({
  id: 'chart-settings',
  viewTypes: ['chart'],
  settings: () => ({ onUpdate() {}, onDestroy() {} }),
});

// 对所有视图生效（省略 viewTypes）
ctx.registerViewSettings({
  id: 'common-settings',
  settings: () => ({ onUpdate() {}, onDestroy() {} }),
});
```

## 注册新的 settings tab

新增一个独立 tab item（有自己的 `label` / `icon`）走 `registerViewSettingsTab()`，详见 [view-settings-tab](view-settings-tab.md)。

## props

[公共上下文 props](conventions.md#公共上下文-props) 外加：

> 公共上下文的完整 API 统一见 [types.md 的「公共上下文」](types.md#公共上下文)。常见的 markdown / 文件 / 任务操作，直接查 `props.markdown`、`props.files`、`props.tasks`。

```ts
type ViewSettingsProps = XdbContextProps & {
  /** 当前 settings 面板的挂载容器 */
  container: HTMLElement;
  /** 数据库读写入口，能力见 types/database.md */
  api: Database;
  /** 当前 view id */
  viewId: string;
  /** 结构见 xdb-view.md#viewdefinition */
  viewDefinition: viewDefinition;
  /** 传完整 viewDefinition 或 updater 函数，持久化写回 */
  setViewDefinition: (updater: unknown) => Promise<void>;
  /** 复用宿主 setting 组件的命令式 builder，见下文「复用宿主 setting 组件」 */
  setting: SettingUi;
};
```

## 复用宿主 setting 组件（`props.setting`）

`props.setting` 是一个命令式 builder，让你直接复用应用内置的 setting 组件（开关、下拉、文件选择、数据库字段选择……），**无需自己写 DOM/CSS，视觉与内置设置项完全一致**。这些组件底层依赖宿主的 React 上下文（vault、portal、数据库 schema），第三方脚本无法自行构建，因此复用必须走这个 builder。

### 心智模型：把 `onUpdate` 当成 render 函数

`onUpdate` 每次被调用时，宿主都会清空上一轮的声明，重新收集你在 `onUpdate` 里通过 `props.setting.*` 声明的每一项，然后渲染。语义和 React 的 render 函数一致：

- **`key` 是幂等锚点**：同一个 `key` 再次声明会**原地更新**而非追加。
- **本轮没声明的 key 会被自动移除**：所以 `if` / 提前 `return` 天然支持条件渲染。
- **`value` 永远从 `viewDefinition` 读**：不要自己维护第二份 UI 状态。
- **写回前保留最新 definition**：简单设置可用 `setViewDefinition`；长生命周期 builder callback 使用下面的 live helper，避免覆盖同时变化的 filter / sort / layouts。

```js
function updateCurrentViewOptions(props, patch) {
  const current = props.api.getDefinition().views?.find((view) => view.id === props.viewId);
  if (!current) throw new Error(`View not found: ${props.viewId}`);
  return props.api.updateView({
    ...current,
    options: { ...(current.options ?? {}), ...patch },
  });
}

settings: () => ({
  onUpdate(props) {
    const options = props.viewDefinition.options ?? {};

    // 开关
    props.setting.switch({
      key: 'showLegend',
      label: '显示图例',
      value: options.showLegend === true,
      onChange: (v) => void updateCurrentViewOptions(props, { showLegend: v }),
    });

    // 条件渲染：只有开了图例才显示「图例位置」
    if (options.showLegend) {
      props.setting.select({
        key: 'legendPosition',
        label: '图例位置',
        value: options.legendPosition ?? 'top',
        options: [
          { value: 'top', label: '上方' },
          { value: 'bottom', label: '下方' },
        ],
        onChange: (v) => void updateCurrentViewOptions(props, { legendPosition: v }),
      });
    }
    // 关掉图例时，上一轮的 legendPosition 不会被重新声明 → 自动消失
  },
  onDestroy() {},
});
```

> 当前宿主用“忽略函数 identity 的内容签名”协调 builder 与 React。若设置项的可见内容没有变化，旧 `onChange` callback 可能被保留；此时 `setViewDefinition((current) => ...)` 中的 `current` 仍可能来自旧 render。需要稳定保留其它 view 字段时，在 callback 执行时用 `props.api.getDefinition()` 重新定位 `viewId`，再调用 `api.updateView()`。这是当前宿主实现限制，不要把 functional updater 描述成绝对的并发安全保证。

> 你仍然可以同时用 `props.container` 写裸 DOM（图表、第三方库挂载等）。builder 渲染的内容和裸 DOM 并存在同一个容器区域里。两者互不冲突。

### 可用方法

#### 基础控件

```js
props.setting.switch({ key, label, icon?, description?, disabled?, value: boolean, onChange });
props.setting.input({ key, label, icon?, description?, disabled?, value: string, placeholder?, onChange });
props.setting.numberInput({ key, label, icon?, description?, disabled?, value: number, min?, max?, step?, suffix?, onChange });
```

#### 选择类

```js
// 原生下拉选择，适合少量固定纯文本枚举。
props.setting.select({
  key, label, icon?, description?, disabled?,
  value: string,
  options: [{ value, label }],
  placeholder?, onChange,
});

// 固定富选项，不提供搜索；支持 icon 和 description。
props.setting.picker({
  key, label, icon?, description?, disabled?,
  value: string,
  options: [{ value, label, icon?, description?, disabled? }],
  placeholder?, emptyText?, onChange,
});

// 可搜索且允许自由输入；Enter/失焦提交，Escape 恢复已提交值
props.setting.combobox({
  key, label, icon?, description?, disabled?,
  value: string,
  options: [{ value, label, description?, keywords?, disabled?, icon? }],
  placeholder?, emptyText?, onChange,
});
```

> 选择方法不是功能递增关系：`select` 用于少量固定纯文本枚举，`picker` 用于固定富选项；
> `autocomplete` 只能搜索和选择已有项；`combobox` 才允许提交候选集合外的文本。

#### 搜索 / 数据源选择（高价值，无法自行复刻）

```js
// 通用 autocomplete：你自备已有选项列表（支持 getter 做懒加载）。
// 搜索 query 不会作为 value 提交；需要自由输入时使用 combobox。
props.setting.autocomplete({
  key, label, icon?, description?, disabled?,
  value: string,
  options: [{ value, label, description?, keywords?, disabled?, icon? }] | (() => [...]),
  loading?, error?, placeholder?, emptyText?, clearable?,
  onChange: (value, option?) => {...},
});

// 选库内文件
props.setting.fileAutocomplete({
  key, label, icon?, disabled?, value, placeholder?,
  filter?: (file: { path, name, extension }) => boolean,  // 按扩展名等过滤
  onChange,
});

// 文件路径允许尚不存在时
props.setting.fileCombobox({
  key, label, icon?, description?, disabled?, value, placeholder?, emptyText?,
  filter?: (file: { path, name, extension }) => boolean,
  onChange,
});

// 选择单张或多张图片；value 与 onChange 必须同为 string 或同为 string[]
props.setting.imageAutocomplete({
  key, label, icon?, description?, disabled?,
  value: string | string[],
  onChange,
});

// 选库内文件夹
props.setting.folderAutocomplete({
  key, label, icon?, disabled?, value, placeholder?,
  filter?: (folder: { path, name }) => boolean,
  onChange,
});

// 目标文件夹允许尚不存在时
props.setting.folderCombobox({
  key, label, icon?, description?, disabled?, value, placeholder?, emptyText?,
  filter?: (folder: { path, name }) => boolean,
  onChange,
});

// 选 frontmatter 属性名
props.setting.propertyAutocomplete({
  key, label, icon?, disabled?, value, placeholder?,
  filter?: (property: { name, label?, type? }) => boolean,  // 只要数值型等
  onChange,
});

// 配置将要创建/写入的 property name
props.setting.propertyCombobox({
  key, label, icon?, description?, disabled?, value, placeholder?, emptyText?,
  filter?: (property: { name, label?, type? }) => boolean,
  onChange,
});

// 选当前数据库的字段（字段列表由宿主从 api 自动取，你不用传）
props.setting.fieldAutocomplete({
  key, label, icon?, disabled?, value, placeholder?, clearable?,
  filter?: (field: { name, label?, type? }) => boolean,  // 只要 number 字段等
  onChange,
});
```

`filter` 是 builder 相比 schema 的关键优势：schema 永远表达不了「只要数值型字段」，而这里直接传一个普通函数即可。

#### 动作与布局

```js
props.setting.action({ key, label, icon?, disabled?, variant?: 'default'|'danger', suffix?, onClick });
props.setting.popover({
  key, label, icon?, disabled?, value?, open?, onOpenChange?,
  content: (container) => { /* 往 container 写浮层内容；可 return cleanup */ },
});
props.setting.title('小节标题');          // 静态布局原语，无需 key
props.setting.description('说明文字');
props.setting.divider();
```

> `title/description/divider` 是静态布局项：不返回 handle，也不需要 `key`。要关闭 popover，调用 `onOpenChange(false)`（受控）。

#### 逃生口：`custom`

当上面都不够用（比如要挂 ECharts、第三方编辑器），用 `custom` 拿到一个干净的容器，自由写 DOM。返回的 cleanup 函数在移除/重渲染时执行。

```js
props.setting.custom({
  key: 'preview',
  render: (container) => {
    container.innerHTML = '<canvas></canvas>';
    const chart = echarts.init(container.querySelector('canvas'));
    chart.setOption({
      /* ... */
    });
    return () => chart.dispose(); // cleanup
  },
});
```

### `icon` 的约定

`icon` 只接受 lucide 图标名（字符串），例如 `'bar-chart'`、`'list'`、`'calendar'`。宿主会自动解析成对应图标。第三方脚本无法构造 React 节点，所以不要传 React 元素。留空 / 不传则不渲染图标。

## 实现要求

- 只负责编辑当前 view 配置
- 普通写回可用 `setViewDefinition(...)`；必须合并最新 view 字段时用上面的 live helper
- 适用范围用 `viewTypes` 声明，不要在 `onUpdate` 里手写 type 判断
