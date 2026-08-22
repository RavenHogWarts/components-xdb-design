# Setting UI API Schema

`props.setting` 让第三方 DOM 扩展声明宿主标准设置控件。把每次 `onUpdate(props)` 当作一次 render：从本轮 props 读取 value，声明当前应存在的控件，通过 surface setter 写回持久化数据。

## Render 规则

```ts
interface SettingHandle {
  /**
   * 在当前 onUpdate 声明 pass 完成前移除此项。不要跨 pass 保存或在事件回调中调用 handle；
   * 条件不成立时不声明该 key 更直接。它不替代持久化 setter，也不是资源 cleanup。
   */
  remove(): void;
}

interface SettingItemBase {
  /**
   * 当前 settings 实例内的幂等身份。必须稳定并在同一 pass 中唯一。
   * 同 key 重复声明时后者替换前者；下一轮未声明的 key 自动消失。
   */
  key: string;

  /** 设置行的用户可见名称。 */
  label: string;

  /**
   * PascalCase Lucide icon 名，例如 BarChart2、Folder。省略/空白时不显示；
   * 不要传 ReactNode，也不要使用 kebab-case。
   */
  icon?: string;

  /** 标签下方的辅助说明。 */
  description?: string;

  /** true 时保留显示但禁止交互。 */
  disabled?: boolean;
}
```

- `value` 必须来自当前 `props.action` / `viewDefinition` / `field`。
- `onChange` 必须通过 `setAction()` / `setViewDefinition()` / `setFieldDefinition()` 写回。
- builder 项与 `props.container` DOM 分属两个并列区域；不要依赖它们相互嵌套。
- `custom.render` 和 `popover.content` 返回的 cleanup 由对应 React slot 在重渲染、关闭或移除时调用；普通控件不需要 cleanup。

## 公共选项与 filter 输入

```ts
interface SettingUiOption {
  /** 稳定选项身份，也是 onChange 返回的值。 */
  value: string;
  /** 用户可见名称。 */
  label: string;
  /** 富选项的辅助说明。 */
  description?: string;
  /** 搜索时除 value/label 外参与匹配的词。 */
  keywords?: readonly string[];
  /** true 时选项可见但不可选择。 */
  disabled?: boolean;
  /** PascalCase Lucide icon 名。 */
  icon?: string;
}

/** select 使用的轻量选项；需要说明、图标或禁用态时改用 picker。 */
interface SettingSelectOption {
  /** 稳定选项身份，也是 onChange 返回的值。 */
  value: string;
  /** 用户可见名称。 */
  label: string;
}

/** 文件 filter 的扁平只读输入；不是 Obsidian TFile。 */
interface FileLike {
  /** Vault 相对路径。 */
  path: string;
  /** 含扩展名的文件名。 */
  name: string;
  /** 不含点号的扩展名。 */
  extension: string;
}

/** 文件夹 filter 的扁平只读输入；不是 Obsidian TFolder。 */
interface FolderLike {
  /** Vault 相对路径。 */
  path: string;
  /** 最后一段文件夹名。 */
  name: string;
}

/** Frontmatter 属性候选的扁平只读输入。 */
interface PropertyLike {
  /** 持久化属性名。 */
  name: string;
  /** 可选用户显示名。 */
  label?: string;
  /** 可选属性类型。 */
  type?: string;
}

/** Database 字段候选的扁平只读输入。 */
interface FieldLike {
  /** 字段稳定名称。 */
  name: string;
  /** 可选用户显示名。 */
  label?: string;
  /** 可选字段类型。 */
  type?: string;
}
```

## 基础控件

```ts
interface SettingSwitchOpts extends SettingItemBase {
  /** 当前开关值。 */
  value: boolean;
  /** 用户切换后调用；回调负责持久化。 */
  onChange(value: boolean): void;
}

interface SettingInputOpts extends SettingItemBase {
  /** 当前文本值；不要用 undefined 表示空值。 */
  value: string;
  /** 输入为空时显示的提示。 */
  placeholder?: string;
  /** 文本变化后调用；回调负责持久化或提交策略。 */
  onChange(value: string): void;
}

interface SettingNumberInputOpts extends SettingItemBase {
  /** 当前有限数值。 */
  value: number;
  /** 浏览器数值输入的最小值提示/约束。 */
  min?: number;
  /** 浏览器数值输入的最大值提示/约束。 */
  max?: number;
  /** 数值步长。 */
  step?: number;
  /** 控件右侧显示的单位文本，不参与 value。 */
  suffix?: string;
  /** 数值变化后调用；业务范围仍应由插件验证。 */
  onChange(value: number): void;
}
```

## 选择控件

```ts
interface SettingSelectOpts extends SettingItemBase {
  /** 当前 option value。 */
  value: string;
  /** 少量固定纯文本选项；不支持 description/icon/disabled。 */
  options: SettingSelectOption[];
  /** 未选择时的提示。 */
  placeholder?: string;
  /** 选择已有 option 后调用。 */
  onChange(value: string): void;
}

interface SettingPickerOpts extends SettingItemBase {
  /** 当前 option value。 */
  value: string;
  /** 固定富选项；支持 description/icon/disabled，不提供文本搜索。 */
  options: SettingUiOption[];
  /** 未选择时的提示。 */
  placeholder?: string;
  /** options 为空时显示的文本。 */
  emptyText?: string;
  /** 选择已有 option 后调用。 */
  onChange(value: string): void;
}

interface SettingComboboxOpts extends SettingItemBase {
  /** 当前已提交文本；可以不在 options 中。 */
  value: string;
  /** 搜索建议，不是合法值白名单。 */
  options: SettingUiOption[];
  /** 输入为空时的提示。 */
  placeholder?: string;
  /** 没有匹配建议时显示的文本。 */
  emptyText?: string;
  /** 选择建议或提交自由文本后调用。 */
  onChange(value: string): void;
}

interface SettingAutocompleteOpts extends SettingItemBase {
  /** 当前已选择的 option value。查询文本不会作为 value 提交。 */
  value: string;
  /** 已有选项或每次 render 时同步求值的 getter。 */
  options: SettingUiOption[] | (() => SettingUiOption[]);
  /** true 时显示加载状态；插件自己负责异步请求。 */
  loading?: boolean;
  /** 非空时显示错误；传字符串而不是 Error。 */
  error?: string | null;
  /** 搜索输入提示。 */
  placeholder?: string;
  /** 无匹配结果时显示的文本。 */
  emptyText?: string;
  /** true 时允许清空为 ''。 */
  clearable?: boolean;
  /**
   * 选择已有选项后调用。option 是当前 options 中与 value 匹配的对象；
   * 清空或无法匹配时可能为 undefined。
   */
  onChange(value: string, option?: SettingUiOption): void;
}
```

选择原则：`select` 用于少量固定纯文本枚举；`picker` 用于固定富选项；`autocomplete` 只能选择已有项；`combobox` 允许提交候选外文本。

## Vault 与 Database 候选控件

```ts
interface SettingFileAutocompleteOpts extends SettingItemBase {
  /** 当前 Vault 文件路径；只能选择已有文件。 */
  value: string;
  /** 搜索输入为空时的提示。 */
  placeholder?: string;
  /** 同步过滤已有文件候选；不要产生副作用或抛错。 */
  filter?: (file: FileLike) => boolean;
  /** 选择已有文件路径后调用。 */
  onChange(value: string): void;
}

interface SettingFileComboboxOpts extends SettingItemBase {
  /** 当前文件路径文本；可以指向尚不存在的文件。 */
  value: string;
  /** 搜索输入为空时的提示。 */
  placeholder?: string;
  /** 没有匹配建议时显示的文本。 */
  emptyText?: string;
  /** 只过滤建议；不限制自由输入值。 */
  filter?: (file: FileLike) => boolean;
  /** 选择建议或提交自由文本后调用。 */
  onChange(value: string): void;
}

type SettingImageAutocompleteOpts = SettingItemBase &
  (
    | {
        /** 单选图片路径。 */
        value: string;
        /** 必须与单选 value 形状一致。 */
        onChange(value: string): void;
      }
    | {
        /** 多选图片路径。 */
        value: string[];
        /** 必须与多选 value 形状一致。 */
        onChange(value: string[]): void;
      }
  );

interface SettingFolderAutocompleteOpts extends SettingItemBase {
  /** 当前 Vault 文件夹路径；只能选择已有文件夹。 */
  value: string;
  /** 搜索输入为空时的提示。 */
  placeholder?: string;
  /** 同步过滤已有文件夹候选。 */
  filter?: (folder: FolderLike) => boolean;
  /** 选择已有文件夹路径后调用。 */
  onChange(value: string): void;
}

interface SettingFolderComboboxOpts extends SettingItemBase {
  /** 当前文件夹路径文本；可以指向尚不存在的文件夹。 */
  value: string;
  /** 搜索输入为空时的提示。 */
  placeholder?: string;
  /** 没有匹配建议时显示的文本。 */
  emptyText?: string;
  /** 只过滤建议；不限制自由输入值。 */
  filter?: (folder: FolderLike) => boolean;
  /** 选择建议或提交自由文本后调用。 */
  onChange(value: string): void;
}

interface SettingPropertyAutocompleteOpts extends SettingItemBase {
  /** 当前已有 Frontmatter 属性名。 */
  value: string;
  /** 搜索输入为空时的提示。 */
  placeholder?: string;
  /** 同步过滤已有属性候选。 */
  filter?: (property: PropertyLike) => boolean;
  /** 选择已有属性名后调用。 */
  onChange(value: string): void;
}

interface SettingPropertyComboboxOpts extends SettingItemBase {
  /** 当前属性名；允许输入尚不存在的新属性名。 */
  value: string;
  /** 搜索输入为空时的提示。 */
  placeholder?: string;
  /** 没有匹配建议时显示的文本。 */
  emptyText?: string;
  /** 只过滤建议；不限制自由输入值。 */
  filter?: (property: PropertyLike) => boolean;
  /** 选择建议或提交自由文本后调用。 */
  onChange(value: string): void;
}

interface SettingFieldAutocompleteOpts extends SettingItemBase {
  /** 当前 Database 字段名；只能选择宿主提供的已有字段。 */
  value: string;
  /** 搜索输入为空时的提示。 */
  placeholder?: string;
  /** true 时允许清空为 ''。 */
  clearable?: boolean;
  /** 同步过滤当前 Database 字段候选。 */
  filter?: (field: FieldLike) => boolean;
  /** 选择已有字段名，或在 clearable 时清空为 '' 后调用。 */
  onChange(value: string): void;
}
```

`fieldAutocomplete` 的字段列表由宿主从当前 `api.getAvailableFields()` 提供。Action Editor 的 `api` 可能缺失；此时列表为空，其它 Setting UI 控件不受影响。

## 动作、Popover 与自定义内容

```ts
interface SettingActionOpts extends SettingItemBase {
  /** danger 使用危险操作样式；省略为 default。 */
  variant?: 'default' | 'danger';
  /** 按钮右侧额外文本，不是 label 的一部分。 */
  suffix?: string;
  /** 点击后调用；异步错误需在回调内部捕获。 */
  onClick(): void;
}

interface SettingPopoverOpts extends SettingItemBase {
  /** trigger 上显示的当前值文本。 */
  value?: string;
  /** 可选受控打开状态；提供时配合 onOpenChange。 */
  open?: boolean;
  /** 打开状态变化回调；调用 onOpenChange(false) 关闭受控 popover。 */
  onOpenChange?: (open: boolean) => void;
  /**
   * 向新的 popover body 容器渲染内容。
   * 返回的 cleanup 在关闭、重渲染或移除时调用。
   */
  content(container: HTMLElement): void | (() => void);
}

interface SettingCustomOpts {
  /** 当前 settings 实例内稳定且唯一的幂等 key。 */
  key: string;
  /**
   * 向新的自定义容器渲染内容。返回 cleanup 释放 listener、chart、observer 等资源；
   * cleanup 在重渲染或此 key 被移除时调用。
   */
  render(container: HTMLElement): void | (() => void);
}
```

## Builder

```ts
interface SettingUi {
  /** 声明 boolean 开关。 */
  switch(opts: SettingSwitchOpts): SettingHandle;
  /** 声明单行文本输入。 */
  input(opts: SettingInputOpts): SettingHandle;
  /** 声明数值输入。 */
  numberInput(opts: SettingNumberInputOpts): SettingHandle;

  /** 声明少量固定纯文本选项。 */
  select(opts: SettingSelectOpts): SettingHandle;
  /** 声明不带搜索的固定富选项。 */
  picker(opts: SettingPickerOpts): SettingHandle;
  /** 声明允许自由文本的可搜索建议输入。 */
  combobox(opts: SettingComboboxOpts): SettingHandle;
  /** 声明只能选择已有项的通用搜索选择器。 */
  autocomplete(opts: SettingAutocompleteOpts): SettingHandle;

  /** 声明只能选择已有 Vault 文件的搜索选择器。 */
  fileAutocomplete(opts: SettingFileAutocompleteOpts): SettingHandle;
  /** 声明允许自由文件路径的搜索建议输入。 */
  fileCombobox(opts: SettingFileComboboxOpts): SettingHandle;
  /** 声明单选或多选 Vault 图片路径的搜索选择器。 */
  imageAutocomplete(opts: SettingImageAutocompleteOpts): SettingHandle;
  /** 声明只能选择已有 Vault 文件夹的搜索选择器。 */
  folderAutocomplete(opts: SettingFolderAutocompleteOpts): SettingHandle;
  /** 声明允许自由文件夹路径的搜索建议输入。 */
  folderCombobox(opts: SettingFolderComboboxOpts): SettingHandle;
  /** 声明只能选择已有 Frontmatter 属性的搜索选择器。 */
  propertyAutocomplete(opts: SettingPropertyAutocompleteOpts): SettingHandle;
  /** 声明允许新属性名的搜索建议输入。 */
  propertyCombobox(opts: SettingPropertyComboboxOpts): SettingHandle;
  /** 声明只能选择当前 Database 已有字段的搜索选择器。 */
  fieldAutocomplete(opts: SettingFieldAutocompleteOpts): SettingHandle;

  /** 声明操作按钮。 */
  action(opts: SettingActionOpts): SettingHandle;
  /** 声明由插件渲染内容的 Popover trigger。 */
  popover(opts: SettingPopoverOpts): SettingHandle;

  /** 添加小节标题；由声明顺序自动生成当前 pass 的 key。 */
  title(label: string): void;
  /** 添加说明段落；由声明顺序自动生成当前 pass 的 key。 */
  description(text: string): void;
  /** 添加分隔线；由声明顺序自动生成当前 pass 的 key。 */
  divider(): void;

  /** 声明完全自定义的宿主 slot。 */
  custom(opts: SettingCustomOpts): SettingHandle;
}
```

布局原语没有显式 key，因此条件渲染时要保持同一 pass 内的声明顺序稳定。
