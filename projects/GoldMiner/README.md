# xdb-gold-miner

黄金矿工移植版 —— 基于 Canvas 2D 从零实现的经典黄金矿工玩法（矢量绘制、合成音效，无外部资源；`refer/` 下的 H5 源码仅作玩法参考，已 gitignore）。

## 玩法

- 点击画面或按 **空格** 放出钩爪，钩爪摆动中瞄准时机出手
- 金块越大越值钱也越重（收得慢）；钻石小而贵；神秘袋开出随机金额；石头不值钱还很重；TNT 会爆炸并波及周边，鼹鼠背着钻石来回跑
- 限时达到目标金额进入**商店**：炸药（收钩途中按 **X** 引爆销毁抓到的物品）、强力马达、幸运四叶草、岩石图鉴
- **R** 随时重开一局

## XDB 特色

- **独立设置 Tab**：难度 / 摆锤速度 / 每关时间 / 音效
- **战绩存档（按视图独立）**：最高分、最高关卡、累计金币、局数，存在 `viewDefinition.options`，同一数据库可为不同标签页各自记档，支持一键重置
- **战绩写入数据库**：开启后每局结束在当前视图新建一行（`score` / `level` / `difficulty` / `date` 字段，需 source 支持 `createRow`，如 file source），之后可用表格视图筛选、统计战绩
- 跟随 Obsidian 明暗主题的自适应画面

## 开发

```bash
# 仓库根目录
pnpm install          # 安装依赖（仅需一次）
pnpm build GoldMiner   # 生产构建 → gold-miner.xdb.js
pnpm dev GoldMiner     # 监听模式

# 或在本项目目录内
pnpm build
pnpm dev
```

构建产物 `gold-miner.xdb.js` 位于项目根目录，将其放入 XDB 的插件目录即可加载；在数据库里新建视图时选择「xdb-gold-miner」类型。

## 开发规范

本模板基于 `.agents/skills/xdb-plugin-skills` 约定生成：

- 扩展 ID 带插件命名空间（视图 `gold-miner:view`、设置 Tab `gold-miner:settings`）
- 图标使用 PascalCase 的 Lucide 名称（如 `List`、`BarChart2`），不要使用 kebab-case
- 插件元数据（id / 显示名 / 描述 / 作者 / 图标 / 版本）单一来源为 `package.json` 顶层字段（标准 `name`/`version`/`description`/`author` + 扩展 `id`/`icon`），构建时注入源码，发版/改名只改 package.json
- 所有 CSS class 使用插件专属前缀 `goldMiner--`（宿主保留前缀 `components--` 不可用）
- 设置页采用声明式方案（`src/settings.ts` 只用 `props.setting.*` 原生控件）。统一 padding 由 style.css 的 `[role="tabpanel"]:has(.goldMiner--settingsRoot)` 提供（container 标记类为钩子）
- 游戏不读取行数据，使用 `registerView()`（Plain View）；`onUpdate` 可重复调用，`onDestroy` 释放 RAF / 监听器 / ResizeObserver / AudioContext，`install()` 返回 cleanup
- 修改后可运行校验器检查产物形状：

  ```bash
  node .agents/skills/xdb-plugin-skills/scripts/validate-xdb-plugin.mjs gold-miner.xdb.js
  ```
