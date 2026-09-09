# xdb-2048

经典 2048 数字合并小游戏：滑动合并方块冲击 2048 金方块，支持撤销/存档/战绩统计

## 玩法

- **操作**：方向键 / WASD 移动，触屏滑动同样有效；`Z` 撤销上一步，`N` 新开一局
- **规则**：相同数字相撞合并翻倍；棋盘满且无法合并即终局
- **胜利**：合成目标方块（默认 2048，可设 4096 / 无尽）后可继续挑战
- **盘面 / 模式**：棋盘上方切换器即时切换 3 × 3 / 4 × 4 / 5 × 5 盘面与
  2048 / 4096 / 无尽模式，点击即按新配置开新局；设置页同样可调（下一局生效）
- **生成动画**：新方块从所在格子中心浮现（缩放 + 淡入）

键盘采用**聚焦容器**策略：方向键监听挂在棋盘上，点击棋盘开始、点击外部自动让出按键，
不会劫持 Obsidian 的列表导航与光标移动。

## 方块配色：落日光谱

叙事为「从纸与沙出发，燃过日落，越过皇家色，最终加冕黄金」：

| 数值        | 色带                                        |
| ----------- | ------------------------------------------- |
| 2 / 4       | 纸与沙（中性暖纸色，深色文字）              |
| 8 → 64      | 日落升温（琥珀 → 杏橙 → 珊瑚 → 朱红）       |
| 128 → 1024  | 皇家色阶（树莓 → 品红 → 紫罗兰 → 靛蓝）     |
| 2048        | 金色加冕（金色渐变 + 金辉，通关之冠）        |
| 4096+       | 深空超越（深空蓝灰 + 鎏金描边文字）          |

高值方块伴随逐级增强的辉光；棋盘底色跟随 Obsidian 明暗主题。

## 持久化

- **进度存档**：每步有效移动后快照写入 `viewDefinition.options[game-2048].save`，
  退出视图重进可继续；终局自动清除
- **战绩统计**：最高分 / 最大方块实时刷新，终局与首次达成目标入账
  （累计得分、局数），写入 `stats` 字段，设置页可一键重置
- **写回安全**：View 内配置写回走 `api.getDefinition() → api.updateView()` 重读合并，
  并以串行队列防止高频移动时的并发覆盖

## 开发

```bash
# 仓库根目录
pnpm install          # 安装依赖（仅需一次）
pnpm build Game2048   # 生产构建 → game-2048.xdb.js
pnpm dev Game2048     # 监听模式

# 或在本项目目录内
pnpm build
pnpm dev
```

构建产物 `game-2048.xdb.js` 位于项目根目录，将其放入 XDB 的插件目录即可加载。

## 源码结构

```
src/
├── plugin-core.ts    # install()：registerStyleSheet + registerView + 设置 Tab（特性检测降级）
├── view.tsx          # React 渲染器：棋盘 UI、动画编排、键盘/滑动输入、存档与战绩统计
├── game/engine.ts    # 纯逻辑引擎：两阶段移动（slide → settle）、合并、生成、撤销、胜负
├── settings.ts       # 声明式设置页（盘面尺寸 / 目标 / 动画 / 重置战绩）
├── persist.ts        # 视图配置写回（串行队列 + 重读合并）
├── types.ts          # 元数据常量（唯一读取构建注入 __PLUGIN_*__ 的文件）与解析
└── style.css         # 落日光谱配色与棋盘几何（cqw 随盘面缩放）
```

引擎为无 DOM 纯逻辑（`move()` 产生滑动中间态、`settle()` 收合合并并生成新块），
便于独立测试：合并规则（`[2,2,2,2] → [4,4]`）、位移判定、撤销、终局与胜利判定
均已覆盖（43 项断言）。

## 开发规范

本模板基于 `.agents/skills/xdb-plugin-skills` 约定生成：

- 扩展 ID 带插件命名空间（视图 `game-2048:view`、设置 Tab `game-2048:settings`）
- 图标使用 PascalCase 的 Lucide 名称（如 `List`、`Grid3x3`），不要使用 kebab-case
- 插件元数据（id / 显示名 / 描述 / 作者 / 图标 / 版本）单一来源为 `package.json` 顶层字段（标准 `name`/`version`/`description`/`author` + 扩展 `id`/`icon`），构建时注入源码，发版/改名只改 package.json
- 所有 CSS class 使用插件专属前缀 `game-2048--`（宿主保留前缀 `components--` 不可用）
- 设置页二选一：`src/settings.ts` 纯声明式（只用 `props.setting.*` 原生控件，无插件 DOM）；
  `src/settings.tsx` React 方案（可混用原生控件 + 自定义 React，自定义内容通过
  `setting.custom()` 挂载进设置列表）。统一 padding 由 style.css 的
  `[role="tabpanel"]:has(.game-2048--settingsRoot)` 提供（container 标记类为钩子，
  `--size-*` 等 Obsidian 内置变量，不影响内置 tab）
- `onUpdate` 可重复调用，`onDestroy` 释放资源，`install()` 返回 cleanup
- 修改后可运行校验器检查产物形状：

  ```bash
  node .agents/skills/xdb-plugin-skills/scripts/validate-xdb-plugin.mjs game-2048.xdb.js
  ```
