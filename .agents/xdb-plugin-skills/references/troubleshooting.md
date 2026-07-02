# 排错

### 插件文件写好了，但根本没有加载

打开**插件管理视图**，它会列出加载失败的文件及原因：`conflict`（id 冲突）/ `invalid`（形状校验或执行失败）。控制台日志可对照：

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
  install(ctx) { return () => undefined; },
};
```

### 改了 `.xdb.js`，但界面还残留旧逻辑或旧资源

- `install(ctx)` 没有返回 cleanup 函数 → 必须返回
- 只处理了 `onDestroy()`，没处理插件级 cleanup → cleanup 负责插件级清理，`onDestroy()` 只清当前实例资源

分工见 [lifecycle#cleanup-与-ondestroy-的分工](lifecycle.md#cleanup-与-ondestroy-的分工)。

### 在 settings 面板改了配置，但没按 view 定义持久化

- 没用 `setViewDefinition(...)` → settings 必须通过它写回
- 绕过 settings 扩展边界直接改内部状态 → 不要这样做

```js
void props.setViewDefinition((current) => ({
  ...current,
  options: { ...(current.options ?? {}), chartType: 'pie' },
}));
```

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

### card cover / button step 的 settings 没接到私有配置

- settings 扩展的 `id` 没对上目标 cover / button step 的 `id`
- 私有配置没用 `getData()` / `updateData()` 读写

cover / button step settings 都按 `id` 取扩展——这是运行时的真实查找方式。

### 样式和其他插件打架，或重复注入难维护

- 不要在 `onUpdate()` 里手动插入 `<style>`
- 样式统一走 `registerStyleSheet()`
- 选择器加本插件自己的稳定前缀（例如 `myPlugin--ChartView`）；`components--` 是宿主保留的，不要用
