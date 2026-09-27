# xdb-trex-runner

Chrome 断网小恐龙跑酷（T-Rex Runner）：跳跃/下蹲避障、仙人掌与翼龙、日夜交替、越跑越快、最高分存档

移植自 Chromium 离线小恐龙彩蛋（BSD 许可），参考实现为
[wayou/t-rex-runner](https://github.com/wayou/t-rex-runner)（BSD 3-Clause，源码快照见
`refer/t-rex-runner/`，已被 `.gitignore` 排除）。原版类结构、物理常量、精灵图与音效
完整保留，仅做 XDB 宿主适配（见下）。

## 玩法

- **空格 / ↑**：跳跃（按住跳得更高）；点击游戏区同样跳跃
- **↓**：地面下蹲 / 空中速降
- **Enter / 空格 / 点击**：终局后重开（原版节奏：撞毁后 750ms 起可重开）
- **P**：暂停 / 继续；**N**：重开（有进度需二次确认）
- 触屏：游戏区点按跳跃，或使用下方「跳跃 / 下蹲」按钮（按住生效）

机制与原版一致：速度随距离从 6 加速到 13；得分 = 奔跑距离 × 0.025，每 100 分里程碑
提示；700 分起进入夜晚（月亮相位 + 星空 + 画面反色），每 700 分昼夜交替；小/大仙人掌
成组出现（速度达标后），翼龙三档高度、速度 8.5 起。最高分持久化在本视图（画布右上角
HI），并在设置页汇总累计战绩。

## 目录结构

```
src/
├── game/
│   ├── runner.ts   # 移植版引擎（原版 index.js 的 Runner/Trex/Obstacle/Horizon/
│   │               # NightMode/DistanceMeter/GameOverPanel 等，文件头列有适配清单）
│   └── assets.ts   # 内嵌精灵图（1x/2x）与音效（base64，由 refer/gen-assets.mjs 生成）
├── view.tsx        # React HUD：记分条 / 暂停·重开 / 触屏按钮 / 新纪录提示
├── settings.ts     # 声明式设置页：规则说明 / 音效开关 / 战绩存档
├── persist.ts      # 战绩写回 viewDefinition.options（串行队列）
├── plugin-core.ts  # 注册点：registerView + registerViewSettingsTab（降级共享设置区）
├── types.ts        # 元数据常量（唯一读取 __PLUGIN_*__ 的地方）+ 选项解析
└── style.css       # HUD 样式 + 原版 index.css 游戏区样式移植（收敛为局部反色）
refer/              # 参考实现快照（gitignore）：t-rex-runner 仓库 + gen-assets.mjs
```

## 宿主适配说明（相对原版）

原版是离线错误页脚本：`window` 单例、`document` 级键盘/鼠标、`document.body` 反色、
`window.resize` 自适应。移植版保持逐行逻辑不变，仅调整边界：

1. 挂载元素由构造函数注入，同一页面可多实例；键盘按「激活实例」门控（最近挂载/点击的实例响应）
2. 精灵图 / 音效内嵌为 data URL（原版为页面 `<img>` / `<template>`）
3. 日夜反转 class 加在游戏区元素上（原版加 `document.body`），不污染宿主界面
4. 尺寸自适应用 `ResizeObserver`（原版 `window.resize`）
5. 新增 `destroy()` 生命周期：移除监听、取消 rAF、清理注入 DOM 与 AudioContext
6. 最高分经 `options.highScore` 注入、`onGameOver(score, isRecord)` 回调持久化到本视图
7. 移除离线页专属逻辑（snackbar / 静态 icon / arcade 全屏 / 提示浮层）

## 开发

```bash
# 仓库根目录
pnpm install            # 安装依赖（仅需一次）
pnpm build TrexRunner   # 生产构建 → trex-runner.xdb.js
pnpm dev TrexRunner     # 监听模式

# 或在本项目目录内
pnpm build
pnpm dev

# 重新生成内嵌资源（改动 refer/t-rex-runner 后才需要）
node refer/gen-assets.mjs
```

构建产物 `trex-runner.xdb.js` 位于项目根目录，将其放入 XDB 的插件目录即可加载。

## 开发规范

本模板基于 `.agents/skills/xdb-plugin-skills` 约定生成：

- 扩展 ID 带插件命名空间（视图 `trex-runner:view`、设置 Tab `trex-runner:settings`）
- 图标使用 PascalCase 的 Lucide 名称（如 `List`、`BarChart2`），不要使用 kebab-case
- 插件元数据（id / 显示名 / 描述 / 作者 / 图标 / 版本）单一来源为 `package.json` 顶层字段（标准 `name`/`version`/`description`/`author` + 扩展 `id`/`icon`），构建时注入源码，发版/改名只改 package.json
- 所有 CSS class 使用插件专属前缀 `trexRunner--`（宿主保留前缀 `components--` 不可用）
- 设置页为声明式方案：`src/settings.ts` 只用 `props.setting.*` 原生控件。统一 padding 由 style.css 的
  `[role="tabpanel"]:has(.trexRunner--settingsRoot)` 提供（container 标记类为钩子，
  `--size-*` 等 Obsidian 内置变量，不影响内置 tab）
- `onUpdate` 可重复调用，`onDestroy` 释放资源，`install()` 返回 cleanup
- 修改后可运行校验器检查产物形状：

  ```bash
  node .agents/skills/xdb-plugin-skills/scripts/validate-xdb-plugin.mjs trex-runner.xdb.js
  ```

## 许可

- 游戏源码：Chromium（BSD 3-Clause，© The Chromium Authors），经
  [wayou/t-rex-runner](https://github.com/wayou/t-rex-runner) 提取；精灵图与音效版权归 Google/Chromium 作者所有
- 本插件的 XDB 适配层：与本仓库其余部分同许可
