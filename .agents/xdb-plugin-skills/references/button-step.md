# Button Step

为按钮字段注册一个可执行步骤，以及对应的设置面板。两者通过**同一个 `id`** 绑定。

## 配置位置

`extensionData`，通过 `getData()` 读、`updateData()` 写。

## registerButtonStep

执行动作（不渲染界面）。

```ts
interface DatabaseButtonStepExtension {
  /** 唯一 id，和对应 settings 扩展用同一常量绑定 */
  id: string;
  name: string;
  description?: string;
  /** 触发时调用，返回 Promise */
  run: (props: DatabaseButtonStepRunProps) => Promise<void>;
}
```

props = [公共上下文](conventions.md#公共上下文-props) 外加：

```ts
type DatabaseButtonStepRunProps = XdbContextProps & {
  /** 数据库读写入口，能力见 types.md */
  api: Database;
  /** 当前 view id */
  viewId: string;
  /** 触发这个按钮步骤的鼠标事件 */
  event: MouseEvent;
  /** 当前按钮字段的定义 */
  field: DatabaseFieldDefinition;
  /** 当前行的原始数据（结构见 types.md） */
  $item: Record<string, unknown>;
  /** 读私有配置 */
  getData: () => Readonly<Record<string, unknown>>;
  /** 写私有配置 */
  updateData: (update: unknown) => void;
};

type DatabaseFieldDefinition = {
  name: string;
  type?: DatabaseFieldType; // 'text' | 'number' | 'boolean' | 'date' | 'datetime' | 'select' | 'multi-select' | 'button' | string
  formula?: string;
  options?: Record<string, unknown>;
};
```

> `run` 拿到的是当前行原始数据 `$item` 和宿主能力（`app` / `api` / `obsidian` 等）。需要改当前行时，通过 `$item` 定位、用 `api` 操作。

## registerButtonStepSettings

按钮步骤设置面板。`id` 必须等于对应 button step 的 `id`。

```ts
interface DatabaseButtonStepSettingsExtension {
  id: string;
  settings: () => {
    /** 首次渲染和后续配置变化时调用 */
    onUpdate: (props: DatabaseButtonStepRunSettingsProps) => void;
    onDestroy: () => void;
  };
}
```

props = 公共上下文外加 `container`、`api`、`viewId`、`field`、`getData`、`updateData`。

## 示例

按钮步骤把配置指定的字段值复制到剪贴板；设置面板让用户指定字段名：

```js
const STEP_ID = 'copy-field';

ctx.registerButtonStep({
  id: STEP_ID,
  name: 'Copy Field',
  description: '把指定字段的值复制到剪贴板',
  async run(props) {
    const field = props.getData().field ?? 'name';
    const value = props.$item[field];
    if (value == null) return;
    await navigator.clipboard.writeText(String(value));
    new props.obsidian.Notice(`已复制：${value}`);
  },
});

// 同一 id 绑定设置面板
ctx.registerButtonStepSettings({
  id: STEP_ID,
  settings() {
    return {
      onUpdate(props) {
        const current = props.getData().field ?? 'name';
        props.container.replaceChildren();
        const input = document.createElement('input');
        input.value = current;
        input.placeholder = '字段名，如 name';
        input.addEventListener('change', () => {
          props.updateData({ field: input.value });
        });
        props.container.appendChild(input);
      },
      onDestroy() {},
    };
  },
});
```
