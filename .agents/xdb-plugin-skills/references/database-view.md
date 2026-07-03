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

`onUpdate` 的 props 都会带 `viewDefinition`（对应类型 `DatabaseViewDefinition`）：

```ts
type DatabaseViewDefinition = {
  /** 当前 view 实例 id */
  id: string;
  /** 当前 view 名称 */
  name: string;
  /** 当前 view 类型，写到 viewDefinition.type，并用来绑定对应 settings 扩展 */
  type: string;
  /**
   * 父 view id：缺省/null 表示挂在根 tab 条上；填字符串表示由那个父 view 渲染
   * （例如 dashboard 视图渲染它的子视图）。第三方视图通常用不到。
   */
  parentId?: string | null;
  /** camelCase 的 Lucide 名称 */
  icon?: string;
  /**
   * dashboard 布局的网格位置（按断点 key）。
   * 设计上「布局存在子视图（我在哪）」而非父视图。
   */
  layouts?: Record<string, { x: number; y: number; w: number; h: number }>;
  /** 当前 view 显示哪些字段（字段名数组） */
  visibleFields?: string[];
  /** 当前 view 的过滤条件，结构见 types.md#FilterItem */
  filter?: FilterItem;
  /** 排序规则，按优先级；direction 默认 'asc' */
  sort?: Array<{ field: string; direction?: 'asc' | 'desc' }>;
  /** 分组定义，见下面 DatabaseViewGroupDefinition */
  group?: DatabaseViewGroupDefinition;
  /** 每列的汇总表达式，key 是字段名；表达式里可用 $values（该列值数组）和 $items（整行对象数组） */
  summary?: Record<string, string>;
  /** 新建记录时默认模板 id */
  defaultTemplateId?: string;
  /** 行链接 / 内链的打开方式，默认 'tab' */
  linkOpenMode?: 'tab' | 'split' | 'window' | 'modal-center' | 'modal-right' | 'modal-left' | 'current' | 'none';
  /** 树形结构的父字段名 */
  tree?: { parentField: string };
  /** 返回行数上限 */
  limit?: number;
  /** 当前 view 的自定义持久化配置（插件自己的配置都写这里） */
  options?: Record<string, unknown>;
};

type DatabaseViewGroupDefinition = {
  /** 分组层级，数组顺序即嵌套顺序 */
  by: Array<{
    /** 分组字段名 */
    field: string;
    /** 组值排序：'asc' | 'desc' | 手动顺序数组（数组不是白名单） */
    sort?: 'asc' | 'desc' | Array<string | null>;
    /** 隐藏的组值 */
    hidden?: Array<string | null>;
    /** 固定显示的组值 */
    pinned?: Array<string | null>;
  }>;
  /** 已折叠的分组选择器（按完整前缀路径匹配组节点） */
  collapsed?: Array<Record<string, string | null>>;
  /** 分组头摘要表达式 */
  summary?: string;
};
```

> `viewDefinition` 里的字段大部分由宿主管理，插件一般只**读**它们。插件自己要持久化的配置统一写到 `options`。

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

在 `ViewProps` 基础上**多一个 `viewData`**（对应 `DatabaseViewData`）：

```ts
type DatabaseViewProps = ViewProps & {
  viewData: {
    name: string;
    type: string;
    /** 当前 view 要渲染的可见字段（已按 visibleFields 过滤） */
    visibleFields: DatabaseFieldDefinition[];
    /** 全量字段 schema（不论是否可见） */
    allFields: DatabaseFieldDefinition[];
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
      groups?: DatabaseViewGroup[];
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

type DatabaseFieldDefinition = {
  name: string;
  type?: DatabaseFieldType; // 'text' | 'number' | 'boolean' | 'date' | 'datetime' | 'select' | 'multi-select' | 'button' | string
  formula?: string;
  options?: Record<string, unknown>;
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
