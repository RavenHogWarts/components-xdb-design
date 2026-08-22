# XDB Plugin 公共 API Schema

这份文件是 `*.xdb.js` 的公共契约索引。**先读 schema 注释，再读专题页的做法和示例。**

- 只列第三方插件可用的 DOM API；`viewComponent`、`settingsComponent`、`editorComponent` 等 React 入口是 `@internal`，不属于第三方契约。
- `id` / `type` 的唯一性都以对应 registry 为边界；不同种类的扩展可以使用相同字符串。
- `Database`、数据结构和行能力见 [Database API](types/database.md)。
- `props.setting` 的完整控件 schema 见 [Setting UI](types/setting-ui.md)。
- schema 与源码冲突时，以 `XdbApp.ts` 及其直接引用的公共类型为准，并修正文档。

快速定位：[Plugin / XdbApp](#plugin-与注册入口) · [生命周期](#dom-实例生命周期) · [公共上下文](#公共运行时上下文) · [View](#view) · [Settings](#view-settings) · [Settings Tab](#独立-view-settings-tab) · [Action Menu](#view-action-menu) · [Action](#action) · [Field Type](#field-type) · [Field Renderer](#field-renderer) · [Field Settings](#field-settings) · [Row Style](#row-style-provider) · [Card Cover](#card-cover)

## Plugin 与注册入口

```ts
/** 插件卸载或热重载时执行的同步清理函数。应可安全重复调用。 */
type Cleanup = () => void;

interface XdbPlugin {
  /**
   * 插件的稳定身份。必须是非空字符串，并且不能与已安装插件重复。
   * 建议使用小写 kebab-case；发布后不要更改，否则旧注册与配置无法归属。
   */
  id: string;

  /** 插件管理界面显示名。必须是非空字符串。 */
  name: string;

  /** 插件能力说明。必须是字符串；扩展没有 description 时会用它作默认说明。 */
  description: string;

  /** 可选的作者展示信息；不参与身份或权限判断。 */
  author?: string;

  /** 可选的版本展示信息；宿主不按它做依赖解析或迁移。 */
  version?: string;

  /**
   * 同步安装入口。只注册扩展并返回 Cleanup，不在这里挂载 View UI。
   * 抛错会使安装失败，并回滚本次已登记的扩展和 registerStyleSheet 样式。
   * 返回非函数不会阻止插件安装，但宿主会记录 warning；第三方必须始终返回函数。
   */
  install(ctx: XdbApp): Cleanup;
}
```

插件文件使用 CommonJS 导出：

```js
module.exports = {
  id: 'example-plugin',
  name: 'Example Plugin',
  description: 'Adds an example capability.',
  install(ctx) {
    // ctx.registerXxx(...)
    return () => undefined;
  },
};
```

```ts
interface XdbApp {
  /**
   * 注册一种可持久化、可编辑、可执行的 Action。
   * 唯一键是 extension.type。shape 非法或 type 已占用时返回 false。
   */
  registerAction<TAction extends Action>(extension: ActionExtension<TAction>): boolean;

  /**
   * 注册不需要 View 行投影的 DOM View。
   * 唯一键是 extension.id，与 Database View 共用同一个 View registry。
   * 返回 void；非法或重复注册只记录 [xdb-plugin] 日志，没有可读取的注册结果。
   */
  registerView(extension: ViewExtension): void;

  /**
   * 向共享 View 设置页追加内容。唯一键是 extension.id。
   * 返回 void；用 viewTypes 控制适用范围。
   */
  registerViewSettings(extension: ViewSettingsExtension): void;

  /**
   * 注册独立设置 tab。唯一键是 extension.id；tab 路由值是 tabId ?? id。
   * 返回 void。第三方必须提供 settings factory。
   */
  registerViewSettingsTab(extension: ViewSettingsTabExtension): void;

  /**
   * 注册 View toolbar 项。唯一键是 extension.id。
   * shape 非法或 id 已占用时返回 false。
   */
  registerViewActionMenu(extension: ViewActionMenuExtension): boolean;

  /**
   * 注册读取宿主 View 行投影的 DOM View。唯一键是 extension.id。
   * 宿主会把它标记为 Database View，并提供 viewData。
   * 返回 void；非法或重复注册只记录 [xdb-plugin] 日志，没有可读取的注册结果。
   */
  registerDatabaseView(extension: DatabaseViewExtension): void;

  /** @deprecated 使用 registerViewSettings。 */
  registerDatabaseViewSettings(extension: ViewSettingsExtension): void;

  /** 注册一种卡片 cover renderer。唯一键是 extension.id；返回 void。 */
  registerCardCoverView(extension: DatabaseViewCoverExtension): void;

  /**
   * 注册与 cover id 对应的设置 renderer。唯一键是 extension.id；返回 void。
   * id 应等于要配置的 DatabaseViewCoverExtension.id。
   */
  registerCardCoverViewSettings(extension: DatabaseViewCoverSettingsExtension): void;

  /** 注册声明式行样式 provider。唯一键是 provider.id；返回 void。 */
  registerDatabaseViewRowStyleProvider(provider: RowStyleProvider): void;

  /**
   * 注册字段选择器中的一个 type 目录项。唯一键是 extension.type。
   * shape 非法或 type 已占用时返回 false；不自动注册 renderer 或 settings。
   */
  registerFieldType(extension: DatabaseFieldTypeExtension): boolean;

  /** 注册字段值 renderer。唯一键是 extension.id；返回 void。 */
  registerFieldRenderer(extension: DatabaseFieldRendererExtension): void;

  /** 注册字段详情中的设置内容。唯一键是 extension.id；返回 void。 */
  registerFieldSettings(extension: DatabaseFieldSettingsExtension): void;

  /**
   * 向 document.head 注入插件级 CSS。空白 CSS 被忽略。
   * 同一插件可注册多段；宿主在卸载/安装回滚时按 plugin id 全部移除。
   */
  registerStyleSheet(css: string): void;
}
```

只有 `registerAction()`、`registerFieldType()`、`registerViewActionMenu()` 返回注册结果。它们返回 `false` 后，通常应从 `install()` 抛错，触发整次安装回滚。其它方法返回 `void`，必须结合 validator、`[xdb-plugin]` 日志和真实 UI 验证。

## DOM 实例生命周期

```ts
/** 每个已挂载扩展实例的同步生命周期。 */
interface ViewInstance<TProps> {
  /**
   * 宿主在输入变化后重复调用。必须同步返回、允许重复执行，并只使用本轮 props。
   * 不要返回 Promise；异步工作自行捕获错误并用 AbortController 或 generation 丢弃旧结果。
   */
  onUpdate(props: TProps): void;

  /**
   * 实例被替换或卸载时调用。释放 listener、observer、chart、子 Component、DOM 引用和异步工作。
   * 实现应幂等，不依赖它只被调用一次。
   */
  onDestroy(): void;
}

/**
 * 创建一个新的 DOM 扩展实例。factory 不接收 props，也不是插件级 singleton；
 * 宿主可在视图、设置面板或 extension identity 变化时重新创建实例。
 */
type ViewInstanceFactory<TProps> = () => ViewInstance<TProps>;
```

## 公共运行时上下文

所有公开 DOM View、Settings、Action Editor、Field Renderer、Field Settings 和 Cover props 都包含：

```ts
interface XdbContextProps {
  /** 当前 Obsidian App；用于 vault、workspace 等底层能力。 */
  app: App;

  /** 宿主提供的 Moment.js 实例；用于日期解析、计算和格式化。 */
  moment: typeof moment;

  /**
   * 当前 DOM 扩展实例的宿主 Component 生命周期边界。
   * 宿主负责 load/unload；不要手动 unload。自建长期资源优先挂到新的子 Component。
   */
  PluginComponent: Component;

  /** Obsidian API 命名空间，例如 Component、MarkdownRenderer、requestUrl、parseYaml。 */
  obsidian: typeof import('obsidian');

  /** 绑定当前 App 的 Daily Notes helper；schema 见 types/dailyNotes.md。 */
  dailyNotes: DailyNotesApi;

  /** 绑定当前 App 的 Markdown helper；schema 见 types/markdown.md。 */
  markdown: MarkdownApi;

  /** 绑定当前 App 的文件创建、模板和移动 helper；schema 见 types/files.md。 */
  files: FilesApi;

  /** 绑定当前 App 的任务读取、插入和跳转 helper；schema 见 types/tasks.md。 */
  tasks: TasksApi;

  /**
   * 宿主预注册常用图表/组件并使用 CanvasRenderer 的 ECharts core 实例。
   * 插件创建的 chart 由插件 dispose；不能假设未列出的 chart type 已注册。
   */
  echarts: typeof import('echarts/core');
}
```

```ts
/** 宿主支持的链接打开方式。 */
type ObsidianLinkOpenMode =
  | 'tab' // 新 tab
  | 'split' // 当前窗口的新 split
  | 'window' // 新窗口
  | 'modal-center' // 中央 modal leaf
  | 'modal-right' // 右侧 modal leaf
  | 'modal-left' // 左侧 modal leaf
  | 'current' // 当前 leaf
  | 'none'; // 只处理数据，不打开链接
```

## View

```ts
interface ViewExtension {
  /**
   * 稳定 View type，写入 DatabaseViewDefinition.type。
   * 必须是非空字符串，并在 Plain View + Database View 的共享 registry 中唯一。
   */
  id: string;

  /** View picker、tab 和设置中的显示名。必须是非空字符串。 */
  name: string;

  /**
   * Lucide icon 名。省略时宿主使用 PanelTop；不存在的名称不渲染图标。
   * 推荐 PascalCase，例如 List、BarChart2；不要使用 kebab-case。
   */
  icon?: string;

  /** 可选说明；省略时使用插件 description。 */
  description?: string;

  /**
   * 第三方 DOM renderer factory。第三方必须提供。
   * 源码中的 viewComponent / isInternal 是宿主 React 内部入口，不属于公共 API。
   */
  view: ViewInstanceFactory<ViewProps>;
}

interface DatabaseViewExtension extends Omit<ViewExtension, 'view'> {
  /** Database View 的类型标记。registerDatabaseView 也会在注册时强制设为 true。 */
  isDatabaseView: true;

  /** 接收当前 View 已完成 filter、sort、group 和 summary 投影后的 viewData。 */
  view: ViewInstanceFactory<DatabaseViewProps>;
}

interface ViewProps extends XdbContextProps {
  /**
   * 此实例唯一可写的根容器。onUpdate 应替换/更新自己的内容，不要持续 append 旧 UI。
   * 不要操作容器外的宿主 DOM。
   */
  container: HTMLElement;

  /** 当前 Database。View 不拥有它；onDestroy 时禁止调用 api.unload()。 */
  api: Database;

  /** 当前 View id，等于本轮 viewDefinition.id。用于查询或定位持久化定义。 */
  viewId: string;

  /**
   * 当前一轮的完整持久化 View 定义。按只读数据使用，不要原地修改。
   * View props 没有 setter；写入前从 api.getDefinition() 重读，再调用 api.updateView()。
   */
  viewDefinition: DatabaseViewDefinition;

  /** 当前 View 的临时内存状态；与该 View 的 Action Menu 共享，不写入 .xdb。 */
  state: ViewState;
}

interface DatabaseViewProps extends ViewProps {
  /**
   * 当前 View 的宿主投影结果。数据或查询输入变化后，宿主会重新调用 onUpdate。
   * 不要为了同一结果再建立 subscribeData() 缓存。
   */
  viewData: DatabaseViewData;
}

type ViewState = Readonly<{
  /** 读取一个临时值；未知 key 返回 undefined。 */
  get(key: string): unknown;

  /**
   * 写入一个临时值。key 应带插件命名空间。
   * 值变化会更新共享 state，并使 View / Action Menu 收到新 state。
   */
  set(key: string, value: unknown): void;

  /** 删除临时值；已有值被删除时会更新共享 state。 */
  delete(key: string): void;
}>;
```

`DatabaseViewComponentProps` 是宿主 React renderer 的内部类型，第三方 `.xdb.js` 不读取、不实现它。DOM 插件只使用上面的 `DatabaseViewProps`。

## View Settings

```ts
type ViewDefinitionUpdater = DatabaseViewDefinition | ((current: DatabaseViewDefinition) => DatabaseViewDefinition);

interface ViewSettingsExtension {
  /**
   * 此 Settings contributor 的稳定身份。必须是非空字符串，
   * 在 View Settings registry 中唯一；它不是 tab id，也不写入 .xdb。
   */
  id: string;

  /**
   * 适用的 View type 列表。省略表示所有 View；数组中的每一项必须是非空字符串。
   * 空数组不会匹配任何 View。匹配逻辑属于 metadata，不要在 onUpdate 中重复写 guard。
   */
  viewTypes?: string[];

  /** 渲染顺序；越小越靠前，省略为 0，同值按注册顺序。推荐有限数值。 */
  order?: number;

  /** 第三方 DOM settings factory。必须提供。 */
  settings: ViewInstanceFactory<ViewSettingsProps>;
}

interface ViewSettingsProps extends XdbContextProps {
  /** 自定义 DOM 逃生口；普通表单优先使用 setting。 */
  container: HTMLElement;

  /** 当前 Database；Settings 不拥有它。 */
  api: Database;

  /** 当前 View id，等于 viewDefinition.id。 */
  viewId: string;

  /** 当前 onUpdate 这一轮的完整 View 定义；按只读数据使用。 */
  viewDefinition: DatabaseViewDefinition;

  /**
   * 写回完整 View 定义。函数参数 current 是当前 onUpdate 这一轮的 definition，
   * 不是跨异步流程的事务式 compare-and-swap。正常控件事件优先使用函数形式并保留未知字段；
   * 长异步流程结束后不要用早先 props 覆盖更新，需等待新 props 或重新读取当前 definition。
   */
  setViewDefinition(update: ViewDefinitionUpdater): Promise<void>;

  /** 宿主标准设置控件 builder；完整 schema 见 types/setting-ui.md。 */
  setting: SettingUi;
}
```

## 独立 View Settings Tab

```ts
interface ViewSettingsTabExtension {
  /**
   * 稳定注册 id。必须非空，在 Settings Tab registry 中唯一。
   * 同一插件可以用同一 id 再注册以替换或禁用自己的 tab；不能覆盖其它插件。
   */
  id: string;

  /**
   * tab UI 与 defaultTab/settingTabId 使用的稳定路由值。省略时等于 id。
   * 它不是 registry 唯一键；多个不同 viewTypes 的注册可以共享 tabId。
   */
  tabId?: string;

  /** tab 显示名。必须是非空字符串。 */
  label: string;

  /** 可选 Lucide icon；推荐 PascalCase，不存在时不显示。 */
  icon?: string;

  /** 适用的 View type；省略表示所有 View。每一项必须非空；空数组不匹配任何 View。 */
  viewTypes?: string[];

  /**
   * 第三方 DOM settings factory。新注册必须提供。
   * 源码允许同 owner 的 renderer-less override 用来禁用已有 tab；第三方通常不要依赖此管理能力。
   */
  settings: ViewInstanceFactory<ViewSettingsTabProps>;
}

interface ViewSettingsTabProps extends ViewSettingsProps {
  /** 关闭当前设置面板。宿主不能提供关闭能力时为 undefined。 */
  close?: () => void;
}
```

## View Action Menu

```ts
type ViewActionMenuContext = Readonly<{
  /** 当前 Obsidian App。 */
  app: App;

  /** 当前 Database。 */
  database: Database;

  /** 当前 View 定义；按只读数据使用。 */
  viewDefinition: DatabaseViewDefinition;

  /**
   * 当前 View 投影结果；尚未加载、加载失败或 Plain View 时可能为 null。
   * isVisible/isActive/isDisabled/onClick 都必须处理 null。
   */
  viewData: DatabaseViewData | null;

  /** 与当前 View renderer 共享的临时状态。 */
  state: ViewState;

  /** 当前 View 的搜索 UI 状态。setter 更新宿主状态。 */
  search: Readonly<{
    /** 搜索框是否打开。 */
    open: boolean;
    /** 当前查询文本。 */
    query: string;
    /** 打开或关闭搜索框。 */
    setOpen(open: boolean): void;
    /** 更新查询文本。 */
    setQuery(query: string): void;
  }>;
}>;

type ViewActionMenuResult = void | Readonly<{
  /** 告诉宿主这次命令创建了一个可打开的条目。 */
  type: 'created-item';
  /** 新条目的 vault href；用于通知和打开操作。 */
  href: string;
  /** 新条目是否满足当前 View 投影；只影响反馈，不更改筛选。 */
  status: 'visible' | 'not-visible';
}>;

interface ViewActionMenuBase {
  /** 稳定菜单项 id；必须非空，在 View Action Menu registry 中唯一。 */
  id: string;
  /** 用户可见标签；必须非空。 */
  label: string;
  /**
   * Lucide icon；必须非空，camelCase/PascalCase 均可，推荐 PascalCase。
   * 未知名称不影响注册，但 UI 不渲染图标。
   */
  icon: string;
  /** 适用 View type；省略表示所有 View。每一项必须非空；空数组不匹配任何 View。 */
  viewTypes?: string[];
  /**
   * 排序值，必须是有限数；越小越靠前。
   * 省略时排在显式 order 后方，同值保持注册顺序。
   */
  order?: number;
  /** 返回 false 时不渲染；必须同步且不抛错。省略表示可见。 */
  isVisible?(context: ViewActionMenuContext): boolean;
  /** 返回 true 时显示激活态；必须同步且不抛错。省略表示未激活。 */
  isActive?(context: ViewActionMenuContext): boolean;
  /** 返回 true 时禁止点击；必须同步且不抛错。省略表示可用。 */
  isDisabled?(context: ViewActionMenuContext): boolean;
}

type ViewActionMenuExtension = ViewActionMenuBase &
  (
    | {
        /** 打开 tabId ?? id 与此值相等的设置 tab；必须非空。 */
        settingTabId: string;
        onClick?: never;
      }
    | {
        settingTabId?: never;
        /**
         * 执行命令。宿主捕获同步抛错和 Promise rejection 并写入 console；
         * 不自动显示 Notice。需要用户可见反馈时由插件自己提供。
         */
        onClick(context: ViewActionMenuContext): ViewActionMenuResult | Promise<ViewActionMenuResult>;
      }
  );
```

`settingTabId` 与 `onClick` 必须且只能提供一个。`settingTabId` 应精确等于目标 `ViewSettingsTabExtension.tabId ?? id`；不要依赖找不到 tab 时的宿主 fallback。

## Action

```ts
/** Action 可以在哪些配置表面被创建。 */
type ActionScope = 'button-field' | 'button-view' | 'new-row';

interface Action {
  /** 稳定 Action type，连接持久化 payload 与注册的 ActionExtension。 */
  type: string;

  /**
   * 其余字段由 extension 定义。payload 必须是可写入 .xdb 的普通 JSON 数据：
   * object/array/string/boolean/null/有限 number；不要存函数、DOM、class 实例、BigInt 或循环引用。
   */
  [key: string]: unknown;
}

interface ActionMatchContext {
  /** 当前 picker 所在表面。 */
  scope: ActionScope;

  /** 脱离 Database 的展示位置可能没有 Database。 */
  database?: Database;
}

interface ActionSummaryContext {
  /** 当前 Obsidian App。 */
  app: App;
  /** 脱离 Database 的展示位置可能没有 Database。 */
  api?: Database;
  /** 当前 Action 的配置表面。 */
  scope: ActionScope;
}

type ActionUpdate<TAction extends Action> = TAction | ((current: TAction) => TAction);

interface ActionExtension<TAction extends Action> {
  /**
   * 稳定、非空、带插件命名空间的 Action type。
   * 必须等于 create() 结果及 handler.type，并在 Action registry 中唯一。
   */
  type: TAction['type'];

  /** picker 与编辑器中的显示名；必须非空。 */
  label: string;

  /**
   * Lucide icon；必须非空，camelCase/PascalCase 均可，推荐 PascalCase。
   * 未知名称不影响注册，但 UI 不渲染图标。
   */
  icon: string;

  /** 可选的发现/搜索说明；省略时使用插件 description。 */
  description?: string;

  /**
   * 只控制 picker 是否允许新建该 Action。省略表示所有 scope/source 可选。
   * 返回 false 不阻止已持久化 Action 的摘要、编辑或执行。
   * 宿主不隔离此回调异常；必须同步、无副作用且不抛错。
   */
  match?(context: ActionMatchContext): boolean;

  /**
   * 创建默认 payload。必须同步返回新的普通对象，返回值 type 必须等于 extension.type。
   * 注册阶段不会调用或验证返回值，也没有统一的非法结果 fallback；返回错误 shape 时，
   * 不同 consumer 可能持久化畸形 Action 或在当前操作失败。每次调用都不要复用可变 singleton。
   */
  create(): TAction;

  /** 执行能力；handler.type 必须等于 extension.type。 */
  handler: ActionHandler<TAction>;

  /**
   * 返回列表中显示的一行纯文本摘要。必须同步、无副作用且不抛错。
   * 应容忍旧版本或部分缺失的 payload；宿主不隔离此回调异常，也不承诺统一 UI fallback。
   */
  summary(action: TAction, context: ActionSummaryContext): string;

  /** 可选的第三方 DOM editor factory。没有 editor 时仍可执行，但没有专用配置 UI。 */
  editor?: ViewInstanceFactory<ActionEditorViewProps<TAction>>;
}

interface ActionHandler<TAction extends Action> {
  /** 必须等于所属 ActionExtension.type。 */
  type: TAction['type'];

  /**
   * 执行 Action。同步抛错或 Promise rejection 会停止当前串行 Action 列表。
   * 需要行时检查 context.row；长任务检查/传递 context.signal。
   */
  run(action: TAction, context: ActionContext): Promise<void>;
}

interface ActionContext {
  /** 当前 Obsidian App。 */
  app: App;

  /** 执行所属的当前 Database。 */
  database: Database;

  /**
   * 当前表面提供的链接解析基准路径，通常是 .xdb definition path，
   * 但 handler 应把它当作不透明的 Obsidian sourcePath 使用。
   */
  sourcePath: string;

  /** 链接打开方式：tab/split/window/modal-center/modal-right/modal-left/current/none。 */
  linkOpenMode: ObsidianLinkOpenMode;

  /** 当前表面提供的模板/脚本变量；键集合由调用方决定，不能假设固定字段。 */
  variables: Record<string, unknown>;

  /** 只有具有当前行的执行表面才提供；使用前必须检查。 */
  row?: ActionRowContext;

  /** 可选取消信号。已经 aborted 或后续 abort 时应尽快停止可取消工作。 */
  signal?: AbortSignal;
}

interface ActionRowContext {
  /** 当前规范 row id；move/update 后可能改变，应每次重新读取。 */
  readonly id: string;

  /** 当前行数据；set/update 后由 adapter 同步。按只读数据使用。 */
  readonly item: Record<string, unknown>;

  /** delete() 成功后为 true；后续 mutation 不应继续执行。 */
  readonly deleted: boolean;

  /** 更新一个字段，并同步 adapter 的 id/item。 */
  set(fieldName: string, value: unknown): Promise<void>;

  /** 通过一次 updateRow 调用提交一组字段更新，并同步 adapter 的 id/item。 */
  update(values: Record<string, unknown>): Promise<void>;

  /** 移动当前行，并同步可能变化的 row id。source 不支持时会失败。 */
  move(targetFolder: string): Promise<void>;

  /** 删除当前行；成功后 deleted 变为 true。 */
  delete(): Promise<void>;
}

interface ActionEditorViewProps<TAction extends Action> extends XdbContextProps {
  /** 自定义 DOM 逃生口；普通表单优先使用 setting。 */
  container: HTMLElement;

  /** 当前 onUpdate 这一轮的 Action payload；按只读数据使用。 */
  action: TAction;

  /** 脱离 Database 的编辑位置可能没有 Database。 */
  api?: Database;

  /** 当前编辑表面。 */
  scope: ActionScope;

  /**
   * 写回完整 Action payload。普通控件优先使用函数形式并保留未知字段。
   * updater 以当前 editor props 的 action 为输入，不是跨异步流程事务。
   */
  setAction(update: ActionUpdate<TAction>): void;

  /** 宿主标准设置控件 builder；完整 schema 见 types/setting-ui.md。 */
  setting: SettingUi;
}
```

## Field Type

```ts
interface DatabaseFieldTypeMatchContext {
  /** 当前 Database，用于检查 source 与写入能力。 */
  api: Database;

  /** 编辑已有字段时是字段名；创建新字段等上下文可能省略。 */
  fieldName?: string;
}

interface DatabaseFieldTypeExtension {
  /**
   * 写入 DatabaseFieldDefinition.type 的稳定身份。
   * 必须是非空字符串，并在 Field Type registry 中唯一；不能覆盖内置或其它插件 type。
   */
  readonly type: DatabaseFieldType;

  /** 字段类型 picker 的显示名；必须是非空字符串。 */
  readonly label: string;

  /**
   * Lucide icon 名；必须是非空字符串。camelCase/PascalCase 均可，推荐 camelCase 与内置 type 一致。
   * 不存在时注册仍成功，但 UI 回退为 Text icon。
   */
  readonly icon: string;

  /** 排序值，必须是有限数；越小越靠前，省略为 0，同值按注册顺序。 */
  readonly order?: number;

  /**
   * 只控制字段类型 picker 可用性。省略表示可选。
   * 返回 false 不重写已持久化 field.type，也不代表 renderer/settings 不匹配。
   * 抛错时宿主记录错误、跳过本 type，并继续解析其它 type。
   */
  readonly match?(context: DatabaseFieldTypeMatchContext): boolean;
}
```

Field Type 只声明目录 metadata，不定义值 schema、不增加 source 存储能力。值类型由插件 renderer/settings/Action 自己约定；写入前仍用 `api.supportsFieldType()`、`canUpdateCell()` 等实际 capability。

## Field Renderer

```ts
interface DatabaseFieldRendererMatchContext {
  /** 当前 Database。 */
  api: Database;
  /** 当前字段定义。 */
  field: DatabaseFieldDefinition;
  /** 当前字段是否由 source 提供，而非 .xdb 自定义字段。 */
  isBuiltInField: boolean;
}

interface DatabaseFieldRendererExtension {
  /** 稳定 renderer id；必须非空，在 Field Renderer registry 中唯一。 */
  id: string;
  /** renderer 显示名；必须非空。 */
  name: string;
  /** 可选说明。 */
  description?: string;
  /** 可选 PascalCase Lucide icon。 */
  icon?: string;
  /** 解析顺序，必须是有限数；越小越先匹配，省略为 0，同值按注册顺序。 */
  order?: number;

  /**
   * 同步决定是否处理该字段。宿主按 order 取第一个返回 true 的 renderer。
   * 抛错时记录错误并继续下一个 renderer。
   */
  match(context: DatabaseFieldRendererMatchContext): boolean;

  /**
   * 可选的编辑能力检查。false 表示此 renderer 不进入编辑模式；
   * 最终可编辑性还受 source、readOnly、onCommit 等条件限制。必须同步且不抛错。
   */
  canEdit?(field: DatabaseFieldDefinition): boolean;

  /**
   * 判断值是否为空，影响 List/Gantt 等只渲染非空功能字段的表面。
   * 必须同步、无副作用且不抛错；不要简单使用 !value，以免把 0/false 当空值。
   */
  isValueEmpty(field: DatabaseFieldDefinition, value: unknown): boolean;

  /** 第三方 DOM renderer factory；必须提供。 */
  view: ViewInstanceFactory<DatabaseFieldRendererProps>;
}

interface DatabaseFieldRendererProps extends XdbContextProps {
  /** 此 cell renderer 唯一可写的根容器。 */
  container: HTMLElement;
  /** 当前 Database；renderer 不拥有它。 */
  api: Database;
  /** 当前 View id。 */
  viewId: string;
  /** 当前 View type；某些非标准表面可能省略。 */
  viewType?: DatabaseViewType;
  /** 当前字段定义；按只读数据使用。 */
  field: DatabaseFieldDefinition;
  /** 当前完整 DatabaseRow；按只读数据使用。 */
  row: DatabaseRow;
  /** 当前 cell value；类型由 field/source/插件约定。 */
  value: unknown;
  /** true 时不得进入编辑或提交。省略按 false 处理。 */
  readOnly?: boolean;
  /** 当前是否处于编辑模式。 */
  editing: boolean;
  /** 可选编辑状态 setter；没有时插件不能请求宿主切换 editing。 */
  onEditingChange?: (editing: boolean) => void;
  /** 可选提交入口；没有时只能只读渲染。可以同步返回或返回 Promise。 */
  onCommit?: (value: unknown) => void | Promise<void>;
}
```

第三方 Field Renderer 不使用源码中的 `viewComponent`、`editor`、`editorPopup`，它们是内置 React 编辑路径。

## Field Settings

```ts
interface DatabaseFieldSettingsMatchContext {
  /** 当前 Database。 */
  api: Database;
  /** 当前字段定义。 */
  field: DatabaseFieldDefinition;
  /** 当前字段是否由 source 提供。 */
  isBuiltInField: boolean;
}

type FieldDefinitionUpdate = DatabaseFieldDefinition | ((current: DatabaseFieldDefinition) => DatabaseFieldDefinition);

interface DatabaseFieldSettingsExtension {
  /** 稳定 settings id；必须非空，在 Field Settings registry 中唯一。 */
  id: string;
  /** 渲染顺序，必须是有限数；越小越靠前，省略为 0，同值按注册顺序。 */
  order?: number;
  /**
   * 同步决定是否为当前字段显示设置。所有匹配项都会按 order 渲染。
   * 抛错时记录错误并继续其它 settings。
   */
  match(context: DatabaseFieldSettingsMatchContext): boolean;
  /** 第三方 DOM settings factory；必须提供。 */
  settings: ViewInstanceFactory<DatabaseFieldSettingsProps>;
}

interface DatabaseFieldSettingsProps extends XdbContextProps {
  /** 自定义 DOM 逃生口；普通表单优先使用 setting。 */
  container: HTMLElement;
  /** 当前 Database；Settings 不拥有它。 */
  api: Database;
  /** 打开字段设置时所属的 View id。 */
  viewId: string;
  /** 当前 onUpdate 这一轮的字段定义；按只读数据使用。 */
  field: DatabaseFieldDefinition;
  /**
   * 写回完整字段定义。优先使用函数形式并保留 name/type/formula 及其它 options。
   * 返回值可能是 void 或 Promise；需要等待持久化时使用 await Promise.resolve(...)
   */
  setFieldDefinition(update: FieldDefinitionUpdate): void | Promise<void>;
  /** 宿主标准设置控件 builder；完整 schema 见 types/setting-ui.md。 */
  setting: SettingUi;
}
```

## Row Style Provider

```ts
type RowStyleAttributes = Record<string, string | number | boolean | null | undefined>;

interface RowStyleProviderContext {
  /** 当前 View 定义；用于读取插件在 options 中的规则。 */
  viewDefinition: DatabaseViewDefinition;
  /** 当前行的原始数据对象，不含 DatabaseRow.id wrapper。 */
  item: Record<string, unknown>;
  /** 使用当前 Database filter 引擎判断此行是否匹配 filter。 */
  matchesFilter(filter: FilterItem): boolean;
}

interface RowStyleProvider {
  /** 稳定 provider id；必须非空，在 Row Style registry 中唯一。 */
  id: string;
  /** provider 显示/诊断名；必须非空。 */
  name: string;
  /** 返回根节点 inline style；null 表示本行不贡献 style。 */
  style?(ctx: RowStyleProviderContext): Record<string, string | number> | null;
  /** 返回一个或多个根节点 class；null 表示不贡献 class。 */
  className?(ctx: RowStyleProviderContext): string | string[] | null;
  /**
   * 返回声明式根节点 attribute。null/undefined 值表示不设置对应 attribute。
   * 只描述属性，不在这里注册 DOM 事件或保存 element。
   */
  attributes?(ctx: RowStyleProviderContext): RowStyleAttributes | null;
}
```

## Card Cover

```ts
type XdbData = Record<string, unknown>;
type XdbDataUpdate = XdbData | ((previous: Readonly<XdbData>) => XdbData);

interface XdbDataProps {
  /** 读取当前 cover 私有 extensionData；按只读数据使用。 */
  getData(): Readonly<XdbData>;

  /**
   * 浅合并 patch 到当前 extensionData。函数形式接收当前数据；
   * patch 中值为 undefined 的 key 会被删除。不要用它写 View 的其它 options。
   */
  updateData(update: XdbDataUpdate): void;
}

interface DatabaseViewCoverExtension {
  /** 稳定 cover id；必须非空，在 Cover registry 中唯一，并写入 View cover 配置。 */
  id: string;
  /** cover 选择器显示名；必须非空。 */
  name: string;
  /** 可选说明。 */
  description?: string;
  /** 第三方 DOM cover renderer factory；必须提供。 */
  view: ViewInstanceFactory<DatabaseViewCoverProps>;
}

interface DatabaseViewCoverProps extends XdbContextProps, XdbDataProps {
  /** 当前 cover renderer 根容器。 */
  container: HTMLElement;
  /** 当前 Database；cover 不拥有它。 */
  api: Database;
  /** 当前 View id。 */
  viewId: string;
  /** 当前行规范 id。 */
  rowId: string;
  /** 当前行原始数据对象；按只读数据使用。 */
  $item: Record<string, unknown>;
}

interface DatabaseViewCoverSettingsExtension {
  /**
   * 要配置的 cover id；必须非空，在 Cover Settings registry 中唯一。
   * 通常与 DatabaseViewCoverExtension.id 相同。
   */
  id: string;
  /** 第三方 DOM settings factory；必须提供。 */
  settings: ViewInstanceFactory<DatabaseViewCoverSettingsProps>;
}

interface DatabaseViewCoverSettingsProps extends XdbContextProps, XdbDataProps {
  /** settings 根容器。 */
  container: HTMLElement;
  /** 当前 Database；Settings 不拥有它。 */
  api: Database;
  /** 当前 View id。 */
  viewId: string;
}
```

Cover settings 当前没有 `SettingUi` builder；使用 `container` 渲染，并在 `onDestroy()` 清理资源。
