# View Settings

为数据库视图的 settings 区域提供设置内容。

## 配置位置

`viewDefinition.options`

## 注册接口

```ts
type ViewSettingsExtension = {
  /** settings 扩展自身的唯一 id，推荐和对应 view 用同一常量 */
  id: string;
  /** 声明适用于哪些 view type；省略表示对所有 view type 生效（通用 settings） */
  viewTypes?: string[];
  settings: () => {
    /** 首次渲染和后续配置变化时调用 */
    onUpdate: (props: ViewSettingsProps) => void;
    onDestroy: () => void;
  };
};
```

> **设计原则**：settings 的适用范围属于扩展元数据（`viewTypes`）。只对某个 view 生效就声明 `viewTypes: ['xxx']`；对所有 view 生效就省略。**不要**在 `onUpdate(props)` 里手写 `if (props.viewDefinition.type !== 'xxx') return;`。

```js
// 只对 chart 视图生效
ctx.registerViewSettings({
  id: 'chart-settings',
  viewTypes: ['chart'],
  settings: () => ({ onUpdate() {}, onDestroy() {} }),
});

// 对所有视图生效（省略 viewTypes）
ctx.registerViewSettings({
  id: 'common-settings',
  settings: () => ({ onUpdate() {}, onDestroy() {} }),
});
```

## props

[公共上下文 props](conventions.md#公共上下文-props) 外加：

```ts
type ViewSettingsProps = XdbContextProps & {
  /** 当前 settings 面板的挂载容器 */
  container: HTMLElement;
  /** 数据库读写入口，能力见 types.md */
  api: Database;
  /** 结构见 database-view.md#viewdefinition */
  viewDefinition: viewDefinition;
  /** 传完整 viewDefinition 或 updater 函数，持久化写回 */
  setViewDefinition: (updater: unknown) => Promise<void>;
};
```

## 实现要求

- 只负责编辑当前 view 配置
- 持久化写入通过 `setViewDefinition(...)`
- 适用范围用 `viewTypes` 声明，不要在 `onUpdate` 里手写 type 判断

推荐写法：

```js
void props.setViewDefinition((current) => ({
  ...current,
  options: { ...(current.options ?? {}), chartType: 'line' },
}));
```
