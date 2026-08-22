# Root Group 与嵌套 Group

XDB 有两层容器：

- `rootGroup` 组织所有根 View，是数据库首页的布局。
- `type: "group"` 的 View 只用于首页内部继续嵌套一组子 View。

先配置 `rootGroup`。只有局部还需要 tabs、vertical-tabs 或 dashboard 时，才新增 `group` View。

固定外壳与 `group` 专属字段以 [`.xdb` Schema](schema.md#rootgroupdefinition) 和 [View Schema](view-schema.md#group) 为准；本页说明两层容器怎样组合。

## Root Group

```ts
interface RootGroupDefinition {
  type?: 'tabs' | 'vertical-tabs' | 'dashboard';
  options?: {
    sidebarWidth?: number;
    locked?: boolean;
  };
  style?: DatabaseViewStyle;
}
```

```json
{
  "rootGroup": {
    "type": "dashboard",
    "options": { "locked": false }
  },
  "views": [
    {
      "id": "summary",
      "name": "总览",
      "type": "metric",
      "layouts": {
        "laptop": { "x": 0, "y": 0, "w": 6, "h": 4 },
        "mobile": { "x": 0, "y": 0, "w": 4, "h": 4 }
      }
    },
    { "id": "details", "name": "明细", "type": "table" }
  ]
}
```

根 View 的 `parentId` 为空或缺省。`rootGroup.type` 省略时按 `tabs` 处理。

| 类型            | 使用场景                    | 相关 options   |
| --------------- | --------------------------- | -------------- |
| `tabs`          | 少量入口，一次查看一个 View | 无             |
| `vertical-tabs` | View 较多，需要左侧导航     | `sidebarWidth` |
| `dashboard`     | 指标、图表和明细同时出现    | `locked`       |

整库样式也由 `rootGroup.style` 负责，见 [view-style](view-style.md)。

## 嵌套 Group View

需要在某个 dashboard 格子或 tab 内再组织一组 View 时，使用 `type: "group"`：

```ts
interface GroupViewOptions {
  groupType?: 'tabs' | 'vertical-tabs' | 'dashboard';
  sidebarWidth?: number;
  locked?: boolean;
}
```

```json
[
  {
    "id": "periods",
    "name": "周期",
    "type": "group",
    "options": { "groupType": "tabs" },
    "layouts": {
      "laptop": { "x": 0, "y": 0, "w": 8, "h": 8 },
      "mobile": { "x": 0, "y": 0, "w": 4, "h": 8 }
    }
  },
  {
    "id": "this-month",
    "name": "本月",
    "type": "metric",
    "parentId": "periods"
  },
  {
    "id": "last-month",
    "name": "上月",
    "type": "metric",
    "parentId": "periods"
  }
]
```

规则：

- `parentId` 只能为空，或指向一个存在的 `group` View。
- `group` 可以嵌套，但层级不能形成环。
- `groupType` 省略时按 `tabs` 处理。
- `sidebarWidth` 只影响 `vertical-tabs`；`locked` 只影响 `dashboard`。
- 移动 View 到新父容器时，旧 dashboard 的 `layouts` 会失效，应重新检查或生成布局。

## Dashboard layouts

dashboard 的位置保存在**子 View 自己**的 `layouts`，不是父容器：

```json
{
  "layouts": {
    "laptop": { "x": 0, "y": 0, "w": 12, "h": 10 },
    "mobile": { "x": 0, "y": 0, "w": 4, "h": 10 }
  }
}
```

- `laptop` 使用 24 列，保证 `x + w <= 24`。
- `mobile` 使用 4 列，保证 `x + w <= 4`。
- 同一 dashboard 的卡片不要重叠；移动容器后重新检查两套断点。
- tabs / vertical-tabs 不需要 `layouts`。

## 选择原则

- 首页要 tabs、侧栏或 dashboard：改 `rootGroup`，不要增加包装用的根 `group` View。
- 只在局部收拢同类 View：增加嵌套 `group` View。
- 能用一层 rootGroup 表达的结构，不再多套一层 group。
