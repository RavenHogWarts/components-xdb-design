// ═════════════════════════════════════════════════════════════
// 五子棋 AI（纯逻辑，无 DOM，可独立测试）
//
// 共享核心 = 棋型评估器：盘面按行/列/两条斜线切成 15+15+29+29 条线，
// 每条线缓存贡献值，落子/撤子只重算经过该点的 4 条线（增量，叶子评估 O(1)）。
// 棋型按连续段长 + 空端数分类：连五/活四/冲四/活三/眠三/活二/眠二；
// 跳型（跳三/跳冲四）需填空后成为连续威胁，由搜索深度自然覆盖（README 已注明）。
//
// 四档难度（跨机制分层）：
//   easy   只会眼前棋：自己成五就下、对方成五就堵，否则邻域内确定性乱走
//   medium 一档棋型贪心：每个候选点做一次精确增量评估（攻防同源），取最高分
//   hard   α-β 深度 4：邻域候选 + 静态启发排序 + 威胁延伸 + 节点预算
//   expert 迭代加深 α-β（2→8 层、350ms 预算）+ Zobrist 置换表 + 威胁延伸
// 威胁延伸：刚走出 ≥ 活三（含冲四/活四）时给应手方追加 2 层搜索，
// 近似 VCF 连杀视野。全部确定性：同局面同落点。
// ═════════════════════════════════════════════════════════════

import { BLACK, BOARD_SIZE, WHITE, type AiLevel } from '../types';
import { GomokuEngine, opponent, type Point } from './engine';

// ── 棋型权值（同色求和比较；胜负值必须远大于评估和） ─────────
export const SC = {
  FIVE: 10_000_000,
  LIVE_FOUR: 1_000_000,
  RUSH_FOUR: 180_000,
  LIVE_THREE: 45_000,
  SLEEP_THREE: 4_000,
  LIVE_TWO: 1_800,
  SLEEP_TWO: 150,
} as const;

export const WIN_SCORE = 1_000_000_000;

function runValue(len: number, openEnds: number): number {
  if (len >= 5) return SC.FIVE;
  switch (len) {
    case 4:
      return openEnds >= 2 ? SC.LIVE_FOUR : openEnds === 1 ? SC.RUSH_FOUR : 0;
    case 3:
      return openEnds >= 2 ? SC.LIVE_THREE : openEnds === 1 ? SC.SLEEP_THREE : 0;
    case 2:
      return openEnds >= 2 ? SC.LIVE_TWO : openEnds === 1 ? SC.SLEEP_TWO : 0;
    default:
      return 0;
  }
}

// Zobrist 表：每格 × 两色的随机 32 位（模块加载一次，进程内稳定即可）
const ZOB: number[][] = (() => {
  const rand = () => (Math.random() * 0xffffffff) >>> 0;
  const table: number[][] = [];
  for (let i = 0; i < BOARD_SIZE * BOARD_SIZE; i++) {
    table.push([rand() || 1, rand() || 1]);
  }
  return table;
})();

// ── 增量棋型评估器（搜索局面） ──────────────────────────────

export class SearchBoard {
  readonly grid: Uint8Array;
  stones: number;
  blackTotal = 0;
  whiteTotal = 0;
  /** 刚落子是否连五（place 后有效，unplace 清除） */
  fiveOnLastPlace = false;
  /** 刚落子形成的最大威胁分（落子方视角，place 后有效） */
  lastThreat = 0;
  /** Zobrist 哈希（随 place/unplace 增量维护） */
  hash = 0;

  // 每条线的黑白贡献缓存：h: y | v: x | d1: x-y+14 | d2: x+y
  private lb = {
    h: new Float64Array(BOARD_SIZE),
    v: new Float64Array(BOARD_SIZE),
    d1: new Float64Array(BOARD_SIZE * 2 - 1),
    d2: new Float64Array(BOARD_SIZE * 2 - 1),
  };
  private lw = {
    h: new Float64Array(BOARD_SIZE),
    v: new Float64Array(BOARD_SIZE),
    d1: new Float64Array(BOARD_SIZE * 2 - 1),
    d2: new Float64Array(BOARD_SIZE * 2 - 1),
  };
  private tracking = false;
  private lastPlacedColor = 0;

  constructor(grid: Uint8Array) {
    this.grid = grid.slice();
    this.stones = 0;
    for (let i = 0; i < this.grid.length; i++) {
      const c = this.grid[i];
      if (c) {
        this.stones++;
        this.hash ^= ZOB[i][c === BLACK ? 0 : 1];
      }
    }
    for (let y = 0; y < BOARD_SIZE; y++) {
      this.initLine(this.rowCells(y), this.lb.h, this.lw.h, y);
    }
    for (let x = 0; x < BOARD_SIZE; x++) {
      this.initLine(this.colCells(x), this.lb.v, this.lw.v, x);
    }
    for (let k = 0; k < BOARD_SIZE * 2 - 1; k++) {
      this.initLine(this.d1Cells(k), this.lb.d1, this.lw.d1, k);
      this.initLine(this.d2Cells(k), this.lb.d2, this.lw.d2, k);
    }
  }

  /** 相对 side 的局面分（黑视角 = 黑总值 − 白总值） */
  evalFor(side: number): number {
    return side === BLACK ? this.blackTotal - this.whiteTotal : this.whiteTotal - this.blackTotal;
  }

  place(x: number, y: number, color: number): void {
    const idx = y * BOARD_SIZE + x;
    this.grid[idx] = color;
    this.stones++;
    this.hash ^= ZOB[idx][color === BLACK ? 0 : 1];
    this.fiveOnLastPlace = false;
    this.lastThreat = 0;
    this.lastPlacedColor = color;
    this.tracking = true;
    this.refreshThrough(x, y);
    this.tracking = false;
  }

  unplace(x: number, y: number): void {
    const idx = y * BOARD_SIZE + x;
    const c = this.grid[idx];
    this.grid[idx] = 0;
    this.stones--;
    this.hash ^= ZOB[idx][c === BLACK ? 0 : 1];
    this.fiveOnLastPlace = false;
    this.lastThreat = 0;
    this.tracking = false;
    this.refreshThrough(x, y);
  }

  /** 重算经过 (x,y) 的 4 条线并同步总值 */
  private refreshThrough(x: number, y: number): void {
    this.refresh(this.lb.h, this.lw.h, y, this.rowCells(y));
    this.refresh(this.lb.v, this.lw.v, x, this.colCells(x));
    this.refresh(this.lb.d1, this.lw.d1, x - y + BOARD_SIZE - 1, this.d1Cells(x - y + BOARD_SIZE - 1));
    this.refresh(this.lb.d2, this.lw.d2, x + y, this.d2Cells(x + y));
  }

  private refresh(
    bCache: Float64Array,
    wCache: Float64Array,
    key: number,
    cells: number[]
  ): void {
    this.blackTotal -= bCache[key];
    this.whiteTotal -= wCache[key];
    const res = this.scanLine(cells);
    bCache[key] = res.b;
    wCache[key] = res.w;
    this.blackTotal += res.b;
    this.whiteTotal += res.w;
  }

  private initLine(
    cells: number[],
    bCache: Float64Array,
    wCache: Float64Array,
    key: number
  ): void {
    const res = this.scanLine(cells);
    bCache[key] = res.b;
    wCache[key] = res.w;
    this.blackTotal += res.b;
    this.whiteTotal += res.w;
  }

  /** 扫描一条线：黑/白各段连续棋形分；跟踪模式记录连五与最大威胁 */
  private scanLine(cells: number[]): { b: number; w: number } {
    let b = 0;
    let w = 0;
    const n = cells.length;
    let i = 0;
    while (i < n) {
      const c = this.grid[cells[i]];
      if (!c) {
        i++;
        continue;
      }
      let j = i + 1;
      while (j < n && this.grid[cells[j]] === c) j++;
      const len = j - i;
      const open =
        (i > 0 && this.grid[cells[i - 1]] === 0 ? 1 : 0) +
        (j < n && this.grid[cells[j]] === 0 ? 1 : 0);
      const v = runValue(len, open);
      if (c === BLACK) b += v;
      else w += v;
      if (this.tracking && c === this.lastPlacedColor) {
        if (len >= 5) this.fiveOnLastPlace = true;
        if (v > this.lastThreat) this.lastThreat = v;
      }
      i = j;
    }
    return { b, w };
  }

  private rowCells(y: number): number[] {
    const out: number[] = [];
    for (let x = 0; x < BOARD_SIZE; x++) out.push(y * BOARD_SIZE + x);
    return out;
  }

  private colCells(x: number): number[] {
    const out: number[] = [];
    for (let y = 0; y < BOARD_SIZE; y++) out.push(y * BOARD_SIZE + x);
    return out;
  }

  private d1Cells(k: number): number[] {
    // x - y = k - 14
    const x0 = Math.max(0, k - (BOARD_SIZE - 1));
    const y0 = Math.max(0, BOARD_SIZE - 1 - k);
    const out: number[] = [];
    let x = x0;
    let y = y0;
    while (x < BOARD_SIZE && y < BOARD_SIZE) {
      out.push(y * BOARD_SIZE + x);
      x++;
      y++;
    }
    return out;
  }

  private d2Cells(k: number): number[] {
    // x + y = k
    const x0 = Math.max(0, k - (BOARD_SIZE - 1));
    const y0 = Math.min(k, BOARD_SIZE - 1);
    const out: number[] = [];
    let x = x0;
    let y = y0;
    while (x < BOARD_SIZE && y >= 0) {
      out.push(y * BOARD_SIZE + x);
      x++;
      y--;
    }
    return out;
  }
}

// ── 候选生成与启发 ──────────────────────────────────────────

/** 空点邻域候选（与任一棋子切比雪夫距离 ≤ 2）；开局势单列 */
function candidates(sb: SearchBoard, color: number, limit: number): number[] {
  if (sb.stones === 0) return [BOARD_SIZE * 7 + 7];
  if (sb.stones === 1) {
    const other = sb.grid.indexOf(color === BLACK ? WHITE : BLACK);
    const fx = other % BOARD_SIZE;
    const fy = (other / BOARD_SIZE) | 0;
    const out: number[] = [];
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = fx + dx;
        const y = fy + dy;
        if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) continue;
        if (sb.grid[y * BOARD_SIZE + x] === 0) out.push(y * BOARD_SIZE + x);
      }
    }
    return out.sort((a, b) => a - b).slice(0, limit);
  }
  const out: number[] = [];
  for (let i = 0; i < sb.grid.length; i++) {
    if (sb.grid[i]) continue;
    const x = i % BOARD_SIZE;
    const y = (i / BOARD_SIZE) | 0;
    let near = false;
    outer: for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= BOARD_SIZE || ny < 0 || ny >= BOARD_SIZE) continue;
        if (sb.grid[ny * BOARD_SIZE + nx]) {
          near = true;
          break outer;
        }
      }
    }
    if (near) out.push(i);
  }
  const scored = out
    .map((idx) => ({ idx, s: lightScore(sb, idx, color) }))
    .sort((a, b) => b.s - a.s || a.idx - b.idx);
  return scored.slice(0, limit).map((e) => e.idx);
}

/** 静态启发：数经过该点的四条线上各色最长连续段，粗估攻防价值 */
function lightScore(sb: SearchBoard, idx: number, color: number): number {
  const x = idx % BOARD_SIZE;
  const y = (idx / BOARD_SIZE) | 0;
  const opp = opponent(color);
  const dirs: ReadonlyArray<readonly [number, number]> = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ];
  let my = 0;
  let op = 0;
  for (const [dx, dy] of dirs) {
    for (const c of [color, opp]) {
      let total = 1;
      for (const s of [1, -1]) {
        let nx = x + dx * s;
        let ny = y + dy * s;
        while (
          nx >= 0 &&
          nx < BOARD_SIZE &&
          ny >= 0 &&
          ny < BOARD_SIZE &&
          sb.grid[ny * BOARD_SIZE + nx] === c
        ) {
          total++;
          nx += dx * s;
          ny += dy * s;
        }
      }
      if (c === color) my = Math.max(my, total);
      else op = Math.max(op, total);
    }
  }
  const w = (n: number) => (n >= 4 ? 10000 : n === 3 ? 900 : n === 2 ? 60 : 0);
  return w(Math.min(my, 4)) + Math.floor(w(Math.min(op, 4)) * 0.9);
}

/** 落子后的精确增量分（贪心/根排序用）：落子 → 评估 → 撤子 */
function placeDelta(sb: SearchBoard, idx: number, color: number): number {
  const x = idx % BOARD_SIZE;
  const y = (idx / BOARD_SIZE) | 0;
  const before = sb.evalFor(color);
  sb.place(x, y, color);
  const after = sb.evalFor(color);
  sb.unplace(x, y);
  return after - before;
}

// ── α-β 搜索 ────────────────────────────────────────────────

interface SearchOptions {
  depth: number;
  maxCands: number;
  nodeBudget: number;
  /** 时间预算 ms（>0 = 迭代加深模式） */
  timeMs: number;
  extend: number;
  maxPly: number;
  useTT: boolean;
}

const LEVEL_OPTS: Record<AiLevel, SearchOptions> = {
  easy: { depth: 0, maxCands: 8, nodeBudget: 0, timeMs: 0, extend: 0, maxPly: 0, useTT: false },
  medium: { depth: 1, maxCands: 16, nodeBudget: 0, timeMs: 0, extend: 0, maxPly: 0, useTT: false },
  hard: { depth: 4, maxCands: 14, nodeBudget: 500_000, timeMs: 0, extend: 2, maxPly: 8, useTT: false },
  expert: { depth: 8, maxCands: 16, nodeBudget: 2_000_000, timeMs: 350, extend: 2, maxPly: 12, useTT: true },
};

class TimeoutError extends Error {}

interface TtEntry {
  depth: number;
  score: number;
  flag: 0 | 1 | 2; // exact / lower(β 截断) / upper(全低于 α)
  move: number;
}

export class AlphaBeta {
  private sb: SearchBoard;
  private opts: SearchOptions;
  private nodes = 0;
  private t0 = 0;
  private tt: Map<number, TtEntry> = new Map();

  constructor(sb: SearchBoard, opts: SearchOptions) {
    this.sb = sb;
    this.opts = opts;
  }

  /** 最优着法 idx；无空点返回 -1。超时/超预算时返回已完成深度/贪心的最优 */
  search(color: number): number {
    this.t0 = performance.now();
    const moves = candidates(this.sb, color, this.opts.maxCands);
    if (moves.length === 0) return -1;
    if (this.opts.timeMs > 0) {
      let best = moves[0];
      for (let d = 1; d <= this.opts.depth; d++) {
        let done: number;
        try {
          done = this.iteration(moves, color, d, best);
        } catch (err) {
          if (!(err instanceof TimeoutError)) throw err;
          break; // 超时：用上一层（或第一候选）的结果
        }
        best = done;
      }
      return best;
    }
    try {
      return this.iteration(moves, color, this.opts.depth, moves[0]);
    } catch (err) {
      if (!(err instanceof TimeoutError)) throw err;
      return -1; // 单层搜索超预算：由调用方兜底
    }
  }

  /** 固定深度的一轮根搜索（rootMove 提为候选首位 = 上一层最优） */
  private iteration(moves: number[], color: number, depth: number, rootMove: number): number {
    const ordered = [...moves];
    const i = ordered.indexOf(rootMove);
    if (i > 0) {
      ordered.splice(i, 1);
      ordered.unshift(rootMove);
    }
    let alpha = -Infinity;
    let bestMove = ordered[0];
    for (const m of ordered) {
      this.makeMove(m, color);
      let v: number;
      if (this.sb.fiveOnLastPlace) {
        v = Infinity;
      } else {
        v = -this.negamax(opponent(color), depth - 1, -Infinity, -alpha, 1);
      }
      this.undoMove(m, color);
      if (v > alpha) {
        alpha = v;
        bestMove = m;
        if (alpha === Infinity) break;
      }
      this.checkBudget();
    }
    return bestMove;
  }

  /** negamax（fail-soft + 置换表 + 威胁延伸） */
  private negamax(color: number, depth: number, alpha: number, beta: number, ply: number): number {
    // 节点级预算：每 2048 节点检查一次时间/节点上限
    if ((++this.nodes & 0x7ff) === 0) this.checkBudget();
    if (depth <= 0 || ply >= this.opts.maxPly) {
      return this.sb.evalFor(color);
    }
    // 置换表
    let ttMove = -1;
    if (this.opts.useTT) {
      const e = this.tt.get(this.sb.hash);
      if (e && e.depth >= depth) {
        if (e.flag === 0) return e.score;
        if (e.flag === 1 && e.score >= beta) return e.score;
        if (e.flag === 2 && e.score <= alpha) return e.score;
        ttMove = e.move;
      }
    }
    const moves = candidates(this.sb, color, this.opts.maxCands);
    if (ttMove >= 0) {
      const ti = moves.indexOf(ttMove);
      if (ti > 0) {
        moves.splice(ti, 1);
        moves.unshift(ttMove);
      }
    }
    if (moves.length === 0) return this.sb.evalFor(color);

    const origAlpha = alpha;
    let best = -Infinity;
    let bestMove = moves[0];
    for (const m of moves) {
      this.makeMove(m, color);
      let v: number;
      if (this.sb.fiveOnLastPlace) {
        v = WIN_SCORE - ply; // 越早赢分越高
      } else {
        // 威胁延伸：己方刚走出 ≥ 活三 且本层已到底 → 给应手方追加 EXT 层
        let ext = 0;
        if (this.opts.extend > 0 && depth === 1 && this.sb.lastThreat >= SC.LIVE_THREE) {
          ext = this.opts.extend;
        }
        v = -this.negamax(opponent(color), depth - 1 + ext, -beta, -alpha, ply + 1);
      }
      this.undoMove(m, color);
      if (v > best) {
        best = v;
        bestMove = m;
      }
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    if (this.opts.useTT) {
      const flag: 0 | 1 | 2 = alpha >= beta ? 1 : best <= origAlpha ? 2 : 0;
      const entry = { depth, score: best, flag, move: bestMove };
      const prev = this.tt.get(this.sb.hash);
      if (!prev || prev.depth <= depth) this.tt.set(this.sb.hash, entry);
      if (this.tt.size > 300_000) this.tt.clear();
    }
    return best;
  }

  private makeMove(idx: number, color: number): void {
    this.sb.place(idx % BOARD_SIZE, (idx / BOARD_SIZE) | 0, color);
  }

  private undoMove(idx: number, _color: number): void {
    this.sb.unplace(idx % BOARD_SIZE, (idx / BOARD_SIZE) | 0);
  }

  private checkBudget(): void {
    // 每 2048 节点查一次：时间与节点双预算（粒度太粗会拖到秒级才中断）
    if (this.opts.nodeBudget > 0 && this.nodes > this.opts.nodeBudget) {
      throw new TimeoutError();
    }
    if (this.opts.timeMs > 0 && performance.now() - this.t0 > this.opts.timeMs) {
      throw new TimeoutError();
    }
  }
}

// ── 对外入口 ────────────────────────────────────────────────

/**
 * AI 选点：终局或无空点返回 null。
 * @param timeMs 覆盖专家档时间预算（测试可加大）
 */
export function chooseAiMove(engine: GomokuEngine, level: AiLevel, timeMs?: number): Point | null {
  if (engine.over !== 0 || engine.history.length >= BOARD_SIZE * BOARD_SIZE) return null;
  const color = engine.colorToMove;
  const sb = new SearchBoard(engine.grid);

  // easy：即时成五 / 挡对方成五，否则邻域内确定性乱走
  if (level === 'easy') {
    const cands = candidates(sb, color, 512);
    if (cands.length === 0) return null;
    for (const m of cands) {
      const x = m % BOARD_SIZE;
      const y = (m / BOARD_SIZE) | 0;
      sb.place(x, y, color);
      const win = sb.fiveOnLastPlace;
      sb.unplace(x, y);
      if (win) return { x, y };
    }
    const opp = opponent(color);
    for (const m of cands) {
      const x = m % BOARD_SIZE;
      const y = (m / BOARD_SIZE) | 0;
      sb.place(x, y, opp);
      const win = sb.fiveOnLastPlace;
      sb.unplace(x, y);
      if (win) return { x, y };
    }
    if (sb.stones < 2) {
      // 空盘走天元；首子已占天元时退回邻域第一候选（否则会落回已占点卡死）
      const center = BOARD_SIZE * 7 + 7;
      if (sb.grid[center] === 0) return { x: 7, y: 7 };
      const pick = cands[0];
      if (pick !== undefined) return { x: pick % BOARD_SIZE, y: (pick / BOARD_SIZE) | 0 };
    }
    const seed = ((engine.history[engine.history.length - 1] ?? 112) * 7 + 13) % cands.length;
    const pick = cands[seed];
    return { x: pick % BOARD_SIZE, y: (pick / BOARD_SIZE) | 0 };
  }

  // medium：一档棋型贪心（精确增量评估，攻防同源）；
  // 前置两个即时硬约束：自己成五必下，对方下一步成五必堵（冲四防线）
  if (level === 'medium') {
    const cands = candidates(sb, color, 64);
    for (const m of cands) {
      const x = m % BOARD_SIZE;
      const y = (m / BOARD_SIZE) | 0;
      sb.place(x, y, color);
      const win = sb.fiveOnLastPlace;
      sb.unplace(x, y);
      if (win) return { x, y };
    }
    const opp = opponent(color);
    for (const m of cands) {
      const x = m % BOARD_SIZE;
      const y = (m / BOARD_SIZE) | 0;
      sb.place(x, y, opp);
      const win = sb.fiveOnLastPlace;
      sb.unplace(x, y);
      if (win) return { x, y };
    }
    let bestIdx = -1;
    let bestVal = -Infinity;
    for (const m of cands) {
      const v = placeDelta(sb, m, color);
      if (v > bestVal) {
        bestVal = v;
        bestIdx = m;
      }
    }
    if (bestIdx < 0) return null;
    return { x: bestIdx % BOARD_SIZE, y: (bestIdx / BOARD_SIZE) | 0 };
  }

  // hard / expert：α-β
  const opts = { ...LEVEL_OPTS[level] };
  if (timeMs !== undefined) opts.timeMs = timeMs;
  const solver = new AlphaBeta(sb, opts);
  let bestIdx = -1;
  try {
    bestIdx = solver.search(color);
  } catch (err) {
    if (!(err instanceof TimeoutError)) throw err;
  }
  if (bestIdx < 0) {
    // 兜底：在全新盘面上做贪心（搜索超时抛异常时可能已污染共享局面）
    const fresh = new SearchBoard(engine.grid);
    const cands = candidates(fresh, color, 32);
    let bv = -Infinity;
    for (const m of cands) {
      const v = placeDelta(fresh, m, color);
      if (v > bv) {
        bv = v;
        bestIdx = m;
      }
    }
  }
  if (bestIdx < 0) return null;
  return { x: bestIdx % BOARD_SIZE, y: (bestIdx / BOARD_SIZE) | 0 };
}
