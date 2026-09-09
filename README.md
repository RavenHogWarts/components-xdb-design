# Components XDB

本库用于设计和实现 XDB 组件（pnpm workspace monorepo）

## 目录结构

```
XDB/
├── AGENTS.md                # AI 助手操作指南（AI 工具进入仓库先读）
├── docs/                    # 仓库级文档
├── projects/                # 插件项目
│   ├── Game2048/            # 经典 2048 数字合并小游戏
│   ├── GoldMiner/           # 经典黄金矿工小游戏
│   ├── Sudoku/              # 经典数独（每日一题 + 自由练习）
│   └── Log/                 # 星露谷风格打卡
├── templates/plugin/        # 新插件脚手架模板（pnpm new 使用）
├── scripts/
│   ├── build.mjs            # 共享 esbuild 构建脚本
│   ├── run.mjs              # 交互式项目选择与运行（pnpm dev / pnpm build）
│   └── new.mjs              # 交互式新建项目脚手架（pnpm new）
├── tsconfig.base.json       # 共享 TS 配置
├── package.json             # workspace 根（通用依赖集中安装）
└── pnpm-workspace.yaml      # workspace 定义（projects/*）
```

## 快速开始

```bash
pnpm install     # 根目录安装一次，所有项目共用

pnpm new         # 交互式新建插件项目（脚手架 + 构建 + 校验）
pnpm build       # 交互选择项目 → 生产构建
pnpm dev         # 交互选择项目 → 监听模式
pnpm build all   # 跳过交互，构建全部项目
```

交互选择支持快捷键：空格选中 / `a` 全选切换 / 回车确认；也可以直接传项目名（如 `pnpm build Log`）。

详细的结构说明、依赖策略与新增项目流程见 [docs/monorepo-guide.md](docs/monorepo-guide.md)。

## AI 辅助开发

本仓库面向 AI 编码助手优化：任何 AI 工具进入仓库后会按根目录 [AGENTS.md](AGENTS.md) 的指引工作
（命令、规范、验证流程均已写明）。小白用户直接用自然语言向 AI 提需求即可全程操作，例如
「帮我新建一个习惯打卡视图」「把星露谷农场的图标换掉并重新构建」。

## 组件目录

1. 星露谷风格打卡，`projects/Log` （未完善）

   星露谷解包数据：https://pan.quark.cn/s/8cdd6a0c4f05

2. 经典黄金矿工，`projects/GoldMiner`

   Canvas 2D 移植版：摆钩挖金、商店道具、关卡挑战；井口布局按原版素材坐标还原，
   素材内嵌产物自包含；支持 P 暂停、进度自动存档（退出重进可继续）、战绩写入数据库。
   原版 H5 参照源码在 `projects/GoldMiner/refer/`（已 gitignore，不入库）。

3. 经典 2048，`projects/Game2048`

   React DOM + CSS 动画实现：方向键 / WASD / 触屏滑动，Z 撤销、N 新局；
   方块采用「落日光谱」配色（纸沙 → 日落 → 皇家色 → 2048 金色加冕），适配明暗主题；
   棋盘上方切换器即时切换 3×3 / 4×4 / 5×5 盘面与 2048 / 4096 / 无尽目标（开新局生效），
   新方块从格子中心浮现；每步自动存档、战绩写入数据库；
   键盘为聚焦容器策略，不劫持 Obsidian 导航快捷键。

4. 经典数独，`projects/Sudoku`

   纯逻辑引擎（终盘随机回溯生成 + 挖洞，逐一 MRV 解计数校验唯一解）：
   每日一题（日期种子同日同题、难度按日轮换）与自由练习（简单/中等/困难/专家
   四档提示数）双模式，切换即恢复各自进度；笔记模式（候选小字 + 同数联动高亮）、
   同区域/同数高亮、错误标红、提示与撤销；Esc 主动暂停（遮住棋盘停表），
   失焦自动暂停计时；双存档槽防抖落盘、完成自动入账各难度最佳用时、战绩写入数据库；
   键盘为聚焦容器策略，不劫持 Obsidian 导航快捷键。