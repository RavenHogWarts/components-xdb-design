# 星露谷打卡 · 本地预览环境

零侵入式的本地 UI 预览，**完全不动** `src/` 源码与 `build.mjs` 生产构建链路。
通过 mock 的 Obsidian 上下文（`app` / `moment` / `api` / `obsidian.Notice`）直接驱动真实的 `src/view.tsx`。

## 快速开始

```bash
# 1) 安装新增 dev 依赖（仅需一次）
pnpm install

# 2) 启动预览 dev server（默认 http://localhost:5173）
pnpm preview

# 3) 改 src/ 源码会自动热更新到预览页面
```

## 工作原理

```
preview/index.html
        │
        ▼
preview/main.tsx ──── 场景切换 + 挂载容器
        │
        ├── import '../src/style.css'   ← 复用插件全局样式
        ├── import '../src/view'        ← 直接用真实 createFarmRenderer()
        │
        ▼
preview/mock-props.ts ── 组装 DatabaseViewProps
        │
        ├── app.vault.getResourcePath()  → 通过 png?url 返回本地贴图 URL
        ├── app.vault.getAbstractFileByPath() → 总是返回非空，让 checkAssetFiles 通过
        └── api.updateCell/updateRow     → 直接改 mock state，触发重渲染
        │
        ▼
preview/obsidian-mock.ts ← Vite 把 'obsidian' 模块 alias 到这里
                              提供 Notice / App / Component 等占位实现
```

## 内置测试场景

| 场景            | 含义                                 |
| --------------- | ------------------------------------ |
| `空数据`        | 数据库里一条记录都没有（首次安装）   |
| `今天未创建`    | 前几天有打卡，今天还没生成日记文件   |
| `今日部分打卡`  | 3 个习惯只完成 1 个 → 天空过渡色     |
| `完美连续 7 天` | 全勤 → 房屋满级 + 作物大丰收         |
| `中断 streak`   | 昨天断了今天恢复，streak 从 1 重新计 |

切换场景会重建 mock 数据；点击作物 / 复选框 / 「过一天」按钮都会即时反馈到 UI。

## 与生产构建的隔离

| 关注点        | 生产构建 (`pnpm build`) | 本地预览 (`pnpm preview`)           |
| ------------- | ----------------------- | ----------------------------------- |
| 入口          | `src/plugin-core.ts`    | `preview/index.html`                |
| 打包器        | esbuild (build.mjs)     | Vite                                |
| 产物          | `stardew-habit.xdb.js`  | dev server / `preview/dist`         |
| obsidian 模块 | external（XDB 提供）    | alias 到 `preview/obsidian-mock.ts` |
| 数据          | 真实 Obsidian 数据库    | `preview/mock-data.ts`              |

预览依赖全部是 `devDependencies`，`pnpm build` 不会引入 Vite，体积与原产物完全一致。

## 打包成静态站点（可选）

```bash
pnpm preview:build
# 产物在 preview/dist，可直接用任意静态服务器托管
```
