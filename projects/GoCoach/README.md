# xdb-go-coach

围棋学习工具：死活题判分练习（内置原创题库 + Go Game Guru 题库导入）+ SGF 棋谱打谱复盘与试下。参考 [geekhuashan/go-coach](https://github.com/geekhuashan/go-coach) 的判分口径与课程逻辑，以纯前端 XDB 插件形态重实现，完整离线、无后端。

## 功能

**做题练习**

- 内置 182 道原创题：入门课程 64（救棋 / 提子 / 连接 / 阻断，含对称变式）+ 手筋训练 118（双打吃 / 征吃 / 枷吃 / 门吃 / 倒扑 / 接不归 / 抱吃 / 挖吃等，多手序盘题）；
- 判分口径与 go-coach 一致：序盘题沿收录答案树前进、对手按收录变化自动应手；走出收录之外且实际提掉目标也算完成；走出收录未完成 → 「待复核」不判错；基础题单手规则判分；
- 智能推荐（近 30 条作答动态调整：连错巩固、连对降频、同类轮换）/ 顺序练习（按题集推进，选题面板可浏览全部题目与完成状态、点击直达）/ 错题复习（随机旋转镜像变式防背位置）；
- 提示（H）、看答案（主线逐步演示）、查气（点击任意棋子随时查看整块棋与气；X 开启专注模式、Esc 清除显示）、成对撤回（Z）、重试（N 下一题）；
- 学习档案面板（M4）：概览统计（独立答对/正确率/复习池/总作答）、五知识点掌握度与正确率条形图、下一题推荐策略与理由、近期作答历史；全部保存在本地。

**Go Game Guru 题库（可选导入）**

- 417 道 Weekly Go Problems（基础 / 进阶 / 挑战各 139），CC BY-NC-SA 4.0；
- 体积与许可原因不打包进插件：本仓库运行 `pnpm convert-ggg` 生成 `assets/ggg-lessons.json`（由 `references/go-coach` 的已验证数据压缩而来，约 1.1MB），再到设置页导入（IndexedDB 存储，导入时逐题回放校验）；
- **解说已离线汉化**：`scripts/ggg-i18n.mjs` 整句词典覆盖全部 264 种作者解说（1957 处，含劫、双活、征子、见合等术语），翻译在转换时完成；英文原文保留在 `oe` 字段，做题时可在讲解卡片点开「作者原文」对照（原文版权归原作者，逐题携带署名与许可）。

**AI 讲解（M5.1）**

- 设置页接入任意 OpenAI 兼容接口（OpenAI / DeepSeek / Qwen / GLM / 本地 Ollama、LM Studio），支持连接测试；
- 做题时一键「AI 讲解」：把题面、当前盘面（字符矩阵 + 坐标棋谱）与作答状态发给模型，流式生成中文讲解（正文渐进上屏，思考型模型显示「思考 N 字」进度）；「📋 提示词」一键复制完整提示词，可粘贴到任意聊天模型；
- 普通模式：流式 + 空闲超时（120 秒无新数据才中断）+ max_tokens 限制；附加 enable_thinking/thinking 禁思考参数提速，服务端拒绝（如 GLM-5.3 系列始终思考）时自动去参重试；
- 「深度思考」开关（默认关）：针对 deepseek-reasoner / QwQ / GLM 思考链等，开启后不附加禁思考参数、不限输出与时长（做题时显示思考进度，可随时取消）；
- 密钥仅明文存本机 localStorage；未配置 / 超时 / 401 / 429 / 本地服务跨域等场景均有中文提示。

**打谱复盘（SGF）**

- 打开 SGF 文件 / 粘贴棋谱 / 读取 vault 路径（宿主支持时），内置示例棋谱；
- 逐手回放（按钮 / 滑杆 / ←→ 键 / 自动播放），多分支变化切换，注释（C）与标记（LB/CR/TR 等）随节点显示，提子计数；
- 试下：在任意局面开分支自由计算（蓝色描边区分），可退回、可清除，连同原棋谱一起导出 SGF。

## 开发

```bash
# 仓库根目录
pnpm install            # 安装依赖（仅需一次）
pnpm build GoCoach      # 生产构建 → go-coach.xdb.js
pnpm dev GoCoach        # 监听模式

# 或在本项目目录内
pnpm build
pnpm dev
pnpm selftest           # 逻辑层自测（目录校验 / 判分闭环 / GGG 导入 / SGF 往返 / 变式）
pnpm convert-ggg        # 从 references/go-coach 生成 assets/ggg-lessons.json（需先克隆参考仓库）
```

构建产物 `go-coach.xdb.js` 位于项目根目录，将其放入 XDB 的插件目录即可加载。

## 目录结构

```
src/
├── go/            # 纯逻辑层（无 DOM，selftest 覆盖）
│   ├── rules.ts       # 规则引擎：提子 / 禁自杀 / 全局同形禁着（superko）
│   ├── validate.ts    # 题目校验器：导入题库逐题回放（31 手 / 256 节点 / 16 分支）
│   ├── grade.ts       # 做题会话状态机：序盘树回放判分 + 基础题单手判分
│   ├── curriculum.ts  # 目录组装 / 学习评估 / 智能推荐 / 练习推进
│   ├── variation.ts   # 旋转 / 镜像变式（棋盘自同构，复习防背位置）
│   └── sgf.ts         # SGF 解析 / 回放 / 序列化（自写解析器，含压缩坐标）
├── data/          # 内置题库（原创内容）：basics 64 + authored 18 + original 100
├── components/Board.tsx  # SVG 棋盘（9/19 路、标记、手数、试下、查气）
├── view.tsx       # 主视图：做题 + 打谱双模式
├── settings.ts    # 设置页：偏好 / 题库导入（自定义区域）/ 重置进度
└── storage.ts     # 学习档案（localStorage）+ 导入题库（IndexedDB）
docs/user-guide.md       # 使用教程（面向使用者：做题 / 打谱 / AI / 引擎全流程）
docs/go-coach-plan.md    # 方案分析（里程碑 / 许可 / 架构决策）
docs/katago-setup.md     # KataGo 跨平台安装指南（含模型选择与 FAQ）
references/go-coach/     # go-coach 只读克隆（gitignore，转换脚本的数据来源）
assets/ggg-lessons.json  # GGG 紧凑题库（gitignore，本地生成后经设置页导入）
```

## 许可

- 本插件代码：遵循仓库根目录 LICENSE。
- 内置题库（`src/data/`）：go-coach 项目的原创题目数据。
- Go Game Guru 题库：**CC BY-NC-SA 4.0**，作者 David Ormerod、An Younggil，来源 [gogameguru/go-problems](https://github.com/gogameguru/go-problems)（固定 commit `eee12b2e`）。导入文件逐题携带署名 / 许可 / 来源链接；题目数据与插件代码许可分离，仅限非商业使用，再分发须以相同许可共享并注明转换。`references/go-coach` 与 `assets/` 均不入库。

## 开发规范

本模板基于 `.agents/skills/xdb-plugin-skills` 约定生成：

- 扩展 ID 带插件命名空间（视图 `go-coach:view`、设置 Tab `go-coach:settings`）
- 图标使用 PascalCase 的 Lucide 名称（如 `Grid3x3`），不要 kebab-case
- 插件元数据（id / 显示名 / 描述 / 作者 / 图标 / 版本）单一来源为 `package.json` 顶层字段，构建时注入源码，发版/改名只改 package.json
- 所有 CSS class 使用插件专属前缀 `goCoach--`（宿主保留前缀 `components--` 不可用）
- `onUpdate` 可重复调用，`onDestroy` 释放资源，`install()` 返回 cleanup
- 修改后可运行校验器检查产物形状：

  ```bash
  node .agents/skills/xdb-plugin-skills/scripts/validate-xdb-plugin.mjs go-coach.xdb.js
  ```
