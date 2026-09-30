// ═════════════════════════════════════════════════════════════
// KataGo 引擎接入（M5.2a）：EngineClient 统一接口 + 本地子进程 / 远程端点。
// 协议：katago analysis 模式 stdin/stdout 每行一个 JSON（官方 Analysis_Engine.md），
// 远程端点契约同构（POST 单个请求 JSON → 响应 JSON），见 docs/katago-setup.md。
// ═════════════════════════════════════════════════════════════

import { coordLabel, play, cloneBoard } from './go/rules';
import type { Board } from './go/types';
import type { GameNode, LoadedGame } from './go/sgf';
import type { LessonSession } from './go/grade';
import {
  loadEngineConfig,
  saveEngineConfig,
  EVENT_ENGINE_STATUS,
  type EngineMode,
} from './storage';

export type { EngineMode };

export type EngineState = 'off' | 'starting' | 'ready' | 'error';

export interface EngineStatus {
  state: EngineState;
  /** 状态灯 hover 文案（含错误摘要） */
  message: string;
  /** 引擎 stderr 尾部（启动失败回显用，本地模式） */
  stderrTail: string;
}

const IDLE_STATUS: EngineStatus = { state: 'off', message: '引擎未启用', stderrTail: '' };

// ─────────────────────────────────────────────────────────────
// 协议类型（Analysis_Engine.md；字段按官方文档命名）
// ─────────────────────────────────────────────────────────────

export interface AnalysisRequest {
  id: string;
  /** 初始盘面已有棋子，如 [["B","D4"],["W","Q16"]] */
  initialStones: Array<[string, string]>;
  /** 从初始盘面起依次落子（pass = "pass"） */
  moves: Array<[string, string]>;
  initialPlayer: 'B' | 'W';
  rules: string;
  komi: number;
  boardXSize: number;
  boardYSize: number;
  maxVisits: number;
  analyzeTurns: number[];
  includeOwnership: boolean;
  includePolicy: boolean;
  /** 根约束（复核用）：限定首手只考虑给定落点 */
  allowMoves?: Array<{ player: 'B' | 'W'; moves: string[]; untilDepth: number }>;
  /** 查询级覆盖（复核用，如 maxTime） */
  overrideSettings?: Record<string, number | string | boolean>;
}

export interface AnalysisMoveInfo {
  move: string;
  order: number;
  /** 行棋方视角胜率 0-1（落子后） */
  winrate: number;
  /** 行棋方视角目差 */
  scoreLead: number;
  visits: number;
  /** 主变化（含本手） */
  pv: string[];
  prior?: number;
}

export interface AnalysisRootInfo {
  currentPlayer: 'B' | 'W';
  /** 当前行棋方视角胜率 0-1 */
  winrate: number;
  scoreLead: number;
  visits: number;
}

export interface AnalysisResponse {
  id: string;
  turnNumber: number;
  moveInfos: AnalysisMoveInfo[];
  rootInfo: AnalysisRootInfo;
  /** 部分实现（如远程 wrapper）会透传 */
  ownership?: number[];
  isFatalError?: boolean;
  error?: string;
}

/** analyze 的高层入参：不关心协议字段的一方（视图层）用 */
export interface AnalyzeInput {
  size: number;
  /** 初始盘面棋子 */
  stones: Array<{ x: number; y: number; color: 1 | 2 }>;
  /** 从初始盘面起的落子（pass 用 null 坐标表示） */
  moves: Array<{ x: number | null; y: number | null; color: 1 | 2 }>;
  toPlay: 1 | 2;
  komi?: number;
  visits?: number;
}

const colorChar = (c: 1 | 2): 'B' | 'W' => (c === 1 ? 'B' : 'W');

/** 把高层局面描述编码成协议请求（纯函数，selftest 覆盖） */
export function buildAnalysisRequest(input: AnalyzeInput, id: string): AnalysisRequest {
  const stones: Array<[string, string]> = input.stones.map((s) => [
    colorChar(s.color),
    coordLabel(s.x, s.y, input.size),
  ]);
  const moves: Array<[string, string]> = input.moves.map((m) => [
    colorChar(m.color),
    m.x === null || m.y === null ? 'pass' : coordLabel(m.x, m.y, input.size),
  ]);
  return {
    id,
    initialStones: stones,
    moves,
    initialPlayer: colorChar(input.toPlay),
    rules: 'chinese',
    komi: input.komi ?? 7.5,
    boardXSize: input.size,
    boardYSize: input.size,
    maxVisits: Math.max(1, Math.round(input.visits ?? loadEngineConfig().visits ?? 200)),
    analyzeTurns: [input.moves.length],
    includeOwnership: false,
    includePolicy: false,
  };
}

/** 黑方视角胜率（协议为行棋方视角 0-1；白方行棋取补。
 *  防御：个别配置（reportAnalysisWinratesAs 非 SIDETOMOVE）下引擎报 0-100，>1.5 视为百分数） */
export function blackWinrate(winrate: number, currentPlayer: 'B' | 'W'): number {
  let v = Number.isFinite(winrate) ? winrate : 0.5;
  if (v > 1.5) v /= 100;
  v = Math.min(1, Math.max(0, v));
  return currentPlayer === 'B' ? v : 1 - v;
}

/** 黑方视角目差 */
export function blackScoreLead(scoreLead: number, currentPlayer: 'B' | 'W'): number {
  return currentPlayer === 'B' ? scoreLead : -scoreLead;
}

// ─────────────────────────────────────────────────────────────
// 打谱模式适配（M5.2b 纯函数，selftest 覆盖）
// ─────────────────────────────────────────────────────────────

/** KataGo 坐标（"Q16" / "pass"）→ 棋盘点；不在盘上返回 null */
export function kataPoint(coord: string, size: number): { x: number; y: number } | null {
  if (!/^[A-HJ-T][1-9][0-9]?$/.test(coord)) return null;
  const x = 'ABCDEFGHJKLMNOPQRST'.indexOf(coord[0]);
  const y = size - Number(coord.slice(1));
  if (x < 0 || y < 0 || y >= size) return null;
  return { x, y };
}

/**
 * 从打谱路径组装引擎输入：SGF 常规 setup 只在根节点（buildGame 保证 root.move 为 null，
 * root.board 即初始局面），路径上各节点的落子为 moves（illegal 回放节点按 pass 传递）。
 */
export function gameToAnalyzeInput(
  game: LoadedGame,
  path: GameNode[],
  current: GameNode
): AnalyzeInput {
  const size = game.info.size;
  const stones: AnalyzeInput['stones'] = [];
  const rootBoard = path[0]?.board;
  if (rootBoard) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const c = rootBoard[y]?.[x];
        if (c === 1 || c === 2) stones.push({ x, y, color: c });
      }
    }
  }
  const moves: AnalyzeInput['moves'] = [];
  for (const node of path.slice(1)) {
    if (!node.move) continue;
    const m = node.move;
    moves.push(
      m.pass || m.x < 0 || m.y < 0
        ? { x: null, y: null, color: m.color }
        : { x: m.x, y: m.y, color: m.color }
    );
  }
  const komi = Number(game.info.komi);
  return {
    size,
    stones,
    moves,
    toPlay: current.toPlay,
    komi: Number.isFinite(komi) ? komi : undefined,
  };
}

/**
 * 从做题会话组装引擎输入（M5.2c 引擎应手）：题面初始棋子为 initialStones，
 * 会话实际落子（含走出收录变化后的自由探索）为 moves，轮次取当前 toPlay。
 */
export function sessionToAnalyzeInput(s: LessonSession): AnalyzeInput {
  const size = s.lesson.size;
  const stones: AnalyzeInput['stones'] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c = s.initialBoard[y]?.[x];
      if (c === 1 || c === 2) stones.push({ x, y, color: c });
    }
  }
  return {
    size,
    stones,
    moves: s.moves.map((m) => ({ x: m.x, y: m.y, color: m.color })),
    toPlay: s.toPlay,
  };
}

// ─────────────────────────────────────────────────────────────
// 复核（对齐原版 engine.review / lesson_review：候选 vs 参考两点各做一次
// 根约束查询，给目差/胜率证据，不做生死判定、不给作答信用）
// ─────────────────────────────────────────────────────────────

export interface ReviewPointResult {
  /** 引擎被约束落下的点（应等于请求指定的点） */
  move: string;
  blackWinrate: number;
  blackScoreLead: number;
  /** 黑方视角归属预测（-1=黑…1=白；协议为数组、行棋方视角，此处已换算），长度 = size² */
  ownership?: number[];
  /** 该手之后引擎主变化 */
  pv: string[];
}

export interface ReviewResult {
  candidate: ReviewPointResult;
  reference: ReviewPointResult;
  /** 候选相对参考的黑方目差（负数 = 你的这手比参考亏） */
  scoreDelta: number;
  /** 候选相对参考的黑方胜率差（-1..1） */
  winrateDelta: number;
}

/** 构造一对根约束复核查询：同一局面分别强制首手为候选/参考（visits 与 maxTime 对齐原版 128/3 放宽为 5s） */
export function buildReviewQueries(
  input: AnalyzeInput,
  candidateMove: string,
  referenceMove: string,
  visits = 128
): [AnalysisRequest, AnalysisRequest] {
  const make = (move: string): AnalysisRequest => {
    const q = buildAnalysisRequest(input, nextQueryId('rv'));
    q.maxVisits = visits;
    q.includeOwnership = true;
    q.allowMoves = [{ player: q.initialPlayer, moves: [move], untilDepth: 1 }];
    q.overrideSettings = { maxTime: 5 };
    return q;
  };
  return [make(candidateMove), make(referenceMove)];
}

export function normalizeReviewPoint(res: AnalysisResponse): ReviewPointResult {
  const mover = res.rootInfo?.currentPlayer ?? 'B';
  const top = (res.moveInfos ?? [])
    .slice()
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))[0];
  return {
    move: top?.move ?? '',
    blackWinrate: blackWinrate(res.rootInfo?.winrate ?? 0.5, mover),
    blackScoreLead: blackScoreLead(res.rootInfo?.scoreLead ?? 0, mover),
    ownership:
      Array.isArray(res.ownership) && res.ownership.length
        ? res.ownership.map((v) => (mover === 'B' ? v : -v))
        : undefined,
    pv: top?.pv ?? [],
  };
}

export function assembleReview(candidate: AnalysisResponse, reference: AnalysisResponse): ReviewResult {
  const c = normalizeReviewPoint(candidate);
  const r = normalizeReviewPoint(reference);
  return {
    candidate: c,
    reference: r,
    scoreDelta: c.blackScoreLead - r.blackScoreLead,
    winrateDelta: c.blackWinrate - r.blackWinrate,
  };
}

/** 回放候选点主变化（前 maxN 手）得到预览盘面与手数标注；PV 不合法即停 */
export function replayPv(
  base: Board,
  size: number,
  pv: string[],
  toPlay: 1 | 2,
  maxN = 8
): { board: Board; moveNumbers: Map<number, number> } {
  let b = cloneBoard(base);
  const nums = new Map<number, number>();
  let color: 1 | 2 = toPlay;
  for (let i = 0; i < Math.min(pv.length, maxN); i++) {
    const p = kataPoint(pv[i], size);
    if (p) {
      try {
        b = play(b, p.x, p.y, color).board;
        nums.set(p.y * size + p.x, i + 1);
      } catch {
        break;
      }
    }
    color = (3 - color) as 1 | 2;
  }
  return { board: b, moveNumbers: nums };
}

/** 统一归一化响应：按 order 排序 + 黑方视角胜率/目差（M5.2b 显示用） */
export interface NormalizedMove {
  move: string;
  order: number;
  blackWinrate: number;
  blackScoreLead: number;
  visits: number;
  pv: string[];
}

export interface NormalizedAnalysis {
  blackWinrate: number;
  blackScoreLead: number;
  visits: number;
  moves: NormalizedMove[];
}

export function normalizeAnalysis(res: AnalysisResponse): NormalizedAnalysis {
  const mover = res.rootInfo?.currentPlayer ?? 'B';
  const moves = (res.moveInfos ?? [])
    .slice()
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
    .map((m) => ({
      move: m.move,
      order: m.order,
      blackWinrate: blackWinrate(m.winrate ?? 0.5, mover),
      blackScoreLead: blackScoreLead(m.scoreLead ?? 0, mover),
      visits: m.visits ?? 0,
      pv: m.pv ?? [],
    }));
  return {
    blackWinrate: blackWinrate(res.rootInfo?.winrate ?? 0.5, mover),
    blackScoreLead: blackScoreLead(res.rootInfo?.scoreLead ?? 0, mover),
    visits: res.rootInfo?.visits ?? 0,
    moves,
  };
}

// ─────────────────────────────────────────────────────────────
// EngineClient：统一接口
// ─────────────────────────────────────────────────────────────

export interface EngineClient {
  /** 就绪后分析一个局面；未就绪/已退出时 reject */
  analyze(input: AnalyzeInput): Promise<NormalizedAnalysis>;
  /** 复核：候选 vs 参考两点根约束对比（对齐原版 engine.review） */
  review(input: AnalyzeInput, candidateMove: string, referenceMove: string): Promise<ReviewResult>;
  stop(): void;
}

/** Node require 函数（宿主桌面端注入；浏览器/移动端无）。类型用 any：不依赖 @types/node */
type NodeRequireFn = (id: string) => any;

// esbuild 产物为浏览器环境包，require 不做打包转换，仅在运行时检测全局
function nodeRequire(): NodeRequireFn | undefined {
  try {
    if (typeof require === 'function') return require;
  } catch {
    /* 浏览器端引用未定义标识符不会进这里（typeof 已挡），防御宿主沙箱抛错 */
  }
  return undefined;
}

export function localEngineAvailable(): boolean {
  return nodeRequire() !== undefined;
}

/** 本地 fs 能力探测（localfs.ts 复用同一 require 探测，不做二次实现） */
export { nodeRequire };

// ─────────────────────────────────────────────────────────────
// 本地引擎：spawn katago analysis（stdin/stdout JSON 行协议）
// ─────────────────────────────────────────────────────────────

/**
 * 推断 ONNX 系后端的 onnxProvider（v1.18 起 onnx 构建必填，发行 zip 的 example cfg
 * 不一定带）。非 onnx 构建（cuda/trt/opencl/eigen 等）不需要该键——多余键会直接报错。
 * 推断依据发行包文件名惯例（如 katago-v1.18.1-onnx1.24.4-directml-windows-x64）。
 */
export function inferOnnxProvider(katagoPath: string): string | null {
  const p = katagoPath.toLowerCase();
  if (!p.includes('onnx')) return null;
  if (p.includes('directml')) return 'directml';
  if (p.includes('openvino')) return 'openvino';
  if (p.includes('tensorrt') || p.includes('-trt') || p.includes('_trt')) return 'tensorrt';
  if (p.includes('cuda')) return 'cuda';
  if (p.includes('migraphx')) return 'migraphx';
  return 'cpu';
}

/** 解析引擎配置：优先 katago 同目录的官方 analysis_example.cfg（与该二进制配套，
 *  键集必然兼容），不存在时回退到内置保守模板（只写自 v1.0 起存在的键——
 *  实测教训：numAnalysisThreads 等新键在部分发行构建里不存在，写错键名直接启动失败）。
 *  返回临时工作目录：spawn 的 cwd 设为它，logDir 用相对路径 logs（绝对路径含空格时
 *  override 值会被切碎）。其余关键项由 spawn 侧逐键 -override-config 覆盖。 */
function resolveEngineConfig(katagoPath: string): { configPath: string | null; workDir: string } {
  const req = nodeRequire();
  if (!req) return { configPath: null, workDir: '' };
  try {
    const fs = req('fs');
    const os = req('os');
    const path = req('path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'go-coach-engine-'));
    const bundled = path.join(path.dirname(katagoPath), 'analysis_example.cfg');
    if (fs.existsSync(bundled)) return { configPath: bundled, workDir: dir };
    const cfg = path.join(dir, 'analysis.cfg');
    fs.writeFileSync(
      cfg,
      [
        '# GoCoach 生成的最小 KataGo analysis 配置（仅使用最保守的老版本键）',
        'logDir = logs',
        'logAllGTPCommunication = false',
        'logSearchInfo = false',
        '',
      ].join('\n'),
      'utf8'
    );
    return { configPath: cfg, workDir: dir };
  } catch {
    return { configPath: null, workDir: '' };
  }
}

let seq = 0;
const nextQueryId = (tag: string) => `gocoach-${tag}-${Date.now().toString(36)}-${seq++}`;

interface LocalEngineHandle {
  client: EngineClient;
}

let shared: LocalEngineHandle | null = null;
let sharedStatus: EngineStatus = IDLE_STATUS;
let startingRpc = 0; // 防并发「启动」

function setStatus(patch: Partial<EngineStatus>) {
  sharedStatus = { ...sharedStatus, ...patch };
  window.dispatchEvent(new CustomEvent(EVENT_ENGINE_STATUS, { detail: sharedStatus }));
}

export function engineStatus(): EngineStatus {
  return sharedStatus;
}

/**
 * 启动本地引擎并完成就绪探测：
 * spawn 后发一个 maxVisits 极小的空盘查询做握手（同时预热模型），
 * 收到该 id 的响应即就绪；进程退出 / isFatalError → error + stderr 尾部。
 */
export function startLocalEngine(): Promise<EngineClient> {
  const cfg = loadEngineConfig();
  if (!cfg.katagoPath.trim() || !cfg.modelPath.trim()) {
    return Promise.reject(new Error('请先在设置中填写 katago 路径与模型路径。'));
  }
  const req = nodeRequire();
  if (!req) {
    return Promise.reject(new Error('当前宿主不支持子进程（无 require），请使用远程端点模式。'));
  }
  if (shared && sharedStatus.state === 'ready') return Promise.resolve(shared.client);

  const rpc = ++startingRpc;
  return new Promise((resolve, reject) => {
    let child: any;
    try {
      const { spawn } = req('child_process');
      const resolved = resolveEngineConfig(cfg.katagoPath);
      if (!resolved.configPath) throw new Error('无法确定引擎配置文件。');
      // 实测教训：多个 key=value 放进同一个 -override-config 参数时，值会被整串吞掉
      // （logDir 拿到了全部后续键）。逐键一个 -override-config（cxxopts vector 累积）才可靠。
      // 另外 v1.18 中 numSearchThreads 与 cfg 里的 numSearchThreadsPerAnalysisThread 互斥，
      // 线程数不干预，交给配套 cfg 的官方推荐值。maxTime 为慢机安全网（原版 cfg 3s，放宽到 30s）。
      const overrides: Array<[string, string]> = [
        ['logDir', 'logs'],
        ['reportAnalysisWinratesAs', 'SIDETOMOVE'],
        ['maxTime', '30'],
      ];
      if (cfg.visits > 0) overrides.push(['maxVisits', String(cfg.visits)]);
      // onnxProvider 仅 onnx 系构建需要；非 onnx 构建传了会按未知键直接报错
      const inferred = inferOnnxProvider(cfg.katagoPath);
      const provider = inferred === null ? null : cfg.onnxProvider?.trim() || inferred;
      if (provider) overrides.push(['onnxProvider', provider]);
      const args = ['analysis', '-config', resolved.configPath, '-model', cfg.modelPath];
      for (const [key, value] of overrides) args.push('-override-config', `${key}=${value}`);
      child = spawn(cfg.katagoPath, args, { shell: false, cwd: resolved.workDir || undefined });
    } catch (err) {
      const msg = `无法启动 katago：${(err as Error).message}`;
      setStatus({ state: 'error', message: msg, stderrTail: '' });
      reject(new Error(msg));
      return;
    }

    setStatus({ state: 'starting', message: '正在启动引擎（加载模型，首次可能要几十秒）…', stderrTail: '' });

    let stderrBuf = '';
    const pending = new Map<string, { resolve: (r: AnalysisResponse) => void; reject: (e: Error) => void }>();
    let stdoutBuf = '';

    const feedLine = (lineRaw: string) => {
      const line = lineRaw.trim();
      if (!line || line.startsWith('?')) return; // 控制行/空行忽略
      let obj: any;
      try {
        obj = JSON.parse(line);
      } catch {
        return; // 非 JSON（日志串扰）忽略
      }
      if (!obj || typeof obj.id !== 'string') return;
      // 搜索中的增量报告（isDuringSearch）跳过，等最终响应（对齐原版 engine._run_query）
      if (obj.isDuringSearch) return;
      const waiter = pending.get(obj.id);
      if (!waiter) return;
      pending.delete(obj.id);
      if (obj.isFatalError || obj.error) {
        waiter.reject(new Error(String(obj.error ?? '引擎报告致命错误')));
      } else {
        waiter.resolve(obj as AnalysisResponse);
      }
    };

    child.stdout?.setEncoding?.('utf8');
    child.stdout?.on?.('data', (chunk: string) => {
      stdoutBuf += chunk;
      let nl: number;
      while ((nl = stdoutBuf.indexOf('\n')) >= 0) {
        feedLine(stdoutBuf.slice(0, nl));
        stdoutBuf = stdoutBuf.slice(nl + 1);
      }
    });
    child.stderr?.setEncoding?.('utf8');
    child.stderr?.on?.('data', (chunk: string) => {
      stderrBuf = (stderrBuf + chunk).slice(-2000);
    });

    const failAll = (message: string) => {
      for (const w of pending.values()) w.reject(new Error(message));
      pending.clear();
    };

    child.on?.('error', (err: Error) => {
      const msg = `启动失败：${err.message}（检查 katago 路径；权限或杀软拦截也会报此错）`;
      setStatus({ state: 'error', message: msg, stderrTail: stderrBuf });
      failAll(msg);
      if (rpc === startingRpc) reject(new Error(msg));
      shared = null;
    });
    let suppressExitStatus = false;
    child.on?.('exit', (code: number | null) => {
      const tail = stderrBuf.split('\n').filter(Boolean).slice(-4).join(' | ');
      const msg =
        code === 0 ? '引擎已退出。' : `引擎异常退出（code ${code}）${tail ? '：' + tail : ''}`;
      if (!suppressExitStatus && sharedStatus.state !== 'off') setStatus({ state: 'error', message: msg, stderrTail: stderrBuf });
      failAll(msg);
      shared = null;
    });

    const request = (payload: AnalysisRequest): Promise<AnalysisResponse> =>
      new Promise((res, rej) => {
        pending.set(payload.id, { resolve: res, reject: rej });
        child.stdin?.write?.(JSON.stringify(payload) + '\n', (writeErr: Error | undefined) => {
          if (writeErr) {
            pending.delete(payload.id);
            rej(new Error(`写入引擎失败：${writeErr.message}`));
          }
        });
      });

    const client: EngineClient = {
      async analyze(input: AnalyzeInput): Promise<NormalizedAnalysis> {
        if (shared?.client !== client) throw new Error('引擎已停止，请重新启动。');
        const res = await request(buildAnalysisRequest(input, nextQueryId('q')));
        return normalizeAnalysis(res);
      },
      async review(input: AnalyzeInput, candidateMove: string, referenceMove: string) {
        if (shared?.client !== client) throw new Error('引擎已停止，请重新启动。');
        const [qc, qr] = buildReviewQueries(input, candidateMove, referenceMove);
        const [rc, rr] = await Promise.all([request(qc), request(qr)]);
        return assembleReview(rc, rr);
      },
      stop() {
        setStatus({ state: 'off', message: '引擎已停止', stderrTail: '' });
        try {
          child.stdin?.end?.();
        } catch {
          /* ignore */
        }
        try {
          child.kill?.();
        } catch {
          /* ignore */
        }
        shared = null;
      },
    };

    // 握手：9 路空盘 + 极小 visits，收到响应即就绪（同时预热模型）。
    // 带启动超时：大模型冷启动慢、DirectML/OpenCL 多显卡时可能卡在交互式设备选择。
    const START_TIMEOUT_MS = 150000;
    const probe: AnalysisRequest = {
      id: nextQueryId('probe'),
      initialStones: [],
      moves: [],
      initialPlayer: 'B',
      rules: 'chinese',
      komi: 7.5,
      boardXSize: 9,
      boardYSize: 9,
      maxVisits: Math.min(8, cfg.visits || 8),
      analyzeTurns: [0],
      includeOwnership: false,
      includePolicy: false,
    };
    let probeTimer: number | null = null;
    const startupTimeout = new Promise<never>((_, tmReject) => {
      probeTimer = window.setTimeout(
        () =>
          tmReject(
            new Error(
              `启动超时（${START_TIMEOUT_MS / 1000}s 无响应）。可能原因：模型大加载慢（可直接再试一次）、` +
                '后端卡在多显卡设备选择（请在命令行手动跑一次 katago benchmark 完成初始化）、或模型与后端不匹配（如 transformer 网络配了非 CUDA/TRT 后端）。'
            )
          ),
        START_TIMEOUT_MS
      );
    });
    Promise.race([request(probe), startupTimeout])
      .then(() => {
        if (probeTimer !== null) window.clearTimeout(probeTimer);
        if (rpc !== startingRpc) return;
        shared = { client };
        setStatus({ state: 'ready', message: `引擎就绪（visits ${cfg.visits || 200}）`, stderrTail: '' });
        resolve(client);
      })
      .catch((err: Error) => {
        if (probeTimer !== null) window.clearTimeout(probeTimer);
        if (rpc !== startingRpc) return;
        const msg = `引擎启动未就绪：${err.message}${stderrBuf ? '（stderr：' + stderrBuf.slice(-400) + '）' : ''}`;
        suppressExitStatus = true;
        setStatus({ state: 'error', message: msg, stderrTail: stderrBuf });
        try {
          child.kill?.();
        } catch {
          /* ignore */
        }
        reject(new Error(msg));
      });
  });
}

// ─────────────────────────────────────────────────────────────
// 远程引擎：POST 单个请求 JSON → 响应 JSON（契约同构，见 docs）
// ─────────────────────────────────────────────────────────────

const REMOTE_TIMEOUT_MS = 180000;

function remoteClient(url: string): EngineClient {
  const post = async (payload: AnalysisRequest): Promise<AnalysisResponse> => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS);
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
      const obj = (await resp.json()) as AnalysisResponse;
      if (obj.isFatalError || obj.error) throw new Error(String(obj.error ?? '引擎报告错误'));
      return obj;
    } catch (err) {
      const e = err as Error;
      throw new Error(
        e.name === 'AbortError' ? `远程分析超时（${REMOTE_TIMEOUT_MS / 1000}s）` : `远程引擎请求失败：${e.message}`
      );
    } finally {
      window.clearTimeout(timer);
    }
  };
  return {
    async analyze(input: AnalyzeInput) {
      const obj = await post(buildAnalysisRequest(input, nextQueryId('r')));
      return normalizeAnalysis(obj);
    },
    async review(input: AnalyzeInput, candidateMove: string, referenceMove: string) {
      const [qc, qr] = buildReviewQueries(input, candidateMove, referenceMove);
      const [rc, rr] = await Promise.all([post(qc), post(qr)]);
      return assembleReview(rc, rr);
    },
    stop() {
      setStatus({ state: 'off', message: '远程模式无进程', stderrTail: '' });
    },
  };
}

// ─────────────────────────────────────────────────────────────
// 门面：按配置取引擎 / 停止 / 就绪探测
// ─────────────────────────────────────────────────────────────

/** 远程模式的"单例"客户端（url 变化时由配置保存逻辑刷新） */
let remote: { url: string; client: EngineClient } | null = null;

export function remoteEngine(url: string): EngineClient {
  if (!remote || remote.url !== url) remote = { url, client: remoteClient(url) };
  return remote.client;
}

/** 按当前配置返回就绪的引擎（本地：复用或拉起；远程：懒建；off/未配置 → null） */
export async function ensureEngine(): Promise<EngineClient | null> {
  const cfg = loadEngineConfig();
  if (cfg.mode === 'remote' && cfg.remoteUrl.trim()) {
    setStatus({ state: 'ready', message: '远程端点模式（按需请求）', stderrTail: '' });
    return remoteEngine(cfg.remoteUrl.trim());
  }
  if (cfg.mode === 'local') {
    if (shared && sharedStatus.state === 'ready') return shared.client;
    if (sharedStatus.state === 'starting') return null;
    return startLocalEngine();
  }
  return null;
}

export function stopEngine() {
  if (shared) shared.client.stop();
  else setStatus({ state: 'off', message: '引擎未启用', stderrTail: '' });
}

/** 「探测」：spawn `katago version` 秒验路径（不加载模型） */
export async function probeKatago(execPath: string): Promise<string> {
  const req = nodeRequire();
  if (!req) throw new Error('当前宿主不支持子进程，无法探测本地路径。');
  return new Promise((resolve, reject) => {
    let child: any;
    try {
      const { spawn } = req('child_process');
      child = spawn(execPath, ['version'], { shell: false });
    } catch (err) {
      reject(new Error(`无法执行：${(err as Error).message}`));
      return;
    }
    let out = '';
    let errOut = '';
    const timer = window.setTimeout(() => {
      try {
        child.kill?.();
      } catch {
        /* ignore */
      }
      reject(new Error('version 探测超时（15s）'));
    }, 15000);
    child.stdout?.on?.('data', (c: string) => (out += String(c)));
    child.stderr?.on?.('data', (c: string) => (errOut += String(c)));
    child.on?.('error', (err: Error) => {
      window.clearTimeout(timer);
      reject(new Error(`无法执行：${err.message}（路径不存在或无执行权限）`));
    });
    child.on?.('close', (code: number | null) => {
      window.clearTimeout(timer);
      const first = (out || errOut).split('\n').map((s) => s.trim()).filter(Boolean)[0];
      if (code === 0 && first) resolve(first);
      else reject(new Error(`退出码 ${code}${first ? '：' + first : ''}`));
    });
  });
}

/** 插件卸载时调用：确保子进程不残留 */
export function killEngineOnUnload() {
  try {
    if (shared) shared.client.stop();
  } catch {
    /* ignore */
  }
}

export { loadEngineConfig, saveEngineConfig };
