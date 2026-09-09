// ═════════════════════════════════════════════════════════════
// 贪吃蛇引擎（纯逻辑，无 DOM，可独立测试）
//
// 复刻诺基亚 Snake II（3310 同款）的机制：
//   · 逐格离散移动，蛇自动持续前进、不可停止、不可 180° 掉头
//   · 四周边界回绕（从一侧出去、从对侧进来），迷宫墙致死
//   · 食物 +10（25 步内没吃到会换位置重刷）；每吃 5 个食物
//     出现奖励物 +50，约 6 秒后消失
//   · 每吃一个食物略微加速（×0.96），开局速度可选 1-9 档
//   · 撞墙 / 咬到自己 → Game Over（单命）；蛇占满全场 → 胜利
//
// 输入采用方向队列（至多 2 个）：一 tick 只消费一个方向，
// 快速连按两个方向会在后续两步依次生效（诺基亚手感）。
// 视图通过 rev 版本号感知状态变化，lastEvent 上报计分提示。
// ═════════════════════════════════════════════════════════════

import { COLS, ROWS, mazeWalls, type MazeId } from './levels';

export type Dir = 'up' | 'right' | 'down' | 'left';

const DELTA: Record<Dir, [number, number]> = {
  up: [0, -1],
  right: [1, 0],
  down: [0, 1],
  left: [-1, 0],
};

const OPPOSITE: Record<Dir, Dir> = {
  up: 'down',
  right: 'left',
  down: 'up',
  left: 'right',
};

export type SpeedLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export const SPEED_LEVELS: readonly SpeedLevel[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];

/** 开局速度 1-9 档对应的每步间隔（ms），取自 helpfulsheep 对原版的实测曲线 */
export const SPEED_INTERVALS: Record<SpeedLevel, number> = {
  1: 658,
  2: 478,
  3: 378,
  4: 298,
  5: 228,
  6: 178,
  7: 138,
  8: 108,
  9: 88,
};

/** 每吃一个食物，间隔 ×0.96（越吃越快） */
const SPEEDUP_PER_FOOD = 0.96;
const MIN_INTERVAL_MS = 55;

export const FOOD_POINTS = 10;
export const BONUS_POINTS = 50;
/** 每吃多少个食物出现一次奖励物 */
export const BONUS_EVERY = 5;
/** 奖励物存活时长（ms），超时消失 */
export const BONUS_TTL_MS = 6000;
/** 食物没被吃的步数上限，超时换位置 */
export const FOOD_TTL_TICKS = 25;

/** 方向输入队列上限（一 tick 消费一个） */
const MAX_PENDING = 2;

export interface Cell {
  x: number;
  y: number;
}

/** 计分事件（视图显示为战报提示） */
export interface GameEvent {
  label: string;
  points: number;
}

export type OverReason = 'wall' | 'self' | null;

export interface EngineCallbacks {
  /** 终局（含胜利）触发：战绩持久化入口 */
  onSettled?: (engine: SnakeEngine) => void;
}

export interface EngineOptions {
  maze: MazeId;
  speed: SpeedLevel;
}

export class SnakeEngine {
  readonly maze: MazeId;
  readonly speed: SpeedLevel;

  /** 迷宫墙（y 行 x 列） */
  walls: boolean[][] = [];
  /** 蛇身，头在前 */
  snake: Cell[] = [];
  /** 当前朝向（每步消费一个待转方向后更新） */
  dir: Dir = 'right';
  food: Cell | null = null;
  bonus: Cell | null = null;

  score = 0;
  /** 已吃食物数（同时驱动加速） */
  foods = 0;
  over = false;
  won = false;
  overReason: OverReason = null;
  /** 最近一次计分事件（战报提示） */
  lastEvent: GameEvent | null = null;
  /** 视图刷新版本号：任何可见状态变化 +1 */
  rev = 0;

  /** 当前实际每步间隔：基础间隔 × 0.96^已吃食物数（有下限） */
  get intervalMs(): number {
    const base = SPEED_INTERVALS[this.speed];
    return Math.max(
      MIN_INTERVAL_MS,
      Math.round(base * Math.pow(SPEEDUP_PER_FOOD, this.foods))
    );
  }

  get length(): number {
    return this.snake.length;
  }

  private pending: Dir[] = [];
  private acc = 0;
  private foodTicks = 0;
  private bonusLeft = 0;
  private cb: EngineCallbacks;

  constructor(options: EngineOptions, cb?: EngineCallbacks) {
    this.maze = options.maze;
    this.speed = options.speed;
    this.cb = cb ?? {};
    this.walls = mazeWalls(this.maze);
    // 出生走廊固定在第 6 行（所有关卡该行无墙），头朝右
    this.snake = [
      { x: 6, y: 6 },
      { x: 5, y: 6 },
      { x: 4, y: 6 },
      { x: 3, y: 6 },
    ];
    this.spawnFood(false);
  }

  // ── 输入 ───────────────────────────────────────────────────

  /**
   * 请求转向：忽略同向与 180° 掉头；队列满时忽略新输入。
   * 队列里的方向会按顺序在后续 tick 逐一生效。
   */
  turn(d: Dir): void {
    if (this.over || this.won) return;
    const last = this.pending.length ? this.pending[this.pending.length - 1] : this.dir;
    if (d === last || d === OPPOSITE[last]) return;
    if (this.pending.length >= MAX_PENDING) return;
    this.pending.push(d);
  }

  // ── 时间推进（视图的 rAF 循环每帧调用） ────────────────────

  tick(dt: number): void {
    if (this.over || this.won) return;
    this.acc += dt;
    while (this.acc >= this.intervalMs) {
      this.acc -= this.intervalMs;
      this.step();
      if (this.over || this.won) return;
    }
  }

  // ── 内部流程 ───────────────────────────────────────────────

  private step(): void {
    if (this.pending.length) this.dir = this.pending.shift()!;
    const [dx, dy] = DELTA[this.dir];
    const head = this.snake[0];
    // 四边回绕：越界从对侧进入
    const nx = (head.x + dx + COLS) % COLS;
    const ny = (head.y + dy + ROWS) % ROWS;

    if (this.walls[ny][nx]) {
      this.die('wall');
      return;
    }
    const eating = Boolean(this.food && this.food.x === nx && this.food.y === ny);
    // 咬到自己：进食时尾巴不动（整段都算身体），否则尾巴让位
    const body = eating ? this.snake : this.snake.slice(0, -1);
    if (body.some((c) => c.x === nx && c.y === ny)) {
      this.die('self');
      return;
    }

    this.snake.unshift({ x: nx, y: ny });
    if (eating) this.eatFood();
    else this.snake.pop();

    if (this.bonus && this.bonus.x === nx && this.bonus.y === ny) this.eatBonus();

    // 食物限时：超过步数未吃 → 换位置重刷
    this.foodTicks += 1;
    if (this.food && this.foodTicks > FOOD_TTL_TICKS) this.spawnFood(true);

    // 奖励物限时（按步耗折算毫秒）
    if (this.bonus) {
      this.bonusLeft -= this.intervalMs;
      if (this.bonusLeft <= 0) {
        this.bonus = null;
        this.bonusLeft = 0;
      }
    }

    this.rev++;
  }

  private eatFood(): void {
    this.score += FOOD_POINTS;
    this.foods += 1;
    this.lastEvent = { label: '食物', points: FOOD_POINTS };
    // 每 BONUS_EVERY 个食物出现一个奖励物（场上还没有且有空位时）
    if (this.foods % BONUS_EVERY === 0 && !this.bonus) {
      const cell = this.randomFreeCell(true);
      if (cell) {
        this.bonus = cell;
        this.bonusLeft = BONUS_TTL_MS;
      }
    }
    this.spawnFood(false);
  }

  private eatBonus(): void {
    this.score += BONUS_POINTS;
    this.lastEvent = { label: '奖励', points: BONUS_POINTS };
    this.bonus = null;
    this.bonusLeft = 0;
  }

  private spawnFood(excludeCurrent: boolean): void {
    const cell = this.randomFreeCell(excludeCurrent);
    if (!cell) {
      // 蛇占满全场：胜利
      this.food = null;
      this.won = true;
      this.rev++;
      this.cb.onSettled?.(this);
      return;
    }
    this.food = cell;
    this.foodTicks = 0;
  }

  private randomFreeCell(excludeFood: boolean): Cell | null {
    const free: Cell[] = [];
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (this.walls[y][x]) continue;
        if (this.snake.some((c) => c.x === x && c.y === y)) continue;
        if (this.food && excludeFood && this.food.x === x && this.food.y === y) continue;
        if (this.bonus && this.bonus.x === x && this.bonus.y === y) continue;
        free.push({ x, y });
      }
    }
    if (!free.length) return null;
    return free[Math.floor(Math.random() * free.length)];
  }

  private die(reason: Exclude<OverReason, null>): void {
    this.over = true;
    this.overReason = reason;
    this.rev++;
    this.cb.onSettled?.(this);
  }
}
