# Daily Notes API

`props.dailyNotes` 是 Daily Notes API。

```ts
dailyNotes: DailyNotesApi;
```

## API

```ts
interface DailyNotesApi {
  /** 读取当前 Daily Notes 配置下的全部日记文件 */
  getAll(): Promise<TFile[]>;

  /** 按 ISO 日期（YYYY-MM-DD）查找日记 */
  get(isoDate: string): Promise<TFile | null>;

  /** 按当前配置创建日记；存在则直接返回现有文件 */
  create(isoDate: string): Promise<TFile>;

  /** 读取 Obsidian Daily Notes 插件当前配置 */
  getOptions(): DailyNoteOptions;
}
```

## 相关类型

```ts
type DailyNoteOptions = {
  autorun: boolean;
  folder: string;
  format: string;
  template: string;
};
```

字段含义：

- `autorun`：是否启用 Daily Notes 插件的自动行为
- `folder`：日记目录；空字符串表示根目录
- `format`：文件名日期格式，例如 `YYYY-MM-DD`
- `template`：模板路径（不含 `.md` 后缀时也会按 Obsidian 配置解析）

## 行为说明

- `getAll()`：按 Daily Notes 当前配置（`folder` + `format`）过滤 vault 中的 markdown 文件。
- `get(isoDate)`：`isoDate` 必须是 `YYYY-MM-DD`。
- `create(isoDate)`：会按当前 Daily Notes 配置计算路径；如果配置了模板，会按模板创建。

## 示例

```js
const today = props.moment().format('YYYY-MM-DD');
const file = await props.dailyNotes.get(today);
const ensured = file ?? (await props.dailyNotes.create(today));

new props.obsidian.Notice(`今日笔记：${ensured.path}`);
```

## 边界

- 这组 API 只负责“按 Daily Notes 规则”读写日记。
- 如果你要做任意文件操作，去看 [files.md](files.md)。
