/** @jsxImportSource react */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  TetrisEngine,
  COLS,
  VISIBLE_ROWS,
  HIDDEN_ROWS,
  type GameEvent,
} from './game/engine';
import { PIECE_CELLS, type PieceType } from './game/pieces';
import { clearGameSave, patchViewOptions } from './persist';
import {
  CSS_PREFIX,
  PLUGIN_ID,
  GameViewProps,
  GameOptions,
  GameStatsRecord,
  parseGameOptions,
  parseGameStats,
  parseGameSave,
} from './types';

// 左右移自动重复参数（自实现 DAS/ARR，不依赖系统按键重复）
const DAS_MS = 150;
const ARR_MS = 40;
// 消行闪烁时长（须与 style.css 的 clearing 动画一致）
const CLEAR_ANIM_MS = 220;
// 战报提示展示时长
const TOAST_MS = 1400;
// 防误触二次确认窗口（ms）
const CONFIRM_MS = 2500;
// 滑动手势的最小判定距离（px）
const SWIPE_MIN_PX = 24;

// ─────────────────────────────────────────────────────────────
// 对外渲染器：管理 React Root 生命周期
// plugin-core 每次 onUpdate 调用 update()，onDestroy 调用 destroy()。
// onUpdate 是同步、可重复的 render 协议：容器变化时重建 Root。
// ─────────────────────────────────────────────────────────────
export function createViewRenderer() {
  let root: Root | null = null;
  let lastContainer: HTMLElement | null = null;

  return {
    update(props: GameViewProps) {
      if (!root || lastContainer !== props.container) {
        if (root) root.unmount();
        props.container.replaceChildren();
        root = createRoot(props.container);
        lastContainer = props.container;
      }
      root.render(<ViewApp props={props} />);
    },
    destroy() {
      if (root) {
        root.unmount();
        root = null;
        lastContainer = null;
      }
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

interface HeldSide {
  held: boolean;
  t0: number;
  arr: number;
}

interface HeldState {
  left: HeldSide;
  right: HeldSide;
  down: boolean;
}

function freshHeld(): HeldState {
  return {
    left: { held: false, t0: 0, arr: 0 },
    right: { held: false, t0: 0, arr: 0 },
    down: false,
  };
}

/** 方块预览（暂存 / 下一个）：按方块实际外接框居中放进 4 × 2 迷你网格 */
function PiecePreview({ type }: { type: PieceType | null }) {
  if (!type) return <div className={`${CSS_PREFIX}preview`} />;
  const cells = PIECE_CELLS[type][0];
  const xs = cells.map((c) => c[0]);
  const ys = cells.map((c) => c[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const offX = Math.floor((4 - (Math.max(...xs) - minX + 1)) / 2);
  const offY = 2 - (Math.max(...ys) - minY + 1);
  return (
    <div className={`${CSS_PREFIX}preview`}>
      {cells.map(([x, y], i) => (
        <div
          key={i}
          className={`${CSS_PREFIX}previewCell ${CSS_PREFIX}p${type}`}
          style={{ gridColumn: x - minX + offX + 1, gridRow: y - minY + offY + 1 }}
        />
      ))}
    </div>
  );
}

function ViewApp({ props }: { props: GameViewProps }) {
  const boardRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<TetrisEngine | null>(null);
  // onUpdate 每轮传入最新 props；异步回调通过 ref 取当前值，避免闭包过期
  const propsRef = useRef(props);
  propsRef.current = props;

  const pluginOptions = asRecord(props.viewDefinition?.options?.[PLUGIN_ID]);
  const options: GameOptions = parseGameOptions(pluginOptions);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const stats = parseGameStats(pluginOptions.stats);
  const statsRef = useRef<GameStatsRecord | null>(stats);
  statsRef.current = stats;
  // 存档只在挂载时读取一次：之后由本视图自己的写回驱动 viewDefinition 变化
  const initialSave = useMemo(() => parseGameSave(pluginOptions.save), []); // eslint-disable-line react-hooks/exhaustive-deps

  // 引擎 rev → React 重渲染（rAF 循环里比对）
  const [uiRev, setUiRev] = useState(0);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  pausedRef.current = paused;
  const [focused, setFocused] = useState(false);
  const [toast, setToast] = useState<(GameEvent & { id: number }) | null>(null);
  // 防误触二次确认：有进度的对局上，重开需 2.5s 内再点一次
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const confirmRunRef = useRef<(() => void) | null>(null);
  const confirmTimerRef = useRef<number | null>(null);
  // 本局战绩是否已入账（终局时至多一次，防止一局重复计数）
  const countedRef = useRef(false);
  // 终局是否刷新了最高分 / 最多消行（结算面板 🏅 文案）
  const [overRecord, setOverRecord] = useState(false);
  // 输入状态：左右按住（DAS/ARR）、软降按住
  const heldRef = useRef<HeldState>(freshHeld());
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const clearTimerRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const toastSeqRef = useRef(0);
  const lastEventSeenRef = useRef<GameEvent | null>(null);

  // 每块结算后的持久化：进行中只落存档（战绩统计集中在终局入账，
  // 避免 stats.best 被本局实时刷新导致终局"新纪录"判定恒为假）
  const persistSettled = (engine: TetrisEngine) => {
    const current = propsRef.current;
    const api = current?.api;
    if (!api) return;
    const recordRow = () => {
      if (typeof api.createRow !== 'function') return;
      // 重读最新配置，避免用旧闭包里的 recordScores 判断
      const fresh = parseGameOptions(
        asRecord(
          api.getDefinition?.()?.views?.find((view: any) => view.id === current.viewId)?.options?.[
            PLUGIN_ID
          ]
        )
      );
      if (!fresh.recordScores) return;
      const date = new Date().toISOString();
      const moment = current.moment;
      const dateText = moment
        ? moment(date).format('YYYY-MM-DD HH:mm')
        : new Date(date).toLocaleString();
      void api
        .createRow({
          viewId: current.viewId,
          values: {
            tetris: true,
            score: engine.score,
            lines: engine.lines,
            level: engine.level,
            pieces: engine.pieces,
            result: 'over',
            date: dateText,
          },
        })
        .catch((error: unknown) => {
          console.error('[xdb-plugin] tetris: 写入战绩行失败', error);
        });
    };

    if (engine.over) {
      // 终局：清存档；一局只入账一次（比较对象是入账前 stats = 历史最佳）
      void clearGameSave(api, current.viewId);
      if (!countedRef.current) {
        countedRef.current = true;
        const prev = statsRef.current;
        const isRecord =
          engine.score > (prev?.bestScore ?? 0) || engine.lines > (prev?.bestLines ?? 0);
        setOverRecord(isRecord);
        const nextStats: GameStatsRecord = {
          bestScore: Math.max(prev?.bestScore ?? 0, engine.score),
          bestLines: Math.max(prev?.bestLines ?? 0, engine.lines),
          totalScore: (prev?.totalScore ?? 0) + engine.score,
          games: (prev?.games ?? 0) + 1,
          lastDate: new Date().toLocaleString(),
        };
        statsRef.current = nextStats; // 本地同步，避免同会话连续终局读到旧值
        void patchViewOptions(api, current.viewId, { stats: nextStats });
        recordRow();
      }
      return;
    }
    void patchViewOptions(api, current.viewId, { save: engine.snapshot() });
  };

  // 引擎只创建一次；开局等级取自存档（恢复局）或当前设置（新局）
  useEffect(() => {
    const engine = new TetrisEngine(optionsRef.current.startLevel, initialSave, {
      onSettled: persistSettled,
    });
    engineRef.current = engine;
    setUiRev(engine.rev);
    boardRef.current?.focus({ preventScroll: true });
    // 页面切后台时自动暂停（rAF 被节流后时间跳跃不可控）
    const onVisibility = () => {
      if (document.hidden) setPaused(true);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      engineRef.current = null;
      if (clearTimerRef.current !== null) {
        window.clearTimeout(clearTimerRef.current);
        clearTimerRef.current = null;
      }
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 主循环：重力推进 + 按键重复 + 引擎状态同步到 React ─────
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastRev = -1;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(now - last, 100); // 后台回来不补帧
      last = now;
      const engine = engineRef.current;
      if (!engine) return;
      if (!pausedRef.current && !engine.over && !engine.isClearing) {
        runHeldRepeat(now);
        engine.tick(dt, heldRef.current.down);
      }
      // 消行动画结束 → 结算移除（动画关闭则立即）
      if (engine.isClearing && clearTimerRef.current === null) {
        const ms = optionsRef.current.animation ? CLEAR_ANIM_MS : 0;
        clearTimerRef.current = window.setTimeout(() => {
          clearTimerRef.current = null;
          const cur = engineRef.current;
          if (cur?.isClearing) {
            cur.finishClear();
            setUiRev(cur.rev);
          }
        }, ms);
      }
      // 新战报 → 提示条
      if (engine.lastEvent && engine.lastEvent !== lastEventSeenRef.current) {
        lastEventSeenRef.current = engine.lastEvent;
        toastSeqRef.current += 1;
        setToast({ ...engine.lastEvent, id: toastSeqRef.current });
      }
      if (engine.rev !== lastRev) {
        lastRev = engine.rev;
        setUiRev(engine.rev);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 战报提示定时消失
  useEffect(() => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    if (!toast) return;
    toastTimerRef.current = window.setTimeout(() => {
      toastTimerRef.current = null;
      setToast(null);
    }, TOAST_MS);
  }, [toast]);

  // ── 输入：键盘（自实现 DAS/ARR，忽略系统重复） ─────────────

  const activeDir = (): 'left' | 'right' | null => {
    const { left, right } = heldRef.current;
    if (left.held && right.held) return left.t0 > right.t0 ? 'left' : 'right';
    return left.held ? 'left' : right.held ? 'right' : null;
  };

  const runHeldRepeat = (now: number) => {
    const dir = activeDir();
    if (!dir) return;
    const st = heldRef.current[dir];
    const elapsed = now - st.t0;
    if (elapsed < DAS_MS) return;
    const repeats = Math.floor((elapsed - DAS_MS) / ARR_MS);
    while (st.arr <= repeats) {
      engineRef.current?.move(dir === 'left' ? -1 : 1);
      st.arr += 1;
    }
  };

  const startHold = (dir: 'left' | 'right') => {
    if (!inputAllowed()) return;
    const st = heldRef.current[dir];
    st.held = true;
    st.t0 = performance.now();
    st.arr = 0;
    engineRef.current?.move(dir === 'left' ? -1 : 1);
  };

  const endHold = (dir: 'left' | 'right') => {
    heldRef.current[dir].held = false;
  };

  const inputAllowed = () => {
    const engine = engineRef.current;
    return Boolean(engine) && !pausedRef.current && !engine!.over && !engine!.isClearing;
  };

  const togglePause = () => {
    const engine = engineRef.current;
    if (!engine || engine.over) return;
    setPaused((p) => !p);
  };

  const resumeGame = () => {
    setPaused(false);
    boardRef.current?.focus({ preventScroll: true });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
    ) {
      return;
    }
    const engine = engineRef.current;
    if (!engine) return;
    // 自实现重复：吞掉系统自动重复事件
    if (e.repeat && ['ArrowLeft', 'ArrowRight', 'ArrowDown', ' '].includes(e.key)) {
      e.preventDefault();
      return;
    }
    switch (e.key) {
      case 'ArrowLeft':
      case 'a':
      case 'A':
        e.preventDefault();
        startHold('left');
        return;
      case 'ArrowRight':
      case 'd':
      case 'D':
        e.preventDefault();
        startHold('right');
        return;
      case 'ArrowDown':
      case 's':
      case 'S':
        e.preventDefault();
        if (inputAllowed()) heldRef.current.down = true;
        return;
      case 'ArrowUp':
      case 'w':
      case 'W':
      case 'x':
      case 'X':
        e.preventDefault();
        if (inputAllowed()) engine.rotate(1);
        return;
      case 'z':
      case 'Z':
        e.preventDefault();
        if (inputAllowed()) engine.rotate(-1);
        return;
      case ' ':
        e.preventDefault();
        if (inputAllowed()) engine.hardDrop();
        return;
      case 'c':
      case 'C':
      case 'Shift':
        e.preventDefault();
        if (inputAllowed()) engine.hold();
        return;
      case 'p':
      case 'P':
      case 'Escape':
        e.preventDefault();
        togglePause();
        return;
      case 'n':
      case 'N':
        e.preventDefault();
        handleNewGame();
        return;
    }
  };

  const handleKeyUp = (e: React.KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case 'ArrowLeft':
      case 'a':
      case 'A':
        endHold('left');
        return;
      case 'ArrowRight':
      case 'd':
      case 'D':
        endHold('right');
        return;
      case 'ArrowDown':
      case 's':
      case 'S':
        heldRef.current.down = false;
        return;
    }
  };

  // 失焦自动暂停 + 清按键状态（防止按住时失焦导致持续移动）
  const handleBlur = () => {
    setFocused(false);
    heldRef.current = freshHeld();
    const engine = engineRef.current;
    if (engine && !engine.over) setPaused(true);
  };

  // ── 触屏 / 鼠标：棋盘滑动手势 ───────────────────────────────

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    pointerStart.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = pointerStart.current;
    pointerStart.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_MIN_PX) {
      // 轻点：聚焦棋盘恢复失焦态；暂停中的对局顺带继续
      if (!engineRef.current?.over) {
        boardRef.current?.focus({ preventScroll: true });
        if (paused) setPaused(false);
      }
      return;
    }
    if (!inputAllowed()) return;
    const engine = engineRef.current!;
    if (Math.abs(dx) > Math.abs(dy)) {
      // 横向滑动：按滑过的格数平移
      const cell = Math.max(20, boardRef.current?.clientWidth ?? 300) / COLS;
      const steps = Math.max(1, Math.round(Math.abs(dx) / cell));
      for (let i = 0; i < steps; i++) engine.move(dx > 0 ? 1 : -1);
    } else if (dy > 0) {
      engine.hardDrop();
    } else {
      engine.rotate(1);
    }
  };

  // ── 新局（防误触确认） ─────────────────────────────────────

  const disarmConfirm = () => {
    confirmRunRef.current = null;
    if (confirmTimerRef.current !== null) {
      window.clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = null;
    }
    setConfirmId(null);
  };

  const runProtected = (id: string, run: () => void) => {
    if (confirmId === id && confirmRunRef.current) {
      disarmConfirm();
      run();
      return;
    }
    setConfirmId(id);
    confirmRunRef.current = run;
    if (confirmTimerRef.current !== null) window.clearTimeout(confirmTimerRef.current);
    confirmTimerRef.current = window.setTimeout(() => {
      confirmTimerRef.current = null;
      confirmRunRef.current = null;
      setConfirmId(null);
    }, CONFIRM_MS);
  };

  const startGame = (level: number) => {
    const current = propsRef.current;
    const prev = engineRef.current;
    const hadProgress = Boolean(prev && prev.pieces > 0 && !prev.over);
    const engine = new TetrisEngine(level, null, { onSettled: persistSettled });
    engineRef.current = engine;
    countedRef.current = false;
    lastEventSeenRef.current = null;
    heldRef.current = freshHeld();
    if (clearTimerRef.current !== null) {
      window.clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }
    setPaused(false);
    setToast(null);
    setOverRecord(false);
    setUiRev(engine.rev);
    // 放弃进行中的一局：只清存档（最高分已实时刷新，不重复入账）
    if (hadProgress && current?.api) {
      void clearGameSave(current.api, current.viewId);
    }
    boardRef.current?.focus({ preventScroll: true });
  };

  const handleNewGame = () => {
    const engine = engineRef.current;
    const inProgress = Boolean(engine && engine.pieces > 0 && !engine.over);
    if (inProgress) {
      runProtected('new', () => startGame(optionsRef.current.startLevel));
    } else {
      disarmConfirm();
      startGame(optionsRef.current.startLevel);
    }
  };

  // ── 渲染 ───────────────────────────────────────────────────

  const engine = engineRef.current;
  const over = engine?.over ?? false;
  const animation = options.animation;
  const bestDisplay = Math.max(stats?.bestScore ?? 0, engine?.score ?? 0);
  const confirmNew = confirmId === 'new';

  // 可见区 20 × 10 格：锁定块 / 活动块 / 幽灵投影
  const grid: React.ReactNode[] = [];
  if (engine) {
    const clearing = new Set(engine.clearingRows ?? []);
    const curCells = new Map<string, PieceType>();
    if (engine.current) {
      const t = engine.current.type;
      for (const [x, y] of engine.cellsOf()) curCells.set(`${x},${y}`, t);
    }
    const ghostCells = new Map<string, PieceType>();
    if (options.ghost && engine.current) {
      const gy = engine.ghostRow;
      const { type, rot, x: px } = engine.current;
      for (const [dx, dy] of PIECE_CELLS[type][rot]) {
        ghostCells.set(`${px + dx},${gy + dy}`, type);
      }
    }
    for (let vr = 0; vr < VISIBLE_ROWS; vr++) {
      const y = vr + HIDDEN_ROWS;
      const rowClearing = clearing.has(y);
      for (let x = 0; x < COLS; x++) {
        const key = `${x},${y}`;
        const cell = engine.board[y][x];
        let cls = `${CSS_PREFIX}cell`;
        if (cell) {
          cls += ` ${CSS_PREFIX}p${cell.t}`;
          // 刚锁定的块播放落定脉冲（s === 最新锁定序号）
          if (animation && cell.s === engine.lockSeq) cls += ` ${CSS_PREFIX}cell--pulse`;
          if (rowClearing) cls += ` ${CSS_PREFIX}cell--clearing`;
        } else if (curCells.has(key)) {
          cls += ` ${CSS_PREFIX}p${curCells.get(key)} ${CSS_PREFIX}cell--active`;
        } else if (ghostCells.has(key)) {
          cls += ` ${CSS_PREFIX}p${ghostCells.get(key)} ${CSS_PREFIX}cell--ghost`;
        }
        grid.push(<div key={key} className={cls} />);
      }
    }
  }

  const nextPieces = engine ? engine.queue.slice(0, 1) : [];
  const linesToNextLevel = engine ? 10 - (engine.lines % 10) : 10;

  return (
    <div className={CSS_PREFIX + 'root' + (animation ? '' : ` ${CSS_PREFIX}noAnim`)}>
      <div className={CSS_PREFIX + 'topbar'}>
        <div className={CSS_PREFIX + 'brand'}>
          <div className={CSS_PREFIX + 'logo'}>TETRIS</div>
          <div className={CSS_PREFIX + 'mode'}>
            SRS · 7-bag{engine ? ` · 开局 Lv${engine.startLevel}` : ''}
          </div>
        </div>
        <div className={CSS_PREFIX + 'actions'}>
          <button
            type="button"
            className={CSS_PREFIX + 'btn'}
            onClick={togglePause}
            disabled={over}
            title="暂停 / 继续（P）"
          >
            {paused && !over ? '▶ 继续' : '⏸ 暂停'}
          </button>
          <button
            type="button"
            className={`${CSS_PREFIX}btn${confirmNew ? ` ${CSS_PREFIX}btn--confirm` : ''}${
              !confirmNew ? ` ${CSS_PREFIX}btn--primary` : ''
            }`}
            onClick={handleNewGame}
            title={confirmNew ? '进行中的一局将被放弃，再点一次确认' : '重新开始（N）'}
          >
            {confirmNew ? '确认重开？' : '新游戏'}
          </button>
        </div>
      </div>

      {/* 记分条：得分 · 等级 · 行数 · 最佳 */}
      <div className={CSS_PREFIX + 'hud'}>
        <div className={`${CSS_PREFIX}hudBox ${CSS_PREFIX}hudBox--score`}>
          <span className={CSS_PREFIX + 'hudLabel'}>得分</span>
          <span className={CSS_PREFIX + 'hudValue'}>{engine?.score ?? 0}</span>
        </div>
        <div className={CSS_PREFIX + 'hudBox'}>
          <span className={CSS_PREFIX + 'hudLabel'}>等级</span>
          <span className={CSS_PREFIX + 'hudValue'}>{engine?.level ?? options.startLevel}</span>
        </div>
        <div className={CSS_PREFIX + 'hudBox'}>
          <span className={CSS_PREFIX + 'hudLabel'}>行数</span>
          <span className={CSS_PREFIX + 'hudValue'}>{engine?.lines ?? 0}</span>
        </div>
        <div
          className={CSS_PREFIX + 'hudBox'}
          title={`历史最高分 ${stats?.bestScore ?? 0} · 最多消行 ${stats?.bestLines ?? 0}`}
        >
          <span className={CSS_PREFIX + 'hudLabel'}>最佳</span>
          <span className={CSS_PREFIX + 'hudValue'}>{bestDisplay}</span>
        </div>
      </div>

      <div className={CSS_PREFIX + 'main'}>
        <div className={CSS_PREFIX + 'boardWrap'}>
          <div
            ref={boardRef}
            className={CSS_PREFIX + 'board'}
            tabIndex={0}
            role="application"
            aria-label={`俄罗斯方块棋盘，得分 ${engine?.score ?? 0}，等级 ${engine?.level ?? 1}`}
            onKeyDown={handleKeyDown}
            onKeyUp={handleKeyUp}
            onFocus={() => setFocused(true)}
            onBlur={handleBlur}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
          >
            {grid}

            {over && (
              <div className={`${CSS_PREFIX}overlay ${CSS_PREFIX}overlay--over`}>
                <div className={CSS_PREFIX + 'overlayTitle'}>游戏结束</div>
                <div className={CSS_PREFIX + 'overlayMsg'}>
                  得分 {engine?.score ?? 0} · 消行 {engine?.lines ?? 0} · 等级 {engine?.level ?? 1}
                </div>
                {overRecord && (
                  <div className={CSS_PREFIX + 'overlayRecord'}>🏅 新纪录！</div>
                )}
                <button
                  type="button"
                  className={`${CSS_PREFIX}btn ${CSS_PREFIX}btn--primary`}
                  onClick={handleNewGame}
                >
                  再来一局
                </button>
              </div>
            )}

            {paused && !over && (
              <div className={`${CSS_PREFIX}overlay ${CSS_PREFIX}overlay--paused`}>
                <div className={CSS_PREFIX + 'overlayTitle'}>已暂停</div>
                <div className={CSS_PREFIX + 'overlayMsg'}>
                  按 P 或点击继续 · ←→ 移动 ↑ 旋转 Z 逆旋 ↓ 软降 ␣ 硬降 C 暂存
                </div>
                <div className={CSS_PREFIX + 'overlayBtns'}>
                  <button
                    type="button"
                    className={`${CSS_PREFIX}btn ${CSS_PREFIX}btn--primary`}
                    onClick={resumeGame}
                  >
                    继续
                  </button>
                </div>
              </div>
            )}

            {!focused && !paused && !over && (
              <div className={CSS_PREFIX + 'veil'}>
                <span className={CSS_PREFIX + 'veilText'}>
                  点击棋盘开始 · ← → 移动 · ↑ 旋转 · ␣ 硬降
                </span>
              </div>
            )}
          </div>

          {toast && (
            <div key={toast.id} className={CSS_PREFIX + 'toast'}>
              <span className={CSS_PREFIX + 'toastLabel'}>{toast.label}</span>
              {toast.points > 0 && <span className={CSS_PREFIX + 'toastPts'}>+{toast.points}</span>}
            </div>
          )}
        </div>

        <aside className={CSS_PREFIX + 'side'}>
          <div className={CSS_PREFIX + 'panel'}>
            <div className={CSS_PREFIX + 'panelTitle'}>暂存 (C)</div>
            <div
              className={`${CSS_PREFIX}holdBox${engine && !engine.canHold ? ` ${CSS_PREFIX}holdBox--off` : ''}`}
            >
              <PiecePreview type={engine?.holdType ?? null} />
            </div>
          </div>
          <div className={CSS_PREFIX + 'panel'}>
            <div className={CSS_PREFIX + 'panelTitle'}>下一个</div>
            <div className={CSS_PREFIX + 'nextBox'}>
              {nextPieces.map((t, i) => (
                <PiecePreview key={`${i}-${t}`} type={t} />
              ))}
            </div>
          </div>
          <div className={CSS_PREFIX + 'panel'}>
            <div className={CSS_PREFIX + 'panelTitle'}>状态</div>
            <div className={CSS_PREFIX + 'statusBox'}>
              {/* 常驻徽标槽：B2B/COMBO 出现与否不改变面板高度，避免整页跳动 */}
              <div className={CSS_PREFIX + 'statusBadges'}>
                {engine?.b2bActive && <span className={`${CSS_PREFIX}badge`}>B2B</span>}
                {engine && engine.combo >= 1 && (
                  <span className={`${CSS_PREFIX}badge ${CSS_PREFIX}badge--combo`}>
                    COMBO ×{engine.combo}
                  </span>
                )}
              </div>
              <span className={CSS_PREFIX + 'statusLine'}>
                再消 {linesToNextLevel} 行升级 · 已落 {engine?.pieces ?? 0} 块
              </span>
            </div>
          </div>
        </aside>
      </div>

      <div className={CSS_PREFIX + 'status'}>
        <div className={CSS_PREFIX + 'statusMain'}>
          {over ? (
            <span className={CSS_PREFIX + 'statusOver'}>本局结束 · 点「再来一局」重开</span>
          ) : paused ? (
            <span>已暂停 · P 或点棋盘继续</span>
          ) : (
            <span>
              已落 {engine?.pieces ?? 0} 块 · 再消 {linesToNextLevel} 行升级
            </span>
          )}
        </div>
        <div className={CSS_PREFIX + 'statusKbd'}>
          <span><kbd>←</kbd><kbd>→</kbd> 移动</span>
          <span><kbd>↑</kbd> 旋转</span>
          <span><kbd>Z</kbd> 逆旋</span>
          <span><kbd>↓</kbd> 软降</span>
          <span><kbd>␣</kbd> 硬降</span>
          <span><kbd>C</kbd> 暂存</span>
          <span><kbd>P</kbd> 暂停</span>
          <span><kbd>N</kbd> 新局</span>
        </div>
      </div>
    </div>
  );
}
