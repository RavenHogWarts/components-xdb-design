# Components XDB

本库用于设计和实现 XDB 组件（pnpm workspace monorepo）

## 目录结构

```
XDB/
├── AGENTS.md                # AI 助手操作指南（AI 工具进入仓库先读）
├── docs/                    # 仓库级文档
├── projects/                # 插件项目
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