# AGENTS.md — AI 助手操作指南

本仓库是 XDB（Obsidian 数据库插件）的 monorepo。任何 AI 编码助手在本仓库工作前**必须先读完本文件**，小白用户可以直接用自然语言提需求，由 AI 全程操作（注意：交互式命令 AI 不可用，见下方「AI / 非交互用法」）。

## 目录结构

```
XDB/
├── projects/            # 所有插件项目（每个目录 = 一个 *.xdb.js 插件）
├── templates/plugin/    # 新插件脚手架模板（pnpm new 的来源，也是规范基线）
├── scripts/
│   ├── build.mjs        # 共享 esbuild 构建脚本（所有项目共用）
│   ├── run.mjs          # pnpm dev / pnpm build 的交互式项目选择器
│   └── new.mjs          # pnpm new 交互式脚手架
├── docs/monorepo-guide.md  # 结构与构建详细文档
└── tsconfig.base.json   # 共享 TS 配置（各项目 extends）
```

## 命令（在仓库根目录执行）

### AI / 非交互用法（AI 助手一律使用这种形式）

**`pnpm new` / `pnpm build` / `pnpm dev` 不带参数会进入交互式界面，AI 无法操作，必须始终带参数：**

```bash
# 新建项目（第二个参数为设置页方案，可省略；元数据用 key=value 覆盖）
pnpm new KanbanBoard                            # 默认声明式设置页
pnpm new KanbanBoard react                      # React 自由定制设置页
pnpm new KanbanBoard react icon=Kanban description="看板视图" name=my-board author=Me

# 构建指定项目（目录名或包名均可）；all = 全部项目
pnpm build Log
pnpm build xdb-stardew-habit
pnpm build all

# 监听模式（长驻进程，AI 需在后台运行并适时终止）
pnpm dev Log

# 校验插件产物形状（改完代码必跑）
node .agents/skills/xdb-plugin-skills/scripts/validate-xdb-plugin.mjs projects/Log/stardew-habit.xdb.js
```

覆盖参数与 package.json 字段同名：`id=`（插件 id）、`name=`（显示名/包名）、`description=`（描述）、`author=`（作者）、`icon=`（Lucide 图标，PascalCase）。
新建后如需再调整元数据，直接编辑该项目 `package.json` 顶层字段（单一来源），重新 `pnpm build <项目>` 即可。

### 交互式用法（人类终端）

| 命令 | 作用 |
| ---- | ---- |
| `pnpm install` | 安装全部依赖（唯一安装入口，子项目无需单独安装） |
| `pnpm new` | 交互式新建插件项目（输入/单选/快捷键） |
| `pnpm build` | 交互选择项目 → 生产构建 |
| `pnpm dev` | 交互选择项目 → 监听模式 |

在项目目录内（如 `projects/Log`）也可直接 `pnpm build` / `pnpm dev`；Log 另有 `pnpm preview`（Vite UI 预览）。

## 开发规范（必读）

1. **先读 skill 再写代码**：`.agents/skills/xdb-plugin-skills/SKILL.md` 是 XDB 插件 API 的权威文档（注册点选择、props schema、生命周期、配置写回），不确定的 API 以其中的 `references/api-schema.md` 为准。
2. **模板即基线**：`templates/plugin/src/` 展示了标准结构（plugin-core 入口 / view 渲染器 / settings 设置页 / types 常量 / style.css / env.d.ts 注入常量声明），新代码向它对齐。
3. **构建产物**：每个项目构建输出 `<项目名>.xdb.js` 到项目根目录（package.json 的 `main` 字段），已被 gitignore。
4. **元数据单一来源**：插件 id / 显示名 / 描述 / 作者 / 图标 / 版本全部来自各项目 `package.json` 顶层字段（标准字段 `name`/`version`/`description`/`author` + 扩展字段 `id`/`icon`），构建时注入 `__PLUGIN_*__` 常量（声明见各项目 `src/env.d.ts`）。**注入常量只在 `types.ts` 中读取**并转发为 `PLUGIN_ID`/`PLUGIN_NAME` 等导出，其余源码一律从 `types.ts` 导入。发版/改名只改 package.json；已发布插件的 `id` 不可更改。
5. **CSS 前缀**：所有 class 必须带插件专属前缀（由插件 id 派生，如 `myBoard--`）；`components--` 是宿主保留前缀，禁止使用。
6. **图标**：Lucide 名称用 PascalCase（如 `List`、`Sprout`），不要 kebab-case。
7. **设置页（独立 tab）**：声明式方案 `settings.ts` 只用宿主原生控件（`props.setting.*`，无插件 DOM）；React 方案 `settings.tsx` 可混用原生控件 + 自定义 React——自定义内容通过 `setting.custom({ key, render })` 挂载进设置列表，返回的 cleanup 由宿主调用，声明式控件须在 onUpdate 同步 pass 内声明（不要放进 React 异步渲染）。宿主不为插件 tab 提供 `components--Settings` 包裹，统一 padding 由 style.css 的 `[role="tabpanel"]:has(.<前缀>settingsRoot)` 提供：渲染器给 container 加 settingsRoot 标记类作为钩子，只影响本插件的面板、不碰内置 tab；不支持 `:has()` 时降级为无 padding。
8. **改完必验证**：`pnpm build <项目>` + 对产物跑 validator（见上表），两者通过才算完成。

## 典型任务

- **「我想做一个 XX 视图」** → `pnpm new`（或 `pnpm new XxxView`）生成骨架 → 在 `projects/XxxView/src/` 实现 → 构建 + validator。
- **「修改某个插件」** → 定位 `projects/<名称>/src/` → 修改 → 构建 + validator。
- **「构建/产物出问题了」** → 看 `scripts/build.mjs`（esbuild 配置、CSS 内联插件）与项目 package.json 的 `main`。

## 禁止事项

- 不要在子项目里安装 typescript / react 等通用依赖（根目录已集中提供，向上解析）
- 不要为单个项目在根 package.json 加专属脚本（`pnpm new/build/dev` 已自动发现所有项目）
- 不要修改已发布插件的 `id` / 视图 type（会使用户已持久化的配置失效）
- 不要把产物 `*.xdb.js` 提交进版本库
