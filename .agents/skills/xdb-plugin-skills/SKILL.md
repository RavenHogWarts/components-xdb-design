---
name: xdb-plugin-skills
description: 'Use when creating, editing, reviewing, or debugging XDB plugin files (*.xdb.js), including custom Action or Field types, third-party views, settings, renderers, row styles, card covers, view action menus, and plugin styles. Trigger on XdbApp, registerAction, registerFieldType, registerViewActionMenu, Database API, DOM extension lifecycle, or validation failures.'
version: '0.0.5'
author: 'vran'
---

# XDB Plugin Skills

## 用途

本技能给**编写或审查 `*.xdb.js` 的开发者和编码 Agent**使用。目标是让插件能被 XDB 加载、重复更新、持久化配置、热重载并完整卸载。

- 生成或修改 `.xdb` 数据库定义：改用 `xdb-user-skills`。
- 扩展 Action、View、设置、字段、行样式、卡片封面或样式：使用本技能。
- API 不确定时，以 `XdbApp.ts`、它引用的公共类型和 `Database.ts` 为准；不要从内置 React 组件猜第三方契约。

## 工作流

1. **选择扩展点**：先说明要增加什么用户能力，是否需要行数据、持久化配置或当前行。
2. **先读 schema，再读用法**：打开 [公共 API Schema](references/api-schema.md) 中对应接口和字段注释，再读路由表中的专题页。
3. **实现最小插件**：使用稳定、带命名空间的 plugin / extension / Action id；`install()` 只注册并返回 cleanup。
4. **验证静态契约**：已有或生成 `*.xdb.js` 后运行 validator，修完 error，逐项判断 warning。
5. **验证真实宿主**：检查配置持久化、重复 `onUpdate`、热重载、卸载和 UI 行为；静态检查不能代替 Obsidian 验收。

最小插件外壳：

```js
module.exports = {
  id: 'example-plugin',
  name: 'Example Plugin',
  description: 'What the plugin adds to XDB.',
  install(ctx) {
    // ctx.registerXxx(...)
    return () => undefined;
  },
};
```

完整约定见 [conventions](references/conventions.md)，实例生命周期见 [lifecycle](references/lifecycle.md)。

## API 阅读顺序

API 形状、字段注释和约束是首要依据；专题文字只回答“为什么选它、怎样组合、常见错误是什么”。

1. [公共 API Schema](references/api-schema.md)：Plugin、`XdbApp`、View、Settings、Action、Field、Menu、Row Style、Cover。
2. [Database API](references/types/database.md)：`props.api`、Definition、ViewData、Row、Filter。
3. [Setting UI Schema](references/types/setting-ui.md)：`props.setting.*` 的完整参数、返回值和 cleanup。
4. 专题 reference：完整做法与示例。

不要从示例反推字段，也不要用散文覆盖 schema。需要新增或修改 API 文档时，每个字段至少写清：**它是什么、是否必填、稳定性/值域、用途、失败或 cleanup 边界**。

## 先选对扩展点

| 目标                                  | `XdbApp` 方法                                                 | 配置位置                 | 返回值    | 读取                                                   |
| ------------------------------------- | ------------------------------------------------------------- | ------------------------ | --------- | ------------------------------------------------------ |
| 注册可编辑、可执行的 Action type      | `registerAction()`                                            | Action payload           | `boolean` | [action](references/action.md)                         |
| View 不读取行数据                     | `registerView()`                                              | `viewDefinition.options` | `void`    | [xdb-view](references/xdb-view.md)                     |
| View 读取宿主已投影的 `viewData`      | `registerDatabaseView()`                                      | `viewDefinition.options` | `void`    | [xdb-view](references/xdb-view.md)                     |
| 向共享 View 设置页加内容              | `registerViewSettings()`                                      | `viewDefinition.options` | `void`    | [view-settings](references/view-settings.md)           |
| 新增独立设置 tab                      | `registerViewSettingsTab()`                                   | `viewDefinition.options` | `void`    | [view-settings-tab](references/view-settings-tab.md)   |
| toolbar 打开 tab 或执行命令           | `registerViewActionMenu()`                                    | 通常不持久化             | `boolean` | [view-action-menu](references/view-action-menu.md)     |
| 向字段选择器注册新 type               | `registerFieldType()`                                         | 不存配置                 | `boolean` | [field-type](references/field-type.md)                 |
| 自定义字段值渲染                      | `registerFieldRenderer()`                                     | `field.options`          | `void`    | [field-renderer](references/field-renderer.md)         |
| 向字段详情追加设置                    | `registerFieldSettings()`                                     | `field.options`          | `void`    | [field-settings](references/field-settings.md)         |
| 根据行数据输出 class/style/attributes | `registerDatabaseViewRowStyleProvider()`                      | `viewDefinition.options` | `void`    | [row-style-provider](references/row-style-provider.md) |
| 注册卡片 cover 及其设置               | `registerCardCoverView()` / `registerCardCoverViewSettings()` | `extensionData`          | `void`    | [card-cover](references/card-cover.md)                 |
| 注入插件全局 CSS                      | `registerStyleSheet()`                                        | 不存配置                 | `void`    | [style-sheet](references/style-sheet.md)               |

`registerDatabaseViewSettings()` 已废弃，改用 `registerViewSettings()`。旧 `registerButtonStep*()` 已删除，改用 `registerAction()`。

## 四个常见选择

### Plain View 还是 Database View

- 只展示说明、工具或自身配置：`registerView()`。
- 需要当前 View 已完成 filter、sort、group 投影后的行：`registerDatabaseView()`，直接读 `props.viewData`。
- 只有额外查询时才用 `props.api.getData()` / `getAllData()` / `getViewData()`；不要为已有 `viewData` 再建一份订阅和缓存。

### 共享设置还是独立 tab

- 少量 View 选项：`registerViewSettings()`。
- 需要独立 label/icon 和页面：`registerViewSettingsTab()`。
- toolbar 打开自定义 tab 时，`settingTabId` 必须等于该 tab 的 `tabId ?? id`；`settingTabId` 与 `onClick` 二选一。

### 设置怎样持久化

- View Settings / Tab：每次从 `props.viewDefinition` 读取，用 `props.setViewDefinition(current => next)` 写回。
- Field Settings：每次从 `props.field` 读取，用 `props.setFieldDefinition(current => next)` 写回。
- Action editor：从 `props.action` 读取，用 `props.setAction(current => next)` 写回。
- 普通设置控件使用 `props.setting.*` 和稳定 `key`；只有无法表达的自定义内容才用 `setting.custom()` 或容器 DOM。
- 配置放在自己的命名空间中，并保留同一对象上的其它字段；不要维护第二份可编辑状态。

### 什么时候使用 Database API

`props.api` 是当前 `Database`。常见任务：读取当前定义或数据，创建或移动 View，创建/更新/删除行，管理字段和全局 filter。完整方法与 capability 检查见 [Database API](references/types/database.md)。

## 生命周期规则

```text
加载 *.xdb.js
  -> install(ctx) 注册并返回 plugin cleanup
  -> 宿主创建 ViewInstance
  -> 反复调用 onUpdate(latestProps)
  -> 实例销毁时调用 onDestroy()
  -> 插件卸载/重载时执行 plugin cleanup 并移除注册
```

- `install()` 不渲染 UI。
- `onUpdate()` 是同步、可重复的 render 协议：先释放上一轮资源或安全复用，再按最新 props 更新。
- `onDestroy()` 释放当前实例的 listener、observer、chart、Component 和异步工作。
- install cleanup 只负责插件自己创建的全局资源；宿主会按 plugin id 移除注册和 `registerStyleSheet()` 产生的样式。
- Action 的 `match` 只决定 picker 是否可选；持久化 Action 仍可能执行，需要当前行的 handler 必须检查 `context.row`。

## 验证与诊断

`<skill-dir>` 为本 skill 文件夹路径（安装后位于 agent 技能目录，如 `~/.zcode/skills/xdb-plugin-skills`）：

```bash
node <skill-dir>/scripts/validate-xdb-plugin.mjs path/to/your.xdb.js
```

validator 检查插件形状、cleanup、扩展形状、重复 id、废弃 API 和 CSS 前缀。它不能确认跨插件冲突、运行时幂等性、持久化或资源泄漏。

- `registerAction()`、`registerFieldType()`、`registerViewActionMenu()` 失败会返回 `false`；立即停止继续假设该扩展可用，通常应抛错让安装回滚。
- 其它注册返回 `void`；用 validator、控制台 `[xdb-plugin]` 日志和真实 UI 共同确认。
- 插件显示 installed 只代表 plugin descriptor 与 `install()` 完成，不代表每个 void 注册都成功。

问题定位见 [troubleshooting](references/troubleshooting.md)。

## 参考路由

- [conventions](references/conventions.md)：文件格式、命名、配置归属和公共 props。
- [lifecycle](references/lifecycle.md)：重复更新、异步任务、性能和 cleanup。
- [公共 API Schema](references/api-schema.md)：所有第三方扩展点的字段、约束、用途和失败边界。
- [Database API](references/types/database.md)：`props.api`、Definition、ViewData、行数据和 FilterItem。
- [Setting UI Schema](references/types/setting-ui.md)：全部 builder 方法、选项字段、返回 handle 和自定义 cleanup。
- [公共 API](references/types.md)：Obsidian、dailyNotes、markdown、files、tasks、ECharts。
- 具体扩展点：使用上方“先选对扩展点”表中的直接链接。
