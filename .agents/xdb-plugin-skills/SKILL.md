---
name: xdb-plugin-skills
description: 'Use when creating, editing, reviewing, or debugging XDB plugin files (*.xdb.js), including custom Action or Field types, third-party views, settings, renderers, row styles, card covers, view action menus, and plugin styles. Trigger on registerAction, registerFieldType, registerViewActionMenu, DOM extensions, lifecycle, or validation failures.'
version: '0.0.5'
author: 'vran'
---

# XDB Plugin 开发技能

## 定位与目标方

本技能是给**编写或审查 `*.xdb.js` 的编码 Agent / 插件开发者**使用的宿主契约，不是 `.xdb` 数据库配置手册。目标产物不是“看起来像插件的脚本”，而是一个能被 XDB 宿主加载、热重载、持久化配置、稳定重复渲染并完整卸载的插件。

- 要生成或修改 `.xdb` 数据库定义：改用 `xdb-user-skills`。
- 要扩展 XDB 的 Action、视图、设置、字段渲染、行样式或卡片封面：使用本技能。
- 当 reference 与当前仓库代码冲突时，以 `src/v3/componnet/database2/module/plugin`、`api`、`action` 的类型与测试为准，并同步修正文档；不要猜 API。

## 使用流程

做以下任何一件事之前，先读本技能再动手：

- 新建或修改 `*.xdb.js` 插件文件
- 为 xdb 注册第三方扩展点（Action / 视图 / 字段渲染与设置 / 行样式 / 卡片封面 / 样式）
- 排查"插件没加载 / 改了不生效 / 配置没持久化 / 渲染越来越重"等问题

按以下顺序交付：

1. **界定扩展点**：先说明为什么用该 `registerXxx`，配置写在哪里，是否需要行数据或当前行。
2. **读取对应 reference**：只打开下方路由表中与任务有关的契约；不要从内置 React 组件反推第三方 API。
3. **实现最小插件**：稳定且带命名空间的 plugin / extension / Action id；`install()` 只注册并返回 cleanup。
4. **验证静态契约**：运行 validator，修完所有 error，并逐项判断 warning。
5. **验证运行时**：至少覆盖持久化、重复 `onUpdate`、热重载、卸载和失败诊断；静态 validator 不能代替这些检查。

## 运行流程

```
宿主扫描 *.xdb.js
  └─> 执行 module.exports.install(ctx)        // 只注册 + 返回 cleanup
        └─> ctx.registerXxx(...)              // 把扩展登记进宿主
              └─> 宿主按需创建实例
                    └─> 数据/配置变化时调用 instance.onUpdate(props)
                          └─> 实例替换/卸载时调用 instance.onDestroy()
        └─> 插件卸载/重载时执行 install() 返回的 cleanup
```

`ctx` 上**所有**方法都是面向插件开发者的能力（即 `install(ctx)` 收到的 `ctx`）。记住四条规则，能自检绝大多数问题：

1. **install 只注册**：`install(ctx)` 只注册扩展点、返回 cleanup，不做渲染。
2. **配置写对地方**：view 配置写 `viewDefinition.options`；Field Renderer/Settings 配置写 `field.options`；cover 私有配置用 `getData()` / `updateData()`。
3. **onUpdate 可重复**：它会被反复调用；先清理或安全复用旧资源，再从最新 props 更新渲染。
4. **选择性不等于权限**：Action 的 `match` 只控制 picker；需要行的 handler 仍必须检查 `context.row`。
5. **设置项优先用 `props.setting`**：凡是 Field Settings、View Settings、View Settings Tab、Action editor 的 `onUpdate(props)`，普通输入/开关/选择器/各种 autocomplete 必须通过 `props.setting.*` 声明，由宿主渲染成标准设置组件——视觉与内置项一致，且复用了第三方无法自行构建的 React 上下文（vault、portal、数据库 schema）。只有图表、第三方库挂载等 `props.setting` 无法表达的渲染，才退回 `props.container` 裸 DOM（或用 `props.setting.custom()` 做局部逃生舱）。详细方法表见 [view-settings](references/view-settings.md#复用宿主-setting-组件propsetting)，该能力由 `SettingUi`（`src/v3/componnet/database2/module/plugin/types/SettingUi.ts`）定义。

## Quick Start

```js
const PLUGIN_ID = 'example-list-plugin';
const VIEW_TYPE = 'example-list';
const OPTIONS_KEY = PLUGIN_ID;

function updateCurrentViewOptions(props, patch) {
  const current = props.api.getDefinition().views?.find((view) => view.id === props.viewId);
  if (!current) throw new Error(`View not found: ${props.viewId}`);
  return props.api.updateView({
    ...current,
    options: {
      ...(current.options ?? {}),
      [OPTIONS_KEY]: { ...(current.options?.[OPTIONS_KEY] ?? {}), ...patch },
    },
  });
}

module.exports = {
  id: PLUGIN_ID,
  name: 'Example List View',
  description: 'A minimal custom database view plugin.',
  author: 'Your Name',
  version: '1.0.0',

  install(ctx) {
    ctx.registerDatabaseView({
      id: VIEW_TYPE,
      name: 'Example List',
      icon: 'list',
      view() {
        return {
          onUpdate(props) {
            props.container.replaceChildren();
            const root = document.createElement('div');
            const rowIds = new Set();
            const collectRows = (groups) =>
              groups.forEach((group) => {
                group.rows.forEach((row) => rowIds.add(row.id));
                collectRows(group.groups ?? []);
              });
            collectRows(props.viewData.groups);
            const options = props.viewDefinition.options?.[OPTIONS_KEY] ?? {};
            root.textContent = `${options.compact ? 'Compact' : 'Normal'} · Rows: ${rowIds.size}`;
            props.container.appendChild(root);
          },
          onDestroy() {},
        };
      },
    });

    ctx.registerViewSettings({
      id: VIEW_TYPE,
      viewTypes: [VIEW_TYPE],
      settings() {
        return {
          onUpdate(props) {
            props.container.replaceChildren();
            const button = document.createElement('button');
            button.textContent = 'Enable compact mode';
            button.addEventListener('click', () => {
              void updateCurrentViewOptions(props, { compact: true });
            });
            props.container.appendChild(button);
          },
          onDestroy() {},
        };
      },
    });

    return () => undefined;
  },
};
```

## 写完自检

写或改完 `*.xdb.js` 后，跑校验脚本自检——它复刻宿主加载方式 + skill 规则，给出确定性结论，比凭记忆核对可靠：

```bash
node docs/skills/xdb-plugin-skills/scripts/validate-xdb-plugin.mjs path/to/your.xdb.js
```

检查：shape（id / name / description / install）、install 是否返回 cleanup、每个 `registerXxx` 的扩展形状、同一 registry 内重复 id、是否调用已删除或废弃的 API、CSS 是否用了宿主保留前缀 `components--`，并打印注册了哪些扩展点（被宿主拒绝的会标 `✗ rejected`）。退出码非 0 即有硬错。

查不了的（`onUpdate` 幂等性、配置写对位置、运行时是否抛错）仍按 [lifecycle](references/lifecycle.md) / [conventions](references/conventions.md) 自己核对。

### 诊断边界

不要把“插件显示为 installed”当作所有扩展都注册成功：

| 信号                                                  | 能确认什么                                              | 不能确认什么                       |
| ----------------------------------------------------- | ------------------------------------------------------- | ---------------------------------- |
| `registerAction()` / `registerFieldType()` / `registerViewActionMenu()` 的 boolean | 当前 Action / Field type / 视图工具栏项是否注册成功     | 其它扩展点                         |
| 其它 `registerXxx()`                                  | 返回 `void`，插件侧不能直接判断                         | id 冲突、形状拒绝                  |
| 插件管理视图                                          | 文件 eval/shape 失败、plugin id 冲突                    | `install()` 抛错和全部扩展注册失败 |
| 控制台 `[xdb-plugin]` 日志                            | manager 的 shape / duplicate 拒绝、install/cleanup 异常 | 持久化、渲染幂等性和资源泄漏       |
| validator                                             | 单文件静态 shape、同文件重复注册、废弃 API              | 跨插件冲突和运行时行为             |

因此：Action / Field Type / View Action Menu 注册失败应立即抛错；其它扩展使用全局唯一命名空间、先跑 validator，再在控制台和 UI 中确认注册结果。

## 扩展点速查

| 能力（ctx 方法）                                              | 用途                                                     | 配置位置                 | 详细                                                   |
| ------------------------------------------------------------- | -------------------------------------------------------- | ------------------------ | ------------------------------------------------------ |
| `registerAction()`                                            | 注册可持久化、可编辑、可执行的 Action type               | Action payload 所在入口  | [action](references/action.md)                         |
| `registerView()`                                              | 注册视图（只用 `viewDefinition`，不读行数据）            | `viewDefinition.options` | [xdb-view](references/xdb-view.md)                     |
| `registerDatabaseView()`                                      | 注册数据库视图（要读行数据 `viewData`）                  | `viewDefinition.options` | [xdb-view](references/xdb-view.md)                     |
| `registerViewSettings()`                                      | 扩展共享 `View` 设置 tab 的内容                          | `viewDefinition.options` | [view-settings](references/view-settings.md)           |
| `registerViewSettingsTab()`                                   | 新增一个独立的视图设置 tab item（有自己的 label / icon） | `viewDefinition.options` | [view-settings-tab](references/view-settings-tab.md)   |
| `registerViewActionMenu()`                                    | 注册视图工具栏操作项（search/filter/create 类入口）      | 不存配置                 | [view-action-menu](references/view-action-menu.md)     |
| `registerFieldType()`                                         | 注册字段类型目录、图标与当前 source 下的可选择性         | 不存配置                 | [field-type](references/field-type.md)                 |
| `registerFieldRenderer()`                                     | 根据运行时字段 definition 自定义字段渲染                 | `field.options`          | [field-renderer](references/field-renderer.md)         |
| `registerFieldSettings()`                                     | 向字段详情面板追加插件配置                               | `field.options`          | [field-settings](references/field-settings.md)         |
| `registerDatabaseViewRowStyleProvider()`                      | 根据行数据 + view 配置输出样式                           | `viewDefinition.options` | [row-style-provider](references/row-style-provider.md) |
| `registerCardCoverView()` / `registerCardCoverViewSettings()` | 卡片封面渲染 + 设置面板                                  | `extensionData`          | [card-cover](references/card-cover.md)                 |
| `registerStyleSheet()`                                        | 注册插件级样式                                           | 不存配置                 | [style-sheet](references/style-sheet.md)               |

> **迁移提示**：`registerDatabaseViewSettings()` 已 `@deprecated`，请改用 `registerViewSettings()`。

### 能力边界

`*.xdb.js` 可以通过 `registerAction()` 注册新的 Action type、handler、摘要和 DOM editor。内置与第三方 Action 使用同一注册链路。

- `match` 决定该 action 在哪些配置面 / 数据源下可选；省略表示全部可选。scope 值是 `button-field` / `button-view` / `new-row`。
- 第三方 UI 使用 `editor()` 返回 DOM `ViewInstance`；`editorComponent` 是 `@internal`。
- `registerAction()` 返回 `boolean`，失败时不要继续假设 type 已安装。
- `registerFieldType()` 同样返回 `boolean`；Field Renderer / Field Settings 与它独立注册、运行时组合。
- `registerViewActionMenu()` 也返回 `boolean`；它注册视图工具栏操作项（search/filter/create 类入口），不读行数据。详见 [view-action-menu](references/view-action-menu.md)。
- 其它 `registerXxx()` 当前返回 `void`；不能写出并不存在的成功返回值检查。
- 旧的 `registerButtonStep()` / `registerButtonStepSettings()` 仍已删除，没有兼容层。

完整契约、执行上下文、`row.set/update/move/delete` 和编辑器 props 见 [action](references/action.md)。`.xdb` 配置形状见 [Action reference](../xdb-user-skills/reference/actions.md)。

## 参考文档

- [conventions](references/conventions.md)：文件格式、命名、配置写到哪、状态怎么更新，以及各扩展点共用的公共上下文 props。
- [action](references/action.md)：`registerAction()`、match、handler、summary、DOM editor 与注册失败处理。
- [types](references/types.md)：跨扩展点共享的类型——`XdbContextProps`（含 `dailyNotes` / `markdown` / `files` / `tasks` 这些公共 API）、`api`（`Database`）的读写能力、`FilterItem` 过滤结构、行数据 `$item`（`FileIndex` / `TaskIndex`）。
- [field-type](references/field-type.md)：字段类型目录、可选择性、重复 type 与独立组合关系。
- [field-renderer](references/field-renderer.md) / [field-settings](references/field-settings.md)：字段匹配、渲染、空值与编辑语义、配置持久化。
- [lifecycle](references/lifecycle.md)：从加载到卸载的完整生命周期，以及性能、渲染、cleanup、Obsidian 风格等最佳实践。
- 各扩展点的类型与 props：见上面"扩展点速查"表的"详细"列。
- [view-action-menu](references/view-action-menu.md)：视图工具栏操作项的注册契约、二选一规则、可见/激活/禁用回调。
- [troubleshooting](references/troubleshooting.md)：常见问题对照——插件没加载、改了不生效、配置不持久化、渲染叠加。
