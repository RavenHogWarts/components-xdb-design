// ═════════════════════════════════════════════════════════════
// 数独引擎（纯逻辑，无 DOM，可独立测试）
//
// 生成采用主流「终盘 + 挖洞」管线：
//   1. generateSolution —— 随机化回溯生成一张完整终盘；
//   2. generatePuzzle   —— 按难度目标提示数挖洞，每挖一步用解计数器
//      （MRV 最少候选优先，找到 2 个解即停）校验唯一性，
//      破坏唯一性则回填；先按 180° 旋转对称成对挖（视觉经典），
//      仍高于目标时再单格补挖。
//   难度以最终提示数近似刻画：简单 40 / 中等 34 / 困难 30 / 专家 26。
// 每日一题：本地日期字符串哈希为种子（mulberry32），同日同题；
//   难度按当年第几天在四档间轮换。
// ═════════════════════════════════════════════════════════════

import {
  DIFFICULTY_ORDER,
  type SudokuDifficulty,
  type SudokuMode,
  type SudokuSaveSlot,
} from '../types';

const FULL_MASK = 0x1ff; // 1..9 全部候选位

const CLUE_TARGETS: Record<SudokuDifficulty, number> = {
  easy: 40,
  medium: 34,
  hard: 30,
  expert: 26,
};

const rowOf = (i: number) => (i / 9) | 0;
const colOf = (i: number) => i % 9;
const boxOf = (i: number) => ((rowOf(i) / 3) | 0) * 3 + ((colOf(i) / 3) | 0);

/** 每格的 20 个同区域格（行 / 列 / 宫），供高亮与铅笔联动 */
export const PEERS: number[][] = (() => {
  const out: number[][] = [];
  for (let i = 0; i < 81; i++) {
    const set = new Set<number>();
    const r = rowOf(i);
    const c = colOf(i);
    for (let k = 0; k < 9; k++) {
      set.add(r * 9 + k);
      set.add(k * 9 + c);
    }
    const br = ((r / 3) | 0) * 3;
    const bc = ((c / 3) | 0) * 3;
    for (let dr = 0; dr < 3; dr++) {
      for (let dc = 0; dc < 3; dc++) set.add((br + dr) * 9 + bc + dc);
    }
    set.delete(i);
    out.push([...set]);
  }
  return out;
})();

function popcount(x: number): number {
  let n = 0;
  while (x) {
    x &= x - 1;
    n++;
  }
  return n;
}

/** 确定性 PRNG：同一种子产生同一序列（每日一题依赖此性质） */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 字符串 → 32 位种子（xmur3 变体） */
export function seedFromString(text: string): number {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return (h ^ (h >>> 16)) >>> 0;
}

function shuffled<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** 随机化回溯生成一张完整终盘（每格候选随机洗牌，必然成功） */
function generateSolution(rng: () => number): number[] {
  const grid = new Array<number>(81).fill(0);
  const rows = new Array<number>(9).fill(0);
  const cols = new Array<number>(9).fill(0);
  const boxes = new Array<number>(9).fill(0);
  const digits = [1, 2, 3, 4, 5, 6, 7, 8, 9];

  const fill = (pos: number): boolean => {
    if (pos === 81) return true;
    const r = rowOf(pos);
    const c = colOf(pos);
    const b = boxOf(pos);
    const order = shuffled(digits, rng);
    for (const d of order) {
      const bit = 1 << (d - 1);
      if ((rows[r] | cols[c] | boxes[b]) & bit) continue;
      grid[pos] = d;
      rows[r] |= bit;
      cols[c] |= bit;
      boxes[b] |= bit;
      if (fill(pos + 1)) return true;
      grid[pos] = 0;
      rows[r] &= ~bit;
      cols[c] &= ~bit;
      boxes[b] &= ~bit;
    }
    return false;
  };

  fill(0);
  return grid;
}

/**
 * 解计数（MRV 剪枝的回溯）：grid 会被探索并在所有路径上完整还原；
 * 找到 limit 个解立即停止并向上冒泡。
 */
export function countSolutions(grid: number[], limit: number): number {
  const rows = new Array<number>(9).fill(0);
  const cols = new Array<number>(9).fill(0);
  const boxes = new Array<number>(9).fill(0);
  for (let i = 0; i < 81; i++) {
    const v = grid[i];
    if (v) {
      const bit = 1 << (v - 1);
      rows[rowOf(i)] |= bit;
      cols[colOf(i)] |= bit;
      boxes[boxOf(i)] |= bit;
    }
  }

  let count = 0;
  const rec = (): boolean => {
    // MRV：优先展开候选最少的空格，n === 1 时不可能更优，提前停扫
    let best = -1;
    let bestMask = 0;
    let bestN = 10;
    for (let i = 0; i < 81; i++) {
      if (grid[i]) continue;
      const mask = FULL_MASK & ~(rows[rowOf(i)] | cols[colOf(i)] | boxes[boxOf(i)]);
      const n = popcount(mask);
      if (n === 0) return false;
      if (n < bestN) {
        bestN = n;
        best = i;
        bestMask = mask;
        if (n === 1) break;
      }
    }
    if (best === -1) {
      count++;
      return count >= limit;
    }
    const r = rowOf(best);
    const c = colOf(best);
    const b = boxOf(best);
    let mask = bestMask;
    while (mask) {
      const bit = mask & -mask;
      mask ^= bit;
      grid[best] = 32 - Math.clz32(bit);
      rows[r] |= bit;
      cols[c] |= bit;
      boxes[b] |= bit;
      const stop = rec();
      rows[r] &= ~bit;
      cols[c] &= ~bit;
      boxes[b] &= ~bit;
      grid[best] = 0;
      if (stop) return true;
    }
    return false;
  };

  rec();
  return count;
}

/** 挖洞生成题面：先对称成对挖，不足目标再单格补挖，全程保持唯一解 */
export function generatePuzzle(
  rng: () => number,
  difficulty: SudokuDifficulty
): { puzzle: number[]; solution: number[] } {
  const solution = generateSolution(rng);
  const target = CLUE_TARGETS[difficulty];
  const puzzle = solution.slice();
  let clues = 81;

  // 第一遍：180° 旋转对称成对挖（中心格单独）
  for (const i of shuffled([...Array(41).keys()], rng)) {
    if (clues <= target) break;
    const j = 80 - i;
    const cells = i === j ? [i] : [i, j];
    const backup = cells.map((k) => puzzle[k]);
    cells.forEach((k) => {
      puzzle[k] = 0;
    });
    if (countSolutions(puzzle, 2) === 1) {
      clues -= cells.length;
    } else {
      cells.forEach((k, idx) => {
        puzzle[k] = backup[idx];
      });
    }
  }

  // 第二遍：困难/专家仍高于目标时单格补挖
  if (clues > target) {
    for (const k of shuffled([...Array(81).keys()], rng)) {
      if (clues <= target) break;
      if (!puzzle[k]) continue;
      const backup = puzzle[k];
      puzzle[k] = 0;
      if (countSolutions(puzzle, 2) === 1) {
        clues--;
      } else {
        puzzle[k] = backup;
      }
    }
  }

  return { puzzle, solution };
}

/** 每日难度：按当年第几天在四档间轮换，同一天固定 */
function dailyDifficulty(date: Date): SudokuDifficulty {
  const year = date.getFullYear();
  const dayOfYear = Math.floor(
    (Date.UTC(year, date.getMonth(), date.getDate()) - Date.UTC(year, 0, 0)) / 86400000
  );
  return DIFFICULTY_ORDER[dayOfYear % DIFFICULTY_ORDER.length];
}

// ─────────────────────────────────────────────────────────────
// 对局引擎：落子 / 铅笔 / 擦除 / 提示 / 撤销 / 快照
// 每次有效修改后触发 onSettled（视图据此落存档或结算战绩）。
// ─────────────────────────────────────────────────────────────

/** 单格变更（撤销的最小单位） */
interface CellChange {
  cell: number;
  prevVal: number;
  prevPencil: number;
  nextVal: number;
  nextPencil: number;
}

export interface SudokuEngineCallbacks {
  onSettled?: (state: SudokuEngine) => void;
}

type EngineInit =
  | { save: SudokuSaveSlot; onSettled?: SudokuEngineCallbacks['onSettled'] }
  | {
      puzzle: number[];
      solution: number[];
      mode: SudokuMode;
      difficulty: SudokuDifficulty;
      day: string | null;
      onSettled?: SudokuEngineCallbacks['onSettled'];
    };

export class SudokuEngine {
  readonly mode: SudokuMode;
  readonly difficulty: SudokuDifficulty;
  /** daily 模式的日期键（YYYY-MM-DD，本地时区） */
  readonly day: string | null;
  /** 题面，0 = 空（给定格不可修改） */
  readonly puzzle: number[];
  /** 唯一解 */
  readonly solution: number[];
  /** 玩家填入，0 = 空 */
  values: number[];
  /** 每格铅笔候选位掩码（bit d-1 → 数字 d） */
  pencils: number[];
  /** 提示填出的格（样式区分于自填） */
  hinted: Set<number>;
  hints = 0;
  elapsedMs = 0;
  solved = false;

  private history: CellChange[][] = [];
  private cb: SudokuEngineCallbacks;

  private constructor(init: EngineInit) {
    this.cb = { onSettled: init.onSettled };
    if ('save' in init) {
      const s = init.save;
      this.mode = s.mode;
      this.difficulty = s.difficulty;
      this.day = s.day ?? null;
      this.puzzle = s.puzzle.slice();
      this.solution = s.solution.slice();
      this.values = s.values.slice();
      this.pencils = s.pencils.slice();
      this.hints = s.hints;
      this.hinted = new Set(s.hinted);
      this.elapsedMs = s.elapsedMs;
      this.solved = this.isComplete();
    } else {
      this.mode = init.mode;
      this.difficulty = init.difficulty;
      this.day = init.day;
      this.puzzle = init.puzzle;
      this.solution = init.solution;
      this.values = new Array<number>(81).fill(0);
      this.pencils = new Array<number>(81).fill(0);
      this.hinted = new Set();
    }
  }

  /** 自由练习新局（随机种子） */
  static newFree(
    difficulty: SudokuDifficulty,
    onSettled?: SudokuEngineCallbacks['onSettled']
  ): SudokuEngine {
    const rng = mulberry32((Math.random() * 0xffffffff) >>> 0);
    const { puzzle, solution } = generatePuzzle(rng, difficulty);
    return new SudokuEngine({ puzzle, solution, mode: 'free', difficulty, day: null, onSettled });
  }

  /** 今日每日一题（同日同题、难度轮换） */
  static newDaily(onSettled?: SudokuEngineCallbacks['onSettled']): SudokuEngine {
    const now = new Date();
    const day = SudokuEngine.todayKey();
    const difficulty = dailyDifficulty(now);
    const { puzzle, solution } = generatePuzzle(mulberry32(seedFromString(day)), difficulty);
    return new SudokuEngine({
      puzzle,
      solution,
      mode: 'daily',
      difficulty,
      day,
      onSettled,
    });
  }

  /** 本地日期键 YYYY-MM-DD（每日题按用户本地日切分） */
  static todayKey(): string {
    const now = new Date();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${m}-${d}`;
  }

  get canUndo(): boolean {
    return this.history.length > 0;
  }

  /** 落子：给定格不可改；同数字再按一次视为擦除；自动清掉同区域该数字铅笔 */
  place(cell: number, digit: number): boolean {
    if (this.solved || this.puzzle[cell] || digit < 1 || digit > 9) return false;
    const prevVal = this.values[cell];
    const prevPencil = this.pencils[cell];
    if (prevVal === digit) {
      this.commit([{ cell, prevVal, prevPencil, nextVal: 0, nextPencil: prevPencil }]);
      return true;
    }
    const bit = 1 << (digit - 1);
    const changes: CellChange[] = [
      { cell, prevVal, prevPencil, nextVal: digit, nextPencil: 0 },
    ];
    for (const p of PEERS[cell]) {
      if (!this.values[p] && this.pencils[p] & bit) {
        changes.push({
          cell: p,
          prevVal: 0,
          prevPencil: this.pencils[p],
          nextVal: 0,
          nextPencil: this.pencils[p] & ~bit,
        });
      }
    }
    this.commit(changes);
    return true;
  }

  /** 铅笔标记：只在空格上有效，重复按取消 */
  pencil(cell: number, digit: number): boolean {
    if (this.solved || this.puzzle[cell] || this.values[cell]) return false;
    if (digit < 1 || digit > 9) return false;
    const bit = 1 << (digit - 1);
    const prevPencil = this.pencils[cell];
    const nextPencil = prevPencil ^ bit;
    if (nextPencil === prevPencil) return false;
    this.commit([{ cell, prevVal: 0, prevPencil, nextVal: 0, nextPencil }]);
    return true;
  }

  /** 擦除：有数字擦数字（保留铅笔）；没数字清铅笔 */
  erase(cell: number): boolean {
    if (this.solved || this.puzzle[cell]) return false;
    const prevVal = this.values[cell];
    const prevPencil = this.pencils[cell];
    if (!prevVal && !prevPencil) return false;
    this.commit([
      { cell, prevVal, prevPencil, nextVal: 0, nextPencil: prevVal ? prevPencil : 0 },
    ]);
    return true;
  }

  /** 提示：选中格直接填入正解（仅对空格或错格有效），计一次并联动清铅笔 */
  hint(cell: number): boolean {
    if (this.solved || this.puzzle[cell]) return false;
    if (this.values[cell] === this.solution[cell]) return false;
    const digit = this.solution[cell];
    const bit = 1 << (digit - 1);
    const changes: CellChange[] = [
      { cell, prevVal: this.values[cell], prevPencil: this.pencils[cell], nextVal: digit, nextPencil: 0 },
    ];
    for (const p of PEERS[cell]) {
      if (!this.values[p] && this.pencils[p] & bit) {
        changes.push({
          cell: p,
          prevVal: 0,
          prevPencil: this.pencils[p],
          nextVal: 0,
          nextPencil: this.pencils[p] & ~bit,
        });
      }
    }
    this.hints += 1;
    this.hinted.add(cell);
    this.commit(changes);
    return true;
  }

  /** 撤销上一步（一步 = 一组联动变更）；完成后禁止撤销避免战绩重复入账 */
  undo(): boolean {
    if (this.solved) return false;
    const changes = this.history.pop();
    if (!changes) return false;
    for (let i = changes.length - 1; i >= 0; i--) {
      const c = changes[i];
      this.values[c.cell] = c.prevVal;
      this.pencils[c.cell] = c.prevPencil;
    }
    this.notify();
    return true;
  }

  /** 计时累加（视图每秒调用；已完成的局不再累计） */
  addElapsed(ms: number): void {
    if (this.solved) return;
    this.elapsedMs += ms;
  }

  snapshot(): SudokuSaveSlot {
    return {
      v: 1,
      mode: this.mode,
      difficulty: this.difficulty,
      day: this.day ?? undefined,
      puzzle: this.puzzle.slice(),
      solution: this.solution.slice(),
      values: this.values.slice(),
      pencils: this.pencils.slice(),
      hints: this.hints,
      hinted: [...this.hinted],
      elapsedMs: this.elapsedMs,
      savedAt: new Date().toISOString(),
    };
  }

  private commit(changes: CellChange[]): void {
    for (const c of changes) {
      this.values[c.cell] = c.nextVal;
      this.pencils[c.cell] = c.nextPencil;
    }
    this.history.push(changes);
    if (this.isComplete()) this.solved = true;
    this.notify();
  }

  private isComplete(): boolean {
    for (let i = 0; i < 81; i++) {
      if ((this.puzzle[i] || this.values[i]) !== this.solution[i]) return false;
    }
    return true;
  }

  private notify(): void {
    this.cb.onSettled?.(this);
  }
}
