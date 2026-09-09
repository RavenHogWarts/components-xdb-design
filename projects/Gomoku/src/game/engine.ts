// ═════════════════════════════════════════════════════════════
// 五子棋引擎（纯逻辑，无 DOM，可独立测试）
//
// 规则：15×15 无禁手（自由五子棋——连成 5 子或以上即胜，含长连），
// 黑先白后交替落子；空盘落满且无人连五为和棋。
// 胜负判定只扫最后落子的行/列/两条斜线（O(4×len)），悔棋按步回退，
// 每一步都可由调用方落盘（onSettled）。
// ═════════════════════════════════════════════════════════════

import {
  BLACK,
  BOARD_SIZE,
  WHITE,
  type AiLevel,
  type GameMode,
  type GomokuSaveSlot,
  type PlayerColor,
} from '../types';

/** 终局值：0 进行中 / 1 黑胜 / 2 白胜 / 3 和棋 */
export type OverState = 0 | 1 | 2 | 3;

export interface EngineCallbacks {
  /** 每次落子后触发（视图据此落盘 / 调度 AI / 结算） */
  onMove?: (state: GomokuEngine) => void;
}

export interface Point {
  x: number;
  y: number;
}

export const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];

/** 某个颜色对应的对手颜色 */
export function opponent(c: number): number {
  return c === BLACK ? WHITE : BLACK;
}

/** 引擎状态入参：恢复存档或开新局 */
type EngineInit =
  | { save: GomokuSaveSlot; onMove?: EngineCallbacks['onMove'] }
  | {
      mode: GameMode;
      aiLevel: AiLevel;
      playerColor: PlayerColor;
      onMove?: EngineCallbacks['onMove'];
    };

export class GomokuEngine {
  readonly size = BOARD_SIZE;
  readonly mode: GameMode;
  readonly aiLevel: AiLevel;
  readonly playerColor: PlayerColor;

  /** 盘面：0 空 / 1 黑 / 2 白（行优先，idx = y * size + x） */
  grid: Uint8Array;
  /** 着法序列（idx），用于悔棋 / 胜负回放 */
  history: number[] = [];
  over: OverState = 0;

  private cb: EngineCallbacks;

  private constructor(init: EngineInit) {
    this.cb = { onMove: init.onMove };
    if ('save' in init) {
      const s = init.save;
      this.mode = s.mode;
      this.aiLevel = s.aiLevel;
      this.playerColor = s.playerColor;
      this.grid = new Uint8Array(BOARD_SIZE * BOARD_SIZE);
      this.history = [...s.moves];
      for (let i = 0; i < this.history.length; i++) {
        this.grid[this.history[i]] = (i % 2 === 0 ? BLACK : WHITE);
      }
      this.over = s.over;
    } else {
      this.mode = init.mode;
      this.aiLevel = init.aiLevel;
      this.playerColor = init.playerColor;
      this.grid = new Uint8Array(BOARD_SIZE * BOARD_SIZE);
    }
  }

  /** 按当前选项开新局 */
  static newGame(
    mode: GameMode,
    aiLevel: AiLevel,
    playerColor: PlayerColor,
    onMove?: EngineCallbacks['onMove']
  ): GomokuEngine {
    return new GomokuEngine({ mode, aiLevel, playerColor, onMove });
  }

  static fromSave(save: GomokuSaveSlot, onMove?: EngineCallbacks['onMove']): GomokuEngine {
    return new GomokuEngine({ save, onMove });
  }

  colorAt(x: number, y: number): number {
    return this.grid[y * this.size + x];
  }

  at(idx: number): number {
    return this.grid[idx];
  }

  /** 轮到落子的颜色 */
  get colorToMove(): number {
    return this.history.length % 2 === 0 ? BLACK : WHITE;
  }

  /** 人机模式下 AI 的颜色（玩家执白则 AI 执黑） */
  get aiColor(): number {
    return this.playerColor === 'black' ? WHITE : BLACK;
  }

  /** 人机模式下玩家颜色 */
  get humanColor(): number {
    return this.playerColor === 'black' ? BLACK : WHITE;
  }

  get canUndo(): boolean {
    return this.history.length > 0 && this.over === 0;
  }

  /** 黑棋步数 / 白棋步数 */
  countStones(color: number): number {
    let n = 0;
    for (let i = 0; i < this.grid.length; i++) {
      if (this.grid[i] === color) n++;
    }
    return n;
  }

  /**
   * 落子：轮到 color 落（防御校验），返回 false 表示非法。
   * 若该子形成连五 / 满盘，立即置终局。
   */
  place(x: number, y: number, color: number): boolean {
    if (this.over !== 0 || color !== this.colorToMove) return false;
    if (x < 0 || x >= this.size || y < 0 || y >= this.size) return false;
    if (this.grid[y * this.size + x] !== 0) return false;
    this.grid[y * this.size + x] = color;
    this.history.push(y * this.size + x);
    this.over = this.checkWin(x, y, color);
    if (this.over === 0 && this.history.length >= this.size * this.size) {
      this.over = 3; // 满盘和棋
    }
    this.cb.onMove?.(this);
    return true;
  }

  /** 悔棋 n 步（双人 =1；人机 =2 退回玩家回合）；终局后不可悔（直接重开） */
  undo(steps: number): boolean {
    if (this.over !== 0 || this.history.length === 0) return false;
    const n = Math.min(steps, this.history.length);
    for (let i = 0; i < n; i++) {
      const idx = this.history.pop()!;
      this.grid[idx] = 0;
    }
    this.cb.onMove?.(this);
    return true;
  }

  /**
   * 落子 (x,y,color) 后是否连五（或以上）——只检查经过该点的四条线。
   * 返回 0 或落子方颜色。
   */
  checkWin(x: number, y: number, color: number): OverState {
    for (const [dx, dy] of DIRS) {
      let count = 1;
      for (const s of [1, -1]) {
        let nx = x + dx * s;
        let ny = y + dy * s;
        while (
          nx >= 0 &&
          nx < this.size &&
          ny >= 0 &&
          ny < this.size &&
          this.grid[ny * this.size + nx] === color
        ) {
          count++;
          nx += dx * s;
          ny += dy * s;
        }
      }
      if (count >= 5) return color === BLACK ? BLACK : WHITE;
    }
    return 0;
  }

  snapshot(): GomokuSaveSlot {
    return {
      v: 1,
      mode: this.mode,
      aiLevel: this.aiLevel,
      playerColor: this.playerColor,
      moves: [...this.history],
      over: this.over,
      savedAt: new Date().toISOString(),
    };
  }
}
