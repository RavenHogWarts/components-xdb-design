/** @jsxImportSource react */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BLACK, BOARD_SIZE, WHITE } from './types';
import { chooseAiMove } from './game/ai';
import { GomokuEngine } from './game/engine';
import { clearSave, patchViewOptions } from './persist';
import {
  CSS_PREFIX,
  PLUGIN_ID,
  AI_LABELS,
  AI_ORDER,
  COLOR_LABELS,
  MODE_LABELS,
  parseGameOptions,
  parseGameSave,
  parseGameStats,
  type AiLevel,
  type GameMode,
  type GomokuOptions,
  type GomokuSaveSlot,
  type GomokuStatsRecord,
  type GomokuViewProps,
  type PlayerColor,
} from './types';

// 存档防抖间隔（ms）
const PERSIST_DEBOUNCE_MS = 400;
// AI 思考的最小可见延迟（ms）：避免闪烁感，也让交互有节奏
const AI_THINK_MS = 60;

// ─────────────────────────────────────────────────────────────
// 对外渲染器：管理 React Root 生命周期
// plugin-core 每次 onUpdate 调用 update()，onDestroy 调用 destroy()。
// ─────────────────────────────────────────────────────────────
export function createViewRenderer() {
  let root: Root | null = null;
  let lastContainer: HTMLElement | null = null;

  return {
    update(props: GomokuViewProps) {
      if (!root || lastContainer !== props.container) {
        if (root) root.unmount();
        props.container.replaceChildren();
        root = createRoot(props.container);
        lastContainer = props.container;
      }
      root.render(<GomokuApp props={props} />);
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

const STAR_POINTS = new Set<number>([
  // 15×15 天元 + 四星
  7 * BOARD_SIZE + 7,
  3 * BOARD_SIZE + 3,
  3 * BOARD_SIZE + 11,
  11 * BOARD_SIZE + 3,
  11 * BOARD_SIZE + 11,
]);

// 棋盘几何：线区四周留 4% 边距（放下边缘棋子），15 条线等分中间 92%。
// 线与落点共用同一坐标系，边缘棋子不会溢出棋盘。
const GRID_PAD_PCT = 4;
const GRID_SPAN_PCT = 100 - GRID_PAD_PCT * 2;

/** 第 k 条线 / 第 k 个落点的百分比坐标 */
const gridPos = (k: number): string =>
  `calc(${GRID_PAD_PCT}% + ${((k * GRID_SPAN_PCT) / (BOARD_SIZE - 1)).toFixed(3)}%)`;

const INNER_LINE_KEYS = Array.from({ length: BOARD_SIZE - 2 }, (_, i) => i + 1);

function GomokuApp({ props }: { props: GomokuViewProps }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  const pluginOptions = asRecord(props.viewDefinition?.options?.[PLUGIN_ID]);
  const options: GomokuOptions = parseGameOptions(pluginOptions);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const stats = parseGameStats(pluginOptions.stats);
  const statsRef = useRef<GomokuStatsRecord | null>(stats);
  statsRef.current = stats;
  const initialSave = useMemo(() => parseGameSave(pluginOptions.save), []); // eslint-disable-line react-hooks/exhaustive-deps

  const engineRef = useRef<GomokuEngine | null>(null);
  const [engine, setEngineState] = useState<GomokuEngine | null>(null);
  // AI 思考中（调度用：落子后短暂让出主线程）
  const [thinking, setThinking] = useState(false);
  const [overlayDismissed, setOverlayDismissed] = useState(false);
  const [version, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);
  const saveTimerRef = useRef<number | null>(null);
  const aiTimerRef = useRef<number | null>(null);
  const [hover, setHover] = useState(-1);

  // onMove 由引擎持有 → 代理到 ref（切换引擎后回调仍指向最新实现）
  const onMoveRef = useRef<(eng: GomokuEngine) => void>(() => undefined);
  const onMoveProxy = useRef((eng: GomokuEngine) => onMoveRef.current(eng)).current;

  // 首次渲染创建引擎（恢复存档或按当前选项开新局）
  if (!engineRef.current && !engine) {
    const eng = initialSave
      ? GomokuEngine.fromSave(initialSave, onMoveProxy)
      : GomokuEngine.newGame(
          optionsRef.current.mode,
          optionsRef.current.aiLevel,
          optionsRef.current.playerColor,
          onMoveProxy
        );
    engineRef.current = eng;
    setEngineState(eng);
  }

  const persistNow = () => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const current = propsRef.current;
    const eng = engineRef.current;
    if (!current?.api || !eng || eng.over !== 0) return;
    void patchViewOptions(current.api, current.viewId, { save: eng.snapshot() });
  };

  const schedulePersist = () => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      persistNow();
    }, PERSIST_DEBOUNCE_MS);
  };

  const clearAiTimer = () => {
    if (aiTimerRef.current !== null) {
      window.clearTimeout(aiTimerRef.current);
      aiTimerRef.current = null;
    }
  };

  /** 落子后的统一出口：持久化 + 结算 + 调度 AI */
  onMoveRef.current = (eng: GomokuEngine) => {
    if (eng.over === 0) {
      schedulePersist();
      // 人机模式且轮到 AI → 异步调度（给 UI 让出主线程）
      if (eng.mode === 'ai' && eng.colorToMove === eng.aiColor && !eng.over) {
        clearAiTimer();
        setThinking(true);
        aiTimerRef.current = window.setTimeout(() => {
          aiTimerRef.current = null;
          try {
            const move = chooseAiMove(eng, eng.aiLevel);
            if (move && eng.colorToMove === eng.aiColor && eng.over === 0) {
              eng.place(move.x, move.y, eng.aiColor);
            }
          } finally {
            setThinking(false);
            bump();
          }
        }, AI_THINK_MS);
      }
      bump();
      return;
    }
    // 终局：清存档、入账统计、按需写战绩行
    const current = propsRef.current;
    void clearSave(current.api, current.viewId);
    setOverlayDismissed(false);
    settleStats(eng);
    bump();
  };

  const settleStats = (eng: GomokuEngine) => {
    const current = propsRef.current;
    if (!current?.api) return;
    const prev = statsRef.current;
    const isDraw = eng.over === 3;
    const humanWon =
      !isDraw && eng.mode === 'ai' && eng.over === eng.humanColor;
    const nextStats: GomokuStatsRecord = {
      games: (prev?.games ?? 0) + 1,
      wins: (prev?.wins ?? 0) + (humanWon ? 1 : 0),
      losses: (prev?.losses ?? 0) + (eng.mode === 'ai' && !isDraw && !humanWon ? 1 : 0),
      draws: (prev?.draws ?? 0) + (isDraw ? 1 : 0),
      lastDate: new Date().toLocaleString(),
    };
    statsRef.current = nextStats; // 本地同步，避免同会话连续终局读到旧值
    void patchViewOptions(current.api, current.viewId, { stats: nextStats });

    // 战绩行：读取最新配置（recordScores 可能刚在设置页改过）
    const fresh = parseGameOptions(
      asRecord(
        current.api.getDefinition?.()?.views?.find((view: any) => view.id === current.viewId)
          ?.options?.[PLUGIN_ID]
      )
    );
    if (!fresh.recordScores || typeof current.api.createRow !== 'function') return;
    const date = new Date().toISOString();
    const moment = current.moment;
    const dateText = moment
      ? moment(date).format('YYYY-MM-DD HH:mm')
      : new Date(date).toLocaleString();
    void current.api
      .createRow({
        viewId: current.viewId,
        values: {
          gomoku: true,
          mode: eng.mode === 'ai' ? '人机' : '双人',
          aiLevel: eng.mode === 'ai' ? AI_LABELS[eng.aiLevel] : '—',
          color: eng.mode === 'ai' ? COLOR_LABELS[eng.humanColor] : '—',
          winner: isDraw ? '和棋' : COLOR_LABELS[eng.over],
          moves: eng.history.length,
          date: dateText,
        },
      })
      .catch((error: unknown) => {
        console.error('[xdb-plugin] gomoku: 写入战绩行失败', error);
      });
  };

  // 卸载清理：清 AI 定时器并把进行中的局落盘
  useEffect(() => {
    return () => {
      clearAiTimer();
      const current = propsRef.current;
      const eng = engineRef.current;
      if (current?.api && eng && eng.over === 0) {
        void patchViewOptions(current.api, current.viewId, { save: eng.snapshot() });
      }
    };
  }, []);

  // AI 先手（玩家执白时黑方 AI 开局）
  useEffect(() => {
    if (engine && engine.mode === 'ai' && engine.over === 0 && engine.history.length === 0) {
      const eng = engine;
      setThinking(true);
      aiTimerRef.current = window.setTimeout(() => {
        aiTimerRef.current = null;
        try {
          const move = chooseAiMove(eng, eng.aiLevel);
          if (move && eng.over === 0 && eng.colorToMove === eng.aiColor) {
            eng.place(move.x, move.y, eng.aiColor);
          }
        } finally {
          setThinking(false);
          bump();
        }
      }, 120);
    }
  }, [engine]);

  if (!engine) return null;
  const eng = engine;
  const terminal = eng.over !== 0;
  const humanTurn = eng.mode === 'local' ? true : eng.colorToMove === eng.humanColor;
  const overlayShown = terminal && !overlayDismissed;

  // ── 操作 ───────────────────────────────────────────────────

  const handleCellClick = (x: number, y: number) => {
    if (eng.over !== 0 || thinking) return;
    if (eng.mode === 'ai' && eng.colorToMove !== eng.humanColor) return;
    if (eng.colorAt(x, y) !== 0) return;
    eng.place(x, y, eng.colorToMove);
    bump();
  };

  /** 悔棋：双人退 1 步；人机退回玩家回合（撤销 AI + 玩家各一步） */
  const handleUndo = () => {
    if (eng.over !== 0 || eng.history.length === 0) return;
    if (eng.mode === 'ai') {
      clearAiTimer();
      setThinking(false);
      eng.undo(2);
      // 玩家执白时 AI 执黑先手，若撤回的是 AI 开局第一步则让 AI 重下
      if (eng.mode === 'ai' && eng.history.length === 0 && eng.playerColor === 'white') {
        // 交给 AI 先手 effect（engine 引用未变，改为直接调度）
        const e = eng;
        setThinking(true);
        aiTimerRef.current = window.setTimeout(() => {
          aiTimerRef.current = null;
          try {
            const move = chooseAiMove(e, e.aiLevel);
            if (move && e.over === 0 && e.colorToMove === e.aiColor) {
              e.place(move.x, move.y, e.aiColor);
            }
          } finally {
            setThinking(false);
            bump();
          }
        }, 120);
      }
    } else {
      eng.undo(1);
    }
    bump();
  };

  const handleNewGame = () => {
    clearAiTimer();
    setThinking(false);
    setOverlayDismissed(false);
    const eng2 = GomokuEngine.newGame(
      optionsRef.current.mode,
      optionsRef.current.aiLevel,
      optionsRef.current.playerColor,
      onMoveProxy
    );
    engineRef.current = eng2;
    setEngineState(eng2);
    setHover(-1);
    bump();
    rootRef.current?.focus({ preventScroll: true });
  };

  /** 切换模式 / 难度 / 执子：写入配置并立即开新局 */
  const switchAndRestart = (patch: Partial<Pick<GomokuOptions, 'mode' | 'aiLevel' | 'playerColor'>>) => {
    const next = { ...optionsRef.current, ...patch };
    clearAiTimer();
    const current = propsRef.current;
    if (current?.api) void patchViewOptions(current.api, current.viewId, patch);
    const eng2 = GomokuEngine.newGame(next.mode, next.aiLevel, next.playerColor, onMoveProxy);
    engineRef.current = eng2;
    setEngineState(eng2);
    setThinking(false);
    setOverlayDismissed(false);
    setHover(-1);
    bump();
    rootRef.current?.focus({ preventScroll: true });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
    ) {
      return;
    }
    if (e.key === 'z' || e.key === 'Z') {
      e.preventDefault();
      handleUndo();
      return;
    }
    if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      handleNewGame();
      return;
    }
  };

  // ── 渲染 ───────────────────────────────────────────────────

  const winnerText =
    eng.over === 3 ? '和棋' : eng.over === eng.humanColor && eng.mode === 'ai' ? '你赢了！' : `${COLOR_LABELS[eng.over]}方胜利`;

  const turnText = (() => {
    if (eng.over !== 0) return winnerText;
    const who = eng.colorToMove === eng.humanColor && eng.mode === 'ai' ? '（你）' : eng.mode === 'ai' ? '（AI）' : '';
    return `轮到 ${COLOR_LABELS[eng.colorToMove]}${who}`;
  })();

  const lastIdx = eng.history.length > 0 ? eng.history[eng.history.length - 1] : -1;

  const cells: React.ReactNode[] = [];
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const idx = y * BOARD_SIZE + x;
      const c = eng.colorAt(x, y);
      const isStar = STAR_POINTS.has(idx);
      cells.push(
        <div
          key={idx}
          className={`${CSS_PREFIX}point${c ? ` ${CSS_PREFIX}stone ${CSS_PREFIX}stone--${c === BLACK ? 'b' : 'w'}` : ''}`}
          style={{ left: gridPos(x), top: gridPos(y) }}
          onClick={() => handleCellClick(x, y)}
          onPointerEnter={() => setHover(idx)}
          onPointerLeave={() => setHover(-1)}
        >
          {isStar && !c && <span className={CSS_PREFIX + 'star'} />}
          {!c && hover === idx && humanTurn && eng.over === 0 && !thinking && (
            <span
              className={`${CSS_PREFIX}ghost ${CSS_PREFIX}ghost--${eng.colorToMove === BLACK ? 'b' : 'w'}`}
            />
          )}
          {idx === lastIdx && <span className={`${CSS_PREFIX}lastMark ${c === BLACK ? '' : CSS_PREFIX + 'lastMark--w'}`} />}
        </div>
      );
    }
  }

  return (
    <div
      ref={rootRef}
      className={CSS_PREFIX + 'root'}
      tabIndex={0}
      role="application"
      aria-label={`五子棋，${MODE_LABELS[eng.mode]}`}
      onKeyDown={handleKeyDown}
    >
      <div className={CSS_PREFIX + 'topbar'}>
        <div className={CSS_PREFIX + 'brand'}>
          <div className={CSS_PREFIX + 'logo'}>五子棋</div>
          <div className={CSS_PREFIX + 'mode'}>
            {MODE_LABELS[eng.mode]}
            {eng.mode === 'ai' ? ` · ${AI_LABELS[eng.aiLevel]}` : ''} · 15×15 无禁手
          </div>
        </div>
        <div className={CSS_PREFIX + 'scores'}>
          <div className={CSS_PREFIX + 'scoreBox'}>
            <span className={CSS_PREFIX + 'scoreLabel'}>战绩</span>
            <span className={CSS_PREFIX + 'scoreValue'}>
              {eng.mode === 'ai'
                ? `胜 ${stats?.wins ?? 0} 负 ${stats?.losses ?? 0} 和 ${stats?.draws ?? 0}`
                : `共 ${stats?.games ?? 0} 局`}
            </span>
          </div>
        </div>
        <div className={CSS_PREFIX + 'actions'}>
          <button
            type="button"
            className={CSS_PREFIX + 'btn'}
            onClick={handleUndo}
            disabled={eng.history.length === 0 || eng.over !== 0}
            title="悔棋（Z）：双人退一步，人机退回你的回合"
          >
            ↩ 悔棋
          </button>
          <button
            type="button"
            className={`${CSS_PREFIX}btn ${CSS_PREFIX}btn--primary`}
            onClick={handleNewGame}
            title="新开一局（N）"
          >
            新游戏
          </button>
        </div>
      </div>

      <div className={CSS_PREFIX + 'switchRow'}>
        <div className={CSS_PREFIX + 'segGroup'} role="group" aria-label="切换模式">
          <span className={CSS_PREFIX + 'segLabel'}>模式</span>
          <div className={CSS_PREFIX + 'segmented'}>
            {(['ai', 'local'] as GameMode[]).map((m) => (
              <button
                type="button"
                key={m}
                className={`${CSS_PREFIX}segBtn${eng.mode === m ? ` ${CSS_PREFIX}segBtn--on` : ''}`}
                aria-pressed={eng.mode === m}
                onClick={() => switchAndRestart({ mode: m })}
                title={m === 'ai' ? '与电脑对战（切难度立即生效）' : '本地双人同屏（黑先）'}
              >
                {MODE_LABELS[m]}
              </button>
            ))}
          </div>
        </div>
        <div
          className={`${CSS_PREFIX}segGroup${eng.mode === 'local' ? ` ${CSS_PREFIX}segGroup--dim` : ''}`}
          role="group"
          aria-label="切换 AI 难度"
        >
          <span className={CSS_PREFIX + 'segLabel'}>AI 难度</span>
          <div className={CSS_PREFIX + 'segmented'}>
            {AI_ORDER.map((l) => (
              <button
                type="button"
                key={l}
                className={`${CSS_PREFIX}segBtn${eng.aiLevel === l ? ` ${CSS_PREFIX}segBtn--on` : ''}`}
                aria-pressed={eng.aiLevel === l}
                onClick={() => switchAndRestart({ aiLevel: l })}
                title={`AI 难度：${AI_LABELS[l]}（切换立即开局）`}
              >
                {AI_LABELS[l]}
              </button>
            ))}
          </div>
        </div>
        <div
          className={`${CSS_PREFIX}segGroup${eng.mode === 'local' ? ` ${CSS_PREFIX}segGroup--dim` : ''}`}
          role="group"
          aria-label="玩家执子"
        >
          <span className={CSS_PREFIX + 'segLabel'}>执子</span>
          <div className={CSS_PREFIX + 'segmented'}>
            {(['black', 'white'] as PlayerColor[]).map((p) => (
              <button
                type="button"
                key={p}
                className={`${CSS_PREFIX}segBtn${eng.playerColor === p ? ` ${CSS_PREFIX}segBtn--on` : ''}`}
                aria-pressed={eng.playerColor === p}
                onClick={() => switchAndRestart({ playerColor: p })}
                title={p === 'black' ? '你执黑先行' : '你执白后行（AI 先手）'}
              >
                {p === 'black' ? '执黑先手' : '执白后手'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className={`${CSS_PREFIX}board ${CSS_PREFIX}boardWrap`}>
        {/* 网格线：外框 + 内部 13×13 线，SVG 与落点共用同一坐标（4% 边距 + 等分 92%） */}
        <svg
          className={CSS_PREFIX + 'grid'}
          viewBox="0 0 1000 1000"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <rect
            x={GRID_PAD_PCT * 10}
            y={GRID_PAD_PCT * 10}
            width={GRID_SPAN_PCT * 10}
            height={GRID_SPAN_PCT * 10}
            className={CSS_PREFIX + 'gridOuter'}
          />
          {INNER_LINE_KEYS.map((k) => {
            const s = ((GRID_PAD_PCT + (k * GRID_SPAN_PCT) / (BOARD_SIZE - 1)) * 10).toFixed(2);
            const lo = GRID_PAD_PCT * 10;
            const hi = (GRID_PAD_PCT + GRID_SPAN_PCT) * 10;
            return (
              <g key={k}>
                <line x1={s} y1={lo} x2={s} y2={hi} className={CSS_PREFIX + 'gridLine'} />
                <line x1={lo} y1={s} x2={hi} y2={s} className={CSS_PREFIX + 'gridLine'} />
              </g>
            );
          })}
        </svg>

        {/* cqw 尺寸基准层（container-type 不参与棋盘 aspect-ratio 布局） */}
        <div className={CSS_PREFIX + 'boardInner'}>
          {cells}

        {overlayShown && (
          <div className={`${CSS_PREFIX}overlay ${CSS_PREFIX}overlay--${eng.over === 3 ? 'draw' : 'win'}`}>
            <div className={CSS_PREFIX + 'overlayTitle'}>
              {eng.over === 3 ? '🤝 和棋' : eng.mode === 'ai' && eng.over === eng.humanColor ? '🎉 你赢了！' : '🏆 对局结束'}
            </div>
            <div className={CSS_PREFIX + 'overlayMsg'}>
              {winnerText} · 共 {eng.history.length} 手
            </div>
            <div className={CSS_PREFIX + 'overlayBtns'}>
              <button
                type="button"
                className={`${CSS_PREFIX}btn ${CSS_PREFIX}btn--primary`}
                onClick={() => setOverlayDismissed(true)}
              >
                欣赏棋盘
              </button>
              <button type="button" className={CSS_PREFIX + 'btn'} onClick={handleNewGame}>
                再来一局
              </button>
            </div>
          </div>
        )}

        {thinking && !overlayShown && (
          <div className={CSS_PREFIX + 'thinkBadge'}>
            <span>🤔 AI 思考中…</span>
          </div>
        )}
        </div>
      </div>

      <div className={CSS_PREFIX + 'hint'}>
        <span>{turnText}</span>
        {eng.mode === 'ai' && eng.over === 0 && !humanTurn && !thinking && (
          <span className={CSS_PREFIX + 'hintEm'}>AI 即将落子，可随时悔棋</span>
        )}
        <span>点击空格落子</span>
        <span>Z 悔棋</span>
        <span>N 新局</span>
      </div>
    </div>
  );
}
