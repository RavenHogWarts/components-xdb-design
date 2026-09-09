# xdb-snake

经典诺基亚贪吃蛇（Snake II，3310 同款）：单色 LCD 像素屏、四周边界回绕、五套迷宫关卡、
限时食物与高分奖励物、越吃越快。

## 玩法

- **操作**（状态行常驻完整快捷键表）：`方向键` / `WASD` / 诺基亚小键盘 `2·4·6·8` 转向，
  `P` 暂停，`N` 新游戏；触屏可滑动转向、轻点继续
- **规则**：蛇自动前进不可停止，不可 180° 掉头（反向输入被忽略）；
  屏幕四边可穿越（从一侧出去从对侧进来），撞迷宫墙或咬到自己即终局（单命制）
- **计分**：食物 +10（25 步内没吃到会换位置重刷），每吃 5 个食物出现奖励物 +50
  （约 6 秒后消失）；每吃一个食物略微加速（×0.96），开局速度可选 1-9 档
  （1 档 658ms/步 的诺基亚经典节奏，9 档 88ms/步）
- **迷宫与速度**：5 套关卡（空旷 / 三室 / 十字 / 砖墙 / 之字）+ 开局速度 1-9 档，设置页可选，也可在棋盘上方切换器即时调整（有进度的对局需二次确认后立即按新配置开局）

键盘采用**聚焦容器**策略：按键监听挂在棋盘上，点击棋盘开始、点击外部自动暂停并让出按键，
不会劫持 Obsidian 的列表导航与光标移动；页面切后台同样自动暂停。

## Snake II 机制还原

- **边界回绕**：与 Snake I（6110 撞边死）不同，Snake II 的四周边界可穿越——
  从底边出去会从顶边进来（Wikipedia Snake II 条目确认）
- **迷宫与速度分离**：原版中迷宫（maze）与速度（level）是两个独立选项，
  本插件同样把「关卡」与「初始速度」分开设置
- **方向队列**：快速连按两个方向会依次生效（至多排队 2 个），保留诺基亚的手感
- **限时食物**：普通食物与奖励物都会超时消失并在别处重刷
- **LCD 视觉**：深色像素画在浅色背光上的单色屏，蛇头带朝向双眼、尾巴渐细、
  食物两帧闪烁、奖励物反白呼吸、迷宫墙中央带背光小点；分数在屏内
  以补零 4 位（`SCORE 0040`）显示，终局整屏闪 3 下再弹结算
- **出生固定**：所有关卡共用同一出生走廊（第 6 行无墙），蛇长 4 头朝右

## 持久化

- **战绩统计**：最高分 / 最长（格）/ 累计得分 / 局数在终局一次性入账
  `stats` 字段（`viewDefinition.options[snake]`），刷新最高分时结算面板标注
  🏅 新纪录；设置页可一键重置
- **防误触**：有进度的对局上点「新游戏」需 2.5s 内再点一次确认
- **写回安全**：View 内配置写回走 `api.getDefinition() → api.updateView()` 重读合并，
  并以串行队列防止并发覆盖

## 开发

```bash
# 仓库根目录
pnpm install          # 安装依赖（仅需一次）
pnpm build Snake      # 生产构建 → snake.xdb.js
pnpm dev Snake        # 监听模式

# 或在本项目目录内
pnpm build
pnpm dev
```

构建产物 `snake.xdb.js` 位于项目根目录，将其放入 XDB 的插件目录即可加载。

## 源码结构

```
src/
├── plugin-core.ts      # install()：registerStyleSheet + registerView + 设置 Tab（特性检测降级）
├── view.tsx            # React 渲染器：LCD 棋盘、rAF 主循环、键盘（方向/WASD/8462）、触屏手势、战绩统计
├── game/
│   ├── levels.ts       # 5 套迷宫字面量（21×12，'#' 墙）与解析校验
│   └── engine.ts       # 纯逻辑引擎：步进/回绕/方向队列、进食成长、限时食物与奖励物、加速曲线、终局
├── settings.ts         # 声明式设置页（迷宫关卡 / 初始速度 / 像素动画 / 重置战绩）
├── persist.ts          # 视图配置写回（串行队列 + 重读合并）
├── types.ts            # 元数据常量（唯一读取构建注入 __PLUGIN_*__ 的文件）与解析
└── style.css           # LCD 像素配色（明暗两套绿）、墙/蛇/食物/奖励物像素样式、屏闪动画
```

引擎为无 DOM 纯逻辑（`tick(dt)` 按当前间隔推进、`rev` 版本号驱动视图刷新），
棋盘 21×12（≈ 3310 屏幕 84:48 宽高比），迷宫字面量在加载时校验行列数，
杜绝静默错版。

## 开发规范

本模板基于 `.agents/skills/xdb-plugin-skills` 约定生成：

- 扩展 ID 带插件命名空间（视图 `snake:view`、设置 Tab `snake:settings`）
- 图标使用 PascalCase 的 Lucide 名称（如 `Gamepad2`），不要使用 kebab-case
- 插件元数据（id / 显示名 / 描述 / 作者 / 图标 / 版本）单一来源为 `package.json` 顶层字段（标准 `name`/`version`/`description`/`author` + 扩展 `id`/`icon`），构建时注入源码，发版/改名只改 package.json
- 所有 CSS class 使用插件专属前缀 `snake--`（宿主保留前缀 `components--` 不可用）
- 设置页二选一：`src/settings.ts` 纯声明式（只用 `props.setting.*` 原生控件，无插件 DOM）；
  `src/settings.tsx` React 方案（可混用原生控件 + 自定义 React，自定义内容通过
  `setting.custom()` 挂载进设置列表）。统一 padding 由 style.css 的
  `[role="tabpanel"]:has(.snake--settingsRoot)` 提供（container 标记类为钩子，
  `--size-*` 等 Obsidian 内置变量，不影响内置 tab）
- `onUpdate` 可重复调用，`onDestroy` 释放资源，`install()` 返回 cleanup
- 修改后可运行校验器检查产物形状：

  ```bash
  node .agents/skills/xdb-plugin-skills/scripts/validate-xdb-plugin.mjs snake.xdb.js
  ```
