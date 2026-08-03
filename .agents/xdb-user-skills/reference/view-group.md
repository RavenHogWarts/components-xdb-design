# group

## 视图简介

容器视图，把多个视图组合到一个页面。是 xdb 中唯一的容器视图，可无限嵌套。

## 适用场景

- 把多个视图组织成一个页面（单一入口）。
- 仪表盘：dashboard 布局 + 若干子视图。
- 嵌套组合：dashboard 格子里再放一个 tabs / vertical-tabs。
- 比如在 dashboard 中放一个销售视图，通过 tab 可以切换年、月、季的不同维度视图

## Schema

```ts
interface GroupViewDefinition extends DatabaseViewDefinition {
  type: 'group';
  options?: GroupViewOptions;
}

interface GroupViewOptions {
  groupType?: 'tabs' | 'vertical-tabs' | 'dashboard';
  locked?: boolean;            // dashboard 专用
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `options.groupType` | `'tabs' \| 'vertical-tabs' \| 'dashboard'` | 否 | 布局类型，默认 `'tabs'` |
| `options.locked` | `boolean` | 否 | dashboard 专用，默认 `false`。`true` 时禁止拖拽 / 缩放网格项 |

| `groupType` | 说明 |
| --- | --- |
| `tabs` | 顶部水平标签条，一次显示一个子视图（默认） |
| `vertical-tabs` | 左侧竖向标签条，一次显示一个子视图 |
| `dashboard` | 响应式网格，所有子视图同时显示 |

### parentId 与嵌套

所有视图平铺在 `views` 数组中。父子关系由 `parentId` 建立：

- `parentId` 为 `null` / 缺省 → 顶层视图，挂在根标签条上。
- `parentId` 指向某 `group` 视图的 id → 该视图是那个 group 的子视图。

group 可嵌套：子视图也可以是 group。删除 group 会级联删除其所有子孙视图。

最新宿主支持在 View Settings 的「移动视图」中把视图移到根或任意 `group`：

- 不能移动到普通数据视图，也不能移入自己的子树。
- 移动操作会把被移动视图放到目标 group 子树之后，并清除它旧的 `layouts`。
- 移入 dashboard 后由宿主生成无冲突默认位置；手工修改 JSON 的 `parentId` 时也应删除旧 `layouts` 并重新布局。
- `parentId` 的层级不能形成环；手写 `.xdb` 后必须跑 validator。

> 顶层标签条由外壳固定按 `tabs` 渲染（不存储为 group）。要让整个数据库首页就是仪表盘：建一个顶层 `group`（`groupType: 'dashboard'`），其它视图都挂在其下。

## dashboard 网格

dashboard 用网格摆放子视图。位置信息存在**每个子视图自己**的 `layouts` 字段：

```ts
layouts: {
  laptop?: { x: number; y: number; w: number; h: number };
  mobile?: { x: number; y: number; w: number; h: number };
}
```

| 断点 | 触发宽度 | 列数 | 说明 |
| --- | --- | --- | --- |
| `laptop` | 容器 ≥ 720px | 24 列 | `x + w` 不应超过 24 |
| `mobile` | 容器 < 720px | 4 列 | `x + w` 不应超过 4 |

- `x` / `y`：网格列 / 行坐标（0 起）。
- `w` / `h`：占多少列 / 多少行。
- 行高 12px，间距 12px。

默认摆放：laptop 每个子视图占 4×4、每行 3 个；mobile 全宽纵向堆叠。

## 最佳实践

- 多个顶层视图应收进一个 group（避免顶层散落）。
- 仪表盘布局从上到下：顶部一排 metric（小格）、中部 charts（中格）、底部 table / kanban（占满宽的大格）。各视图尺寸见 [best-practices.md](best-practices.md#3-仪表盘网格尺寸laptop-24-列基准)。
- 嵌套不要过深，一般 2 层足够。
