/** @jsxImportSource react */
// 围棋棋盘：SVG 网格线 + 绝对定位棋子/标记层，9/19 路自适应。
// 几何与 Gomoku 视图同思路：线区四周留固定百分比边距，线与落点共用坐标系。
// 点击/悬停按事件坐标换算最近交叉点（不渲染逐点热区，19 路也可控）。

import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { CSS_PREFIX } from '../types';
import type { Board as BoardData, Mark, Point } from '../go/types';

export interface BoardInspect {
  stones: Set<number>;
  liberties: Set<number>;
}

export interface GoBoardProps {
  size: number;
  board: BoardData;
  marks?: Mark[];
  lastMove?: Point | null;
  /** 交叉点 idx（y*size+x）→ 手数 */
  moveNumbers?: Map<number, number> | null;
  showCoords?: boolean;
  /** 试下分支上的棋子 idx 集合（蓝色描边区分） */
  trialSet?: Set<number> | null;
  inspect?: BoardInspect | null;
  /** 「看答案」高亮点 */
  answerPoints?: Set<number> | null;
  /** 悬停预览颜色；null 表示当前不可落子 */
  ghostColor?: 1 | 2 | null;
  onPlay?: (x: number, y: number) => void;
  boardState?: 'default' | 'solved' | 'wrong';
}

// 线区边距（百分比）：19 路边缘棋子与坐标文字共用这一圈留白
const PAD = 4.2;
const SPAN = 100 - PAD * 2;

const pct = (k: number, size: number): number => PAD + (k * SPAN) / (size - 1);
/** SVG viewBox 为 0–1000，百分比坐标 ×10 后使用 */
const svgCoord = (k: number, size: number): string => (pct(k, size) * 10).toFixed(2);

/** 星位：≥15 路九星（3/中/n-4），9/13 路五星（四角 + 天元），偶数路无天元 */
function starPoints(size: number): Array<[number, number]> {
  if (size >= 15 && size % 2 === 1) {
    const mid = (size - 1) / 2;
    const xs = [3, mid, size - 4];
    const out: Array<[number, number]> = [];
    for (const y of xs) for (const x of xs) out.push([x, y]);
    return out;
  }
  const edge = size >= 13 ? 3 : 2;
  const last = size - 1 - edge;
  const xs = [...new Set([edge, last, size % 2 === 1 ? (size - 1) / 2 : -1])].filter((v) => v >= 0);
  const out: Array<[number, number]> = [];
  for (const y of xs) {
    for (const x of xs) {
      // 五星只取四角与天元：恰好一维落在中线的（边中点十字）不取
      const midIndex = xs.length === 3 ? 1 : -1;
      const onMidX = midIndex >= 0 && x === xs[midIndex];
      const onMidY = midIndex >= 0 && y === xs[midIndex];
      if (onMidX !== onMidY) continue;
      out.push([x, y]);
    }
  }
  return out;
}

const MARK_GLYPH: Record<string, string> = {
  circle: '○',
  triangle: '△',
  square: '□',
  cross: '✕',
  select: '◈',
};

const COL_LETTERS = 'ABCDEFGHJKLMNOPQRST';

export function GoBoard({
  size,
  board,
  marks = [],
  lastMove = null,
  moveNumbers = null,
  showCoords = false,
  trialSet = null,
  inspect = null,
  answerPoints = null,
  ghostColor = null,
  onPlay,
  boardState = 'default',
}: GoBoardProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  const cell = SPAN / (size - 1); // 交叉点间距（容器百分比）
  const stone = cell * 0.96;

  /** 事件坐标 → 最近交叉点；超容差返回 null */
  const pointFromEvent = (clientX: number, clientY: number): Point | null => {
    const el = ref.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const fx = (((clientX - rect.left) / rect.width) * 100 - PAD) / cell;
    const fy = (((clientY - rect.top) / rect.height) * 100 - PAD) / cell;
    const x = Math.round(fx);
    const y = Math.round(fy);
    if (x < 0 || x >= size || y < 0 || y >= size) return null;
    if (Math.abs(fx - x) > 0.42 || Math.abs(fy - y) > 0.42) return null;
    return { x, y };
  };

  const handleClick = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!onPlay || e.button !== 0) return;
    const p = pointFromEvent(e.clientX, e.clientY);
    if (!p) return;
    onPlay(p.x, p.y);
  };

  const handleMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!onPlay || !ghostColor) {
      if (hover !== null) setHover(null);
      return;
    }
    const p = pointFromEvent(e.clientX, e.clientY);
    setHover(p ? p.y * size + p.x : null);
  };

  const innerLines = Array.from({ length: size - 2 }, (_, i) => i + 1);
  const stars = starPoints(size);

  const stones: ReactNode[] = [];
  const numbers = moveNumbers;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c = board[y][x];
      if (!c) continue;
      const idx = y * size + x;
      const isTrial = trialSet?.has(idx) ?? false;
      stones.push(
        <span
          key={`s${idx}`}
          className={
            `${CSS_PREFIX}stone ${CSS_PREFIX}stone--${c === 1 ? 'b' : 'w'}` +
            (isTrial ? ` ${CSS_PREFIX}stone--trial` : '') +
            (inspect?.stones.has(idx) ? ` ${CSS_PREFIX}stone--inspect` : '')
          }
          style={{
            left: `${pct(x, size)}%`,
            top: `${pct(y, size)}%`,
            width: `${stone}%`,
            height: `${stone}%`,
          }}
        >
          {numbers?.has(idx) && <span className={CSS_PREFIX + 'stoneNum'}>{numbers.get(idx)}</span>}
          {lastMove && lastMove.x === x && lastMove.y === y && (
            <span className={`${CSS_PREFIX}lastDot ${CSS_PREFIX}lastDot--${c === 1 ? 'w' : 'b'}`} />
          )}
        </span>
      );
    }
  }

  const markNodes: ReactNode[] = [];
  marks.forEach((m, i) => {
    const key = `m${i}`;
    if (m.x < 0 || m.x >= size || m.y < 0 || m.y >= size) return;
    markNodes.push(
      <span
        key={key}
        className={`${CSS_PREFIX}mark ${CSS_PREFIX}mark--chip`}
        style={{ left: `${pct(m.x, size)}%`, top: `${pct(m.y, size)}%` }}
      >
        {m.label}
      </span>
    );
  });

  const libertyNodes: ReactNode[] = [];
  if (inspect) {
    for (const idx of inspect.liberties) {
      const x = idx % size;
      const y = Math.floor(idx / size);
      libertyNodes.push(
        <span
          key={`l${idx}`}
          className={CSS_PREFIX + 'libertyDot'}
          style={{ left: `${pct(x, size)}%`, top: `${pct(y, size)}%`, width: `${cell * 0.3}%`, height: `${cell * 0.3}%` }}
        />
      );
    }
  }

  const answerNodes: ReactNode[] = [];
  if (answerPoints) {
    for (const idx of answerPoints) {
      const x = idx % size;
      const y = Math.floor(idx / size);
      answerNodes.push(
        <span
          key={`a${idx}`}
          className={CSS_PREFIX + 'answerRing'}
          style={{
            left: `${pct(x, size)}%`,
            top: `${pct(y, size)}%`,
            width: `${stone * 1.15}%`,
            height: `${stone * 1.15}%`,
          }}
        />
      );
    }
  }

  return (
    <div
      ref={ref}
      className={
        `${CSS_PREFIX}board ${CSS_PREFIX}boardGo` +
        (boardState !== 'default' ? ` ${CSS_PREFIX}boardGo--${boardState}` : '') +
        (onPlay ? ` ${CSS_PREFIX}boardGo--live` : '')
      }
      onPointerDown={handleClick}
      onPointerMove={handleMove}
      onPointerLeave={() => setHover(null)}
      role={onPlay ? 'button' : undefined}
      aria-label={`${size} 路棋盘`}
    >
      {/* 网格线：外框 + 内部线，SVG 与棋子层共用百分比坐标系 */}
      <svg className={CSS_PREFIX + 'grid'} viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
        <rect
          x={PAD * 10}
          y={PAD * 10}
          width={SPAN * 10}
          height={SPAN * 10}
          className={CSS_PREFIX + 'gridOuter'}
        />
        {innerLines.map((k) => {
          const s = svgCoord(k, size);
          const lo = PAD * 10;
          const hi = (PAD + SPAN) * 10;
          return (
            <g key={k}>
              <line x1={s} y1={lo} x2={s} y2={hi} className={CSS_PREFIX + 'gridLine'} />
              <line x1={lo} y1={s} x2={hi} y2={s} className={CSS_PREFIX + 'gridLine'} />
            </g>
          );
        })}
      </svg>

      {/* 星位 */}
      {stars.map(([x, y]) => (
        <span
          key={`star${x}-${y}`}
          className={CSS_PREFIX + 'star'}
          style={{
            left: `${pct(x, size)}%`,
            top: `${pct(y, size)}%`,
            width: `${cell * 0.16}%`,
            height: `${cell * 0.16}%`,
          }}
        />
      ))}

      {stones}
      {libertyNodes}
      {markNodes}
      {answerNodes}

      {/* 悬停预览：虚线圆环提示可落点 */}
      {hover !== null && ghostColor && !board[Math.floor(hover / size)][hover % size] && (
        <span
          className={`${CSS_PREFIX}ghost ${ghostColor === 2 ? CSS_PREFIX + 'ghost--w' : ''}`}
          style={{
            left: `${pct(hover % size, size)}%`,
            top: `${pct(Math.floor(hover / size), size)}%`,
            width: `${stone * 0.86}%`,
            height: `${stone * 0.86}%`,
          }}
        />
      )}

      {/* 坐标（左列数字 + 底行字母，跳过 I） */}
      {showCoords && (
        <>
          {Array.from({ length: size }, (_, k) => (
            <span key={`cx${k}`} className={`${CSS_PREFIX}coord ${CSS_PREFIX}coord--x`} style={{ left: `${pct(k, size)}%` }}>
              {COL_LETTERS[k]}
            </span>
          ))}
          {Array.from({ length: size }, (_, k) => (
            <span key={`cy${k}`} className={`${CSS_PREFIX}coord ${CSS_PREFIX}coord--y`} style={{ top: `${pct(k, size)}%` }}>
              {size - k}
            </span>
          ))}
        </>
      )}
    </div>
  );
}

/** SGF 标记渲染辅助：BoardMark kind → 字形 */
export function sgfMarkToMark(
  marks: Array<{ x: number; y: number; kind: string; label?: string }>
): Mark[] {
  return marks.map((m) => ({
    x: m.x,
    y: m.y,
    label: m.kind === 'label' ? (m.label ?? '') : (MARK_GLYPH[m.kind] ?? ''),
  }));
}
