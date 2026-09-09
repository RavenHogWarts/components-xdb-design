// ═════════════════════════════════════════════════════════════
// 俄罗斯方块引擎（纯逻辑，无 DOM，可独立测试）
//
// 实现遵循 Tetris Guideline：
//   · SRS 旋转 + 踢墙（JLSTZ / I 两套偏移表，O 不踢）
//   · 7-bag 随机器；出生区在棋盘上方 4 行隐藏缓冲区
//   · 幽灵投影、暂存（Hold，每块限一次）、软降/硬降
//   · 锁定延迟 500ms + 移动重置（每块至多 15 次，降到新低点清零）
//   · 计分：单/双/三/四连消、T-Spin（三角判定）、Back-to-Back ×1.5、
//     连击、完美清空；软降 +1/格、硬降 +2/格；每 10 行升 1 级
//
// 消行采用两阶段协议（配合视图动画）：
//   1. 锁定时若构成满行 → 进入 clearing 态（保留盘面，只记录待消行）
//   2. 视图播放消行闪烁后调用 finishClear() —— 移除满行、结算入账、
//      生成下一块；无满行的锁定则一步完成。
// ═════════════════════════════════════════════════════════════

import {
  KICKS_I,
  KICKS_JLSTZ,
  PIECE_CELLS,
  SPAWN_COL,
  gravityMs,
  shuffledBag,
  softDropMs,
  type PieceType,
} from './pieces';
import type { GameSaveSlot } from '../types';

export const COLS = 10;
export const VISIBLE_ROWS = 20;
/** 棋盘上方的隐藏缓冲行：出生与踢墙的余量 */
export const HIDDEN_ROWS = 4;
export const TOTAL_ROWS = VISIBLE_ROWS + HIDDEN_ROWS;

export const LOCK_DELAY_MS = 500;
export const MAX_LOCK_RESETS = 15;

/** 棋盘格：t = 方块种类；s = 锁定序号（视图用它给刚落定的块播放脉冲） */
export interface BoardCell {
  t: PieceType;
  s: number;
}

/** 活动方块（包围盒左上角定位） */
export interface ActivePiece {
  type: PieceType;
  rot: number;
  x: number;
  y: number;
}

/** 结算事件（视图显示为战报提示） */
export interface GameEvent {
  label: string;
  points: number;
}

export type TSpinKind = 'full' | 'mini' | null;

export interface EngineCallbacks {
  /** 每块完全结算后触发（含终局）：存档 / 战绩持久化入口 */
  onSettled?: (engine: TetrisEngine) => void;
}

/** 出生行（隐藏区倒数第二行起，出生后立即下移一格进入可见区） */
const SPAWN_ROW = HIDDEN_ROWS - 2;

export class TetrisEngine {
  readonly startLevel: number;

  board: (BoardCell | null)[][] = [];
  current: ActivePiece | null = null;
  /** 接下来出场的方块（含 7-bag 补袋，恒 ≥ 8 个） */
  queue: PieceType[] = [];
  /** 当前袋剩余（存档恢复随机序列用） */
  bag: PieceType[] = [];
  holdType: PieceType | null = null;
  canHold = true;

  score = 0;
  lines = 0;
  pieces = 0;
  over = false;
  overReason: 'blockout' | 'lockout' | null = null;

  /** 待消除的满行（clearing 态；视图动画后调 finishClear） */
  clearingRows: number[] | null = null;
  /** 连击数：首次清行为 -1（无加成），连续清行 +1 */
  combo = -1;
  /** Back-to-Back：上一次消行是否为“高难”（四连消或 T-Spin 消行） */
  b2bActive = false;
  /** 锁定序号（每锁定 +1，供视图区分“刚落定”的格子） */
  lockSeq = 0;
  /** 最近一次结算事件（战报提示） */
  lastEvent: GameEvent | null = null;
  /** 视图刷新版本号：任何可见状态变化 +1 */
  rev = 0;

  private gravityAcc = 0;
  private lockTimer = 0;
  private lockResets = 0;
  /** 当前方块到过的最低行（降到新低点重置锁定重置次数） */
  private lowestRow = -99;
  private lastActionRotate = false;
  private lastKickIndex = 0;
  private lastClearCount = 0;
  private cb: EngineCallbacks;

  constructor(startLevel: number, save: GameSaveSlot | null, cb?: EngineCallbacks) {
    // 恢复局以存档中的开局等级为准（parseGameSave 已保证 ∈ [1, 15]）
    this.startLevel = save ? save.startLevel : Math.max(1, Math.round(startLevel) || 1);
    this.cb = cb ?? {};
    this.board = emptyBoard();
    if (save && this.restore(save)) return;
    this.refillQueue();
    this.spawnNext();
  }

  // ── 派生状态 ───────────────────────────────────────────────

  /** 当前等级：起始等级与消行数取大（每 10 行升 1 级） */
  get level(): number {
    return Math.max(this.startLevel, 1 + Math.floor(this.lines / 10));
  }

  get gravityInterval(): number {
    return gravityMs(this.level);
  }

  get softInterval(): number {
    return Math.min(this.gravityInterval, softDropMs(this.level));
  }

  /** 方块已触底（下一格被占） */
  get grounded(): boolean {
    const c = this.current;
    return !c || !this.fits(c.type, c.rot, c.x, c.y + 1);
  }

  /** 正处于消行动画阶段 */
  get isClearing(): boolean {
    return this.clearingRows !== null;
  }

  /** 幽灵投影：硬降后的落点行（列向最低可行位置） */
  get ghostRow(): number {
    const c = this.current;
    if (!c) return 0;
    let y = c.y;
    while (this.fits(c.type, c.rot, c.x, y + 1)) y += 1;
    return y;
  }

  /** 活动方块的绝对格子坐标 */
  cellsOf(p: ActivePiece | null = this.current): Array<[number, number]> {
    if (!p) return [];
    return PIECE_CELLS[p.type][p.rot].map(([dx, dy]) => [p.x + dx, p.y + dy]);
  }

  // ── 时间推进（视图的 rAF 循环每帧调用） ────────────────────

  /**
   * 推进重力 / 锁定计时。soft = 软降按住（提速并每格 +1 分）。
   * 触底后进入锁定倒计时；重置由成功的移动/旋转驱动（见 postMoveLock）。
   */
  tick(dt: number, soft: boolean): void {
    if (this.over || this.isClearing || !this.current) return;
    if (this.grounded) {
      this.gravityAcc = 0;
      this.lockTimer += dt;
      if (this.lockTimer >= LOCK_DELAY_MS) this.lockPiece();
      return;
    }
    this.lockTimer = 0;
    const interval = soft ? this.softInterval : this.gravityInterval;
    this.gravityAcc += dt;
    while (this.gravityAcc >= interval && this.current) {
      this.gravityAcc -= interval;
      if (!this.fits(this.current.type, this.current.rot, this.current.x, this.current.y + 1)) {
        this.gravityAcc = 0;
        break;
      }
      this.current.y += 1;
      if (soft) this.score += 1;
      this.lastActionRotate = false;
      this.trackLowest();
      this.rev++;
      if (this.grounded) {
        this.gravityAcc = 0;
        break;
      }
    }
  }

  // ── 输入操作（返回是否成功；成功即 rev++ 由视图刷新） ───────

  move(dx: 1 | -1): boolean {
    if (this.over || this.isClearing || !this.current) return false;
    const c = this.current;
    if (!this.fits(c.type, c.rot, c.x + dx, c.y)) return false;
    c.x += dx;
    this.lastActionRotate = false;
    this.postMoveLock();
    this.rev++;
    return true;
  }

  rotate(dir: 1 | -1): boolean {
    if (this.over || this.isClearing || !this.current) return false;
    const c = this.current;
    if (c.type === 'O') {
      // O 旋转恒成功但不产生位移：不重置锁定计时（防止原地转 O 无限拖时间）
      this.lastActionRotate = true;
      this.lastKickIndex = 0;
      return true;
    }
    const to = (c.rot + dir + 4) % 4;
    const table = (c.type === 'I' ? KICKS_I : KICKS_JLSTZ)[`${c.rot}${to}`];
    for (let i = 0; i < table.length; i++) {
      const [kx, ky] = table[i];
      if (this.fits(c.type, to, c.x + kx, c.y + ky)) {
        c.rot = to;
        c.x += kx;
        c.y += ky;
        this.lastActionRotate = true;
        this.lastKickIndex = i;
        this.trackLowest();
        this.postMoveLock();
        this.rev++;
        return true;
      }
    }
    return false;
  }

  hardDrop(): boolean {
    if (this.over || this.isClearing || !this.current) return false;
    const c = this.current;
    let dropped = 0;
    while (this.fits(c.type, c.rot, c.x, c.y + 1)) {
      c.y += 1;
      dropped += 1;
    }
    this.score += dropped * 2;
    // T-Spin 判定看“最后动作是否为旋转”：硬降 0 格（旋转后已触底）不破坏该标记
    if (dropped > 0) this.lastActionRotate = false;
    this.lockPiece();
    return true;
  }

  hold(): boolean {
    if (this.over || this.isClearing || !this.current || !this.canHold) return false;
    const prev = this.current.type;
    if (this.holdType) {
      const swap = this.holdType;
      this.holdType = prev;
      this.spawnPiece(swap);
    } else {
      this.holdType = prev;
      this.spawnNext();
    }
    this.canHold = false;
    this.rev++;
    return true;
  }

  /** 视图消行动画结束后调用：移除满行、结算完美清空、生成下一块 */
  finishClear(): void {
    const rows = this.clearingRows;
    if (!rows) return;
    this.clearingRows = null;
    for (const y of rows) {
      this.board.splice(y, 1);
      this.board.unshift(Array.from({ length: COLS }, () => null));
    }
    // 完美清空：整盘清干净额外加分（按本次消除行数）
    if (this.board.every((row) => row.every((cell) => cell === null))) {
      const pts = [0, 800, 1200, 1800, 2000][this.lastClearCount] * this.level;
      this.score += pts;
      if (this.lastEvent) {
        this.lastEvent = {
          label: `PERFECT CLEAR · ${this.lastEvent.label}`,
          points: this.lastEvent.points + pts,
        };
      } else {
        this.lastEvent = { label: 'PERFECT CLEAR', points: pts };
      }
    }
    this.spawnNext();
    this.rev++;
    this.cb.onSettled?.(this);
  }

  // ── 存档 ───────────────────────────────────────────────────

  /** 导出进行中的局（每块结算后由视图持久化；终局不落盘） */
  snapshot(): GameSaveSlot {
    return {
      v: 1,
      board: this.board.map((row) => row.map((c) => (c ? c.t : '.')).join('')).join(''),
      current: this.current
        ? { t: this.current.type, r: this.current.rot, x: this.current.x, y: this.current.y }
        : null,
      queue: this.queue.slice(0, 10).join(''),
      bag: this.bag.join(''),
      hold: this.holdType ?? '',
      canHold: this.canHold,
      score: this.score,
      lines: this.lines,
      pieces: this.pieces,
      startLevel: this.startLevel,
      combo: this.combo,
      b2b: this.b2bActive,
      lockSeq: this.lockSeq,
      savedAt: new Date().toISOString(),
    };
  }

  /**
   * 从存档恢复；结构不符或活动方块非法返回 false（构造函数按全新局处理）。
   * 全部在局部盘面上校验通过后才提交，失败不留半套脏状态。
   */
  private restore(save: GameSaveSlot): boolean {
    const board: (BoardCell | null)[][] = Array.from({ length: TOTAL_ROWS }, (_, y) =>
      Array.from({ length: COLS }, (_, x) => {
        const ch = save.board[y * COLS + x];
        return ch === '.' ? null : ({ t: ch, s: 0 } as BoardCell);
      })
    );
    let current: ActivePiece | null = null;
    if (save.current) {
      const p: ActivePiece = {
        type: save.current.t,
        rot: save.current.r,
        x: save.current.x,
        y: save.current.y,
      };
      if (!fitsOn(board, p.type, p.rot, p.x, p.y)) return false;
      current = p;
    }
    this.board = board;
    // 队列 / 袋 / 暂存在存档中是字母串（parseGameSave 已校验字符集）
    this.queue = [...save.queue] as PieceType[];
    this.bag = [...save.bag] as PieceType[];
    this.holdType = save.hold ? (save.hold as PieceType) : null;
    this.canHold = save.canHold;
    this.score = save.score;
    this.lines = save.lines;
    this.pieces = save.pieces;
    this.combo = save.combo;
    this.b2bActive = save.b2b;
    this.lockSeq = save.lockSeq;
    this.refillQueue();
    if (!current) this.spawnNext();
    else this.current = current;
    this.rev++;
    return true;
  }

  // ── 内部流程 ───────────────────────────────────────────────

  private fits(type: PieceType, rot: number, x: number, y: number): boolean {
    return fitsOn(this.board, type, rot, x, y);
  }

  /** 补充队列：先取完当前袋，再开新袋（保持 7-bag 语义） */
  private refillQueue(): void {
    while (this.queue.length < 8) {
      const added = this.bag.length > 0 ? this.bag.splice(0, this.bag.length) : shuffledBag();
      this.queue.push(...added);
    }
  }

  private spawnNext(): void {
    const next = this.queue.shift();
    if (!next) {
      this.refillQueue();
      return this.spawnNext();
    }
    this.refillQueue();
    this.spawnPiece(next);
  }

  /** 生成指定方块：隐藏区出生并立即下移一格（Guideline 行为） */
  private spawnPiece(type: PieceType): void {
    this.gravityAcc = 0;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.lowestRow = -99;
    this.lastActionRotate = false;
    const col = SPAWN_COL[type];
    let y = SPAWN_ROW;
    let placed = false;
    while (y >= 0) {
      if (this.fits(type, 0, col, y)) {
        placed = true;
        break;
      }
      y -= 1;
    }
    if (!placed) {
      this.gameOver('blockout');
      return;
    }
    // 出生后立即下移一格（若可行），尽快进入可见区
    const dropRow = this.fits(type, 0, col, y + 1) ? y + 1 : y;
    this.current = { type, rot: 0, x: col, y: dropRow };
    this.trackLowest();
    this.rev++;
  }

  /** 成功的移动/旋转后：触底则重置锁定计时（有次数上限） */
  private postMoveLock(): void {
    if (this.grounded) {
      if (this.lockResets < MAX_LOCK_RESETS) {
        this.lockTimer = 0;
        this.lockResets += 1;
      }
    } else {
      this.lockTimer = 0;
    }
  }

  private trackLowest(): void {
    const c = this.current;
    if (c && c.y > this.lowestRow) {
      this.lowestRow = c.y;
      this.lockResets = 0;
    }
  }

  private lockPiece(): void {
    const c = this.current;
    if (!c) return;
    const cells = this.cellsOf(c);
    const tspin = this.detectTSpin(c);
    this.lockSeq += 1;
    for (const [x, y] of cells) {
      this.board[y][x] = { t: c.type, s: this.lockSeq };
    }
    this.pieces += 1;
    this.current = null;
    this.gravityAcc = 0;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.lowestRow = -99;
    this.canHold = true;

    // 锁定溢出：整块停在隐藏区 → 终局
    if (cells.every(([, y]) => y < HIDDEN_ROWS)) {
      this.gameOver('lockout');
      return;
    }

    const full: number[] = [];
    for (let y = 0; y < TOTAL_ROWS; y++) {
      if (this.board[y].every((cell) => cell !== null)) full.push(y);
    }

    if (full.length > 0) {
      this.applyClearScore(full.length, tspin);
      this.clearingRows = full; // 视图动画后 finishClear
      this.rev++;
      return;
    }

    if (tspin) {
      // 无消行的 T-Spin 同样计分（B2B 不因此中断）
      const pts = (tspin === 'full' ? 400 : 100) * this.level;
      this.score += pts;
      this.lastEvent = { label: tspin === 'full' ? 'T-SPIN' : 'T-SPIN MINI', points: pts };
    }
    this.combo = -1;
    this.spawnNext();
    this.cb.onSettled?.(this);
  }

  /**
   * T-Spin 三角判定：最后动作是旋转，且 T 的 3×3 盒四角至少三格被占
   * （棋盘外视为被占）。两前角（朝向侧）皆占 → full；仅后角占 → mini，
   * 但用了第 5 组踢墙偏移（大幅上踢）时按 full 计。
   */
  private detectTSpin(p: ActivePiece): TSpinKind {
    if (p.type !== 'T' || !this.lastActionRotate) return null;
    const corners: Array<[number, number]> = [
      [p.x, p.y],
      [p.x + 2, p.y],
      [p.x, p.y + 2],
      [p.x + 2, p.y + 2],
    ];
    const occupied = corners.map(([x, y]) =>
      x < 0 || x >= COLS || y >= TOTAL_ROWS ? true : this.board[y][x] !== null
    );
    if (occupied.filter(Boolean).length < 3) return null;
    // 各朝向的“前两角”：rot0 朝上 → 上两角；rot1 朝右 → 右两角……
    const frontByRot: Record<number, [number, number]> = { 0: [0, 1], 1: [1, 3], 2: [2, 3], 3: [0, 2] };
    const [f1, f2] = frontByRot[p.rot];
    if (occupied[f1] && occupied[f2]) return 'full';
    return this.lastKickIndex === 4 ? 'full' : 'mini';
  }

  /** 消行计分（Guideline）：基础分 × 等级、B2B ×1.5、连击 50×连击×等级 */
  private applyClearScore(n: number, tspin: TSpinKind): void {
    this.combo += 1;
    const lvl = this.level;
    let pts: number;
    let label: string;
    let difficult: boolean;
    if (tspin === 'full') {
      pts = [0, 800, 1200, 1600, 1600][n];
      label = `T-SPIN ${['', 'SINGLE', 'DOUBLE', 'TRIPLE', 'TRIPLE'][n]}`;
      difficult = true;
    } else if (tspin === 'mini') {
      pts = [0, 200, 400, 400, 400][n];
      label = 'T-SPIN MINI';
      difficult = true;
    } else {
      pts = [0, 100, 300, 500, 800][n];
      label = ['', 'SINGLE', 'DOUBLE', 'TRIPLE', 'TETRIS'][n];
      difficult = n === 4;
    }
    const b2b = difficult && this.b2bActive;
    if (b2b) {
      pts = Math.floor(pts * 1.5);
      label = `B2B ${label}`;
    }
    this.b2bActive = difficult;
    pts *= lvl;
    let comboPts = 0;
    if (this.combo >= 1) comboPts = 50 * this.combo * lvl;
    this.score += pts + comboPts;
    this.lines += n;
    this.lastClearCount = n;
    this.lastEvent = {
      label: this.combo >= 1 ? `${label} + COMBO ×${this.combo}` : label,
      points: pts + comboPts,
    };
  }

  private gameOver(reason: 'blockout' | 'lockout'): void {
    this.over = true;
    this.overReason = reason;
    this.current = null;
    this.clearingRows = null;
    this.rev++;
    this.cb.onSettled?.(this);
  }
}

function emptyBoard(): (BoardCell | null)[][] {
  return Array.from({ length: TOTAL_ROWS }, () =>
    Array.from({ length: COLS }, () => null as BoardCell | null)
  );
}

/** 在指定盘面上判断方块（包围盒定位）是否可放置 */
function fitsOn(
  board: (BoardCell | null)[][],
  type: PieceType,
  rot: number,
  x: number,
  y: number
): boolean {
  for (const [dx, dy] of PIECE_CELLS[type][rot]) {
    const gx = x + dx;
    const gy = y + dy;
    if (gx < 0 || gx >= COLS || gy < 0 || gy >= TOTAL_ROWS) return false;
    if (board[gy][gx] !== null) return false;
  }
  return true;
}
