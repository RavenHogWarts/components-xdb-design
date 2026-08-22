# Components XDB

本库用于设计和实现 XDB 组件（pnpm workspace monorepo）

## 目录结构

```
XDB/
├── docs/                    # 仓库级文档
├── projects/                # 插件项目
│   ├── Log/                 # 星露谷风格打卡
│   └── GalaxyView/          # 星系视图
├── scripts/build.mjs        # 共享构建脚本
├── tsconfig.base.json       # 共享 TS 配置
└── package.json             # workspace 根（通用依赖集中安装）
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

## 组件目录

1. 星露谷风格打卡，`projects/Log`

   星露谷解包数据：https://pan.quark.cn/s/8cdd6a0c4f05

2. 星系视图，`projects/GalaxyView`

   作者：[Albus](https://github.com/AlbusGuo)
