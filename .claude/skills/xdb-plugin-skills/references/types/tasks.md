# Tasks API

`props.tasks` 是任务 API。

```ts
tasks: TasksApi;
```

## API

```ts
interface TasksApi {
  /** 读取 vault 索引中的全部任务 */
  getAll(): Promise<Task[]>;

  /** 读取某一篇笔记中的全部任务 */
  getFromFile(filePath: string): Promise<Task[]>;

  /** 从原始 task 文本里提取去掉 checkbox 前缀后的纯文本 */
  extractContent(task: { text: string }): string;

  /** 修改任务正文 */
  modify(filePath: string, taskPos: Pos, input: string): Promise<void>;

  /** 修改任务状态字符 */
  setStatus(filePath: string, taskPos: Pos, status: string): Promise<void>;

  /** 删除任务 */
  delete(filePath: string, pos: Pos): Promise<void>;

  /** 在编辑器中定位并选中某个任务 */
  revealInFile(filePath: string, pos: Pos, newLeaf?: PaneType | boolean): void;

  /** 在待办/完成之间切换 */
  toggle(filePath: string, taskPos: Pos, currentStatus: string): Promise<void>;

  /** 新增任务 */
  add(filePath: string, content: string, position?: TaskInsertPosition): Promise<void>;

  /** 根据事件修饰键决定是否新开 pane，然后跳转到任务 */
  navigateTo(filePath: string, pos: Pos, evt?: MouseEvent | KeyboardEvent): void;
}
```

## `Task` 结构

`getAll()` / `getFromFile()` 返回的是一个轻量任务对象，不等于数据库任务源里的完整 `$item`。

```ts
type Task = {
  number: number;
  parent: number;
  status: string;
  text: string;
  pos: Pos;
  filePath: string;
};
```

字段说明：

- `number`：文件内的任务编号 / 行级身份（由索引提供）
- `parent`：父任务编号；顶层任务通常是 `-1`
- `status`：checkbox 里的状态字符，例如 `' '`、`'x'`、`'-'`
- `text`：原始整行文本
- `pos`：任务在文件中的精确位置
- `filePath`：所属文件路径

## `Pos` / `Loc`

`Pos` 和 `Loc` 来自 Obsidian。

```ts
interface Pos {
  start: Loc;
  end: Loc;
}

interface Loc {
  /** 0-based 行号 */
  line: number;
  /** 列号 */
  col: number;
  /** 从文件开头算起的字符偏移 */
  offset: number;
}
```

`pos.start.line` / `pos.end.line` 是处理任务编辑、跳转、删除时最常用的字段。

## 新增任务位置：`TaskInsertPosition`

```ts
interface TaskInsertPosition {
  position: TaskInsertPositionType;
  headingLine?: string;
}

enum TaskInsertPositionType {
  TopOfNote = 'TopOfNote',
  BottomOfNote = 'BottomOfNote',
  TopUnderHeading = 'TopUnderHeading',
  BottomUnderHeading = 'BottomUnderHeading',
}
```

使用规则：

- `TopOfNote`：插到笔记顶部（frontmatter 后）
- `BottomOfNote`：插到笔记末尾
- `TopUnderHeading`：插到指定 heading 的第一行内容前
- `BottomUnderHeading`：插到指定 heading 的 section 末尾
- `headingLine`：只在 `TopUnderHeading` / `BottomUnderHeading` 时有意义，格式必须是完整标题行，例如 `## Tasks`

## 示例

### 读取某篇笔记里的任务并完成第一条

```js
const tasks = await props.tasks.getFromFile('Projects/Ship.md');
const first = tasks[0];

if (first) {
  await props.tasks.setStatus(first.filePath, first.pos, 'x');
}
```

### 新增一条任务到指定 heading 下

```js
await props.tasks.add('Projects/Ship.md', 'Prepare release notes', {
  position: 'BottomUnderHeading',
  headingLine: '## Tasks',
});
```

### 跳转到任务

```js
props.tasks.revealInFile(task.filePath, task.pos, true);
```

## 与数据库任务源的区别

- `props.tasks.getAll()` / `getFromFile()`：返回轻量 `Task`
- 任务数据库一行的 `$item`：返回更丰富的 `TaskRowItem`
  - 结构见 [Database API 的“不同 source 的行”](database.md#不同-source-的行)

如果你是在 `viewData.groups[].rows[].$item`、Field Renderer 的 `row.$item`、row-style provider 的 `item` 里读任务行，请看 [database.md](database.md)，不是这页。
