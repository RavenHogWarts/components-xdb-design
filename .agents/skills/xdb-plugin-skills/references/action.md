# Action 扩展

先读 [Action API Schema](api-schema.md#action)。本页只补充入口选择、组合方式和完整示例；字段形状、约束与失败边界以 schema 注释为准。

## Action 是什么

Action 是一份**可序列化的调用描述**：`{ type, ...payload }`。它本身没有行为，只是一个能写入 `.xdb` 的数据对象。运行时由已注册的同名 Action extension 解释并执行。

Action 出现在三个入口，每个入口是一个独立的配置位置，有自己的配置数量和执行上下文：

| 入口        | 配置位置                | 数量               | 执行时当前行     |
| ----------- | ----------------------- | ------------------ | ---------------- |
| 按钮字段    | `field.options.actions` | 多个，按序串行执行 | 有 `context.row` |
| Button View | `view.actions`          | 多个，按序串行执行 | 无               |
| 新建记录    | `view.newRowAction`     | 单个               | 无               |

内置 Action（如 `create-file`、`open-file`、`script`）与第三方 Action 使用同一注册链路。`.xdb` 配置形状见 [Action reference](../../xdb-user-skills/reference/actions.md)。

## 概念边界

```text
Action                    ActionExtension
持久化的调用描述   ────→   type 对应的创建、摘要、编辑和执行能力
{ type, ...payload }
```

- `Action` 是无行为、必须可写入 `.xdb` 的数据对象。
- `ActionExtension` 是插件注册的能力，不会写入 `.xdb`。
- `type` 是两者的连接键；第三方应使用带插件命名空间的稳定值，如 `example:notify`。
- payload schema 由注册该 `type` 的插件拥有；宿主不要求统一的 `data` / `params` 包装。

## 注册契约

```ts
type ActionScope = 'button-field' | 'button-view' | 'new-row';

interface ActionMatchContext {
  scope: ActionScope;
  /** 当前数据库（可选——脱离数据库上下文的展示位可能没有） */
  database?: Database;
}

interface ActionExtension<TAction extends Action> {
  type: TAction['type'];
  label: string;
  icon: string;
  /** 可选；用于 Action picker 的说明和搜索。 */
  description?: string;
  /**
   * 决定该 action 在哪些配置面 / 数据源下可选。
   * 省略 = 任意 scope、任意数据源都可选。
   * 返回 false 时 picker 不展示该项，但已持久化的 action 仍能正常执行。
   */
  match?: (context: ActionMatchContext) => boolean;
  create(): TAction;
  handler: {
    type: TAction['type'];
    run(action: TAction, context: ActionContext): Promise<void>;
  };
  summary(action: TAction, context: ActionSummaryContext): string;
  editor?: () => ViewInstance<ActionEditorViewProps<TAction>>;
}
```

注册返回 `boolean`：成功为 `true`；形状校验失败或 `type` 已被占用时为 `false`。不要忽略结果：

```js
const registered = ctx.registerAction(extension);
if (!registered) throw new Error(`Failed to register ${extension.type}`);
```

宿主校验：

- `type`、`label`、`icon` 必须是非空字符串。
- `description` 若提供必须是字符串；宿主会在 Picker 中展示并纳入搜索。
- `match` 若提供必须是函数。
- `create`、`handler.run`、`summary` 必须是函数。
- `handler.type` 必须等于扩展的 `type`。
- 第三方编辑器使用 `editor()`；不要添加内置 React 专用字段。

宿主不会在注册阶段调用 `create()`，因此插件仍要保证它返回对象，并且返回值的 `type` 与扩展一致。

## 可选性（match）

`match` 决定一个 action type 是否在某个配置面（scope）+ 数据源组合下可选。省略 `match` 表示全部 scope、全部数据源都可选——这是大多数 action 的默认行为。

三个 scope 对应上文「三个入口」表：

| scope          | 入口                       |
| -------------- | -------------------------- |
| `button-field` | 按钮字段的 Action 列表     |
| `button-view`  | Button View 的 Action 列表 |
| `new-row`      | `view.newRowAction`        |

`match` 接收 `{ scope, database }`，可同时按配置面和数据源过滤。例如内置的 `move-row` 只在 file 源的按钮字段可选（task 源没有移动语义）：

```js
match(context) {
  return context.scope === 'button-field'
    && context.database?.getDefinition()?.source !== 'task';
}
```

**关键语义**：`match` 只约束 picker 的可选性，不约束执行。一个已经配置并持久化的 action 永远能被解析和执行——即使用户后来切换了数据源或 scope，已配置的 action 不会因此消失。配置 UI 用 `match` 筛选可选类型；执行器按 type 查找 handler。

## 执行上下文

```ts
interface ActionContext {
  app: App;
  database: Database;
  sourcePath: string;
  linkOpenMode: ObsidianLinkOpenMode;
  variables: Record<string, unknown>;
  row?: ActionRowContext;
  signal?: AbortSignal;
}

interface ActionRowContext {
  readonly id: string;
  readonly item: Record<string, unknown>;
  readonly deleted: boolean;
  set(fieldName: string, value: unknown): Promise<void>;
  update(values: Record<string, unknown>): Promise<void>;
  move(targetFolder: string): Promise<void>;
  delete(): Promise<void>;
}
```

只有 `button-field` 当前提供 `row`。需要行时必须显式检查；不要把 scope 名称当成 TypeScript 能力保证：

```js
if (!context.row) throw new Error('This action requires a row');
await context.row.set('status', 'done');
```

连续 Action 共用同一个 row adapter。`set()` / `update()` / `move()` 会同步最新 `row.id` 和 `row.item`；`delete()` 后 `row.deleted` 为 `true`。不要直接调用 `database.updateCell(context.row.id, ...)` 绕过这些状态同步。

handler 抛错会停止当前 Action 列表。长任务应检查或传递 `context.signal`，让取消及时生效。

## Summary

`summary()` 返回宿主列表和设置行显示的一行配置摘要。它不是执行函数，也不应产生副作用。

```ts
interface ActionSummaryContext {
  app: App;
  api?: Database;
  scope: ActionScope;
}
```

`api` 在脱离数据库上下文的展示位置可能不存在。内置和第三方 Action 都通过该回调展示；需要当前 Obsidian 状态时读 `context.app`，需要按入口调整摘要时读 `context.scope`。

## DOM Editor

`editor()` 返回标准 `ViewInstance`。宿主拥有 `container`，并在配置或上下文变化时重复调用 `onUpdate(props)`：

```ts
interface ActionEditorViewProps<TAction extends Action> extends XdbContextProps {
  container: HTMLElement;
  action: TAction;
  api?: Database;
  scope: ActionScope;
  setAction(update: TAction | ((current: TAction) => TAction)): void;
  /** 复用宿主 setting 组件的命令式 builder，见下文「复用宿主 setting 组件」 */
  setting: SettingUi;
}
```

- 每次 `onUpdate()` 都从最新 `props.action` 渲染。
- 用 `props.setAction(...)` 更新 payload；不要直接修改 `props.action`。
- 优先使用 functional updater，避免事件闭包写回旧快照。
- 只管理 `container` 内的 DOM；监听器和实例在下一次更新前清理，并在 `onDestroy()` 兜底。

### 复用宿主 setting 组件（`props.setting`）

`props.setting` 是一个命令式 builder，让你直接复用应用内置的 setting 组件（开关、下拉、输入、文件选择……），**无需自己写 DOM/CSS，视觉与内置设置项完全一致**。这是 Action editor 的首选渲染方式；只有图表、第三方库挂载这类场景才需要回到 `props.container` 裸 DOM。

心智模型和 view settings 完全一致——把 `onUpdate` 当成 React render 函数：

- **`key` 是幂等锚点**：同一个 `key` 再次声明会**原地更新**而非追加。
- **本轮没声明的 key 会被自动移除**：所以 `if` / 提前 `return` 天然支持条件渲染。
- **`value` 永远从 `props.action` 读，`onChange` 永远走 `props.setAction` 写回**。

```js
editor() {
  return {
    onUpdate(props) {
      const a = props.action;
      props.setting.input({
        key: 'message',
        label: 'Message',
        value: a.message,
        onChange: (v) => props.setAction((cur) => ({ ...cur, message: v })),
      });
      // 条件渲染：只有 message 非空才显示「样式」下拉
      if (a.message) {
        props.setting.select({
          key: 'style',
          label: 'Style',
          value: a.style ?? 'plain',
          options: [
            { value: 'plain', label: 'Plain' },
            { value: 'bold', label: 'Bold' },
          ],
          onChange: (v) => props.setAction((cur) => ({ ...cur, style: v })),
        });
      }
    },
    onDestroy() {},
  };
}
```

builder 与 View/Field Settings 共用同一套 API。完整方法、参数字段、返回 handle 与 cleanup 以 [Setting UI Schema](types/setting-ui.md) 为准。

> 注意：Action editor 的 `api` 是可选的（脱离数据库上下文的展示位可能没有）。用到 `fieldAutocomplete` 时若 `api` 缺失，字段列表为空，不会报错；其它控件不依赖 `api`。

## 完整示例

```js
const { Notice } = require('obsidian');
const TYPE = 'example:notify';

module.exports = {
  id: 'example-action-plugin',
  name: 'Example Action Plugin',
  description: 'Registers a configurable notification action.',
  author: 'Your Name',
  version: '1.0.0',

  install(ctx) {
    const registered = ctx.registerAction({
      type: TYPE,
      label: 'Notify',
      icon: 'Bell',
      // 省略 match = 在所有入口可选
      create() {
        return { type: TYPE, message: '' };
      },
      handler: {
        type: TYPE,
        async run(action, context) {
          new Notice(`${action.message} · ${context.sourcePath}`);
        },
      },
      summary(action, context) {
        return `${context.scope}: ${action.message}`;
      },
      editor() {
        return {
          onUpdate(props) {
            const a = props.action;
            props.setting.input({
              key: 'message',
              label: 'Message',
              value: a.message,
              onChange: (v) => props.setAction((current) => ({ ...current, message: v })),
            });
          },
          onDestroy() {},
        };
      },
    });

    if (!registered) throw new Error(`Failed to register ${TYPE}`);
    return () => undefined;
  },
};
```

完成后运行（`<skill-dir>` 即本 skill 文件夹）：

```bash
node <skill-dir>/scripts/validate-xdb-plugin.mjs path/to/plugin.xdb.js
```

## 常见错误

| 现象                                   | 原因与修复                                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `ctx.registerAction is not a function` | 宿主版本尚未包含 Action 扩展 API；升级宿主。不要退回已删除的 `registerButtonStep*`                      |
| `registerAction()` 返回 `false`        | 查看控制台校验信息；优先检查 type 冲突、match 类型、handler.type 和必填函数                             |
| 编辑器能选但执行时报 unsupported       | 插件已卸载，但 `.xdb` 仍保留它的 Action payload                                                         |
| 编辑器修改不持久化                     | 使用 `props.setAction()`，不要修改 DOM dataset 或 `props.action`。优先用 `props.setting.*` 而非手写 DOM |
| 行操作后后续 Action 读到旧 id          | 使用 `context.row.set/update/move/delete`，不要绕过 row adapter                                         |
