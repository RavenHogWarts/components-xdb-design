# View Action Menu

先读 [View Action Menu API Schema](api-schema.md#view-action-menu)。本页说明 toolbar 行为与设置 tab 路由。

注册视图工具栏上的一个操作项（search / filter / sort / create 这类入口）。View Action Menu 只决定
工具栏里出现哪些按钮、它们的可见/激活/禁用状态以及点击行为；它不渲染视图主体，也没有“当前行”。需要判断整份 View 数据时可读取 `context.viewData`。

每个菜单项要么打开一个已注册的 settings tab，要么执行一次 `onClick`，二者**必须二选一**。

## 注册契约

```ts
type ViewActionMenuContext = Readonly<{
  app: App;
  database: Database;
  viewDefinition: DatabaseViewDefinition;
  viewData: DatabaseViewData | null;
  state: ViewState;
  search: Readonly<{
    open: boolean;
    query: string;
    setOpen: (open: boolean) => void;
    setQuery: (query: string) => void;
  }>;
}>;

type ViewState = Readonly<{
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
  delete: (key: string) => void;
}>;

type ViewActionMenuResult = void | Readonly<{ type: 'created-item'; href: string; status: 'visible' | 'not-visible' }>;

type ViewActionMenuExtension = {
  /** 稳定身份；同一 registry 内唯一。 */
  id: string;
  label: string;
  /** 宿主可识别的 Lucide 名称，例如 Search。 */
  icon: string;
  /** 命中时才在该视图上显示；省略表示对所有视图类型可用。 */
  viewTypes?: string[];
  /** 越小越靠前；省略时宿主排在最后。 */
  order?: number;
  isVisible?: (context: ViewActionMenuContext) => boolean;
  isActive?: (context: ViewActionMenuContext) => boolean;
  isDisabled?: (context: ViewActionMenuContext) => boolean;
} & (
  | { settingTabId: string; onClick?: never }
  | {
      settingTabId?: never;
      onClick: (context: ViewActionMenuContext) => ViewActionMenuResult | Promise<ViewActionMenuResult>;
    }
);
```

`registerViewActionMenu()` 返回 `boolean`。shape 不合法或 `id` 重复时返回 `false`，插件不应继续假设菜单项已经安装：

```js
const registered = ctx.registerViewActionMenu({
  id: 'my-plugin:toggle-panel',
  label: 'Panel',
  icon: 'PanelRight',
  viewTypes: ['my-view'],
  order: 800,
  onClick: ({ viewDefinition }) => {
    // 执行一次操作；可返回 created-item 引导宿主跳转
  },
});
if (!registered) throw new Error('Could not register panel menu item');
```

## settingTabId 与 onClick 二选一

- `settingTabId`：点击后切换到该 id 对应的 settings tab（即 `registerViewSettingsTab()` 注册的 tab，或宿主内置 tab 如 `filter` / `sort` / `field` / `view`）。适合「打开配置面板」类入口。
- `onClick`：点击即执行一次同步/异步操作，可返回 `{ type: 'created-item', href, status }` 指示宿主跳到新建项。

两者都给或都不给会被宿主拒绝。这一约束与内部内置菜单项一致（见 `registerRecordViewActionMenus` / `registerDataViewActionMenus`）。

## 可见、激活、禁用

三个回调都接收同一 `ViewActionMenuContext`，宿主在渲染时调用：

- `isVisible(context)`：返回 `false` 时该项完全不渲染。例如内置 `field` 菜单在移动端隐藏。
- `isActive(context)`：返回 `true` 时高亮（表示当前处于该状态）。例如 `filter` 菜单在有筛选规则时高亮。
- `isDisabled(context)`：返回 `true` 时置灰不可点。例如 `data` 菜单在 `viewData` 为空时禁用。

三个回调都必须是同步、无副作用的纯函数。

## search 状态

`context.search` 是宿主为当前视图维护的搜索态。内置 search 菜单通过它切换搜索框开关与查询词；第三方菜单项也可读取它来决定 `isActive`，或在其 `onClick` 中联动。不要假定它始终处于初始值——用户可能在多个菜单项间切换。

## 临时视图状态

`context.state` 与当前渲染中的 view 共享同一个内存状态对象。它随当前 view 挂载创建，切换 view、关闭分栏或重新挂载后清空，不写入 `viewDefinition`。菜单和视图之间的临时 UI 状态使用插件命名空间 key，例如 `my-plugin:panel-open`。

需要跨会话保留的配置仍写入 `viewDefinition.options`；不要把业务配置放进 `state`。

## 注册失败处理

`registerViewActionMenu()` 与 `registerAction()` / `registerFieldType()` 同属返回 `boolean` 的扩展点。失败原因包括：

- 缺少 `id` / `label` / `icon`，或 `order` 非有限数；
- `viewTypes` 不是数组，或数组中含空白/非字符串值（空数组本身合法，但不会匹配任何 View）；
- `settingTabId` 与 `onClick` 没有恰好提供一个；
- 同一 registry 内 `id` 重复。

注册失败时应立即抛错，不要继续假设菜单项已生效。其它扩展点（`registerView` 等）返回 `void`，不能用同样的返回值判断。

## 与其它扩展点的关系

- `registerView()` 会自动为普通视图注册打开共享 `View` tab 的 Settings action。
- 其它显式 View Action Menu **不依赖** `registerView()` / `registerDatabaseView()`：你可以为任意视图类型（包括内置 table / kanban / calendar）追加菜单项，只要 `viewTypes` 命中。
- 用 `settingTabId` 打开的 settings tab，应已由 `registerViewSettingsTab()` 或宿主内置提供；不存在时当前宿主可能回退到第一个 tab，不要把这种回退当作稳定路由。
- View Action Menu 可读取当前 View 的整体 `viewData`，但没有当前行。需要明确行上下文的操作用按钮字段（见 [action](action.md)）。
