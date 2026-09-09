// ═════════════════════════════════════════════════════════════
// 2048 游戏引擎（纯逻辑，无 DOM，可独立测试）
//
// 移动采用两阶段协议，配合 CSS transition 呈现真实滑动感：
//   1. move(dir)   —— 计算滑动结果：所有方块（含被吞并的一方）移动到目标格，
//                     交由视图渲染触发 transform 过渡；引擎进入 staging 态。
//   2. settle()    —— 收合叠放方块（双倍值 + isMerged 脉冲）、随机生成新块、
//                     结算分数并判定胜负；每步有效移动都必须恰好 settle 一次。
// ═════════════════════════════════════════════════════════════

import { GameSaveSlot, SaveTile } from '../types';

export type Dir = 'up' | 'down' | 'left' | 'right';

export interface Tile {
  id: number;
  r: number;
  c: number;
  value: number;
  /** 本回合新生成（视图播放 pop 动画） */
  isNew?: boolean;
  /** 本回合由合并产生（视图播放 pulse 动画） */
  isMerged?: boolean;
}

/** move() 的滑动结果：absorb 块与 keep 块暂叠在同一格，等 settle 收合 */
export interface SlideResult {
  tiles: Tile[];
  moved: boolean;
  /** 预计本次滑动得分（settle 时才计入 score） */
  gained: number;
}

/** settle() 的结算结果 */
export interface SettleResult {
  tiles: Tile[];
  score: number;
  /** 本步达到胜利目标（target > 0 且首次） */
  won: boolean;
  /** 终局：满盘且无可合并 */
  over: boolean;
  /** 达到的最大方块 */
  maxTile: number;
}

export interface EngineCallbacks {
  /** 每步有效移动结算后触发（存档/战绩持久化入口） */
  onSettled?: (state: Game2048Engine) => void;
}

interface HistorySlot {
  tiles: Tile[];
  score: number;
  moves: number;
}

const SPAWN_FOUR_CHANCE = 0.1;

export class Game2048Engine {
  readonly n: number;
  /** 本局目标（0 = 无尽）；来自开局时的设置快照 */
  readonly target: number;

  tiles: Tile[] = [];
  score = 0;
  moves = 0;
  won = false;
  over = false;

  private nextId = 1;
  private history: HistorySlot | null = null;
  private staging: { gained: number; merged: Map<number, number> } | null = null;
  private cb: EngineCallbacks;

  constructor(n: number, target: number, save?: GameSaveSlot | null, cb?: EngineCallbacks) {
    this.n = n;
    this.target = target;
    this.cb = cb ?? {};
    if (save && save.n === n) {
      // 恢复进行中的一局：won 保留（避免再次弹胜利面板），动画标记不恢复
      this.tiles = save.tiles.map((t) => ({ ...t }));
      this.score = save.score;
      this.moves = save.moves;
      this.won = save.won;
      this.nextId = save.tiles.reduce((max, t) => Math.max(max, t.id), 0) + 1;
    } else {
      this.spawn();
      this.spawn();
    }
  }

  get maxTile(): number {
    return this.tiles.reduce((max, t) => Math.max(max, t.value), 0);
  }

  get canUndo(): boolean {
    return this.history !== null;
  }

  /** 是否处于 move 与 settle 之间（期间拒绝新输入） */
  get isStaging(): boolean {
    return this.staging !== null;
  }

  // ── 移动阶段 ───────────────────────────────────────────────

  /** 计算一步滑动；未产生位移返回 null（调用方不应 settle） */
  move(dir: Dir): SlideResult | null {
    if (this.over || this.staging) return null;

    // 位移判断须与遍历顺序无关：统一按字符串排序后再拼接
    const posKey = (tiles: Tile[]) =>
      tiles
        .map((t) => `${t.id}:${t.r},${t.c}`)
        .sort()
        .join('|');
    const before = posKey(this.tiles);
    const merged = new Map<number, number>(); // keepId -> absorbId
    let gained = 0;
    const out: Tile[] = [];

    const lineIndexes = this.linesOf(dir);
    for (const line of lineIndexes) {
      // 依“靠近目的地在前”排序，滑动时依次压向目的地一侧
      const lineTiles = this.tiles
        .filter((t) => line.some(([r, c]) => t.r === r && t.c === c))
        .sort((a, b) => this.along(a, dir) - this.along(b, dir));
      let slot = 0;
      let i = 0;
      while (i < lineTiles.length) {
        const cur = lineTiles[i];
        const next = lineTiles[i + 1];
        const [r, c] = this.cellAt(slot, dir, line);
        if (next && next.value === cur.value) {
          // 合并：双方都移动到目标格，settle 时吞并方消失
          const keep: Tile = { ...cur, r, c };
          const absorb: Tile = { ...next, r, c };
          merged.set(keep.id, absorb.id);
          gained += cur.value * 2;
          out.push(keep, absorb);
          i += 2;
        } else {
          out.push({ ...cur, r, c });
          i += 1;
        }
        slot += 1;
      }
    }

    const after = posKey(out);
    const moved = after !== before;
    if (!moved) return null;

    // 进入 staging 前记录撤销快照
    this.history = {
      tiles: this.tiles.map((t) => ({ ...t })),
      score: this.score,
      moves: this.moves,
    };
    this.tiles = out;
    this.staging = { gained, merged };
    return { tiles: out, moved, gained };
  }

  // ── 结算阶段 ───────────────────────────────────────────────

  /** 收合叠放方块、生成新块、结算分数与胜负；只在 move 产生位移后调用 */
  settle(): SettleResult {
    const stage = this.staging;
    if (!stage) {
      return {
        tiles: this.tiles,
        score: this.score,
        won: false,
        over: this.over,
        maxTile: this.maxTile,
      };
    }
    this.staging = null;

    // 吞并被合并方：keep 块双倍并打 isMerged 标记
    const absorbedIds = new Set(stage.merged.values());
    const tiles = this.tiles
      .filter((t) => !absorbedIds.has(t.id))
      .map((t) =>
        stage.merged.has(t.id)
          ? { ...t, value: t.value * 2, isMerged: true, isNew: false }
          : { ...t, isNew: false, isMerged: false }
      );

    this.tiles = tiles;
    this.score += stage.gained;
    this.moves += 1;

    const spawned = this.spawn();
    const won = this.target > 0 && !this.won && this.maxTile >= this.target;
    if (won) this.won = true;
    this.over = !this.hasMoves();

    this.cb.onSettled?.(this);
    return { tiles: this.tiles, score: this.score, won, over: this.over, maxTile: this.maxTile };
  }

  /** 撤销上一步（一步）；终局状态一并回退 */
  undo(): boolean {
    if (!this.history || this.staging) return false;
    this.tiles = this.history.tiles.map((t) => ({ ...t, isNew: false, isMerged: false }));
    this.score = this.history.score;
    this.moves = this.history.moves;
    this.over = false;
    this.history = null;
    return true;
  }

  /** 重开一局（清除撤销历史与胜负标记，保留 won=false 语义由新局自然获得） */
  reset(): void {
    this.tiles = [];
    this.score = 0;
    this.moves = 0;
    this.won = false;
    this.over = false;
    this.history = null;
    this.staging = null;
    this.nextId = 1;
    this.spawn();
    this.spawn();
  }

  /** 满盘后是否还存在可合并的相邻同值对 */
  hasMoves(): boolean {
    if (this.tiles.length < this.n * this.n) return true;
    const grid = this.grid();
    for (let r = 0; r < this.n; r++) {
      for (let c = 0; c < this.n; c++) {
        const v = grid[r][c];
        if ((c + 1 < this.n && grid[r][c + 1] === v) || (r + 1 < this.n && grid[r + 1][c] === v)) {
          return true;
        }
      }
    }
    return false;
  }

  /** 导出进度存档（终局时调用方应改用 clearSave 语义：不落盘） */
  snapshot(): GameSaveSlot {
    return {
      v: 1,
      n: this.n,
      target: this.target,
      tiles: this.tiles.map((t): SaveTile => ({ id: t.id, r: t.r, c: t.c, value: t.value })),
      score: this.score,
      moves: this.moves,
      won: this.won,
      savedAt: new Date().toISOString(),
    };
  }

  // ── 内部工具 ───────────────────────────────────────────────

  private grid(): number[][] {
    const grid: number[][] = Array.from({ length: this.n }, () => Array(this.n).fill(0));
    for (const t of this.tiles) grid[t.r][t.c] = t.value;
    return grid;
  }

  /** 在随机空格生成 2（90%）或 4（10%） */
  private spawn(): Tile | null {
    const empty: Array<[number, number]> = [];
    const grid = this.grid();
    for (let r = 0; r < this.n; r++) {
      for (let c = 0; c < this.n; c++) {
        if (grid[r][c] === 0) empty.push([r, c]);
      }
    }
    if (empty.length === 0) return null;
    const [r, c] = empty[Math.floor(Math.random() * empty.length)];
    const tile: Tile = {
      id: this.nextId++,
      r,
      c,
      value: Math.random() < SPAWN_FOUR_CHANCE ? 4 : 2,
      isNew: true,
    };
    this.tiles = [...this.tiles, tile];
    return tile;
  }

  /** 方块沿移动方向的有向坐标（越小越靠近目的地） */
  private along(t: Tile, dir: Dir): number {
    switch (dir) {
      case 'left':
        return t.c;
      case 'right':
        return this.n - 1 - t.c;
      case 'up':
        return t.r;
      case 'down':
        return this.n - 1 - t.r;
    }
  }

  /** 与移动方向垂直的 n 条“线”（每线是全部 n 个格坐标，顺序无关） */
  private linesOf(dir: Dir): Array<Array<[number, number]>> {
    const lines: Array<Array<[number, number]>> = [];
    for (let k = 0; k < this.n; k++) {
      const line: Array<[number, number]> = [];
      for (let i = 0; i < this.n; i++) {
        if (dir === 'left' || dir === 'right') line.push([k, i]);
        else line.push([i, k]);
      }
      lines.push(line);
    }
    return lines;
  }

  /** 线上第 slot 个落点的绝对坐标（slot 0 为最靠目的地一侧） */
  private cellAt(slot: number, dir: Dir, line: Array<[number, number]>): [number, number] {
    const anchor = dir === 'left' || dir === 'right' ? line[0][0] : line[0][1];
    switch (dir) {
      case 'left':
        return [anchor, slot];
      case 'right':
        return [anchor, this.n - 1 - slot];
      case 'up':
        return [slot, anchor];
      case 'down':
        return [this.n - 1 - slot, anchor];
    }
  }
}
