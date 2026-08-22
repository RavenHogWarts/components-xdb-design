# 视图样式

## 核心合同

XDB 视图样式是一个扁平、可继承的 CSS custom property 配置，不是组件主题 Schema，也不是另一套布局系统：

```text
XDB 默认值 -> Root Group style -> 外层 Group style -> 当前 View style -> 当前 View 高级 CSS
```

- 用户只要求美化时，只修改 `rootGroup.style` 或 `view.style`；保留 source、字段、筛选、Action、View 结构和布局。
- 整库统一风格写在 `rootGroup.style`。一个 Dashboard、tabs 或 vertical-tabs 的局部统一风格写在对应 Group。
- 子 View 只保存与父级不同的 Token。当前 View 的同名 Token 覆盖祖先值。
- 产品内的主题 Select 本质上只是把一份完整配置应用到 `rootGroup.style`。预置 ID 不写入 `.xdb`，skill 也不复制产品预置目录；需要精确复用某个内置主题时，以当前产品应用后的配置为准。
- 所有 Token 值都必须是非空 CSS 字符串。不要发明嵌套的 `theme`、`typography`、`radius` 或 `palette` 对象。

## 数据结构

普通 View 和 Root Group 使用相同的 `style` 形状：

```json
{
  "rootGroup": {
    "type": "tabs",
    "style": {
      "light": {
        "--xdb-background-primary": "#ffffff"
      },
      "dark": {
        "--xdb-background-primary": "#202124"
      },
      "css": ":scope { background: #f3f4f6; }\n.theme-dark :scope { background: #111318; }"
    }
  }
}
```

- `light` 是基础 Token map，在 Light 和 Dark 模式下都存在。
- `dark` 在 `.theme-dark` 下覆盖同名 Light Token；没有写入 `dark` 的 Token 继续使用 Light 值。
- 未设置的 Token 使用 XDB 默认值。
- `css` 是可选的高级 CSS 正文，只能写在 `style.css`。
- 未知 custom property 会原样保存和应用。只有 XDB、官方 View 或第三方插件实际消费它时才会产生视觉效果。

## 公共 Token

下面十七项是 XDB 公共 View Token 的完整清单。默认值来自 XDB 根容器；具体 View 只在自己的真实视觉表面消费它们，不会把每个 Token 机械地画到每个 DOM 节点上。

| Token                            | XDB 默认值                          | 语义与使用边界                                                                                                                  |
| -------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `--xdb-background-primary`       | `initial`                           | View 的主要视觉表面。`initial` 允许透明顶层或 consumer 自己的 fallback；需要 sticky 内容遮挡滚动层时应提供不透明色。            |
| `--xdb-background-primary-alt`   | `var(--background-primary-alt)`     | 主背景的替代表面，例如与主要表面相邻的层级。不要把它当作 hover。                                                                |
| `--xdb-background-secondary`     | `var(--background-secondary)`       | 次级容器或面板背景。                                                                                                            |
| `--xdb-background-secondary-alt` | `var(--background-secondary-alt)`   | 次级背景的替代层级，用于进一步区分嵌套区域。                                                                                    |
| `--xdb-background-hover`         | `var(--background-modifier-hover)`  | XDB 可交互元素的 hover 或选中背景；不代表 accent、success、warning 或 danger。                                                  |
| `--xdb-text-primary`             | `var(--text-normal)`                | 正文、标题和主要数据文字。                                                                                                      |
| `--xdb-text-secondary`           | `var(--text-muted)`                 | 次要说明、辅助标签和弱一级的数据文字。                                                                                          |
| `--xdb-text-muted`               | `var(--text-faint)`                 | 占位、空状态提示和最低强调文字。                                                                                                |
| `--xdb-border-color`             | `var(--background-modifier-border)` | 主要视觉表面的边框颜色。只有 consumer 同时绘制边框时才可见。                                                                    |
| `--xdb-border-width`             | `0px`                               | 主要视觉表面的边框宽度；`0px` 表示关闭。可以使用 `1px`、`2px` 等合法 CSS 长度。                                                 |
| `--xdb-border-style`             | `solid`                             | 主要视觉表面的边框样式，如 `solid`、`dashed`。                                                                                  |
| `--xdb-border-radius`            | `var(--radius-l)`                   | 主要视觉表面的圆角。优先复用 Obsidian `--radius-*`；需要直角时使用 `0px`，需要手绘轮廓时可以写完整自由 CSS radius。             |
| `--xdb-box-shadow`               | `none`                              | 主要视觉表面的阴影。接受完整 `box-shadow` 值，也可引用宿主 Token。                                                              |
| `--xdb-font-family`              | `initial`                           | View 基础内容字体。优先使用 `var(--font-interface)`、`var(--font-text)` 或 `var(--font-monospace)`，并为外部字体提供 fallback。 |
| `--xdb-font-size`                | `initial`                           | View 基础内容字号。优先使用 Obsidian 字号 Token，也接受 `rem`、`px`、`clamp()` 等合法值。                                       |
| `--xdb-font-weight`              | `initial`                           | View 基础内容字重。接受数值或关键字；组件为标题等角色设置的明确字重仍可能覆盖它。                                               |
| `--xdb-line-height`              | `initial`                           | View 基础内容行高。优先使用无单位数值；它不负责 Dashboard item 高度、Table 行高等布局几何。                                     |

### Token 不负责什么

- 公共 Token 不包含 accent、link、success、warning、danger、图表 series、日历事件分类或字段选项颜色。
- 公共 Token 不控制 padding、gap、列宽、Dashboard layouts、Table 密度或具体按钮文案。
- `--xdb-border-*`、`--xdb-box-shadow` 和背景 Token 表达 View 的真实视觉表面，不保证改写每个内部控件。
- 官方 View 的专用扩展使用 `--xdb-<view-type>-<part>-<property>`；第三方插件使用 `--<plugin-id>-<part>-<property>`。专用 Token 无需注册，但必须由对应 View 的 CSS 主动消费。
- 不要使用已经移除的 `--xdb-background`、`--xdb-color`，也不要把字段颜色系统的 `--xdb-color-default` 当作 View 正文色。

## 应用位置与继承

| 目标                                           | 写入位置                   | 结果                                                               |
| ---------------------------------------------- | -------------------------- | ------------------------------------------------------------------ |
| 整个数据库统一主题                             | `rootGroup.style`          | 公共 Token 应用到所有后代 View root。                              |
| 一个 Dashboard / tabs / vertical-tabs 统一主题 | 对应 Group View 的 `style` | 应用到该 Group 的所有后代 View。                                   |
| 单个 View 特殊样式                             | 该 View 的 `style`         | 只覆盖当前 View 的同名 Token。                                     |
| 第三方 Light DOM View                          | 祖先 Group 或当前 View     | 宿主容器获得公共 Token；插件内部是否变化取决于插件有没有消费它们。 |
| Shadow DOM、iframe、Canvas                     | 插件自行桥接               | XDB 只保证宿主表面，不能自动进入隔离渲染边界。                     |
| Reference View                                 | Reference 外框             | 被引用数据库会建立新的 XDB root，不继承当前数据库的 Group 主题。   |

Token 是 custom property，可以沿 Light DOM 继承。背景、边框、圆角和阴影这些普通 CSS property 本身不会继承，因此每个 View 必须在真实表面使用 `var(--xdb-...)` 才会生效。

## 高级 CSS 与子 View 边界

高级 CSS 使用当前配置 View 的 `:scope`：

```css
:scope {
  background:
    linear-gradient(rgba(0, 0, 0, 0.05) 1px, transparent 1px) 0 0 / 18px 18px,
    #f5f7f6;
}

.theme-dark :scope {
  background:
    linear-gradient(rgba(0, 255, 102, 0.04) 1px, transparent 1px) 0 0 / 18px 18px,
    #020b05;
}
```

宿主实际使用带下边界的原生 scope：

```css
@scope (#current-view-mount) to (:scope [data-xdb-view-root]) {
  /* style.css */
}
```

因此必须区分两条规则：

1. 在 `:scope` 声明的 custom property 可以继续继承到后代 Light DOM，除非子 View 覆盖它。
2. `:scope .some-selector` 不能越过嵌套的 `[data-xdb-view-root]`，所以不能从 Root Group 直接选择子 View 的 Dashboard title、Tab header 或第三方插件内部节点。

高级 CSS 适合设置当前 View 根画布的 `background`，或者声明已有公开 Token。主题不得依赖 `.components--*` 等 XDB 内部 class。若目标角色没有公开 Token，例如特定标题栏背景，就无法通过 Root Group 主题稳定修改；应由对应 View 提供并消费专用 Token，而不是移除 scope 边界。

## 唯一完整 Demo

[project-dashboard.xdb](../examples/project-dashboard.xdb) 是本 skill 唯一维护的完整 `.xdb` 案例。它同时展示：

- `rootGroup.style` 中十七项公共 Token 的完整 Light 配置和必要的 Dark 覆盖；
- Root Group 的 Light/Dark 网格画布高级 CSS；
- Dashboard Group 下 Metric、Table、Kanban 和 Calendar 对公共 Token 的继承；
- Metric 子 View 只覆盖排版 Token；
- 数据边界、字段、filter、aggregate、layouts、newRowFile 和按钮 Action 的完整闭环。

不要再为每个内置主题复制一份 token JSON。产品预置变化时不需要同步多份 skill 案例；执行者只需要理解公共合同，并从这个完整 Demo 改出用户需要的值。

## 交付检查

- 输出可直接写入 `.xdb` 的 flat `style.light`、`style.dark` 和可选 `style.css`。
- 说明 style 写在 Root Group、Group 还是单个 View，以及影响哪些后代。
- Light/Dark 正文与背景有足够对比；Dark 只写需要覆盖的值。
- 优先使用现有 XDB/Obsidian Token；自由值只用于明确的字体、字号、圆角或视觉语言需求。
- 不发明内部 class、嵌套主题 Schema、accent Token 或跨子 View 的 CSS 能力。
- 修改完整 `.xdb` 后运行 validator，并在真实 Obsidian 中检查 sticky、Canvas、第三方 View 和明暗模式。
