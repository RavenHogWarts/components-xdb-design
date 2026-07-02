---
name: xdb-plugin-skills
description: "Use this whenever creating, editing, or reviewing XDB plugin files (*.xdb.js), or authoring third-party extensions for the xdb module's plugin system. Covers the registration API exposed on the XdbApp context (registerView, registerDatabaseView, registerViewSettings, registerDatabaseViewRowStyleProvider, registerCardCoverView, registerButtonStep, registerStyleSheet), the install/onUpdate/onDestroy lifecycle, configuration ownership, and repeatable rendering patterns. Trigger on .xdb.js files, XDB plugin authoring, xdb extension/extension-point work."
version: "0.0.1"
author: "vran"
---

# XDB Plugin 开发技能

## 何时使用

做以下任何一件事之前，先读本技能再动手：

- 新建或修改 `*.xdb.js` 插件文件
- 为 xdb 注册第三方扩展点（视图 / 视图设置 / 行样式 / 卡片封面 / 按钮步骤 / 样式）
- 排查"插件没加载 / 改了不生效 / 配置没持久化 / 渲染越来越重"等问题

> 本技能是写 xdb 插件的权威说明：能力、生命周期、取数规则都以此为准。

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

`ctx` 上**所有**方法都是面向插件开发者的能力（即 `install(ctx)` 收到的 `ctx`）。记住三条规则，能自检绝大多数问题：

1. **install 只注册**：`install(ctx)` 只注册扩展点、返回 cleanup，不做渲染。
2. **配置写对地方**：view 配置写 `viewDefinition.options`；cover / button step 私有配置用 `getData()` / `updateData()`（存在 `extensionData`）。
3. **onUpdate 可重复**：它会被反复调用，每次都先清理旧资源，再从最新 props 重建。

## Quick Start

```js
const VIEW_TYPE = 'example-list';

module.exports = {
  id: 'example-list-view',
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
            root.textContent = `Rows: ${props.viewData?.groups?.[0]?.rows?.length ?? 0}`;
            props.container.appendChild(root);
          },
          onDestroy() {},
        };
      },
    });

    ctx.registerViewSettings({
      id: VIEW_TYPE,
      settings() {
        return {
          onUpdate(props) {
            props.container.replaceChildren();
            const button = document.createElement('button');
            button.textContent = 'Enable compact mode';
            button.addEventListener('click', () => {
              void props.setViewDefinition((current) => ({
                ...current,
                options: { ...(current.options ?? {}), compact: true },
              }));
            });
            props.container.appendChild(button);
          },
          onDestroy() {},
        };
      },
    });

    return () => undefined;   // install 必须返回 cleanup 函数
  },
};
```

## 写完自检

写或改完 `*.xdb.js` 后，跑校验脚本自检——它复刻宿主加载方式 + skill 规则，给出确定性结论，比凭记忆核对可靠：

```bash
node docs/user-manuals/xdb-plugin-skills/scripts/validate-xdb-plugin.mjs path/to/your.xdb.js
```

检查：shape（id / name / description / install）、install 是否返回 cleanup、是否用了废弃的 `registerDatabaseViewSettings`、CSS 是否用了宿主保留前缀 `components--`，并打印注册了哪些扩展点。退出码非 0 即有硬错。

查不了的（`onUpdate` 幂等性、配置写对位置、运行时是否抛错）仍按 [lifecycle](references/lifecycle.md) / [conventions](references/conventions.md) 自己核对。

## 扩展点速查

| 能力（ctx 方法） | 用途 | 配置位置 | 详细 |
| --- | --- | --- | --- |
| `registerView()` | 注册视图（只用 `viewDefinition`，不读行数据） | `viewDefinition.options` | [database-view](references/database-view.md) |
| `registerDatabaseView()` | 注册数据库视图（要读行数据 `viewData`） | `viewDefinition.options` | [database-view](references/database-view.md) |
| `registerViewSettings()` | 注册视图设置面板 | `viewDefinition.options` | [view-settings](references/view-settings.md) |
| `registerDatabaseViewRowStyleProvider()` | 根据行数据 + view 配置输出样式 | `viewDefinition.options` | [row-style-provider](references/row-style-provider.md) |
| `registerCardCoverView()` / `registerCardCoverViewSettings()` | 卡片封面渲染 + 设置面板 | `extensionData` | [card-cover](references/card-cover.md) |
| `registerButtonStep()` / `registerButtonStepSettings()` | 按钮步骤执行 + 设置面板 | `extensionData` | [button-step](references/button-step.md) |
| `registerStyleSheet()` | 注册插件级样式 | 不存配置 | [style-sheet](references/style-sheet.md) |

> **迁移提示**：`registerDatabaseViewSettings()` 已 `@deprecated`，请改用 `registerViewSettings()`。

## 参考文档

- [conventions](references/conventions.md)：文件格式、命名、配置写到哪、状态怎么更新，以及各扩展点共用的公共上下文 props。
- [types](references/types.md)：跨扩展点共享的类型——`api`（`Database`）的读写能力、`FilterItem` 过滤结构、行数据 `$item`（`FileIndex` / `TaskIndex`）。
- [lifecycle](references/lifecycle.md)：从加载到卸载的完整生命周期，以及性能、渲染、cleanup、Obsidian 风格等最佳实践。
- 各扩展点的类型与 props：见上面"扩展点速查"表的"详细"列。
- [troubleshooting](references/troubleshooting.md)：常见问题对照——插件没加载、改了不生效、配置不持久化、渲染叠加。
