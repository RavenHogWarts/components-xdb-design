# 生命周期与最佳实践

## 生命周期

```mermaid
flowchart TD
  A[加载 .xdb.js] --> B[执行 module.exports.install(ctx)]
  B --> C[注册扩展点]
  C --> D[宿主创建 view/settings 实例]
  D --> E[首次调用 onUpdate(props)]
  E --> F[数据或配置变化]
  F --> G[再次调用 onUpdate(props)]
  G --> F
  D --> H[宿主销毁实例]
  H --> I[调用 onDestroy()]
  I --> J[插件被卸载或重载]
  J --> K[执行 install() 返回的 cleanup]
```

要求：

1. `install(ctx)` 只做注册和清理函数准备。
2. `onUpdate(props)` 必须可重复执行。
3. `onDestroy()` 释放当前实例持有的运行时资源。
4. `install()` 返回的 cleanup 负责插件级清理。

运行时资源包括：DOM 引用、`ResizeObserver`、ECharts 实例、事件监听器。

文件被 `create` / `modify` / `rename` 成 `.xdb.js` 会触发安装/重载；`delete` 或改名离开 `.xdb.js` 会触发卸载。重载 = 先卸载（跑 cleanup）再安装。

## 最佳实践

### 以 `view()` / `settings()` 作为标准入口

自定义 view 从 `view()` 开始；自定义 settings 从 `settings()` 开始。

### 性能：万级数据要按需渲染

数据库视图一次性可能拿到上万条记录——`props.viewData.groups[].rows[]` 是完整筛选结果，宿主**不会替你虚拟化**。在 `onUpdate` 里为每条记录建 DOM 或算图表，界面会直接卡死。

- **只渲染可见行**：用 `IntersectionObserver`（或窗口化）滚到哪画到哪。仓库示例 `examples/waterfall-view.xdb.js` 就是这个模式。
- **先聚合再画图**：图表基于聚合结果（count / sum / avg），不要一行一个数据点。
- **重对象只建一次**：ECharts 实例等用 `setOption` 增量更新，不要每次 `onUpdate` 重建。
- **事件用委托**：监听器挂在容器上，别每行一个。
- **`onDestroy` 释放**：`IntersectionObserver` / `ResizeObserver` 要在 `onDestroy` 里 `disconnect()`。

```js
view() {
  let io;
  return {
    onUpdate(props) {
      io?.disconnect();                  // 上一轮的先释放，再做幂等重建
      props.container.replaceChildren();
      io = new IntersectionObserver((entries, observer) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          observer.unobserve(e.target);  // 进视口才渲染，渲染完就不再观察
          // 用 e.target.dataset.rowId 取行数据并渲染
        }
      });
      for (const group of props.viewData.groups) {
        for (const row of group.rows) {
          const placeholder = document.createElement('div');
          placeholder.dataset.rowId = row.id;
          props.container.appendChild(placeholder);
          io.observe(placeholder);        // 先只占位，不渲染内容
        }
      }
    },
    onDestroy() {
      io?.disconnect();
    },
  };
}
```

### 把读写配置提成 helper

```js
function readChartOptions(viewDefinition) {
  const options = viewDefinition.options ?? {};
  return {
    chartType: options.chartType === 'line' || options.chartType === 'pie' ? options.chartType : 'bar',
    chartHeight: Number.isFinite(Number(options.chartHeight)) ? Number(options.chartHeight) : 360,
  };
}

function buildNextViewDefinition(current, patch) {
  return { ...current, options: { ...(current.options ?? {}), ...patch } };
}
```

统一默认值，避免误删其他 `options`。

### 保持 `onUpdate()` 可重复执行

稳定顺序：1) 清理旧资源 → 2) 读最新 props → 3) 重建渲染。不要假设 `onUpdate()` 只调用一次。

### 样式统一通过 `registerStyleSheet()`

```js
ctx.registerStyleSheet(`.myPlugin--Root { ... }`);
```

### 匹配 Obsidian 设计风格

插件 UI 要融入 Obsidian，**不要写死颜色**——一律用 Obsidian 的 CSS 变量，这样能自动适配用户的主题（亮/暗、自定义主题）。项目里高频使用的变量：

| 用途 | 变量 |
| --- | --- |
| 文本 | `--text-normal` / `--text-muted` / `--text-faint` / `--text-accent` |
| 背景 | `--background-primary` / `--background-secondary` / `--background-modifier-border` / `--background-modifier-hover` |
| 强调色 | `--interactive-accent` |
| 圆角 | `--radius-s` / `--radius-m` |
| 字号 | `--font-ui-small` / `--font-ui-smaller` |

```css
/* 好：跟随主题 */
.myPlugin--Row {
  color: var(--text-normal);
  background: var(--background-primary);
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-m);
}

/* 不好：写死颜色，换主题就违和 */
.myPlugin--Row { color: #333; background: #fff; }
```

Obsidian 对 button / input / textarea / select 有默认样式，覆盖时要提高选择器优先级。class 统一用本插件自己的稳定前缀（见 [style-sheet](style-sheet.md)）；`components--` 是宿主保留的，第三方不要用。

### 状态优先用 `data-*`

```html
<div class="myPlugin--Toolbar" data-visible="true"></div>
```

不要把状态编码进 class 组合里。

### 字段配置优先使用 `input`

公式字段、未来可能新增的字段、团队约定字段名，优先让用户直接 `input`，不要默认做成固定 dropdown。

### ECharts 的稳定写法

1. `onUpdate()` 里初始化或重建图表
2. 用 `ResizeObserver` 驱动 `chart.resize()`
3. `onDestroy()` 里释放图表实例
4. 图表配置只从 `props.viewDefinition + props.viewData` 推导

### cleanup 与 onDestroy 的分工

```js
install(ctx) {
  const disposeSomething = () => { /* plugin-level cleanup */ };

  ctx.registerDatabaseView({
    id: 'sample-view',
    name: 'Sample View',
    view: () => ({
      onUpdate() {},
      onDestroy() { /* instance-level cleanup */ },
    }),
  });

  return () => { disposeSomething(); };
}
```
