// 确定性围棋规则引擎（移植自 go-coach go_rules.py，纯函数无 DOM）。
// 规则：禁自杀、全局同形禁着（positional superko，pass 豁免）、
// 落子后先提对方无气棋块，再检查己方棋块是否有气。

import type { Board, Color, Point, Stone } from './types';

/** 与棋盘同尺寸的空盘 */
export function emptyBoard(size: number): Board {
  return Array.from({ length: size }, () => Array<Color>(size).fill(0));
}

/** 从初始棋子列表构造棋盘（重复放置抛错） */
export function boardFromStones(size: number, stones: readonly Stone[]): Board {
  const board = emptyBoard(size);
  for (const { x, y, color } of stones) {
    if (board[y][x]) throw new Error('同一点重复放置棋子。');
    board[y][x] = color;
  }
  return board;
}

/** 上下左右相邻点（棋盘内） */
export function neighbors(board: Board, x: number, y: number): Point[] {
  const n = board.length;
  const out: Point[] = [];
  for (const [a, b] of [
    [x - 1, y],
    [x + 1, y],
    [x, y - 1],
    [x, y + 1],
  ] as Array<[number, number]>) {
    if (a >= 0 && a < n && b >= 0 && b < n) out.push({ x: a, y: b });
  }
  return out;
}

/** 棋块与气：同色相连的整体 + 去重后的空点（斜对角不算气） */
export function group(
  board: Board,
  x: number,
  y: number
): { stones: Point[]; liberties: Point[] } {
  const color = board[y][x];
  if (!color) return { stones: [], liberties: [] };
  const stoneSet = new Set<number>();
  const libSet = new Set<number>();
  const pending: Array<[number, number]> = [[x, y]];
  const n = board.length;
  while (pending.length) {
    const [px, py] = pending.pop()!;
    const key = py * n + px;
    if (stoneSet.has(key)) continue;
    stoneSet.add(key);
    for (const { x: a, y: b } of neighbors(board, px, py)) {
      const k = b * n + a;
      if (board[b][a] === 0) libSet.add(k);
      else if (board[b][a] === color && !stoneSet.has(k)) pending.push([a, b]);
    }
  }
  const toPoint = (k: number): Point => ({ x: k % n, y: Math.floor(k / n) });
  const byPos = (p: Point, q: Point) => (p.y - q.y) || (p.x - q.x);
  return {
    stones: [...stoneSet].map(toPoint).sort(byPos),
    liberties: [...libSet].map(toPoint).sort(byPos),
  };
}

/** 局面键（superko 比较用） */
export function boardKey(board: Board): string {
  return board.map((row) => row.join('')).join('/');
}

export interface PlayResult {
  board: Board;
  /** 本手提掉的棋子数 */
  captured: number;
}

/**
 * 落子：非法（越界 / 占用 / 自杀 / 全局同形）抛 Error，消息面向用户。
 * seen 为历史局面键（含当前局面），用于全局同形禁着判定。
 */
export function play(
  board: Board,
  x: number,
  y: number,
  color: 1 | 2,
  seen: readonly string[] = []
): PlayResult {
  const n = board.length;
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= n || y < 0 || y >= n) {
    throw new Error('落子坐标不在棋盘内。');
  }
  if (board[y][x]) throw new Error('这里已经有棋子，请选空交叉点。');
  const out: Board = board.map((row) => row.slice() as Color[]);
  out[y][x] = color;
  let captured = 0;
  for (const { x: a, y: b } of neighbors(out, x, y)) {
    if (out[b][a] === 3 - color) {
      const { stones, liberties } = group(out, a, b);
      if (!liberties.length) {
        captured += stones.length;
        for (const s of stones) out[s.y][s.x] = 0;
      }
    }
  }
  if (!group(out, x, y).liberties.length) {
    throw new Error('这一步会让自己的棋没有气，不能下。');
  }
  const key = boardKey(out);
  if (seen.includes(key)) {
    throw new Error('不能立即还原已出现的局面（全局同形禁着规则）。');
  }
  return { board: out, captured };
}

/** SGF 坐标 ↔ 数值坐标（字母跳过 I 只影响显示，SGF 用 a-s 连续字母） */
export const SGF_COLS = 'abcdefghijklmnopqrs';

export function coordLabel(x: number, y: number, size: number): string {
  const letters = 'ABCDEFGHJKLMNOPQRST'; // 显示坐标跳过 I
  return letters[x] + String(size - y);
}

export function cloneBoard(board: Board): Board {
  return board.map((row) => row.slice() as Color[]);
}
