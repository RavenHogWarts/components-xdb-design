# Markdown API

`props.markdown` 是 Markdown API。

```ts
markdown: MarkdownApi;
```

## API

```ts
interface MarkdownApi {
  /** 读取文件正文，自动去掉 frontmatter */
  read(filePath: string): Promise<string>;

  /** 读取某个 heading 下的内容 */
  readUnderHeading(filePath: string, heading: Omit<MarkdownHeadingLocation, 'createIfNotExist'>): Promise<string>;

  /** 在 heading 区块末尾追加内容 */
  appendUnderHeading(filePath: string, heading: MarkdownHeadingLocation, content: string): Promise<void>;

  /** 在 heading 区块开头插入内容 */
  prependUnderHeading(filePath: string, heading: MarkdownHeadingLocation, content: string): Promise<void>;

  /** 替换 heading 区块内容 */
  replaceUnderHeading(filePath: string, heading: MarkdownHeadingLocation, content: string): Promise<void>;

  /** 替换文件正文（保留 frontmatter） */
  replace(filePath: string, content: string): Promise<void>;

  /** 在文件末尾追加内容 */
  append(filePath: string, content: string): Promise<void>;

  /** 在文件正文开头插入内容（frontmatter 后） */
  prepend(filePath: string, content: string): Promise<void>;

  /** 解析 markdown heading 字符串 */
  parseHeading(heading: string): MarkdownHeadingInfo;

  /** 去掉 `##` 这类 markdown 标题前缀 */
  trimHeading(heading: string): string;

  /** 读取标题层级 */
  resolveHeadingLevel(heading: string): number;
}
```

## 相关类型

```ts
interface MarkdownHeadingLocation {
  heading: string;
  includeSubHeadings?: boolean;
  createIfNotExist?: boolean;
}

interface MarkdownHeadingInfo {
  text: string;
  level: number;
}
```

## 参数规则

- `heading.heading` 必须是 markdown 标题语法，例如 `## Summary`、`### Tasks`。
- `includeSubHeadings`
  - `false`：遇到下一个任意级别标题就结束
  - `true`：遇到“同级或更高层级”的下一个标题才结束
- `createIfNotExist`
  - 只对写操作有效
  - `true`：目标标题不存在时，在文件末尾补出该 heading 再写入

## 示例

### 读取某个 section

```js
const summary = await props.markdown.readUnderHeading('Notes/Plan.md', {
  heading: '## Summary',
  includeSubHeadings: true,
});
```

### 不存在就创建 heading 再追加

```js
await props.markdown.appendUnderHeading(
  'Notes/Plan.md',
  { heading: '## Review', createIfNotExist: true },
  '\n- checked by xdb plugin'
);
```

### 解析标题字符串

```js
const info = props.markdown.parseHeading('### Sprint Notes');
// info.text === 'Sprint Notes'
// info.level === 3
```

## 边界

- `read()` 返回的是“去掉 frontmatter 的正文”，不是整文件原文。
- 如果已经有 Markdown 字符串、只需要渲染它，不用这个 API；直接用 `props.obsidian.MarkdownRenderer`。如果要渲染文件中某个标题下的内容，则先用 `readUnderHeading()` 提取，再交给 `MarkdownRenderer`。
