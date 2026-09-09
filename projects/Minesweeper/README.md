# xdb-minesweeper

经典扫雷小游戏：首击保证安全开局，洪泛展开与和弦加速排雷，支持每日一局、自动存档与战绩写库

## 玩法

- **操作**：左键翻格，右键插旗 / 拔旗（触屏长按同样插旗，也可开「🚩 插旗」模式左键插旗）；
  在已翻开的**数字格上再点一次 = 和弦展开**（邻旗数等于数字时翻开其余邻格）
- **规则**：数字 = 周围 8 格雷数；翻开所有非雷格即胜利；踩雷即败
- **首击安全**：雷在第一次翻格时才布下，并排除首击格及其全部邻格（保证零邻域开局）
- **键盘**：方向键 / WASD 移动光标，`空格 / Enter` 翻格或和弦，`F` 插旗，
  `N` 新局，`Esc` 或「⏸ 暂停」暂停（棋盘遮住停表，点遮罩或按任意键继续）；
  失焦自动暂停计时
- **模式**：棋盘上方切换器即时切换「每日一局 / 自由练习」与
  初级 9×9·10 雷 / 中级 16×16·40 雷 / 高级 30×16·99 雷；
  每日一局按日期种子生成（同日同难度，同首击同雷局），难度随日期在三档间轮换

## 实现机制

- 首击安全布雷：随机洗牌候选格取前 N 格，排除首击格 + 邻格
  （候选不足时降级为仅排除首击格）；每日一局用日期字符串哈希（xmur3 变体）
  作 mulberry32 种子，天然确定性
- 零格洪泛展开：迭代栈连锁翻开 0 邻域（无递归栈溢出风险）
- 和弦展开：邻旗数等于数字才触发；误旗时按经典行为触雷
- 胜利自动给剩余雷格补旗；失败亮出全部雷格、错旗打叉、踩中的雷标红

## 持久化与 XDB 联动

- **进度存档**：自由模式存 `options[minesweeper].save`、每日模式存
  `options[minesweeper].dailySave`，翻格 / 插旗后防抖快照（400ms 合并），
  退出重进可继续；终局自动清除、每日存档跨日作废
- **战绩统计**：胜利局数 / 总局数、各难度最佳用时写入 `stats`，设置页可一键重置
- **战绩写库**：设置页开启后，终局（胜利或踩雷）在当前视图新建一行
  （`minesweeper` / `difficulty` / `mode` / `seconds` / `result` / `date` 字段，
  需数据库 source 支持 `createRow`）
- **写回安全**：View 内配置写回走 `api.getDefinition() → api.updateView()` 重读合并，
  并以串行队列防止高频翻格时的并发覆盖

## 开发

```bash
# 仓库根目录
pnpm install            # 安装依赖（仅需一次）
pnpm build Minesweeper  # 生产构建 → minesweeper.xdb.js
pnpm dev Minesweeper    # 监听模式

# 或在本项目目录内
pnpm build
pnpm dev
```

构建产物 `minesweeper.xdb.js` 位于项目根目录，将其放入 XDB 的插件目录即可加载。

## 源码结构

```
src/
├── plugin-core.ts    # install()：registerStyleSheet + registerView + 设置 Tab（特性检测降级）
├── view.tsx          # React 渲染器：双模式引擎管理、翻格/插旗/和弦、长按、键盘、暂停与战绩联动
├── game/engine.ts    # 纯逻辑引擎：首击安全布雷、洪泛展开、和弦、胜负、快照（确定性种子）
├── settings.ts       # 声明式设置页（难度 / 战绩写库 / 重置战绩）
├── persist.ts        # 视图配置写回（串行队列 + 重读合并）
├── types.ts          # 元数据常量（唯一读取构建注入 __PLUGIN_*__ 的文件）与解析
└── style.css         # 经典格面视觉（凸起/平底、1-8 数字配色、cqw 随棋盘缩放）
```

引擎为无 DOM 纯逻辑，便于独立测试。

## 开发规范

本模板基于 `.agents/skills/xdb-plugin-skills` 约定生成：

- 扩展 ID 带插件命名空间（视图 `minesweeper:view`、设置 Tab `minesweeper:settings`）
- 图标使用 PascalCase 的 Lucide 名称（如 `Bomb`），不要 kebab-case
- 插件元数据（id / 显示名 / 描述 / 作者 / 图标 / 版本）单一来源为 `package.json` 顶层字段（标准 `name`/`version`/`description`/`author` + 扩展 `id`/`icon`），构建时注入源码，发版/改名只改 package.json
- 所有 CSS class 使用插件专属前缀 `minesweeper--`（宿主保留前缀 `components--` 不可用）
- 设置页二选一：`src/settings.ts` 纯声明式（只用 `props.setting.*` 原生控件，无插件 DOM）；
  `src/settings.tsx` React 方案（可混用原生控件 + 自定义 React，自定义内容通过
  `setting.custom()` 挂载进设置列表）。统一 padding 由 style.css 的
  `[role="tabpanel"]:has(.minesweeper--settingsRoot)` 提供（container 标记类为钩子，
  `--size-*` 等 Obsidian 内置变量，不影响内置 tab）
- `onUpdate` 可重复调用，`onDestroy` 释放资源，`install()` 返回 cleanup
- 修改后可运行校验器检查产物形状：

  ```bash
  node .agents/skills/xdb-plugin-skills/scripts/validate-xdb-plugin.mjs minesweeper.xdb.js
  ```
