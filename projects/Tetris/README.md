# xdb-tetris

经典俄罗斯方块：SRS 旋转踢墙 + 7-bag 随机器 + 幽灵投影/暂存/硬降，支持存档/战绩统计

## 玩法

- **操作**（状态行常驻完整快捷键表）：`← →` 移动（按住自动重复），`↑`/`X` 顺时针、`Z` 逆时针旋转，
  `↓` 软降（按住加速），`空格` 硬降，`C`/`Shift` 暂存方块，`P` 暂停，`N` 新游戏
- **触屏**：棋盘滑动操作（横向按格数平移、下滑硬降、上滑旋转）
- **规则**：每消 10 行升 1 级，重力随等级加快（Guideline 速度表，Lv29 起每帧一格）；
  方块堆到出生区（Block Out）或整块锁定在隐藏区（Lock Out）即终局

键盘采用**聚焦容器**策略：按键监听挂在棋盘上，点击棋盘开始、点击外部自动暂停并让出按键，
不会劫持 Obsidian 的列表导航与光标移动；页面切后台同样自动暂停。

## Guideline 实现要点

- **SRS 超级旋转系统**：JLSTZ 与 I 各自独立踢墙表（每步旋转依次测试 5 组偏移，
  全部失败则旋转失败），支持贴墙旋转与 T-Spin 踢入
- **7-bag 随机器**：七种方块洗匀成一袋依次发出，每 7 块必出全七种，杜绝旱涝
- **幽灵投影**：实时显示当前方块硬降落点轮廓（可在设置关闭）
- **暂存（Hold）**：每块限一次，换入的方块重置朝向重新出生
- **锁定延迟**：触底 500ms 后锁定，移动/旋转可重置（每块至多 15 次，
  降到新低点重置上限）——留出走位与 T-Spin 的时间窗口
- **T-Spin 三角判定**：最后动作是旋转且 T 盒四角至少三格被占；前两角全占为
  full（否则 mini，但用了第 5 组踢墙偏移升格为 full）
- **计分**（×当前等级）：
  单消 100 / 双消 300 / 三消 500 / 四连消 800；
  T-Spin 单/双/三消 800/1200/1600，mini 200/400；
  Back-to-Back（连续高难消行）×1.5；连击每层 +50；完美清空 +800~2000；
  软降每格 +1、硬降每格 +2
- **战报提示**：消行 / T-Spin / B2B / COMBO / PERFECT CLEAR 实时弹出得分提示
- **记分条与结算**：棋盘上方记分条（得分 / 等级 / 行数 / 历史最佳），得分实时刷新；
  终局结算面板展示本局数据，刷新最高分或最多消行时标注 🏅 新纪录；
  暂停面板内置操作速查，底部状态行常驻快捷键提示

方块七色采用 Guideline 官方配色（青 I、蓝 J、橙 L、黄 O、绿 S、紫 T、红 Z），
棋盘底色跟随 Obsidian 明暗主题。

## 持久化

- **进度存档**：每块结算后快照写入 `viewDefinition.options[tetris].save`
  （盘面 + 活动方块 + 发牌队列 + 暂存 + 分数/行数/等级/B2B/连击），
  退出视图重进可继续；终局自动清除
- **战绩统计**：最高分 / 最多消行 / 累计得分 / 局数在终局一次性入账
  `stats` 字段（进行中不写战绩，保证「新纪录」判定以历史最佳为基准），
  设置页可一键重置
- **防误触**：有进度的对局上点「新游戏」需 2.5s 内再点一次确认
- **写回安全**：View 内配置写回走 `api.getDefinition() → api.updateView()` 重读合并，
  并以串行队列防止高频结算时的并发覆盖

## 开发

```bash
# 仓库根目录
pnpm install          # 安装依赖（仅需一次）
pnpm build Tetris     # 生产构建 → tetris.xdb.js
pnpm dev Tetris       # 监听模式

# 或在本项目目录内
pnpm build
pnpm dev
```

构建产物 `tetris.xdb.js` 位于项目根目录，将其放入 XDB 的插件目录即可加载。

## 源码结构

```
src/
├── plugin-core.ts      # install()：registerStyleSheet + registerView + 设置 Tab（特性检测降级）
├── view.tsx            # React 渲染器：棋盘 UI、rAF 主循环、DAS/ARR 键盘、触屏手势、存档与战绩统计
├── game/
│   ├── pieces.ts       # 七种方块 4 旋转态定义、SRS 踢墙表、7-bag、Guideline 重力表
│   └── engine.ts       # 纯逻辑引擎：重力/锁定延迟、消行两阶段结算、T-Spin 判定、计分、存档恢复
├── settings.ts         # 声明式设置页（开局等级 / 幽灵投影 / 消行动画 / 重置战绩）
├── persist.ts          # 视图配置写回（串行队列 + 重读合并）
├── types.ts            # 元数据常量（唯一读取构建注入 __PLUGIN_*__ 的文件）与解析
└── style.css           # 官方七色配色、棋盘几何、消行闪烁 / 落定脉冲动画
```

引擎为无 DOM 纯逻辑（两阶段消行：锁定标记满行 → 视图动画 → `finishClear()`
移除入账），开发期以 36 项断言验证：SRS 踢墙（I 贴地/贴墙）、T-Spin 判定与计分、
B2B / 连击 / 完美清空、7-bag 完整性、暂存限制、锁定延迟重置上限、重力节奏与软降计分、
存档快照 → 解析 → 恢复往返、Block Out / Lock Out 终局。

## 开发规范

本模板基于 `.agents/skills/xdb-plugin-skills` 约定生成：

- 扩展 ID 带插件命名空间（视图 `tetris:view`、设置 Tab `tetris:settings`）
- 图标使用 PascalCase 的 Lucide 名称（如 `List`、`Blocks`），不要 kebab-case
- 插件元数据（id / 显示名 / 描述 / 作者 / 图标 / 版本）单一来源为 `package.json` 顶层字段（标准字段 `name`/`version`/`description`/`author` + 扩展 `id`/`icon`），构建时注入源码，发版/改名只改 package.json
- 所有 CSS class 使用插件专属前缀 `tetris--`（宿主保留前缀 `components--` 不可用）
- 设置页二选一：`src/settings.ts` 纯声明式（只用 `props.setting.*` 原生控件，无插件 DOM）；
  `src/settings.tsx` React 方案（可混用原生控件 + 自定义 React，自定义内容通过
  `setting.custom()` 挂载进设置列表）。统一 padding 由 style.css 的
  `[role="tabpanel"]:has(.tetris--settingsRoot)` 提供（container 标记类为钩子，
  `--size-*` 等 Obsidian 内置变量，不影响内置 tab）
- `onUpdate` 可重复调用，`onDestroy` 释放资源，`install()` 返回 cleanup
- 修改后可运行校验器检查产物形状：

  ```bash
  node .agents/skills/xdb-plugin-skills/scripts/validate-xdb-plugin.mjs tetris.xdb.js
  ```
