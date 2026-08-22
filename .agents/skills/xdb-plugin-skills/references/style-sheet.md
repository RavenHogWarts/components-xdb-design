# Style Sheet

注册插件级样式。

## 配置位置

不存配置

## 注册接口

```ts
type XdbApp = {
  registerStyleSheet(cssText: string): void;
};
```

## 实现要求

- 样式统一集中注册
- class 用一个属于本插件的稳定前缀（见下）
- 状态优先用 `data-*`
- 不要在 `install()` 或 `onUpdate()` 里手动插入 `<style>`

## class 命名空间

`registerStyleSheet()` 注入的是**全局**样式，和宿主、其他插件的样式同处一个文档。为避免互相覆盖，每个插件都要给自己的 class 加一个**本插件专属、稳定、唯一**的前缀：

- 用插件 id 派生前缀（下文用 `myPlugin--` 作示意）
- 同一插件所有 class 都带这个前缀，例如 `myPlugin--Row`、`myPlugin--Toolbar`
- 状态用 `data-*` 表达，不要编码进 class
- `components--` 是**宿主保留**的前缀，第三方不要用，否则会和宿主样式冲突

```js
ctx.registerStyleSheet(`
  .myPlugin--Row[data-row-status="done"] {
    background: var(--color-green-rgb);
  }
`);
```
