# 类型与 API 索引

这组文档只做一件事：让你**快速定位** xdb 插件可用的宿主 API 和相关类型。

## 怎么查

| 你想找什么                                                                | 去哪里                                                                          |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `props.api` 能做什么；`Database`、`FilterItem`、行数据 `$item` 的完整结构 | [types/database.md](types/database.md)                                          |
| `props.markdown` 能做什么；heading 相关参数长什么样                       | [types/markdown.md](types/markdown.md)                                          |
| `props.dailyNotes` 能做什么；Daily Notes 配置长什么样                     | [types/dailyNotes.md](types/dailyNotes.md)                                      |
| `props.files` 能做什么；创建/模板/移动文件的行为                          | [types/files.md](types/files.md)                                                |
| `props.tasks` 能做什么；`Task` / `Pos` / `TaskInsertPosition` 的结构      | [types/tasks.md](types/tasks.md)                                                |
| Plugin / XdbApp / View / Action / Field 等扩展 schema 与字段注释          | [api-schema.md](api-schema.md)                                                  |
| `props.setting.*` 的参数、返回值、幂等 key 与 cleanup                     | [types/setting-ui.md](types/setting-ui.md)                                      |
| Field Renderer / Field Settings 的额外 props                              | [field-renderer.md](field-renderer.md) / [field-settings.md](field-settings.md) |
| Action handler / summary / DOM editor 上下文                              | [action.md](action.md)                                                          |

## 公共上下文（XdbContextProps）

所有公开 DOM 扩展点回调（Action editor / view / settings / Field Renderer / Field Settings / cover）的 `props` 都带这组公共上下文。字段用途和生命周期以 [公共 API Schema](api-schema.md#公共运行时上下文) 为准：

```ts
type XdbContextProps = {
  app: App;
  moment: typeof moment;
  PluginComponent: Component;
  obsidian: typeof import('obsidian');
  dailyNotes: DailyNotesApi;
  markdown: MarkdownApi;
  files: FilesApi;
  tasks: TasksApi;
  echarts: typeof import('echarts/core');
};
```

### 宿主基础能力

- `app`：原始 Obsidian `App`。更底层的 Obsidian 能力统一从这里进入。
- `moment`：日期解析与格式化。
- `PluginComponent`：插件根 `Component`。需要自建子组件时，优先 `new props.obsidian.Component()`，不要直接复用它做临时渲染。
- `obsidian`：完整 Obsidian API 命名空间。
- `echarts`：宿主已经 `use()` 过的 ECharts 实例。

### 公共 API

- `dailyNotes`：见 [types/dailyNotes.md](types/dailyNotes.md)
- `markdown`：见 [types/markdown.md](types/markdown.md)
- `files`：见 [types/files.md](types/files.md)
- `tasks`：见 [types/tasks.md](types/tasks.md)

## 设计约定

- 常见的日记 / markdown / 文件 / 任务操作，优先从 `props.dailyNotes` / `props.markdown` / `props.files` / `props.tasks` 查起。
- 更底层或更通用的 Obsidian 能力，再看 `props.app` / `props.obsidian`。
- 扩展点页面只列它们**额外**的 props；公共 API 统一以这组类型文档为准。
