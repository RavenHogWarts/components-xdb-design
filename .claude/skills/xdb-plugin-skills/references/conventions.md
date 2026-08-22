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
- `install`（函数）

`author`、`version` 不是必填，但推荐填写——它们会显示在插件管理视图，方便用户识别插件。
`install()` 应返回 cleanup。没有返回时宿主仍会安装插件，但会记录 warning 并使用 no-op cleanup；不要依赖这个兜底。

## 命名规范

- 插件 `id`：全局唯一、稳定、可预测
- 扩展点 `id` / Action `type`：在各自 registry 中唯一，稳定且带插件命名空间；Plain View 与 Database View 共用一个 View registry
- Action `type`：使用插件命名空间，如 `my-plugin:archive`
- extension 的 `icon` 使用宿主可识别的 Lucide 名称。`props.setting.*` 的 `icon` 明确要求 PascalCase，例如 `BarChart2`、`Image`、`LayoutGrid`；不要传 kebab-case。

```js
const PLUGIN_ID = 'status-row-style';
const VIEW_TYPE = 'example-chart';
const COVER_ID = 'sample-cover';
const FIELD_RENDERER_ID = 'example-field';
const ACTION_TYPE = 'my-plugin:archive';
```

## 配置归属

| 配置类型                     | 存储位置                           | 读写方式                                                              |
| ---------------------------- | ---------------------------------- | --------------------------------------------------------------------- |
| 当前 view 的插件配置         | `viewDefinition.options[pluginId]` | settings 用 `setViewDefinition(...)`；View 内用 `api.updateView(...)` |
| Field Renderer/Settings 配置 | `field.options`                    | `setFieldDefinition(...)`                                             |
| cover 私有配置               | `extensionData`                    | `getData()` / `updateData(...)`                                       |
| Action payload               | 所在 Action 配置对象               | Action editor 的 `setAction(...)`                                     |

不要把配置写到：模块级全局变量、DOM dataset、`install()` 闭包里的隐藏对象、没有持久化出口的本地缓存。

## 公共上下文 props

所有公开 DOM 扩展点回调（Action editor / view / settings / Field Renderer / Field Settings / cover）都会收到下面这组宿主注入的公共上下文。后文各扩展点只列**它额外**的字段：

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
  /** Daily Notes API */
  dailyNotes: DailyNotesApi;
  /** Markdown API */
  markdown: MarkdownApi;
  /** 文件 API */
  files: FilesApi;
  /** 任务 API */
  tasks: TasksApi;
  /** 预置好的 ECharts 实例 */
  echarts: typeof import('echarts/core');
};
```

> 公共上下文字段与用途以 [公共 API Schema](api-schema.md#公共运行时上下文) 为准；`types.md` 负责路由到 dailyNotes / markdown / files / tasks 的具体方法。各扩展点页面只列它们**额外**的 props。

## 职责边界

- `registerView()` / `registerDatabaseView()`：定义 view 如何渲染
- `registerAction()`：定义一种 Action 的创建、摘要、编辑和执行能力
- `registerViewSettings()`：扩展共享 `View` 设置 tab 的内容
- `registerViewSettingsTab()`：为 view 设置面板新增 tab item
- `registerViewActionMenu()`：定义视图工具栏操作项（打开 settings tab 或执行 onClick）
- `registerFieldType()`：定义字段类型目录、图标与 picker 可用性
- `registerFieldRenderer()`：根据运行时字段 definition 渲染字段
- `registerFieldSettings()`：向字段详情追加配置，并写回 `field.options`
- `registerDatabaseViewRowStyleProvider()`：定义行样式输出
- `registerCardCoverView()` / `registerCardCoverViewSettings()`：定义卡片封面和封面设置
- `registerStyleSheet()`：定义插件样式

旧的 `registerButtonStep*` 已删除；新的扩展点是 `registerAction()`。不要混用两套契约。

Field Type、渲染、配置和样式表达要分开，不要混在一个扩展里。Field Renderer / Settings
按运行时字段独立匹配，不依赖 Field Type 注册存在，也不要求使用相同 id。

## 状态更新规则

- settings 面板改当前 view 配置 → `props.setViewDefinition(...)`
- Field Settings 改当前字段配置 → `props.setFieldDefinition(...)`
- view 内部改当前 view 配置 → `props.api.updateView(...)`
- view 和 action menu 共享临时 UI 状态 → `props.state` / `context.state`
- cover 改自己的私有配置 → `props.updateData(...)`
- Action editor 改 payload → `props.setAction(...)`

```js
// settings 面板里改 view 配置
void props.setViewDefinition((cur) => ({
  ...cur,
  options: {
    ...(cur.options ?? {}),
    'my-plugin': {
      ...(cur.options?.['my-plugin'] ?? {}),
      compact: true,
    },
  },
}));

// view 内部没有 setter；写入前从当前 definition 重读目标 View
const current = props.api.getDefinition().views?.find((view) => view.id === props.viewId);
if (current) {
  void props.api.updateView({
    ...current,
    options: {
      ...(current.options ?? {}),
      'my-plugin': {
        ...(current.options?.['my-plugin'] ?? {}),
        compact: true,
      },
    },
  });
}

// Field Settings 里改插件自己的字段配置
void props.setFieldDefinition((current) => ({
  ...current,
  options: {
    ...(current.options ?? {}),
    'my-plugin': { heading: '## Summary' },
  },
}));

// cover 改私有配置
props.updateData({ field: 'cover' });

// Action editor 改当前 Action payload
props.setAction((current) => ({ ...current, message: 'Updated' }));
```
