# Files API

`props.files` 是文件 API。

```ts
files: FilesApi;
```

## API

```ts
interface FilesApi {
  /** 创建文件；已存在则直接返回现有文件 */
  create(filePath: string, content?: string): Promise<TFile>;

  /** 创建文件并按模板填充内容 */
  createFromTemplate(filePath: string, templateFilePath?: string): Promise<TFile>;

  /** 移动文件到目标目录 */
  move(sourceFilePath: string, targetFolderPath: string, autoResolveNameConflict?: boolean): Promise<void>;
}
```

## 行为说明

### create(filePath, content?)

- 自动创建缺失的父目录
- 如果目标文件已存在，不会覆盖，直接返回现有 `TFile`

### createFromTemplate(filePath, templateFilePath?)

- 先保证目标文件存在
- 如果传了模板路径：
  - 读取模板正文
  - 处理模板变量
  - 写入目标文件
- 支持的模板变量见当前 util 实现，常用有：
  - `{{date}}`
  - `{{time}}`
  - `{{title}}`

### move(sourceFilePath, targetFolderPath, autoResolveNameConflict?)

- 自动创建目标目录
- 如果源文件已经在目标目录里，直接返回
- 发生同名冲突时：
  - `autoResolveNameConflict === true`：自动改名
  - 否则抛错

## 示例

### 创建普通文件

```js
const file = await props.files.create('Scratch/example.md', '# Hello');
new props.obsidian.Notice(`已创建：${file.path}`);
```

### 按模板创建

```js
await props.files.createFromTemplate('Journal/Today.md', 'Templates/Daily.md');
```

### 移动并自动解决重名

```js
await props.files.move('Scratch/example.md', 'Archive', true);
```

## 边界

- `move()` 的第二个参数是“目标文件夹路径”，不是完整文件路径。
- 如果你要按 Daily Notes 规则创建日记，优先看 [dailyNotes.md](dailyNotes.md)。
