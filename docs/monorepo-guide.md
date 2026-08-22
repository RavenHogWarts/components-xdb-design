# XDB Monorepo 结构与构建指南

本仓库采用 **pnpm workspace** 管理多个 XDB 插件项目：通用依赖集中在根目录安装，各项目只声明自己特有的依赖，避免重复安装、统一版本管理。

## 目录结构

```
XDB/
├── AGENTS.md                # AI 助手操作指南（AI 工具进入仓库先读）
├── docs/                    # 仓库级文档（英文文件名、中文内容）
│   └── monorepo-guide.md    # 本文档
├── projects/                # 所有插件项目
│   └── Log/                 # 星露谷风格打卡（xdb-stardew-habit）
│       ├── docs/            # 项目内部设计文档（随项目维护）
│       ├── preview/         # Vite 本地预览环境
│       ├── scripts/         # 项目辅助脚本（贴图分析等）
│       ├── src/             # 插件源码
│       └── stardew-habit/   # 星露谷解包数据资产
├── templates/
│   └── plugin/              # 新插件脚手架模板（pnpm new 使用）
├── scripts/
│   ├── build.mjs            # 共享 esbuild 构建脚本
│   ├── run.mjs              # 交互式项目选择与运行（pnpm dev / pnpm build）
│   └── new.mjs              # 交互式新建项目脚手架（pnpm new）
├── tsconfig.base.json       # 共享 TypeScript 编译配置
├── package.json             # workspace 根 + 通用依赖
├── pnpm-workspace.yaml      # workspace 定义（projects/*）
└── pnpm-lock.yaml           # 唯一的依赖锁定文件
```

## 依赖策略

### 通用依赖（根目录 `package.json`）

所有项目都会用到的依赖集中在根目录的 `devDependencies` 中：

| 依赖 | 说明 |
| ---- | ---- |
| `typescript` | 统一版本（`^5.9`，最新 5.x） |
| `react` / `react-dom` | 构建时由 esbuild 全量打包进产物 |
| `@types/react` / `@types/react-dom` | React 类型声明 |
| `esbuild` | 共享构建脚本 `scripts/build.mjs` 的打包器 |

pnpm 版本由根 `package.json` 的 `packageManager` 字段锁定，配合 corepack 保证团队成员使用同一版本。

子项目源码通过 Node 的**向上解析**机制直接使用根目录依赖（esbuild / Vite / tsc 均支持），无需在各项目重复声明。

### 项目专属依赖（各项目 `package.json`）

| 项目 | 专属依赖 | 用途 |
| ---- | -------- | ---- |
| `Log` | `pngjs`、`moment`、`vite`、`@vitejs/plugin-react` | 贴图分析脚本、预览环境 |

### 共享 tsconfig

根目录 `tsconfig.base.json` 保存全部公共编译选项，各项目 tsconfig 通过 `extends` 继承：

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*"]
}
```

`projects/Log/preview/tsconfig.json` 链式继承（preview → Log → base），预览环境的覆盖项（`moduleResolution: Bundler`、`noEmit` 等）不受影响。

## 安装

```bash
# 在仓库根目录执行一次即可，所有项目的依赖统一安装
pnpm install
```

安装后只会生成一份根 `pnpm-lock.yaml` 和按 pnpm store 硬链接去重的 `node_modules`。

## 构建命令

### 根目录统一入口

`pnpm dev` 和 `pnpm build` 是仅有的两个根命令，**新增项目无需修改根脚本**——运行时会自动发现 `projects/` 下的所有项目，交互式选择要操作的对象：

```bash
pnpm build       # 交互选择项目 → 生产构建
pnpm dev         # 交互选择项目 → 监听模式
```

交互界面快捷键：

| 按键 | 功能 |
| ---- | ---- |
| `↑` / `↓` 或 `j` / `k` | 移动光标 |
| 空格 | 选中 / 取消选中当前项目 |
| `a` | 全选 / 全不选（切换） |
| 回车 | 确认执行 |
| `q` / `Esc` | 取消退出 |

- **生产构建**：选中的项目串行构建，结束后输出成功/失败汇总
- **监听模式**：选中的项目并发监听，每行输出带 `[项目名]` 前缀，`Ctrl+C` 全部退出

### 非交互场景（CI、脚本调用）

```bash
pnpm build all                # 全部项目
pnpm build Log                # 指定目录名
pnpm build xdb-stardew-habit  # 也可用 package.json 中的包名
```

### 在项目目录内执行

```bash
cd projects/Log
pnpm build          # 生产构建 → stardew-habit.xdb.js
pnpm dev            # 监听模式
pnpm preview        # 启动 Vite 预览（http://localhost:5173）
```

构建产物 `*.xdb.js` 输出到各项目根目录，已被 `.gitignore` 排除，不会进入版本库。

## 新增项目

推荐使用交互式脚手架，一条命令完成 创建 → 安装 → 构建 → 校验：

```bash
pnpm new
```

交互式输入项目目录名、包名、视图名称、图标（Lucide，PascalCase 预选列表或自定义）、描述、作者
与设置页方案，确认后自动：

1. 从 `templates/plugin/` 生成项目（遵循 `xdb-plugin-skills` 约定：命名空间化扩展 ID、
   PascalCase Lucide 图标、插件专属 CSS 前缀、插件元数据单一来源于 package.json 顶层字段、
   `update`/`destroy` 渲染器协议、设置 Tab 特性检测降级）；
2. 执行 `pnpm install` 注册新 workspace 成员；
3. 立即生产构建验证；
4. 运行 skill 自带的 validator 校验产物形状。

非交互场景（脚本/CI/AI）可传目录名，其余取默认值；第二个参数指定设置页方案，
元数据还可用 key=value 覆盖（与 package.json 字段同名：`id=` / `name=` / `description=` /
`author=` / `icon=`）：

```bash
pnpm new MyBoard                              # 默认声明式控件（props.setting.*）
pnpm new MyBoard react                        # React 自由定制（settingsRoot 包裹）
pnpm new MyBoard react icon=Kanban description="看板视图"
```

设置页二选一：**声明式控件**（`settings.ts`，只用宿主原生 `props.setting.*` 控件，
无插件 DOM，skill 推荐常规表单使用）；**React 自由定制**（`settings.tsx`，可混用原生
控件 + 自定义 React，自定义内容通过 `setting.custom()` 挂载进设置列表）。宿主不为
插件 tab 提供 Settings 包裹，统一 padding 由 style.css 的
`[role="tabpanel"]:has(.<前缀>settingsRoot)` 提供（container 标记类为钩子，不影响
内置 tab）。声明式控件须在 onUpdate 同步 pass 内声明。

新项目放入 `projects/` 后即被 `pnpm dev` / `pnpm build` 自动发现，**无需修改任何根配置**。
脚手架不引入任何新依赖（React 等通用依赖向上解析到根目录）；只有项目特有的依赖才写进
自己的 `package.json`。
