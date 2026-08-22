# 排错

### 插件文件写好了，但根本没有加载

先打开**插件管理视图**。它会列出文件 eval、plugin shape、`install()` 失败（`invalid`）和 plugin id 冲突（`conflict`）。extension shape 拒绝或 extension id 冲突不一定进入该列表，因此还要查看控制台 `[xdb-plugin]` 日志并运行 validator。控制台日志可对照：

- `Plugin file must end with .xdb.js`
- `Plugin is missing a valid id`
- `Plugin is missing a valid install(ctx) function`
- `Failed to evaluate plugin`

确保导出结构完整：

```js
module.exports = {
  id: 'plugin-id',
  name: 'Plugin Name',
  description: 'Plugin Description',
  author: 'Your Name',
  version: '1.0.0',
  install(ctx) {
    return () => undefined;
  },
};
```

插件显示为 installed 只表示 plugin descriptor 与 install 流程完成，不证明每个 `registerXxx` 都成功。`registerAction()`、`registerFieldType()`、`registerViewActionMenu()` 返回 boolean；其它注册方法为 `void`，需通过 validator、控制台和实际 picker / UI 行为共同确认。

### 改了 `.xdb.js`，但界面还残留旧逻辑或旧资源

- `install(ctx)` 没有返回 cleanup 函数 → 必须返回
- 只处理了 `onDestroy()`，没处理插件级 cleanup → cleanup 负责插件级清理，`onDestroy()` 只清当前实例资源

分工见 [lifecycle#cleanup-与-ondestroy-的分工](lifecycle.md#cleanup-与-ondestroy-的分工)。

### 在 settings 面板改了配置，但没按 view 定义持久化

- 没用 `setViewDefinition(...)` → settings 必须通过它写回
- 绕过 settings 扩展边界直接改内部状态 → 不要这样做

```js
void props.setViewDefinition((current) => {
  const previous = current.options?.['my-plugin'];
  const pluginOptions = previous && typeof previous === 'object' && !Array.isArray(previous) ? previous : {};
  return {
    ...current,
    options: {
      ...(current.options ?? {}),
      'my-plugin': { ...pluginOptions, chartType: 'pie' },
    },
  };
});
```

### Field Renderer 没有生效，仍然显示普通文本

- `match({ field })` 没命中最新 definition → 先核对字段名、type 和 `field.options`
- `order` 太大 → renderer 是首个命中，`order` 必须是有限数字；内置 Text 始终最后兜底
- matcher 做了异步读取或抛错 → `match()` 必须同步、无副作用；抛错后宿主会继续匹配

契约见 [field-renderer](field-renderer.md)。

### 功能字段没有 row value，因此在 List/Gantt 消失

功能 renderer 不依赖 `row.$item[field.name]` 时，应明确声明：

```js
isValueEmpty: () => false;
```

### DOM Field Settings 出现了，但配置没持久化或覆盖了别人的 options

- 直接修改 `props.field` → 使用 `props.setFieldDefinition(...)`
- 用旧快照写完整 definition → 使用 functional updater
- 覆盖整个 `field.options` → 只更新自己插件 id 对应的 key，并保留其余配置

Field Settings 是叠加渲染，不能假设只有一个匹配项。详见 [field-settings](field-settings.md)。

### view 每次更新后越来越重，监听器/图表实例在叠加

- `onUpdate()` 里重复绑定事件、重复创建实例未先清理
- 按"先清理，再基于最新 props 重建"的顺序写 `onUpdate()`
- 任何会重复创建的资源，都在下一次 `onUpdate()` 前先释放
- `onDestroy()` 再兜底清理一次

实例会反复收到 `onUpdate()`，替换或卸载时触发 `onDestroy()`——这是 renderer 的真实调用方式。

### row style provider 返回了结果，但界面没变化

- 直接在 provider 里操作 DOM → 不允许
- 返回了 `attributes` / `className` / `style` 但没有对应样式 → 用 `registerStyleSheet()` 补齐
- 选择器没命中宿主真正渲染的可视节点

provider 只返回 `style`、`className`、`attributes`；`attributes` 只用于声明式根节点属性。

### card cover 的 settings 没接到私有配置

- settings 扩展的 `id` 没对上目标 cover 的 `id`
- 私有配置没用 `getData()` / `updateData()` 读写

cover settings 按 `id` 取扩展——这是运行时的真实查找方式。

### `ctx.registerButtonStep is not a function`

按钮步骤插件 API 已删除。删除 `registerButtonStep()` / `registerButtonStepSettings()`，改用一个 `registerAction()` 同时注册 type、handler、summary 和 DOM editor。

完整契约见 [action](action.md)。配置形状见 [Action reference](../../xdb-user-skills/reference/actions.md)。

### `registerAction()` 返回 `false`，或运行时报 `Unsupported action`

- type 已被内置或其他插件占用 → 使用带插件命名空间的稳定 type。
- `handler.type` 与扩展 `type` 不一致，或缺少 `create` / `summary` / `handler.run`。
- `match` 提供了但不是函数。
- 插件已卸载，但 `.xdb` 仍保留它的 Action payload。

注册时必须检查返回值；编辑器与执行器都按 type 查找当前仍在 registry 中的 extension。

### 样式和其他插件打架，或重复注入难维护

- 不要在 `onUpdate()` 里手动插入 `<style>`
- 样式统一走 `registerStyleSheet()`
- 选择器加本插件自己的稳定前缀（例如 `myPlugin--ChartView`）；`components--` 是宿主保留的，不要用
