# View 扩展

先读 [View API Schema](api-schema.md#view) 和 [Database 数据 schema](types/database.md#数据结构)。本页说明 Plain View / Database View 的选择、渲染和配置写回。

先按数据需求选择注册方法：

| 方法                     | 使用场景                                | `onUpdate(props)`                        |
| ------------------------ | --------------------------------------- | ---------------------------------------- |
| `registerView()`         | 说明、工具、编辑器等不读取行数据的 View | `ViewProps`                              |
| `registerDatabaseView()` | 表格、卡片、图表等读取当前 View 行数据  | `DatabaseViewProps`，额外包含 `viewData` |

两者都使用 DOM `view()` factory；第三方插件不使用内部 React `viewComponent`。

## 最小 Database View

```js
const PLUGIN_ID = 'example-row-list';
const VIEW_TYPE = `${PLUGIN_ID}:view`;

ctx.registerDatabaseView({
  id: VIEW_TYPE,
  name: 'Row List',
  icon: 'List',
  isDatabaseView: true,
  view() {
    return {
      onUpdate(props) {
        const rows = flattenUniqueRows(props.viewData.groups);
        const root = props.container.ownerDocument.createElement('div');
        for (const row of rows) {
          const item = props.container.ownerDocument.createElement('div');
          item.textContent = props.api.getRowLink(row.id)?.label ?? row.id;
          root.appendChild(item);
        }
        props.container.replaceChildren(root);
      },
      onDestroy() {},
    };
  },
});

function flattenUniqueRows(groups, result = [], seen = new Set()) {
  for (const group of groups) {
    for (const row of group.rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      result.push(row);
    }
    flattenUniqueRows(group.groups ?? [], result, seen);
  }
  return result;
}
```

一行可能因多值分组出现在多个组；需要扁平列表或全局统计时按 `row.id` 去重。要按组展示时，直接保留 `groups` 结构。

## 扩展形状

```ts
interface ViewExtension {
  id: string;
  name: string;
  icon?: string;
  description?: string;
  /** 第三方 DOM View 的 factory；必填。 */
  view: () => ViewInstance<ViewProps>;
}

interface DatabaseViewExtension extends Omit<ViewExtension, 'view'> {
  isDatabaseView: true;
  /** 额外接收宿主投影后的 viewData；必填。 */
  view: () => ViewInstance<DatabaseViewProps>;
}

interface ViewInstance<T> {
  onUpdate(props: T): void;
  onDestroy(): void;
}
```

`id` 是写入 `.xdb` 的 `view.type`，必须稳定，并在 Plain View 与 Database View 共用的 View registry 中唯一。字段约束和失败边界以 [View API Schema](api-schema.md#view) 为准。

## Props

```ts
interface ViewProps extends XdbContextProps {
  container: HTMLElement;
  api: Database;
  viewId: string;
  viewDefinition: DatabaseViewDefinition;
  state: {
    get(key: string): unknown;
    set(key: string, value: unknown): void;
    delete(key: string): void;
  };
}

interface DatabaseViewProps extends ViewProps {
  viewData: DatabaseViewData;
}
```

- 持久化配置：读 `viewDefinition.options[pluginId]`。
- 当前 View 已投影的数据：读 `viewData.visibleFields`、`allFields`、`groups` 和 `summary`。
- 临时 UI 状态：用带命名空间 key 的 `state`。它不持久化，View 重新挂载后清空，并与 Action Menu context 共享。
- 额外数据库读写：用 `api`，见 [Database API](types/database.md)。

## 在 View 内写配置

View props 没有 `setViewDefinition()`。写入前从当前 definition 重读目标 View，避免用旧 props 覆盖 filter、sort 或 layouts：

```js
async function updateViewOptions(api, viewId, pluginId, patch) {
  const current = api.getDefinition().views?.find((view) => view.id === viewId);
  if (!current) throw new Error(`View not found: ${viewId}`);

  const previous = current.options?.[pluginId];
  const pluginOptions = previous && typeof previous === 'object' && !Array.isArray(previous) ? previous : {};

  await api.updateView({
    ...current,
    options: {
      ...(current.options ?? {}),
      [pluginId]: { ...pluginOptions, ...patch },
    },
  });
}
```

Settings 扩展有专用的 functional setter，应优先使用 `props.setViewDefinition(current => next)`，见 [view-settings](view-settings.md)。

## 宿主提供的设置入口

- `registerView()` 成功后，宿主会添加打开共享 `View` tab 的 Settings toolbar action。
- `registerDatabaseView()` 会获得 `field`、`filter`、`sort`、`group` 数据设置 tab，但不会自动给第三方 View 注册全部 toolbar action。需要从 toolbar 打开某个 tab 时，显式注册 `registerViewActionMenu()`。
- 自定义设置内容用 `registerViewSettings()`；自定义独立 tab 用 `registerViewSettingsTab()`。

## 实现检查

- `onUpdate()` 可反复调用；更新 DOM，不要不断 append 旧 UI。
- 不在 `onUpdate()` 里复制订阅 `viewData`；宿主会在数据变化后再次传入最新 props。
- observer、listener、chart、Component 和异步任务在下一轮或 `onDestroy()` 清理。
- `onUpdate()` 不返回 Promise；异步任务自行捕获错误，并用 generation token 或 AbortController 丢弃旧结果。
- 万级行不要一次创建全部 DOM；使用窗口化、渐进渲染或先聚合。
