# Field Renderer

先读 [Field Renderer API Schema](api-schema.md#field-renderer)。本页说明匹配、空值和渲染做法。

为数据库字段提供运行时渲染。

## 什么时候使用

- 把普通字段渲染成链接、按钮或只读功能视图
- 根据字段名、类型、公式或插件配置选择渲染方式
- 即使 `row.$item[field.name]` 没有值，也要展示派生内容

不要用它扩展筛选、排序或分组语义。

## 注册契约

```ts
type DatabaseFieldRendererMatchContext = {
  api: Database;
  field: DatabaseFieldDefinition;
  isBuiltInField: boolean;
};

type DatabaseFieldRendererExtension = {
  id: string;
  name: string;
  description?: string;
  icon?: keyof typeof icons;
  /** 越小越先匹配；省略为 0。第三方必须使用有限数字。 */
  order?: number;
  /** 同步、无副作用。 */
  match(context: DatabaseFieldRendererMatchContext): boolean;
  /** 省略即不可编辑。可编辑 renderer 通过 inline commit 写回。 */
  canEdit?: (field: DatabaseFieldDefinition) => boolean;
  /** 决定 data-empty，以及 List/Gantt 是否保留该功能字段。 */
  isValueEmpty(field: DatabaseFieldDefinition, value: unknown): boolean;
  /** 渲染入口。 */
  view: () => ViewInstance<DatabaseFieldRendererProps>;
};
```

## 匹配规则

1. `order` 升序，值相同时保持注册顺序。
2. 第一个返回 `true` 的 renderer 生效。
3. matcher 抛错时宿主记录错误并继续。
4. 内置 Text 是终止匹配项，始终排在所有第三方有限 `order` 后面。

`match()` 每次都拿到最新字段定义。rename 不迁移或保留隐藏绑定；字段名改变后自然重新匹配。

推荐让匹配规则有明确含义——按字段名、字段类型，或用户在 Field Settings 里勾选的开关：

```js
// 只对用户在该字段设置里启用的字段生效
const matchesEnabled = ({ field }) => field.options?.['my-plugin']?.enabled === true;
```

## Renderer props

[公共上下文 props](conventions.md#公共上下文-props) 外加：

```ts
type DatabaseFieldRendererProps = XdbContextProps & {
  container: HTMLElement;
  api: Database;
  viewId: string;
  viewType?: DatabaseViewType;
  field: DatabaseFieldDefinition;
  row: DatabaseRow;
  value: unknown;
  editing: boolean;
  onEditingChange?: (editing: boolean) => void;
  onCommit?: (value: unknown) => void | Promise<void>;
};
```

- `field` 是本次渲染的运行时 definition。
- `value` 等于 `row.$item[field.name]`，功能字段可以忽略它。
- 省略 `canEdit` 时，`editing` 为 `false`，宿主不提供编辑回调。
- `canEdit()` 返回 `true` 时，renderer 自己使用 `onEditingChange` / `onCommit` 完成 inline editing。

## 生命周期

`view()` 返回同步 `ViewInstance`：

```ts
type ViewInstance<T> = {
  onUpdate(props: T): void;
  onDestroy(): void;
};
```

宿主为每个实例配对一个 Obsidian `Component`。`onUpdate()` 仍是同步协议；异步读取要在实例内部启动、捕获错误，并用 generation token 或 `AbortController` 丢弃旧结果。`onDestroy()` 释放监听器、子 Component 和未完成任务。

## 功能字段的空值语义

如果 renderer 不依赖存储值，必须显式返回非空，否则 List/Gantt 可能不挂载它：

```js
isValueEmpty: () => false;
```

普通值字段则按自己的值结构判断，例如空字符串或空数组。

## 完整示例

完整实现应把“哪个字段启用渲染”交给用户决定——Field Settings 出现在每个普通字段上，用户勾选启用后 renderer 才匹配该字段。渲染所需的 heading 默认取字段名，无需记任何固定名。

`api.getRowLink(row.id)?.href` 是可传给 `markdown.readUnderHeading()` 的 vault 相对路径。拿到 Markdown 字符串后，用 Obsidian 的标准入口渲染：

```js
await props.obsidian.MarkdownRenderer.render(props.app, content, container, sourcePath, component);
```

其中 `component` 应是该次渲染拥有并会卸载的子 `Component`。

### 渲染 Markdown 的两个必备细节

字段单元格的值容器（`.components--DatabaseValue`）默认带 `white-space: nowrap; overflow: hidden`，会把多行 Markdown 压成单行并裁剪。渲染 Markdown 时要在自己的容器上恢复换行，并加上 Obsidian 的预览样式钩子 `markdown-rendered`：

```css
.headingContent--Root {
  white-space: normal;
  overflow: visible;
  text-overflow: clip;
}
```

```js
props.container.classList.add('headingContent--Root', 'markdown-rendered');
```

用户使用规则：

1. 把示例保存到 vault 中任意 `*.xdb.js` 文件并等待插件加载。
2. 在数据库创建任意普通字段。
3. 打开该字段的 Field Settings，勾选 **Render heading content**。
4. 按需填写 Markdown heading；留空时默认用 `## 字段名`。
5. 选择是否包含更低层级的子标题内容。
6. 文件库读取当前行文件，任务库读取任务所在文件；字段只读，不修改源文件或 row value。

启用后的配置等价于：

```yaml
- name: Summary
  options:
    example-heading-content:
      enabled: true
      heading: '## Summary'
      includeSubHeadings: true
```

## 常见错误

- 给功能字段使用普通空值判断：没有 row value 时整个 renderer 不会显示。
- 在 `match()` 中读文件或修改状态：matcher 必须同步且无副作用。
- 返回 Promise 给 `onUpdate()`：协议是同步的，异步错误必须由实例自己捕获。
- 假设 rename 会迁移 renderer 绑定：系统没有持久化绑定。
