# GoCoach（围棋学习工具）XDB 插件方案

> 状态：**M0–M3 已完成**（方案分析稿 + 实现记录；M4/M5 待启动）
> 参考实现：[geekhuashan/go-coach](https://github.com/geekhuashan/go-coach)，已只读克隆至本目录同级 `references/go-coach/`（gitignore，不修改其源码、不提交入库）。

## 1. 目标与定位

在 XDB（Obsidian 数据库插件）宿主内提供一个**本地优先、离线可用**的围棋学习工具：

- **做题**：死活题 / 手筋题练习，落子即时判分，错题复习；
- **打谱复盘**：加载 SGF 棋谱，逐步播放、浏览变化树、自由试下；
- **进度沉淀**：作答记录、知识点掌握评估、（可选）写入 XDB 数据库行，与笔记体系联动。

与 go-coach 的差异：go-coach 是「Python 标准库 HTTP 服务 + 原生 JS 前端 + 本地 KataGo 进程」的独立 Web 应用；本项目是 **纯前端 XDB 插件**（`*.xdb.js` 单产物，运行于 Obsidian 渲染进程），无自有后端，KataGo / LLM 只作为可选外接端点。

## 2. 功能需求分析（围棋学习工具需要什么）

### 2.1 核心闭环（必须有）

| 模块 | 功能 | 内容来源 |
| --- | --- | --- |
| 围棋规则引擎 | 落子/提子/禁自杀/全局同形禁着（positional superko，pass 豁免）、9/19 路 | 移植 go-coach `go_rules.py`（52 行，确定性纯函数，TS 化成本低） |
| 棋盘渲染 | SVG 棋盘、星位/坐标、棋子/标记/最后一手/气提示，点击落子 | 参考 go-coach `static/app.js`（SVG 方案，575 行） |
| 做题练习 | 题面（黑先/白先、目标）、答案树逐手判分（对=沿树前进+对手应手，错=提示重试，未收录走法=「暂不判错」）、提示、放弃看答案 | go-coach 题库 JSON + `curriculum.grade()` 判题逻辑 |
| 题库 | ① 原创吃子题 118 道（征吃/枷吃/门吃/倒扑/接不归/抱吃/挖吃，难度 3-5，约 50KB 可直接内置）；② Go Game Guru 417 道（easy/intermediate/hard 各 139）+ 旋转镜像变式共 567 道可选 | go-coach `data/original-extra/`、`data/gogameguru/`（CC BY-NC-SA 4.0） |
| 进度记录 | 每次作答（独立/提示后/重试、对错、耗时）持久化；错题本；顺序练习 / 智能推荐 / 错题复习三种模式 | 参考 `curriculum.py`（learning/recommend，近 30 条动态调整） |

### 2.2 棋谱功能（SGF）

| 功能 | 说明 |
| --- | --- |
| SGF 解析 | 自写 TS 解析器（go-coach 也是自写解析器，未用第三方库）：`AB/AW` 初始子、`B/W` 落子、`C` 注释、`LB/CR/TR` 标记、多分支变化树、`SZ/RU/KM/RE/PB/PW` 元信息 |
| 打谱模式 | 载入用户 vault 内 `.sgf` 文件 → 逐步前进/后退/跳手/自动播放，注释与标记随行显示 |
| 复盘试下 | 在任意手数开分支自由试下（受规则引擎约束），与原变化树并存 |
| 导入导出 | 从 SGF 生成题目（提取静态局面为 `stones`，答案树为 `tree`）；对局/试下结果导出 SGF |
| 对弈记录 | 本地双人对弈 + （可选）KataGo 人机，终局数子（贴 7.5 目），导出 SGF |

### 2.3 增值能力（可选，后期）

- **学习水平评估**：入门知识点掌握度（非段位），样本 ≥3 且正确率 ≥75% 推荐进阶（go-coach 同款规则）；
- **LLM 讲解**：OpenAI 兼容 API，设置页配置 base URL / key / model，对当前局面生成讲解与答疑（go-coach `llm_client.py` 的前端化）；
- **KataGo 外接**：连接用户自建的 KataGo analysis HTTP 端点做胜率/推荐着法展示（Obsidian 内不管理本地进程，只做客户端）；
- **XDB 数据库联动**：作答记录/对局写入数据库行（Gomoku 已有「战绩写库」先例），支持在表格视图里筛选统计；
- **题库导入**：支持 go-coach 的书题 JSON 单题导入格式（`题库导入说明.md`），用户可自录题目。

### 2.4 内容（非功能需求）

- 题库必须携带**来源与许可元数据**（见 §6）；
- 入门知识点文案（吃子手法、基础死活）需中文撰写；
- 提示文案分级：方向提示 → 关键点提示 → 完整答案。

## 3. 形态选型：XDB 插件 vs .xdb 数据库组件

| 维度 | XDB 插件（`*.xdb.js`） | .xdb 数据库组件 |
| --- | --- | --- |
| 承载棋盘交互 UI | ✅ `registerDatabaseView` 自定义视图 | ❌ 只有表格/卡片等内置视图 |
| 持久化 | viewDefinition.options（配置）+ Database API（结构化记录） | ✅ 原生行/字段 |
| 独立设置页 | ✅ `registerViewSettingsTab` | ❌ |
| 适合角色 | **主体：练习室视图、做题引擎、SGF 播放器** | **辅载体：作答/对局记录表、题库索引表** |

**结论：以插件为主体**（与仓库内 Gomoku/Sudoku 等游戏插件同构）；数据库联动作为可选增强——插件用 `props.api` 把作答记录写入用户指定的数据库（M4），而不是先建 .xdb 再想办法塞 UI。

## 4. go-coach 参考分析与移植策略

克隆位置：`projects/GoCoach/references/go-coach/`（只读，不改源码）。

| go-coach 模块 | 规模 | 移植策略 |
| --- | --- | --- |
| `go_rules.py` | 52 行 | **直接 TS 重写**（neighbors/group/play/superko 判定），配单元测试 |
| `static/app.js` | 575 行 | **思路参考**：SVG 渲染、drawer/toast 交互改为 React + `view.tsx`；判分状态机重写 |
| `curriculum.py` | 327 行 | **逻辑移植**：grade（作答判定）/ learning（掌握度）/ recommend（近 30 条智能推荐）/ 顺序练习章节 |
| `tactics.py` + `data/original-extra/` | 275 行 + ~55KB JSON | **数据直接复用**（原创题，无第三方许可约束） |
| `data/gogameguru/` | 4.86MB lessons.json + 423 个 SGF | **转换复用**（见 §5.2 / §6） |
| `engine.py` / `engine_bridge.py` | 230 行 | **不移植**（本地进程管理不适合 Obsidian）；改为可选 HTTP 客户端 |
| `llm_client.py` | ~200 行 | 前端化为 OpenAI 兼容 fetch 客户端（可选） |
| `server.py` / `cloud/` | 799 行 + Workers | **不移植**（无后端；持久化走 XDB 宿主能力） |
| `lesson_review.py` / review-variations | 旋转/镜像变式生成 | 变式生成器 TS 化（8 对称变换 + 校验） |

## 5. 数据方案

### 5.1 题目格式：采纳 go-coach 的 Lesson JSON

```jsonc
{
  "id": "ggg-easy-01",
  "title": "Go Game Guru · 基础 1",
  "prompt": "黑先。……",
  "hint": "……",
  "size": 19,              // 9 | 19
  "to_play": 1,            // 1 黑先 2 白先
  "skill": "tsumego",      // capture | tsumego
  "difficulty": 3,         // 1..5
  "sequence": true,        // 多手序盘题
  "stones": [{ "x": 14, "y": 15, "color": 1 }],  // 左上原点，1 黑 2 白
  "objective": { "kind": "capture", "targets": [[3, 2]] },  // capture | capture_any | authored_solution
  "marks": [{ "x": 9, "y": 9, "label": "A" }],
  "source": { "kind": "licensed", "...": "署名/许可/来源 commit，逐题携带" },
  "tree": { "children": [{ "move": [16, 17], "explanation": "…", "children": [] }] }
  // 限制：31 手 / 256 节点 / 每节点 16 分支；根节点不含落子；交替落子
}
```

优点：判分（答案树回放）、变式（对称变换）、书题导入（用户自录）三套需求一个 schema 覆盖，且与 go-coach 生态互通。

### 5.2 题库体积与加载策略

| 题库 | 原始体积 | 策略 |
| --- | --- | --- |
| 原创吃子题（118 道 + 基础变式） | ~55KB + more.json ~255KB | **直接打包进插件**（esbuild JSON loader） |
| GGG 417 题（含答案树） | 4.86MB | **不打包**。转换脚本产出精简版（紧凑坐标编码、剥离冗余英文注释、保留 source 许可字段），按难度拆 3 个 JSON，用户经设置页「导入题库文件」或放入 vault 指定路径由插件读取 |
| 旋转/镜像变式（567 道） | 146KB | 运行时由变式生成器从 417 题即时派生，不落盘 |

> 转换脚本放本仓库 `projects/GoCoach/scripts/`（读取 `references/go-coach/data/`，只读输入、独立输出到 `assets/`），不修改 go-coach 源码。

### 5.3 持久化

- **配置**：`viewDefinition.options[PLUGIN_ID]`（当前题库、筛选、显示偏好）——宿主标准写回通道；
- **作答/对局记录**：优先写 XDB 数据库行（用户在设置页选择目标数据库/表），无库时降级 localStorage；
- **SGF 棋谱**：直接读用户 vault 文件（宿主 files API），导出写回 vault 或下载。

## 6. 许可与合规（关键约束）

GGG 题库为 **CC BY-NC-SA 4.0**（作者 David Ormerod、An Younggil；来源 commit 固定 `eee12b2e`）：

1. **署名**：逐题保留 `source` 字段（作者、URL、commit、转换说明）；
2. **非商业**：本插件不引入任何商业分发渠道；
3. **相同方式共享**：若随插件分发转换后的题目，须以同许可提供题目数据文件——**题目数据与本插件代码许可分离**（go-coach 正是此做法），README 中明示；
4. 转换时**不删改署名、不伪造许可标记**；私录书题（`household_private`）不进入任何分发渠道。

## 7. 技术架构（XDB 宿主内，按实际实现）

```
projects/GoCoach/
├── src/
│   ├── go/                  # 纯逻辑层（无 DOM，selftest 覆盖）
│   │   ├── rules.ts         # 规则引擎（play/group/liberties/superko）
│   │   ├── sgf.ts           # SGF 解析器 + 回放 + 序列化（压缩坐标/试下分支）
│   │   ├── grade.ts         # 做题会话状态机（答案树判分 + 基础题单手判分）
│   │   ├── curriculum.ts    # 目录 / 学习评估 / 智能推荐 / 练习推进
│   │   ├── variation.ts     # 旋转/镜像变式（棋盘自同构）
│   │   ├── validate.ts      # 导入题库逐题回放校验
│   │   └── types.ts         # 领域类型（Lesson/Attempt/…）
│   ├── data/                # 内置题库（原创，打包进产物）
│   ├── components/Board.tsx # SVG 棋盘（9/19 路、标记、手数、试下、查气）
│   ├── view.tsx             # 主视图（做题 / 打谱双模式）
│   ├── settings.ts          # 设置 tab（偏好 + 题库导入自定义区域 + 重置）
│   └── storage.ts           # 学习档案 localStorage + 导入题库 IndexedDB
├── scripts/
│   ├── convert-ggg.mjs      # GGG 题库压缩转换（references → assets）
│   └── selftest.mjs         # 逻辑层自测（esbuild 打包后 node 执行）
├── docs/go-coach-plan.md    # 本文档
├── references/go-coach/     # 参考仓库只读克隆（gitignore）
└── assets/ggg-lessons.json  # GGG 紧凑题库（gitignore，设置页导入）
```

- 渲染沿用 SVG（缩放清晰、标记方便），React 组件化替代 go-coach 的命令式 DOM 操作；
- 全部逻辑层为纯函数，与 Gomoku 的 `game/engine.ts` 同风格；自测覆盖规则、判分、校验、SGF 往返与变式。

## 8. 里程碑

| 阶段 | 交付 | 验收 | 状态 |
| --- | --- | --- | --- |
| **M0** | 模板骨架 + go-coach 参考克隆 + 本方案 | 构建产物过 validator | ✅ 完成 |
| **M1 可玩闭环** | 规则引擎 + SVG 棋盘 + 内置 182 题做题判分（64 基础 + 118 手筋） | 构建 + validator + 逻辑自测 | ✅ 完成 |
| **M2 题库** | GGG 精简转换脚本（4.8MB→1.1MB）+ 设置页导入（逐题回放校验）+ 智能推荐/顺序/错题复习（变式） | 417 题导入校验 144ms 全过 | ✅ 完成 |
| **M3 棋谱** | SGF 解析/打谱/变式浏览/复盘试下/导出（含压缩坐标、tt 停一手） | 示例与往返自测全过 | ✅ 完成 |
| **M4 沉淀** | 掌握度评估面板 + 智能推荐可视化 + 近期作答历史（作答写库按需求裁剪，不做） | 面板正确呈现评估/推荐/历史 | ✅ 完成（不含写库） |
| **M5.1 LLM 讲解** | 用户自接 OpenAI 兼容 API + 做题一键讲解 | 设置可配/可测、讲解渲染、错误中文化 | ✅ 完成 |
| **M5.2 KataGo** | 本地引擎子进程 / 远程端点 | 方案已定（§10.3），待实现 | ⏳ 未启动 |

### M4 实现记录（2026-09-29，不含作答写库）

- 原简易"学习情况"折叠框升级为**学习档案面板**（做题模式，展开可见）：
  - 概览卡：独立答对 / 独立作答 / 正确率 / 复习池 / 总作答；
  - 知识点掌握度：五个技能各自的阶段结论 + 独立作答正确率条形图（含 aria-label）+ 建议难度；
  - 下一题推荐卡：推荐策略标签（连错巩固 / 换题再练 / 同类轮换 / 连对降温 / 均衡推进）+ 推荐题目 + 理由；
  - 近期作答：最近 10 条（✓ 对 / ✗ 错 / ～ 待复核标记、难度、提示后、第 N 次、相对时间）。
- 智能推荐逻辑沿用 M1 移植的 recommend()（近 30 条窗口），本阶段补齐可视化呈现。
- 作答写库（XDB 数据库联动）按用户要求**不实现**；学习档案继续存 localStorage。

### M0–M3 实现记录（2026-09-29）

- **逻辑层**（`src/go/`，纯函数、无 DOM）：`rules.ts`（提子/禁自杀/positional superko）、`validate.ts`（题目导入校验：31 手/256 节点/16 分支，全树回放）、`grade.ts`（做题会话：序盘答案树判分 + 基础题单手判分 + 撤回/重试/演示）、`curriculum.ts`（目录/学习评估/智能推荐/练习推进，忠实移植 go-coach 口径）、`variation.ts`（八对称变式）、`sgf.ts`（自写解析器 + 回放缓存 + 序列化，支持压缩坐标与重复属性容错）。
- **数据**：内置 182 题（basics 64 + authored 18 + original 100，均过校验）直接打包；GGG 417 题经 `scripts/convert-ggg.mjs` 压缩为 `assets/ggg-lessons.json`（本地文件、不入库），设置页导入存 IndexedDB。GGG 英文解说由 `scripts/ggg-i18n.mjs` 整句词典离线汉化（264 种文本 / 1957 节点全覆盖），原文保留在 oe 字段，做题时可点开「作者原文」对照。
- **视图**：`view.tsx` 双模式（做题/打谱），React + SVG 棋盘（`components/Board.tsx`，事件坐标换算落点，无逐点热区）；学习档案 localStorage，跨实例经 window 事件同步。
- **验证**：`pnpm build GoCoach` + validator 0 警告；`pnpm selftest`（esbuild 打包逻辑层后 node 执行）覆盖：目录校验 182、基础题四类判分、30 题序盘主线 solved、未收录 unlisted、GGG 417 题全量校验 + 抽样 solved、变式 solved、SGF 解析/试下/序列化往返、压缩坐标展开、推荐/推进冒烟。

## 10. M5 方案分析：LLM 讲解 + KataGo 引擎（2026-09-29 调研）

### 10.1 结论

| 能力 | 推荐方案 | 一句话理由 |
| --- | --- | --- |
| LLM 讲解 | **用户自接 OpenAI 兼容 API**（云端或本地 Ollama/LM Studio） | 标准协议、零后端、密钥不上传给插件作者；桌面端 fetch 跨域可用 |
| KataGo | **用户自行下载引擎与模型，设置页一键启动本地子进程**（`katago analysis` JSON 协议） | 即 go-coach `engine.py` 的忠实移植；离线、免费、最强棋力；桌面端可用 |
| KataGo 备选 | 通用"远程分析端点"（用户自填 URL，兼容自建/社区 HTTP 封装） | 子进程不可用（宿主未暴露 require / 移动端）时的降级路径 |
| 不推荐 | 浏览器 WASM 跑 KataGo；免费公共分析 API | 前者需 WebGPU + 几十 MB 模型、CPU 推理慢；后者无稳定免费公开服务（katagui 无公开 API，AI Sensei 为付费） |

### 10.2 LLM 讲解（M5.1，✅ 已实现：`src/llm.ts` + 设置页 AI 配置区 + 做题「AI 讲解」按钮；实测请求构造/局面序列化/成功与 401/未配置路径）

**配置**（设置页"AI 讲解"区，存 localStorage 而非 viewDefinition——避免随库导出泄漏密钥）：

- Base URL（默认 `https://api.openai.com/v1`；兼容 DeepSeek/Qwen/GLM/Ollama `http://localhost:11434/v1` 等）
- API Key（密码框，明文存储并提示风险）
- 模型名（手填 + "获取模型列表"按钮调 `/models`）
- 温度 / 最大 token（可选高级项）

**接入点**：

1. 做题状态卡新增「AI 讲解」按钮：把题目元信息（题面/目标/难度）+ 当前局面（SGF 片段或棋盘序列化）+ 已走棋谱 + 判分结果组装为 system+user 消息，请求 `POST {base}/chat/completions`（非流式起步），结果渲染到讲解卡（与"作者原文"同区域）；
2. 自由问答输入框（可后续）；
3. 错题复习时一键"为什么错"（附收录正解变化对照）。

**工程要点**：超时与错误中文提示（401/429/网络）；`AbortController` 防重复点击；本地 Ollama 需设 `OLLAMA_ORIGINS=*`（文档说明）；不做流式（一期）。

### 10.3 KataGo 引擎（M5.2）

**主方案：本地子进程（桌面端）**

- 前置：用户自行下载 [KataGo 发行版](https://github.com/lightvector/KataGo) 与模型（推荐 CPU 用户 b6c96/b10c128 小模型，有 GPU 可 b18nnp），设置页填写 `katago` 可执行文件路径、模型路径、visits；
- **设置页「启动引擎」按钮**：特性检测 `typeof require === 'function'`（XDB 宿主在桌面 Electron 渲染进程中通常暴露 Node 集成；检测失败则按钮禁用并提示改用远程端点）→ `require('child_process').spawn(katago, ['analysis', '-config', 内置精简模板, '-model', ...])` → 读取 stdout 首行 `? protocol_version` 握手 → 常驻子进程（模块级句柄，插件卸载/视图销毁时 kill）；
- **协议**（官方 [Analysis_Engine.md](https://github.com/lightvector/KataGo/blob/master/docs/Analysis_Engine.md)）：每行一个 JSON 查询（`id/moves/initialStones/initialPlayer/komi/rules/maxVisits/analyzeTurns/includeOwnership`），stdout 每行一个 JSON 回复（`moveInfos` 含 winrate/scoreLead/PV、`ownership` 热度图）；按 `id` 关联，天然异步；
- **接入点**：①做题 unlisted 自由探索时「引擎应手」（取 PV 首着，替代 go-coach 的 playout AI）；②打谱模式「分析当前局面」——胜率条 + 候选点标记（把 `moveInfos` 前 N 映射为棋盘标记）；③可选 ownership 热度着色（二期）；
- **降级链**：启动失败（路径错/无权限/非桌面）→ 按钮态与日志提示 → 用户改填远程端点。

**备选：远程分析端点**——设置项一个 URL，POST 局面 JSON、回传同结构 `moveInfos`；社区 HTTP 封装或用户自建（如 katagui 本地版、简单 wrapper）都可适配；不做具体第三方绑定（无稳定免费公开 API）。

**远期：WASM**——参考 [web-katrain](https://github.com/Sir-Teo/web-katrain)（TFJS WebGPU + WASM 回退）与 saigo.online 的做法可行，但模型体积（数十 MB）与 CPU 推理速度制约体验，仅在"零安装纯浏览器"成为硬需求时评估。

### 10.4 M5.2 详细设计定稿（2026-09-30）

已确认决策：实施切分 M5.2a（引擎管理+设置页+状态灯）→ M5.2b（打谱分析：胜率+候选点+PV）→ M5.2c（做题引擎应手）→ 远程端点（本期做）；visits 默认 100。

**架构**：`EngineClient` 统一接口（`analyze(query) → response`），LocalEngine（child_process.spawn `katago analysis`，stdin/stdout JSON 行协议）与 RemoteEngine（fetch POST 自定义端点，契约同构）两个实现；进程句柄模块级单例，跨视图重挂载存活、插件 cleanup 杀进程。

**子进程管理**：
- 特性检测 `typeof require === 'function'`（XDB 宿主桌面端 Electron nodeIntegration；实现首日验证，不可用则引擎区仅"远程端点"模式）；
- spawn(katago, ['analysis','-config',<插件生成的最小模板>,'-model',<用户模型>,'-override-config','maxVisits=100'])，shell:false；
- 握手：stdout 控制行 `? protocol_version` 即就绪；stderr 收集尾部回显启动错误；退出监听→状态置错误；
- 视图 destroy 不杀进程；设置页「停止」与插件 cleanup 杀。

**协议**（以官方 Analysis_Engine.md 为准，实现时实测校准字段细节）：
- 请求：`{id, initialStenes:["B D4",…], moves:["Q16",…], initialPlayer, rules:"chinese", komi, boardXSize, maxVisits:100, analyzeTurns:[N], includeOwnership, includePolicy}`；
- 响应：按 id 关联；`moveInfos`（top-N 候选：move/order/winrate/scoreLead/pv）+ `rootInfo`；
- 坐标格式（字母跳 I+数字）与插件 coordLabel 一致；winrate/scoreLead 为行棋方视角，白方行棋时换算黑方视角显示。

**UI 接入点**：①打谱「分析当前局面」→候选点字母标记（悬停显示胜率/目差）+ 黑白胜率条 + 点候选看 PV 序号棋盘预览（二期：ownership 热力图、analyzeTurns 全谱胜率曲线）；②做题 unlisted 自由探索时「引擎应手」（moveInfos[0]，不计入判分）；③顶栏引擎状态灯（未启用/启动中/就绪/分析中/错误）。

**设置页引擎区**：模式（关闭/本地/远程）、katago 路径+「探测」（spawn version 秒验）、模型路径、visits（默认 100）、启动/停止、状态与 stderr 回显；远程模式仅一个 URL，docs 给出最小 wrapper 契约。模型建议（按 katagotraining.org 实测）：GPU → 主表最强 b11c768（transformer）；CPU → Extra Nets 的 Lionffen b6c64 或主表历史区 b10c128/b15c192；拟人棋风 → b18c384nbt-humanv0。详见 docs/katago-setup.md §六。安装指南见 docs/katago-setup.md（跨平台，按 Releases 实测产物编写；注意最新 tag v1.18.2 仅含 CUDA，全后端在 v1.18.1）。

### 10.5 M5.2a 实现记录（2026-09-30）

已完成并经浏览器实测（mock 端点全链路 + 状态灯三态）：

- `src/engine.ts`：`EngineClient` 统一接口（`analyze(AnalyzeInput) → NormalizedAnalysis`）。
  - 纯函数层：`buildAnalysisRequest`（coordLabel 复用、pass 编码、analyzeTurns=已落子数）、
    `blackWinrate/blackScoreLead`（协议为行棋方视角，白方行棋取补）、`normalizeAnalysis`（order 排序 + 黑方视角）。
  - `startLocalEngine`：特性检测 `typeof require === 'function'`（env.d.ts 声明；产物 CJS/neutral 下
    esbuild 原样保留 `require` 引用，浏览器 iife 预览里 `__require` stub 调用时抛错→走降级文案，已实测）；
    spawn `katago analysis -config <插件临时目录生成的最小 cfg> -model <用户模型> [-override-config maxVisits=N]`；
    握手 = 9 路空盘 visits≤8 的探针查询（同时预热模型）；stdout 行解析按 id 关联 pending，`isFatalError`/`error` 抛错；
    stderr 尾部 2000 字符回显；进程退出→error 态 + 全部 pending 拒绝。进程句柄模块级单例，跨视图存活。
  - `probeKatago`：spawn `version` 秒验路径（15s 超时，回显首行）。
  - 远程：`remoteEngine(url)`（懒建单例）fetch POST，180s 超时，契约同构（见 katago-setup.md「远程端点模式」）。
  - `ensureEngine/stopEngine/killEngineOnUnload`：按配置取引擎；插件 cleanup 杀进程。
- `storage.ts`：`EngineConfig{mode,katagoPath,modelPath,visits=100,remoteUrl}`（localStorage `go-coach:engine:v1`）+
  `EVENT_ENGINE_CHANGED`；engine.ts 状态经 `EVENT_ENGINE_STATUS` 广播。
- 设置页引擎区（custom 整块）：模式三选（本地模式在无 require 环境禁用+提示）、katago 路径+「探测版本」、
  模型路径、visits（1-10000）、「启动引擎/停止」+ 状态行（订阅状态事件局部刷新，stderr 尾部错误回显）、
  远程 URL+「测试连接」（空盘 9 路 visits 8 探针）+ 契约说明。
- 顶栏状态灯：off=灰点、starting=黄点脉冲、ready=绿 chip「引擎就绪」、error=红 chip、remote 未请求=chip「远程端点」。
- 实测结论：远程端点**必须回 CORS 头**（否则浏览器 `Failed to fetch`），已写入 katago-setup.md；
  preview.mjs 扩展为同时构建 index/settings 两个预览页。
- selftest 第 8 节：请求编码/视角换算/归一化 14 项断言全绿；构建 + validator（0 警告）+ tsc 通过。

**真机修复（2026-09-30，用户 Windows + onnx-directml + Lionffen b6c64 实测）**：
spawn/stderr 回显/错误状态全链路已验证可用；首报 `Could not find key 'numAnalysisThreads'`——
凭记忆写的模板键在部分发行构建不存在（v1.18.1 官方 cfg 有此键但 directml 构建不认；旧模板还埋了
`reportAnalysisWinratesAs = false` 非法枚举值雷）。修复：resolveEngineConfig 优先 katago 同目录
`analysis_example.cfg`（与二进制配套），模板只写 v1.0 老键，统一 `-override-config`
`logDir=<tmp> reportAnalysisWinratesAs=SIDETOMOVE numSearchThreads=2 [maxVisits=N]`；
启动探针加 150s 超时（防 DirectML 多显卡交互卡死，超时文案给三条排查方向）；blackWinrate 对 >1.5
的值按百分数自适应（防 reportAnalysisWinratesAs 未按预期生效的引擎）。

**真机修复第二轮（同日）**：①`-override-config` 多键放同一参数会被整串当成首个键的值
（回显 `logDir = …/logs reportAnalysisWinratesAs=… maxVisits=100` 全成了 logDir 值）——改为
逐键一个 `-override-config`（cxxopts vector 累积）；spawn `cwd` 设为插件临时目录、logDir 用
相对 `logs`（绝对路径含空格用户名时 override 值会碎）。②v1.18 起 onnx 系构建必填
`onnxProvider`（发行 cfg 不一定带）：`inferOnnxProvider` 按发行包文件名推断
（含 onnx 才返回 provider，非 onnx 构建绝不传该键——未知键直接报错），设置页本地模式出现
「ONNX 后端」下拉（自动=按文件名；路径变化时行显隐重建）。实测链路：浏览器验证显隐/推断/
持久化全过。

**真机修复第三轮（同日）**：override 的 `numSearchThreads=2` 与 v1.18 cfg 里的
`numSearchThreadsPerAnalysisThread` 互斥（Cannot specify both）——线程数改为完全不干预，
交给配套 cfg 的官方推荐值。至此 override 清单收敛为四个有实测必要性的键：
logDir（防写脏用户目录）、reportAnalysisWinratesAs（统一视角）、maxVisits（核心参数）、
onnxProvider（onnx 构建必填）。教训：对第三方引擎做 override 要最小化，每多动一个键
就多一处版本/构建差异的爆点。

### 10.5b M5.2b 实现记录（2026-09-30，打谱局面分析）

已完成并经浏览器端到端实测（mock 端点全链路）：

- `engine.ts` 新增三个纯函数（selftest 第 9 节 9 项断言）：`kataPoint`（"Q16"/"pass" → 棋盘点，
  跳 I + 行号自下而上，与 coordLabel 互逆）、`gameToAnalyzeInput`（root.board 棋子为
  initialStones——buildGame 保证 root.move 为 null、setup 只在根；路径各节点的落子为 moves，
  illegal 回放节点按 pass 传递；komi 从棋谱 KM 读取，缺省 7.5）、`replayPv`（当前局面回放
  候选主变化前 8 手得预览盘面 + 手数标注，PV 非法即停）。
- `view.tsx` 打谱模式：工具栏「⚡ 分析」按钮（busy 禁用+文案）；侧栏分析框（分支行与注释盒之间）：
  黑白胜率条（黑方视角，fill 百分比）+ 目差/visits + 前 6 候选列表（字母徽标 + 坐标 + 黑胜率% +
  目差，title=完整 PV）+ 错误行；棋盘候选点字母标记 A-F（复用 mark--chip，预览时隐藏防叠字）；
  点候选行 → PV 预览（棋盘换成回放盘面、moveNumbers 标 1-8、点棋盘或「✕ 退出预览」恢复）。
- 结果按 `boardKey(board)|toPlay` 缓存（Map 上限 40 条 FIFO）：切节点自动隐藏、切回直接命中
  显示不重新请求；analysisTick state 仅作刷新触发，展示统一读 ref 缓存。
- 实测项：分析→mock 响应→胜率条/候选/字母标记渲染；PV 进入/退出；切节点隐藏与缓存命中
  （回根节点直接显示）；remote 模式状态灯「引擎就绪」。
- 教训复用：测试断言的坐标换算要先核对基准（SGF y 自上而下 vs GTP 行号自下而上；
  idx = y*size+x），本轮测试脚本自身错两轮才定位。

### 10.5c M5.2c 实现记录（2026-09-30，做题引擎应手）——M5.2 全部完成

- `engine.ts`：`sessionToAnalyzeInput`（题面 initialBoard 棋子为 initialStones、会话实际落子为
  moves、toPlay 取当前轮次；selftest 第 10 节 3 项断言）。
- `view.tsx`：做题操作区「⚡ 引擎应手」按钮，仅 `session.playout`（走出收录变化/答错后的自由
  探索）时显示；点击 → ensureEngine → analyze 当前局面 → moveInfos[0] 落子（走 playout 分支，
  状态「自由探索中」，不判分不写档案）；move 为 pass 时 toast 提示不落子；失败 toast 回显。
- 浏览器实测（mock 端点）：落子判错进自由探索 → 按钮出现 → 点击 → 引擎（白方）落子 →
  状态自由探索中、按钮保留可连续应手。注：IAB cua 坐标点击不触发 React onPointerDown，
  测试用合成 PointerEvent dispatchEvent 落子。
- M5.2 至此（a 引擎管理 + b 打谱分析 + c 引擎应手 + 远程端点）全部完成。

**原版对照修正（2026-09-30）**：对照原版 `references/go-coach/engine.py` 发现并修复——
KataGo 排队时会先输出 `isDuringSearch: true` 的增量报告，原版 `_run_query` 显式跳过
（engine.py:148），我们的 stdout 解析未跳、会提前拿到不完整 moveInfos。已在 feedLine 加跳过。

### 10.5d 复核 + maxTime + 文件选择器（2026-09-30，对照原版补齐）

- **复核（对齐原版 engine.review / lesson_review）**：做题走出收录变化（unlisted）后操作区出现
  「⚖ 引擎复核」——把你的最后一手与参考首手（`referenceMoveAt`，grade.ts 新增：回退到手前
  所在树节点的 children[0]）各做一次**根约束查询**（`allowMoves` untilDepth=1 + includeOwnership +
  maxVisits=128 + 查询级 `overrideSettings.maxTime=5`，本地/远程双实现）；`buildReviewQueries`
  /`normalizeReviewPoint`（ownership 行棋方视角→黑方视角换算）/`assembleReview`（scoreDelta/
  winrateDelta）纯函数在 selftest 第 11 节。UI：状态卡内对比卡（你的 vs 参考：坐标/黑胜率/目差/
  之后主变化）+ 差值文案（亏 X 目 / 好X 目 / 几乎相同），reviewData.moveIdx 防跨题串显。
- **maxTime 安全网**：常规 override 加 `maxTime=30`（原版 cfg 3s，我们放宽防慢机大模型长等）。
- **路径选择器**：设置页本地模式两行加「📁 浏览」→ 系统 `<input type=file>`（katago 限
  `.exe`、模型限 `.gz`）；Electron 宿主经 `file.path` 或 `webUtils.getPathForFile` 取绝对路径，
  浏览器预览拿不到时提示手填。
- 浏览器实测（mock 升级支持 allowMoves 区分响应）：顺序练习导航至序盘题「双打吃」→ 走远端
  J1 走出收录 → unlisted + 复核按钮出现 → 点击 → 两个根约束查询（mock 收到 allow: J1/D6）→
  对比卡渲染（你的 J1 45.0%/-1.5 vs 参考 D6 45.0%/-1.5 + PV 行）；文件选择器 accept .exe/.gz 就位。

### 10.6 SGF 文件夹加载（2026-09-30，打谱便捷载入）

- `src/localfs.ts`（新）：复用 engine.ts 导出的 `nodeRequire` 探测——`listSgfFiles`（readdirSync
  过滤 .sgf、自然数排序、不递归）、`readLocalText`（UTF-8 优先，解码出 U+FFFD 时按 latin1 兜底
  ——老中文 SGF 常为 GBK）、`joinPath`（分隔符自适应，不依赖 node:path）、`dirOfFile`
  （webkitdirectory 选中文件反推目录）。
- 设置页新增「打谱」区：SGF 文件夹路径 + 📁（`input[webkitdirectory]` 选目录，Electron 取
  file.path/webUtils 后 dirOfFile 反推）+ 保存后显示「已保存：N 个 .sgf」（浏览器预览 require
  为 stub，恒显示 0，属预期降级）。存 localStorage `go-coach:sgf:v1` + `EVENT_SGF_CHANGED`。
- 打谱工具栏（粘贴棋谱旁）：文件夹下拉（列出全部 .sgf 文件名，选中即读入加载，悬停显示
  目录与数量）+「⟳」重扫描；未设置时显示「📁 未设置文件夹」禁用态。设置页与视图同窗口时
  事件即时联动（预览双 tab 跨页事件不通为环境限制，非 bug）。
- selftest 第 12 节：临时目录写入 sgf/txt/子目录，验证过滤/自然数排序/读取/路径工具/不存在
  目录容错，7 项全绿。

**引擎应手过期快照修复（2026-09-30，用户报 9 路棋盘应手不上子）**：根因是
`setSession(playStone(session,…))` 使用 await 前的闭包快照——引擎思考期间用户落的手被旧盘面
覆盖。改为 sessionRef 取最新局面落子（目标点被占提示再点一次），成功/失败/pass 均有 toast
反馈。浏览器 mock 实测「思考期间抢先落子」：两子都保留，toast 显示应手坐标与胜率。

### 10.7 人机对局（2026-09-30，M6）

打谱工具栏「✚ 对局」：9/13/19 路空盘开局，自动开试下模式 + 自动应手；`handleSgfEngineReply(manual)`
复用 `gameToAnalyzeInput` + `addTrialChild`（currentRef 防异步过期）——手动模式替当前轮次落子并让
引擎接管该颜色（开局点一次＝引擎执黑），自动模式（useEffect，400ms 延迟防点击竞态）只在轮到
engineColor 且当前节点无分支时触发。「🤖 自动应手」toggle、「⚡ 引擎应手」手动按钮随试下模式
显示；↩ 退一手 / ✕ 清除试下 / ⬇ 导出 SGD 保存整盘。浏览器 mock 实测：开 9 路对局 → 用户一手 →
引擎自动落第 2 手 → 轮用户时不再动。

### 10.6 风险与开放问题（M5.2）

| 风险 | 对策 |
| --- | --- |
| XDB 宿主未向子插件暴露 `require` | 启动按钮前特性检测；不可用则禁用并引导远程端点方案 |
| 用户路径 / config 写错 | 启动时捕获 stderr 首几行回显；提供内置 analysis 配置模板（免用户写 config） |
| 密钥明文存储 | 存 localStorage、设置页脱敏显示、说明文案提示 |
| 移动端 Obsidian | 引擎与 LLM 均按特性检测降级（LLM 理论上移动端可用，看宿主 fetch 权限） |
| 引擎查询阻塞 UI | 协议本身异步按 id 回调；UI 只在收到回复行后更新 |
| 免费公共分析服务 | 调研未发现稳定免费公开 API，不做内置集成，避免随时失效 |

## 9. 风险与开放问题

| 风险 | 对策 |
| --- | --- |
| GGG 许可（NC/SA）传播风险 | 题库不打包进产物，独立数据文件 + 独立许可声明；仓库 README 明示 |
| 4.86MB 题库性能 | 精简编码 + 按难度分片 + 惰性加载；变式运行时派生 |
| Obsidian 内无本地进程能力 | KataGo 走外接 HTTP；不承诺内置引擎 |
| 宿主 files/网络 API 能力边界 | 实现前对照 skill `references/types.md` 的 files API 逐项确认 |
| 19 路棋盘移动端可用性 | 响应式棋盘 + 触控命中区域放大，参考仓库游戏插件做法 |
| 「未收录走法暂不判错」的体验预期 | 文案明确「完成作者收录变化 ≠ 程序证明最优」，与 go-coach 口径一致 |
