# 规范与公共上下文

## 文件格式

- 文件名：`*.xdb.js`
- 模块格式：CommonJS，导出 `module.exports = { ... }`

推荐骨架：

```js
module.exports = {
  id: 'plugin-id',
  name: 'Plugin Name',
  description: 'What this plugin does.',
  author: 'Your Name',
  version: '1.0.0',
  install(ctx) {
    return () => {
      // plugin-level cleanup
    };
  },
};
```

宿主加载时会校验插件形状，缺少以下任一字段会被判为 `invalid` 并记录到插件管理视图：

- `id`（非空字符串，全局唯一）
- `name`（非空字符串）
- `description`（字符串）
- `install`（函数，且**必须返回一个 cleanup 函数**）

`author`、`version` 不是必填，但推荐填写——它们会显示在插件管理视图，方便用户识别插件。

## 命名规范

- 插件 `id`：全局唯一、稳定、可预测
- 扩展点 `id`：稳定、不要运行时拼接
- `icon`：使用 **camelCase 的 Lucide 名称**，例如 `barChart2`、`image`、`list`

```js
const PLUGIN_ID = 'status-row-style';
const VIEW_TYPE = 'example-chart';
const COVER_ID = 'sample-cover';
const STEP_ID = 'open-note';
```

## 配置归属

| 配置类型 | 存储位置 | 读写方式 |
| --- | --- | --- |
| 当前 view 的配置 | `viewDefinition.options` | `setViewDefinition(...)` / `api.updateView(...)` |
| cover / button step 私有配置 | `extensionData` | `getData()` / `updateData(...)` |

不要把配置写到：模块级全局变量、DOM dataset、`install()` 闭包里的隐藏对象、没有持久化出口的本地缓存。

## 公共上下文 props

所有扩展点回调（view / settings / cover / button step）都会收到下面这组宿主注入的公共上下文。后文各扩展点只列**它额外**的字段：

```ts
type XdbContextProps = {
  /** Obsidian App 实例 */
  app: App;
  /** 日期处理库 */
  moment: typeof moment;
  /** 宿主提供的生命周期组件，可用于注册/清理资源 */
  PluginComponent: Component;
  /** Obsidian API 命名空间 */
  obsidian: typeof import('obsidian');
  /** @deprecated，改用 obsidian.MarkdownRenderer */
  MarkdownRenderer: typeof MarkdownRenderer;
  /** 预置好的 ECharts 实例 */
  echarts: typeof import('echarts/core');
};
```

> 各字段的类型与最小用法见 [types.md 的「公共上下文」](types.md#公共上下文xdbcontextprops)。

## 职责边界

- `registerView()` / `registerDatabaseView()`：定义 view 如何渲染
- `registerViewSettings()`：定义 view 如何配置
- `registerDatabaseViewRowStyleProvider()`：定义行样式输出
- `registerStyleSheet()`：定义插件样式

渲染、配置、样式表达要分开，不要混在一个扩展里。

## 状态更新规则

- settings 面板改当前 view 配置 → `props.setViewDefinition(...)`
- view 内部改当前 view 配置 → `props.api.updateView(...)`
- cover / button step 改自己的私有配置 → `props.updateData(...)`

```js
// settings 面板里改 view 配置
void props.setViewDefinition((cur) => ({
  ...cur,
  options: { ...(cur.options ?? {}), compact: true },
}));

// view 内部改 view 配置
props.api.updateView({
  ...props.viewDefinition,
  options: { ...(props.viewDefinition.options ?? {}), compact: true },
});

// cover / button step 改私有配置
props.updateData({ field: 'cover' });
```
