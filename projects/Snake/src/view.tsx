/** @jsxImportSource react */
import { useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  SnakeEngine,
  SPEED_LEVELS,
  type GameEvent,
  type SpeedLevel,
} from './game/engine';
import { COLS, ROWS, MAZE_IDS, MAZE_NAMES, type MazeId } from './game/levels';
import { patchViewOptions } from './persist';
import {
  CSS_PREFIX,
  PLUGIN_ID,
  GameViewProps,
  GameOptions,
  GameStatsRecord,
  parseGameOptions,
  parseGameStats,
} from './types';

// 战报提示展示时长
const TOAST_MS = 1400;
// 防误触二次确认窗口（ms）
const CONFIRM_MS = 2500;
// 滑动手势的最小判定距离（px）
const SWIPE_MIN_PX = 24;
// 终局屏闪时长（ms，须与 style.css 的 dyingFlash 动画一致）
const DYING_MS = 700;

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

/** LCD 分数补零：诺基亚风 4 位显示 */
function lcdNumber(n: number): string {
  return String(Math.max(0, Math.round(n))).padStart(4, '0');
}

/** 迷宫缩略图（侧栏）：按当前局关卡渲染墙格 */
function MazePreview({ walls }: { walls: boolean[][] }) {
  const cells: React.ReactNode[] = [];
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      cells.push(
        <div
          key={`${x},${y}`}
          className={walls[y]?.[x] ? `${CSS_PREFIX}miniWall` : `${CSS_PREFIX}miniEmpty`}
        />
      );
    }
  }
  return (
    <div className={`${CSS_PREFIX}mazePreview`} style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }}>
      {cells}
    </div>
  );
}

function ViewApp({ props }: { props: GameViewProps }) {
  const boardRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<SnakeEngine | null>(null);
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
  // 终局屏闪中（盖板前先闪几下，诺基亚手感）
  const [dying, setDying] = useState(false);
  // 本局战绩是否已入账（终局时至多一次，防止一局重复计数）
  const countedRef = useRef(false);
  // 终局是否刷新了最高分 / 最长（结算面板 🏅 文案）
  const [overRecord, setOverRecord] = useState(false);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const dyingTimerRef = useRef<number | null>(null);
  const toastSeqRef = useRef(0);
  const lastEventSeenRef = useRef<GameEvent | null>(null);
  const prevOverRef = useRef(false);

  // 终局一次性入账：最高分 / 最长 / 累计 / 局数
  const persistEnd = (engine: SnakeEngine) => {
    const current = propsRef.current;
    const api = current?.api;
    if (!api || countedRef.current) return;
    countedRef.current = true;
    const prev = statsRef.current;
    const isRecord =
      engine.score > (prev?.bestScore ?? 0) || engine.length > (prev?.bestLength ?? 0);
    setOverRecord(isRecord);
    const nextStats: GameStatsRecord = {
      bestScore: Math.max(prev?.bestScore ?? 0, engine.score),
      bestLength: Math.max(prev?.bestLength ?? 0, engine.length),
      totalScore: (prev?.totalScore ?? 0) + engine.score,
      games: (prev?.games ?? 0) + 1,
      lastDate: new Date().toLocaleString(),
    };
    statsRef.current = nextStats; // 本地同步，避免同会话连续终局读到旧值
    void patchViewOptions(api, current.viewId, { stats: nextStats });
  };

  // 引擎只创建一次；关卡/速度取自当前设置（新局由 startGame 重建）
  useEffect(() => {
    const engine = new SnakeEngine(
      { maze: optionsRef.current.maze, speed: optionsRef.current.speed },
      { onSettled: persistEnd }
    );
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
      if (dyingTimerRef.current !== null) {
        window.clearTimeout(dyingTimerRef.current);
        dyingTimerRef.current = null;
      }
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 主循环：蛇步进 + 引擎状态同步到 React ──────────────────
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
      if (!pausedRef.current && !engine.over && !engine.won) {
        engine.tick(dt);
      }
      // 终局瞬间：先屏闪再等盖板（动画关闭则跳过）
      if (engine.over && !prevOverRef.current) {
        prevOverRef.current = true;
        if (optionsRef.current.animation) {
          setDying(true);
          dyingTimerRef.current = window.setTimeout(() => {
            dyingTimerRef.current = null;
            setDying(false);
          }, DYING_MS);
        }
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

  // ── 输入：键盘（方向键 / WASD / 诺基亚小键盘 2·4·6·8） ─────

  const inputAllowed = () => {
    const engine = engineRef.current;
    return Boolean(engine) && !pausedRef.current && !engine!.over && !engine!.won;
  };

  const togglePause = () => {
    const engine = engineRef.current;
    if (!engine || engine.over || engine.won) return;
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
    switch (e.key) {
      case 'ArrowUp':
      case 'w':
      case 'W':
      case '8':
        if (inputAllowed()) {
          e.preventDefault();
          engineRef.current?.turn('up');
        }
        return;
      case 'ArrowDown':
      case 's':
      case 'S':
      case '2':
        if (inputAllowed()) {
          e.preventDefault();
          engineRef.current?.turn('down');
        }
        return;
      case 'ArrowLeft':
      case 'a':
      case 'A':
      case '4':
        if (inputAllowed()) {
          e.preventDefault();
          engineRef.current?.turn('left');
        }
        return;
      case 'ArrowRight':
      case 'd':
      case 'D':
      case '6':
        if (inputAllowed()) {
          e.preventDefault();
          engineRef.current?.turn('right');
        }
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

  // 失焦自动暂停（防止挂机时蛇撞死）
  const handleBlur = () => {
    setFocused(false);
    const engine = engineRef.current;
    if (engine && !engine.over && !engine.won) setPaused(true);
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
      if (!engineRef.current?.over && !engineRef.current?.won) {
        boardRef.current?.focus({ preventScroll: true });
        if (paused) setPaused(false);
      }
      return;
    }
    if (!inputAllowed()) return;
    if (Math.abs(dx) > Math.abs(dy)) {
      engineRef.current?.turn(dx > 0 ? 'right' : 'left');
    } else {
      engineRef.current?.turn(dy > 0 ? 'down' : 'up');
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

  const startGame = (cfg?: { maze?: MazeId; speed?: SpeedLevel }) => {
    const engine = new SnakeEngine(
      {
        maze: cfg?.maze ?? optionsRef.current.maze,
        speed: cfg?.speed ?? optionsRef.current.speed,
      },
      { onSettled: persistEnd }
    );
    engineRef.current = engine;
    countedRef.current = false;
    lastEventSeenRef.current = null;
    prevOverRef.current = false;
    setPaused(false);
    setToast(null);
    setOverRecord(false);
    setDying(false);
    setUiRev(engine.rev);
    boardRef.current?.focus({ preventScroll: true });
  };

  /** 关卡 / 速度切换：写入设置并立即按新配置开局（有进度需二次确认） */
  const switchConfig = (patch: { maze?: MazeId; speed?: SpeedLevel }) => {
    const engine = engineRef.current;
    const inProgress = Boolean(engine && engine.score > 0 && !engine.over && !engine.won);
    const id =
      patch.maze !== undefined ? ('maze:' + patch.maze) : ('speed:' + patch.speed);
    const run = () => {
      const current = propsRef.current;
      if (current?.api) {
        void patchViewOptions(current.api, current.viewId, { ...patch } as Record<string, unknown>);
      }
      startGame(patch);
    };
    if (inProgress) {
      runProtected(id, run);
    } else {
      disarmConfirm();
      run();
    }
  };

  const handleNewGame = () => {
    const engine = engineRef.current;
    const inProgress = Boolean(engine && engine.score > 0 && !engine.over && !engine.won);
    if (inProgress) {
      runProtected('new', startGame);
    } else {
      disarmConfirm();
      startGame();
    }
  };

  // ── 渲染 ───────────────────────────────────────────────────

  const engine = engineRef.current;
  const over = engine?.over ?? false;
  const won = engine?.won ?? false;
  const animation = options.animation;
  const bestDisplay = Math.max(stats?.bestScore ?? 0, engine?.score ?? 0);
  const confirmNew = confirmId === 'new';

  // LCD 棋盘格：墙 / 蛇（头·身·尾）/ 食物 / 奖励物
  const grid: React.ReactNode[] = [];
  if (engine) {
    const head = engine.snake[0];
    const tail = engine.snake[engine.snake.length - 1];
    const isHead = (x: number, y: number) => head && head.x === x && head.y === y;
    const isTail = (x: number, y: number) => tail && tail.x === x && tail.y === y;
    const isBody = (x: number, y: number) =>
      engine.snake.some((c) => c.x === x && c.y === y);
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        let cls = `${CSS_PREFIX}cell`;
        if (engine.walls[y][x]) {
          cls += ` ${CSS_PREFIX}cell--wall`;
        } else if (isHead(x, y)) {
          cls += ` ${CSS_PREFIX}cell--snake ${CSS_PREFIX}cell--head ${CSS_PREFIX}cell--head--${engine.dir}`;
        } else if (isBody(x, y)) {
          cls += isTail(x, y) ? ` ${CSS_PREFIX}cell--snake ${CSS_PREFIX}cell--tail` : ` ${CSS_PREFIX}cell--snake`;
        } else if (engine.food && engine.food.x === x && engine.food.y === y) {
          cls += ` ${CSS_PREFIX}cell--food`;
        } else if (engine.bonus && engine.bonus.x === x && engine.bonus.y === y) {
          cls += ` ${CSS_PREFIX}cell--bonus`;
        }
        grid.push(<div key={`${x},${y}`} className={cls} />);
      }
    }
  }

  return (
    <div className={CSS_PREFIX + 'root' + (animation ? '' : ` ${CSS_PREFIX}noAnim`)}>
      <div className={CSS_PREFIX + 'topbar'}>
        <div className={CSS_PREFIX + 'brand'}>
          <div className={CSS_PREFIX + 'logo'}>SNAKE&nbsp;II</div>
          <div className={CSS_PREFIX + 'mode'}>
            诺基亚经典{engine ? ` · 迷宫 ${engine.maze} ${MAZE_NAMES[engine.maze]} · 速度 ${engine.speed} 档` : ''}
          </div>
        </div>
        <div className={CSS_PREFIX + 'actions'}>
          <button
            type="button"
            className={CSS_PREFIX + 'btn'}
            onClick={togglePause}
            disabled={over || won}
            title="暂停 / 继续（P）"
          >
            {paused && !over && !won ? '▶ 继续' : '⏸ 暂停'}
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

      {/* 记分条：得分 · 长度 · 速度 · 最高分 */}
      <div className={CSS_PREFIX + 'hud'}>
        <div className={`${CSS_PREFIX}hudBox ${CSS_PREFIX}hudBox--score`}>
          <span className={CSS_PREFIX + 'hudLabel'}>得分</span>
          <span className={CSS_PREFIX + 'hudValue'}>{engine?.score ?? 0}</span>
        </div>
        <div className={CSS_PREFIX + 'hudBox'}>
          <span className={CSS_PREFIX + 'hudLabel'}>长度</span>
          <span className={CSS_PREFIX + 'hudValue'}>{engine?.length ?? 4}</span>
        </div>
        <div className={CSS_PREFIX + 'hudBox'}>
          <span className={CSS_PREFIX + 'hudLabel'}>速度</span>
          <span className={CSS_PREFIX + 'hudValue'}>{engine?.speed ?? options.speed} 档</span>
        </div>
        <div
          className={CSS_PREFIX + 'hudBox'}
          title={`历史最高分 ${stats?.bestScore ?? 0} · 最长 ${stats?.bestLength ?? 0} 格`}
        >
          <span className={CSS_PREFIX + 'hudLabel'}>最高分</span>
          <span className={CSS_PREFIX + 'hudValue'}>{bestDisplay}</span>
        </div>
      </div>

      {/* 关卡 / 速度切换：点按即按新配置开局（有进度需二次确认） */}
      <div className={CSS_PREFIX + 'switchRow'}>
        <div className={CSS_PREFIX + 'segGroup'} role="group" aria-label="切换关卡">
          <span className={CSS_PREFIX + 'segLabel'}>关卡</span>
          <div className={CSS_PREFIX + 'segmented'}>
            {MAZE_IDS.map((m) => {
              const armed = confirmId === 'maze:' + m;
              const on = (engine?.maze ?? options.maze) === m;
              return (
                <button
                  type="button"
                  key={m}
                  className={
                    CSS_PREFIX + 'segBtn' +
                    (on ? ' ' + CSS_PREFIX + 'segBtn--on' : '') +
                    (armed ? ' ' + CSS_PREFIX + 'segBtn--confirm' : '')
                  }
                  aria-pressed={on}
                  onClick={() => switchConfig({ maze: m })}
                  title={armed ? '进行中的一局将被放弃，再点一次确认' : '关卡 ' + m + ' · ' + MAZE_NAMES[m] + '（立即开局）'}
                >
                  {armed ? '确认？' : MAZE_NAMES[m]}
                </button>
              );
            })}
          </div>
        </div>
        <div className={CSS_PREFIX + 'segGroup'} role="group" aria-label="切换速度">
          <span className={CSS_PREFIX + 'segLabel'}>速度</span>
          <div className={CSS_PREFIX + 'segmented'}>
            {SPEED_LEVELS.map((sp) => {
              const armed = confirmId === 'speed:' + sp;
              const on = (engine?.speed ?? options.speed) === sp;
              return (
                <button
                  type="button"
                  key={sp}
                  className={
                    CSS_PREFIX + 'segBtn' +
                    (on ? ' ' + CSS_PREFIX + 'segBtn--on' : '') +
                    (armed ? ' ' + CSS_PREFIX + 'segBtn--confirm' : '')
                  }
                  aria-pressed={on}
                  onClick={() => switchConfig({ speed: sp })}
                  title={armed ? '进行中的一局将被放弃，再点一次确认' : '速度 ' + sp + ' 档（立即开局）'}
                >
                  {armed ? '✓' : String(sp)}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className={CSS_PREFIX + 'main'}>
        <div className={CSS_PREFIX + 'boardWrap'}>
          <div
            ref={boardRef}
            className={`${CSS_PREFIX}board${dying ? ` ${CSS_PREFIX}dying` : ''}`}
            tabIndex={0}
            role="application"
            aria-label={`贪吃蛇棋盘，得分 ${engine?.score ?? 0}，长度 ${engine?.length ?? 4}`}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={handleBlur}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
          >
            {/* LCD 状态条：补零分数，诺基亚同款 */}
            <div className={CSS_PREFIX + 'lcdbar'}>
              <span>SCORE {lcdNumber(engine?.score ?? 0)}</span>
              <span>HI {lcdNumber(bestDisplay)}</span>
            </div>
            <div className={CSS_PREFIX + 'cells'}>{grid}</div>

            {over && !dying && (
              <div className={`${CSS_PREFIX}overlay ${CSS_PREFIX}overlay--over`}>
                <div className={CSS_PREFIX + 'overlayTitle'}>GAME OVER</div>
                <div className={CSS_PREFIX + 'overlayMsg'}>
                  {engine?.overReason === 'wall' ? '撞到了墙' : '咬到了自己'} · 得分{' '}
                  {engine?.score ?? 0} · 长度 {engine?.length ?? 4}
                </div>
                {overRecord && <div className={CSS_PREFIX + 'overlayRecord'}>🏅 新纪录！</div>}
                <button
                  type="button"
                  className={`${CSS_PREFIX}btn ${CSS_PREFIX}btn--primary`}
                  onClick={handleNewGame}
                >
                  再来一局
                </button>
              </div>
            )}

            {won && (
              <div className={`${CSS_PREFIX}overlay ${CSS_PREFIX}overlay--win`}>
                <div className={CSS_PREFIX + 'overlayTitle'}>YOU WIN</div>
                <div className={CSS_PREFIX + 'overlayMsg'}>
                  蛇占满了全场！得分 {engine?.score ?? 0}
                </div>
                {overRecord && <div className={CSS_PREFIX + 'overlayRecord'}>🏅 新纪录！</div>}
                <button
                  type="button"
                  className={`${CSS_PREFIX}btn ${CSS_PREFIX}btn--primary`}
                  onClick={handleNewGame}
                >
                  再来一局
                </button>
              </div>
            )}

            {paused && !over && !won && (
              <div className={`${CSS_PREFIX}overlay ${CSS_PREFIX}overlay--paused`}>
                <div className={CSS_PREFIX + 'overlayTitle'}>已暂停</div>
                <div className={CSS_PREFIX + 'overlayMsg'}>
                  按 P 或点击继续 · 方向键 / WASD / 2·4·6·8 转向
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

            {!focused && !paused && !over && !won && (
              <div className={CSS_PREFIX + 'veil'}>
                <span className={CSS_PREFIX + 'veilText'}>
                  点击棋盘开始 · 方向键 / WASD / 2·4·6·8 转向
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
            <div className={CSS_PREFIX + 'panelTitle'}>迷宫预览</div>
            <div className={CSS_PREFIX + 'mazeBox'}>
              {engine ? (
                <MazePreview walls={engine.walls} />
              ) : (
                <div className={CSS_PREFIX + 'statusLine'}>未开始</div>
              )}
            </div>
            <div className={CSS_PREFIX + 'statusLine'}>
              {engine ? `关卡 ${engine.maze} · ${MAZE_NAMES[engine.maze]}` : ''}
            </div>
          </div>
          <div className={CSS_PREFIX + 'panel'}>
            <div className={CSS_PREFIX + 'panelTitle'}>状态</div>
            <div className={CSS_PREFIX + 'statusBox'}>
              <span className={CSS_PREFIX + 'statusLine'}>
                本局已吃 {engine?.foods ?? 0} 个食物{engine && engine.foods > 0 ? ' · 越吃越快' : ''}
              </span>
              <span className={CSS_PREFIX + 'statusLine'}>
                历史最长 {stats?.bestLength ?? 0} 格 · 共 {stats?.games ?? 0} 局
              </span>
              <span className={CSS_PREFIX + 'statusLine'}>
                累计得分 {stats?.totalScore ?? 0}
              </span>
            </div>
          </div>
        </aside>
      </div>

      <div className={CSS_PREFIX + 'status'}>
        <div className={CSS_PREFIX + 'statusMain'}>
          {over ? (
            <span className={CSS_PREFIX + 'statusOver'}>本局结束 · 点「再来一局」重开</span>
          ) : won ? (
            <span className={CSS_PREFIX + 'statusOver'}>通关！点「再来一局」继续挑战</span>
          ) : paused ? (
            <span>已暂停 · P 或点棋盘继续</span>
          ) : (
            <span>
              迷宫 {engine?.maze ?? options.maze} · 速度 {engine?.speed ?? options.speed} 档 · 蛇自动前进
            </span>
          )}
        </div>
        <div className={CSS_PREFIX + 'statusKbd'}>
          <span><kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> 转向</span>
          <span><kbd>WASD</kbd> / <kbd>2·4·6·8</kbd></span>
          <span><kbd>P</kbd> 暂停</span>
          <span><kbd>N</kbd> 新局</span>
        </div>
      </div>
    </div>
  );
}
