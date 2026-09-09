# xdb-gomoku

经典五子棋（15×15 无禁手）：四档 AI 难度人机对战 + 本地双人，支持悔棋、自动存档与战绩写库

## 玩法

- **规则**：15×15 无禁手自由五子棋——黑先白后交替落子，连成 5 子或以上即胜（含长连），
  满盘无五为和棋
- **模式**：棋盘上方切换器即时切换「人机对战 / 双人」；人机模式可选 AI 难度四档与
  玩家执子（执黑先手 / 执白后手）；双人同屏黑先
- **操作**：点击空格落子；`Z` 悔棋（人机模式一次撤回 AI + 你各一步、退回你的回合），
  `N` 新局；悬停显示落子预览，最后一手带标记环
- **AI 调度**：AI 异步思考（不卡界面），思考中显示「🤔 AI 思考中…」徽标并屏蔽落子，
  此时可悔棋取消 AI 一步
- **存档**：每手后防抖自动存档，退出重进可继续；终局自动清除并入账战绩

## AI 难度分层（跨机制，非单一评估调参）

| 档位 | 机制 | 能力 |
| ---- | ---- | ---- |
| 简单 | 即时规则 + 邻域随手 | 自己成五就下、对方成五就堵；看不出复合威胁，几分钟可赢 |
| 中等 | 一档棋型贪心（精确增量评估，攻防同源）+ 冲四防线 | 权衡活四/冲四/活三…；能防可见威胁 |
| 困难 | α-β 深度 4 + 静态启发排序 + 威胁延伸 + 节点预算 | 会主动做双威胁，守住单线连杀 |
| 专家 | 迭代加深 α-β（约 350ms 预算）+ Zobrist 置换表 + 威胁延伸 | 主动制造并防守复合威胁，接近连杀视野 |

- **评估器**：盘面按行/列/两条斜线切成 88 条线并缓存，落子/撤子只增量重算经过该点的
  4 条线（叶子评估 O(1)）；棋型按连续段长 + 空端数分类计分
- **候选生成**：只考虑已有棋子切比雪夫距离 ≤ 2 的空点（开局/第二手特判），
  静态启发排序后截取前 N 个
- **威胁延伸**：走出 ≥ 活三（含冲四/活四）时给应手方追加 2 层搜索（深度硬顶封顶），
  近似 VCF 连杀视野
- **预算保护**：时间（350ms）/ 节点双重预算，超时立即返回已完成的加深层结果；
  兜底在全新盘面做贪心，绝不因超时污染局面（异常路径会遗留未撤的推演子）
- 已知取舍：棋型识别只认连续段，跳型（跳三/跳冲四）需填空后由搜索深度自然覆盖

## 持久化与 XDB 联动

- **进度存档**：`options[gomoku].save` 存着法序列与本局设置快照（模式/难度/执子），
  每手防抖落盘，退出重进可继续；终局清除
- **战绩统计**：总局数、人机胜负和（按玩家视角）写入 `stats`，设置页可一键重置
- **战绩写库**：设置页开启后，对局结束在当前视图新建一行
  （`gomoku` / `mode` / `aiLevel` / `color` / `winner` / `moves` / `date` 字段，
  需数据库 source 支持 `createRow`）
- **写回安全**：View 内配置写回走 `api.getDefinition() → api.updateView()` 重读合并，
  并以串行队列防止并发覆盖

## 开发

```bash
# 仓库根目录
pnpm install        # 安装依赖（仅需一次）
pnpm build Gomoku   # 生产构建 → gomoku.xdb.js
pnpm dev Gomoku     # 监听模式

# 或在本项目目录内
pnpm build
pnpm dev
```

构建产物 `gomoku.xdb.js` 位于项目根目录，将其放入 XDB 的插件目录即可加载。

## 源码结构

```
src/
├── plugin-core.ts    # install()：registerStyleSheet + registerView + 设置 Tab（特性检测降级）
├── view.tsx          # React 渲染器：棋盘/落子预览/人机异步调度/悔棋/切换器/战绩联动
├── game/engine.ts    # 纯逻辑引擎：交替落子、四向连五判定、悔棋、快照
├── game/ai.ts        # 四档 AI：增量棋型评估器 + 贪心 + α-β/迭代加深/置换表/威胁延伸
├── settings.ts       # 声明式设置页（AI 难度 / 战绩写库 / 重置战绩）
├── persist.ts        # 视图配置写回（串行队列 + 重读合并）
├── types.ts          # 元数据常量（唯一读取构建注入 __PLUGIN_*__ 的文件）与解析
└── style.css         # 棋盘视觉（网格线/双色棋子/预览虚环/终局遮罩）
```

引擎与 AI 均为无 DOM 纯逻辑：开发时把 `engine.ts` + `ai.ts` 经 esbuild 打成 ESM，
即可用 node 跑行为冒烟测试（胜负/长连/满盘和棋、各档成五与堵冲四、确定性、预算耗时、
快照往返）。

## 开发规范

本模板基于 `.agents/skills/xdb-plugin-skills` 约定生成：

- 扩展 ID 带插件命名空间（视图 `gomoku:view`、设置 Tab `gomoku:settings`）
- 图标使用 PascalCase 的 Lucide 名称（如 `CircleDot`），不要 kebab-case
- 插件元数据（id / 显示名 / 描述 / 作者 / 图标 / 版本）单一来源为 `package.json` 顶层字段（标准 `name`/`version`/`description`/`author` + 扩展 `id`/`icon`），构建时注入源码，发版/改名只改 package.json
- 所有 CSS class 使用插件专属前缀 `gomoku--`（宿主保留前缀 `components--` 不可用）
- 设置页二选一：`src/settings.ts` 纯声明式（只用 `props.setting.*` 原生控件，无插件 DOM）；
  `src/settings.tsx` React 方案（可混用原生控件 + 自定义 React，自定义内容通过
  `setting.custom()` 挂载进设置列表）。统一 padding 由 style.css 的
  `[role="tabpanel"]:has(.gomoku--settingsRoot)` 提供（container 标记类为钩子，
  `--size-*` 等 Obsidian 内置变量，不影响内置 tab）
- `onUpdate` 可重复调用，`onDestroy` 释放资源，`install()` 返回 cleanup
- 修改后可运行校验器检查产物形状：

  ```bash
  node .agents/skills/xdb-plugin-skills/scripts/validate-xdb-plugin.mjs gomoku.xdb.js
  ```
