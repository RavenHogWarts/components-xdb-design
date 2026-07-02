# Database View

注册一个新的视图。`XdbApp` 暴露两个入口，区别只在**是否加载行数据**：

| 方法 | 何时用 | props 是否含 `viewData` |
| --- | --- | --- |
| `registerView()` | 视图只用 `viewDefinition`（标题栏、字段概览等），不读行数据 | 否 |
| `registerDatabaseView()` | 视图要读行数据（表格、图表、卡片等） | 是 |

两者共享同一个 `view: () => ({ onUpdate, onDestroy })` 工厂结构，注册后都写入 `viewDefinition.type`。

## 配置位置

`viewDefinition.options`

## 注册接口

```ts
type ViewExtension = {
  /** view type，写到 viewDefinition.type，并用来绑定对应 settings 扩展 */
  id: string;
  /** UI 中显示的视图名称 */
  name: string;
  /** camelCase 的 Lucide 名称，例如 barChart2 */
  icon?: string;
  description?: string;
  view: () => {
    /** 首次渲染和后续数据/配置变化时调用 */
    onUpdate: (props: ViewProps | DatabaseViewProps) => void;
    /** 宿主销毁该实例时调用 */
    onDestroy: () => void;
  };
};
```

## viewDefinition

`onUpdate` 的 props 都会带 `viewDefinition`：

```ts
type viewDefinition = {
  /** 当前 view 实例 id */
  id: string;
  /** 当前 view 名称 */
  name: string;
  /** 当前 view 类型 */
  type: string;
  icon?: string;
  /** 当前 view 显示哪些字段 */
  visibleFields?: string[];
  /** 当前 view 的过滤条件 */
  filter?: unknown;
  sort?: Array<{
    /** 排序字段名 */
    field: string;
    /** 默认 asc */
    direction?: 'asc' | 'desc';
  }>;
  group?: {
    by: Array<{
      /** 分组字段名 */
      field: string;
      /** 组值排序规则 */
      sort?: 'asc' | 'desc' | Array<string | null>;
      /** 隐藏的组值 */
      hidden?: Array<string | null>;
      /** 固定显示的组值 */
      pinned?: Array<string | null>;
    }>;
    /** 折叠状态 */
    collapsed?: Array<Record<string, string | null>>;
    /** 分组头摘要表达式 */
    summary?: string;
  };
  /** 每列的汇总表达式 */
  summary?: Record<string, string>;
  /** 新建记录时默认模板 id */
  defaultTemplateId?: string;
  /** 树形结构的父字段名 */
  tree?: { parentField: string };
  /** 当前 view 的自定义持久化配置 */
  options?: Record<string, unknown>;
};
```

## props：registerView（不读行数据）

[公共上下文 props](conventions.md#公共上下文-props) 外加：

```ts
type ViewProps = XdbContextProps & {
  /** 当前 view 的挂载容器 */
  container: HTMLElement;
  /** 数据库读写入口（updateView/updateRow/updateCell/getRowLink…），完整能力见 types.md */
  api: Database;
  viewId: string;
  viewDefinition: viewDefinition;
};
```

`registerView` 示例（只用 viewDefinition，不读行数据）：

```js
ctx.registerView({
  id: 'view-summary',
  name: 'View Summary',
  view() {
    return {
      onUpdate(props) {
        const def = props.viewDefinition;
        props.container.replaceChildren();
        const el = document.createElement('div');
        el.textContent = `${def.name} · 显示 ${def.visibleFields?.length ?? 0} 个字段`;
        props.container.appendChild(el);
      },
      onDestroy() {},
    };
  },
});
```

## props：registerDatabaseView（带数据）

在 `ViewProps` 基础上**多一个 `viewData`**：

```ts
type DatabaseViewProps = ViewProps & {
  viewData: {
    name: string;
    type: string;
    visibleFields: Array<{
      name: string;
      type?: string;
      formula?: string;
      options?: Record<string, unknown>;
    }>;
    allFields: Array<{
      name: string;
      type?: string;
      formula?: string;
      options?: Record<string, unknown>;
    }>;
    groups: Array<{
      /** 当前分组字段名；未分组时为 null */
      field: string | null;
      /** 当前组的组值 */
      value: unknown;
      rows: Array<{
        id: string;
        /** 原始行数据，结构见 types.md */
        $item: Record<string, unknown>;
      }>;
      /** 子分组，结构同当前分组 */
      groups?: Array<Record<string, unknown>>;
      /** 当前组摘要 */
      summary?: string;
      /** 当前组每列汇总结果 */
      rowSummary?: Record<string, string>;
    }>;
    /** 计算后的 view 选项 */
    options?: Record<string, unknown>;
    /** 当前 view 每列汇总结果 */
    summary?: Record<string, string>;
  };
};
```

## 实现要求

- 只负责渲染
- 配置读 `props.viewDefinition`，数据读 `props.viewData`（仅 database view）
- view 内部轻量更新通过 `props.api.updateView(...)`

推荐写法：

```js
function updateViewOptions(api, viewDefinition, patch) {
  return api.updateView({
    ...viewDefinition,
    options: { ...(viewDefinition.options ?? {}), ...patch },
  });
}
```
