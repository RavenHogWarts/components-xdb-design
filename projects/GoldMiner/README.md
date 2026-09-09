# xdb-gold-miner

黄金矿工移植版 —— 基于 Canvas 2D 的经典黄金矿工玩法，美术素材与角色拼装忠实还原 `refer/` 下的原版 H5 游戏（复制到 `src/assets/`，构建时内嵌为 data URL，产物自包含；矢量绘制保留为图片加载失败时的降级）。

## 玩法

- 点击画面或按 **空格** 放出钩爪，钩爪摆动中瞄准时机出手
- 金块越大越值钱也越重（收得越慢），第 4 关起有巨型金块；钻石小而贵；神秘袋开出随机金额；石头不值钱还很重；TNT 会爆炸并波及周边，鼹鼠背着钻石来回跑
- 限时达到目标金额进入**商店**：炸药（收钩途中按 **X** 引爆销毁抓到的物品）、强力马达、幸运四叶草、岩石图鉴
- **P** 暂停 / 继续（切走视图自动暂停），**R** 随时重开一局
- **进度自动存档**：关卡开始、收集、商店购买、暂停与退出视图时自动保存；一局未结束就退出，重进后菜单提供「继续游戏」（回到存档时的关卡与剩余时间 / 商店），游戏结束或重开后存档清除

## 布局与素材（按原版 1280×720 比例移植）

- **画布全屏铺满整个视图**（全宽、尺寸完全跟随容器、无固定宽高比），大屏下物品与角色随分辨率放大（最高 2.2 倍），窄窗口自动收窄防拥挤
- 纵向布局比例取自原版 Construct 2 工程（data.js）：地表条顶边 y=175/720、绳枢轴 (640,169)、钩爪初始位于枢轴下方 44px、矿工实体原点 (651,188)，随画布高度按比例映射
- **矿工为 Spriter 骨骼动画角色**（原版 `miner.scon`）：8 个部件（双头 h1/h2、身体、双臂、手、摇柄、绞盘）按 mainline 顺序拼装，三个动画——`idle` 待机起伏、`throw` 放钩甩手、`roll` 收绳卷扬，姿势关键帧数据内嵌于 `src/game/engine.ts`
- 物品 / 钩爪 / 地表与泥土贴图均来自原版素材；`rock.png`、`hook.png`、`diamole.png`、`bomb.png` 为小图集，通过连通域分析测得的子矩形在 `src/game/assets.ts` 中裁切使用；钩爪旋转与绳同向（scon y-up 坐标已换算）

## XDB 特色

- **独立设置 Tab**：难度 / 摆锤速度 / 每关时间 / 音效
- **战绩存档（按视图独立）**：最高分、最高关卡、累计金币、局数，存在 `viewDefinition.options`，同一数据库可为不同标签页各自记档，支持一键重置
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
