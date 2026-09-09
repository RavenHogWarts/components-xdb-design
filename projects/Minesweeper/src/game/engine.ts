// ═════════════════════════════════════════════════════════════
// 扫雷引擎（纯逻辑，无 DOM，可独立测试）
//
// 标准机制（参照经典 Minesweeper / Windows Vista 起的行为）：
//   1. 首击安全 —— 雷在第一次翻格时才布下，排除首击格及其全部邻格
//      （保证开局是零邻域；候选不足时降级为仅排除首击格）；
//   2. 洪泛展开 —— 翻开数字 0 的格子时连锁展开相邻非雷格（迭代栈，无递归）；
//   3. 和弦展开 —— 已翻开的数字格上再次点击（或双击），若其邻旗数等于
//      该数字，则翻开其余未插旗邻格（可能触雷）；
//   4. 胜利 = 翻开全部非雷格（自动给剩余雷格补旗）；失败 = 翻到雷。
// 每日一局：日期字符串哈希为种子（mulberry32），同日同难度、同首击同雷局。
// ═════════════════════════════════════════════════════════════

import {
  LEVEL_CONFIG,
  LEVEL_ORDER,
  type MineLevel,
  type MineMode,
  type MineSaveSlot,
} from '../types';

export type CellState = 'ready' | 'playing' | 'won' | 'lost';

/** 确定性 PRNG：同一种子产生同一序列（每日一局依赖此性质） */
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

/** 每日难度：按当年第几天在三档间轮换，同一天固定 */
export function dailyLevel(date: Date): MineLevel {
  const year = date.getFullYear();
  const dayOfYear = Math.floor(
    (Date.UTC(year, date.getMonth(), date.getDate()) - Date.UTC(year, 0, 0)) / 86400000
  );
  return LEVEL_ORDER[dayOfYear % LEVEL_ORDER.length];
}

export interface EngineCallbacks {
  /** 任意有效操作后触发（视图据此落存档）；终局时带 result */
  onSettled?: (state: MinesweeperEngine, result: 'won' | 'lost' | null) => void;
}

type EngineInit =
  | { save: MineSaveSlot; onSettled?: EngineCallbacks['onSettled'] }
  | {
      level: MineLevel;
      mode: MineMode;
      day: string | null;
      /** daily 用日期种子；free 传 null 则用随机种子 */
      seed: number | null;
      onSettled?: EngineCallbacks['onSettled'];
    };

export class MinesweeperEngine {
  readonly mode: MineMode;
  readonly level: MineLevel;
  readonly cols: number;
  readonly rows: number;
  readonly total: number;
  readonly mineCount: number;
  /** daily 模式的日期键（YYYY-MM-DD，本地时区） */
  readonly day: string | null;

  state: CellState = 'ready';
  /** 已翻开的非雷格索引集 */
  revealed: Set<number> = new Set();
  /** 已插旗格索引集 */
  flags: Set<number> = new Set();
  /** 触雷格（lost 时有效） */
  explodedAt = -1;
  elapsedMs = 0;

  /** 雷格索引集（布雷后有效） */
  private mines: Set<number> = new Set();
  /** 每格邻雷数（布雷后有效） */
  private numbers: number[] = [];
  private rng: () => number;
  private cb: EngineCallbacks;

  private constructor(init: EngineInit) {
    this.cb = { onSettled: init.onSettled };
    if ('save' in init) {
      const s = init.save;
      const cfg = LEVEL_CONFIG[s.level];
      this.mode = s.mode;
      this.level = s.level;
      this.cols = cfg.cols;
      this.rows = cfg.rows;
      this.total = cfg.cols * cfg.rows;
      this.mineCount = cfg.mines;
      this.day = s.day ?? null;
      this.state = s.state;
      this.revealed = new Set(s.revealed);
      this.flags = new Set(s.flags);
      this.explodedAt = s.state === 'lost' ? s.explodedAt : -1;
      this.elapsedMs = s.elapsedMs;
      if (s.placed) this.applyMines(s.mines);
      // 已恢复的局不再生成新雷：继续沿用存档布局（rng 仅备用）
      this.rng = mulberry32(seedFromString(s.savedAt));
    } else {
      const cfg = LEVEL_CONFIG[init.level];
      this.mode = init.mode;
      this.level = init.level;
      this.cols = cfg.cols;
      this.rows = cfg.rows;
      this.total = cfg.cols * cfg.rows;
      this.mineCount = cfg.mines;
      this.day = init.day;
      this.rng =
        init.seed !== null
          ? mulberry32(init.seed)
          : mulberry32((Math.random() * 0xffffffff) >>> 0);
    }
  }

  /** 自由练习新局 */
  static newFree(
    level: MineLevel,
    onSettled?: EngineCallbacks['onSettled']
  ): MinesweeperEngine {
    return new MinesweeperEngine({ level, mode: 'free', day: null, seed: null, onSettled });
  }

  /** 今日每日一局（同日同难度；同首击同雷局） */
  static newDaily(onSettled?: EngineCallbacks['onSettled']): MinesweeperEngine {
    const day = MinesweeperEngine.todayKey();
    return new MinesweeperEngine({
      level: dailyLevel(new Date()),
      mode: 'daily',
      day,
      seed: seedFromString(`minesweeper:${day}`),
      onSettled,
    });
  }

  /** 本地日期键 YYYY-MM-DD（每日局按用户本地日切分） */
  static todayKey(): string {
    const now = new Date();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${m}-${d}`;
  }

  /** 格索引 → 邻格索引列表（8 邻域，边界自动裁剪） */
  neighborsOf(idx: number): number[] {
    const r = (idx / this.cols) | 0;
    const c = idx % this.cols;
    const out: number[] = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nr >= this.rows || nc < 0 || nc >= this.cols) continue;
        out.push(nr * this.cols + nc);
      }
    }
    return out;
  }

  get placed(): boolean {
    return this.mines.size > 0;
  }

  isMine(idx: number): boolean {
    return this.mines.has(idx);
  }

  isRevealed(idx: number): boolean {
    return this.revealed.has(idx);
  }

  isFlagged(idx: number): boolean {
    return this.flags.has(idx);
  }

  /** 邻雷数（未布雷时为 0） */
  numberAt(idx: number): number {
    return this.numbers[idx] ?? 0;
  }

  /** 剩余雷数显示值（总雷数 − 已插旗数，可为负） */
  get minesLeft(): number {
    return this.mineCount - this.flags.size;
  }

  /** 翻格：未布雷时先按首击安全布雷；数字 0 洪泛展开；触雷即败 */
  reveal(idx: number): boolean {
    if (this.state === 'won' || this.state === 'lost') return false;
    if (this.flags.has(idx) || this.revealed.has(idx)) return false;
    if (!this.placed) this.placeMines(idx);

    if (this.mines.has(idx)) {
      this.state = 'lost';
      this.explodedAt = idx;
      this.notify('lost');
      return true;
    }

    // 洪泛：从 idx 出发翻开所有可达的 0 邻域区域
    const stack = [idx];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (this.revealed.has(cur) || this.mines.has(cur) || this.flags.has(cur)) continue;
      this.revealed.add(cur);
      if (this.numbers[cur] === 0) {
        for (const n of this.neighborsOf(cur)) {
          if (!this.revealed.has(n)) stack.push(n);
        }
      }
    }

    if (this.revealed.size === this.total - this.mineCount) {
      this.state = 'won';
      // 胜利自动给剩余雷格补旗（经典行为）
      for (const m of this.mines) this.flags.add(m);
      this.notify('won');
      return true;
    }
    if (this.state === 'ready') this.state = 'playing';
    this.notify(null);
    return true;
  }

  /** 和弦：已翻开的数字格上，邻旗数等于数字时翻开其余未插旗邻格 */
  chord(idx: number): boolean {
    if (this.state !== 'playing' && this.state !== 'ready') return false;
    if (!this.revealed.has(idx)) return false;
    const n = this.numbers[idx];
    if (n <= 0) return false;
    let flagged = 0;
    for (const p of this.neighborsOf(idx)) {
      if (this.flags.has(p)) flagged++;
    }
    if (flagged !== n) return false;
    let changed = false;
    for (const p of this.neighborsOf(idx)) {
      if (!this.flags.has(p) && !this.revealed.has(p) && !this.mines.has(p)) {
        // 复用洪泛：逐格 reveal（不触雷，雷格跳过——和弦误旗时的雷会单独触）
        this.reveal(p);
        changed = true;
      }
    }
    // 和弦误旗：邻格有雷且未插旗 → 直接触雷（经典行为）
    for (const p of this.neighborsOf(idx)) {
      if (!this.flags.has(p) && !this.revealed.has(p) && this.mines.has(p)) {
        this.state = 'lost';
        this.explodedAt = p;
        this.notify('lost');
        return true;
      }
    }
    if (changed) this.notify(null);
    return changed;
  }

  /** 插旗 / 拔旗：仅未翻开的格子 */
  toggleFlag(idx: number): boolean {
    if (this.state === 'won' || this.state === 'lost') return false;
    if (this.revealed.has(idx)) return false;
    if (this.flags.has(idx)) {
      this.flags.delete(idx);
    } else {
      this.flags.add(idx);
    }
    this.notify(null);
    return true;
  }

  /** 计时累加（视图每秒调用；终局后不再累计） */
  addElapsed(ms: number): void {
    if (this.state === 'won' || this.state === 'lost' || this.state === 'ready') return;
    this.elapsedMs += ms;
  }

  snapshot(): MineSaveSlot {
    return {
      v: 1,
      mode: this.mode,
      level: this.level,
      day: this.day ?? undefined,
      placed: this.placed,
      mines: [...this.mines],
      revealed: [...this.revealed],
      flags: [...this.flags],
      state: this.state,
      explodedAt: this.explodedAt,
      elapsedMs: this.elapsedMs,
      savedAt: new Date().toISOString(),
    };
  }

  // ── 内部 ───────────────────────────────────────────────────

  /** 首击布雷：排除首击格及其邻格（候选不足时仅排除首击格） */
  private placeMines(firstIdx: number): void {
    const exclude = new Set<number>([firstIdx, ...this.neighborsOf(firstIdx)]);
    if (this.total - exclude.size < this.mineCount) {
      exclude.clear();
      exclude.add(firstIdx);
    }
    const candidates: number[] = [];
    for (let i = 0; i < this.total; i++) {
      if (!exclude.has(i)) candidates.push(i);
    }
    // 洗牌取前 mineCount 个
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = (this.rng() * (i + 1)) | 0;
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    this.applyMines(candidates.slice(0, this.mineCount));
    this.state = 'playing';
  }

  /** 布雷布局落位：记录雷集并预计算邻雷数 */
  private applyMines(mineIdx: number[]): void {
    this.mines = new Set(mineIdx);
    this.numbers = new Array<number>(this.total).fill(0);
    for (const m of mineIdx) {
      for (const n of this.neighborsOf(m)) this.numbers[n]++;
    }
  }

  private notify(result: 'won' | 'lost' | null): void {
    this.cb.onSettled?.(this, result);
  }
}
