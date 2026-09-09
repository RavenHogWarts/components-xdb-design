/** @jsxImportSource react */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BLACK, BOARD_SIZE } from './types';
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
  type GomokuStatsRecord,
  type GomokuViewProps,
  type PlayerColor,
} from './types';

// 存档防抖间隔（ms）
const PERSIST_DEBOUNCE_MS = 400;
// AI 思考的最小可见延迟（ms）：避免闪烁感，也让交互有节奏
const AI_THINK_MS = 60;
// 新局/悔棋后轮到 AI 的落子延迟（ms）
const AI_RESUME_MS = 120;
// 破坏性操作（切模式/换执子/重开）二次确认窗口（ms）
const CONFIRM_WINDOW_MS = 2500;

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

/** SVG（viewBox 0..1000）坐标系下第 k 条线的坐标 */
const svgCoord = (k: number): string =>
  (GRID_PAD_PCT * 10 + (k * GRID_SPAN_PCT * 10) / (BOARD_SIZE - 1)).toFixed(2);

const INNER_LINE_KEYS = Array.from({ length: BOARD_SIZE - 2 }, (_, i) => i + 1);

/** 视图内的可切换选项（不持久化，随会话生效） */
type UiPrefs = {
  showMoveNumbers: boolean;
  hover: number;
};

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
  const [prefs, setPrefs] = useState<UiPrefs>({ showMoveNumbers: false, hover: -1 });
  const showNums = prefs.showMoveNumbers;
  const hover = prefs.hover;
  // 防误触二次确认：进行中的对局上，切模式/换执子/重开需 2.5s 内再点一次
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const confirmRunRef = useRef<(() => void) | null>(null);
  const confirmTimerRef = useRef<number | null>(null);

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

  const cancelPersist = () => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
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

  const clearConfirm = () => {
    confirmRunRef.current = null;
    if (confirmTimerRef.current !== null) {
      window.clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = null;
    }
    setConfirmId(null);
  };

  /** 轮到 AI 时异步落子（给 UI 让出主线程），落子后走统一 onMove 出口 */
  const scheduleAiMove = (eng: GomokuEngine, delay = AI_THINK_MS) => {
    clearAiTimer();
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
    }, delay);
  };

  /** 落子后的统一出口：持久化 + 结算 + 调度 AI */
  onMoveRef.current = (eng: GomokuEngine) => {
    if (eng.over === 0) {
      schedulePersist();
      // 人机模式且轮到 AI → 异步调度；悔棋退回空盘（AI 先手）也由这里兜底
      if (eng.mode === 'ai' && eng.colorToMove === eng.aiColor) {
        scheduleAiMove(eng);
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
      clearConfirm();
      const current = propsRef.current;
      const eng = engineRef.current;
      if (current?.api && eng && eng.over === 0 && eng.history.length > 0) {
        void patchViewOptions(current.api, current.viewId, { save: eng.snapshot() });
      }
    };
  }, []);

  // 设置页（或外部）修改了 AI 难度 → 同步到进行中的引擎，下一手 AI 立即生效
  useEffect(() => {
    if (engine && engine.mode === 'ai' && engine.aiLevel !== options.aiLevel) {
      engine.aiLevel = options.aiLevel;
      bump();
    }
  }, [engine, options.aiLevel]);

  // AI 先手 / 恢复存档后轮到 AI：引擎更替时兜底调度（悔棋回退由 onMove 处理）
  useEffect(() => {
    if (!engine) return;
    if (
      engine.mode === 'ai' &&
      engine.over === 0 &&
      engine.colorToMove === engine.aiColor &&
      aiTimerRef.current === null
    ) {
      scheduleAiMove(engine, AI_RESUME_MS);
    }
  }, [engine]);

  if (!engine) return null;
  const eng = engine;
  const terminal = eng.over !== 0;
  const humanTurn = eng.mode === 'local' ? true : eng.colorToMove === eng.humanColor;
  const aiToMove = eng.mode === 'ai' && eng.colorToMove === eng.aiColor;
  const overlayShown = terminal && !overlayDismissed;
  const winning = eng.winningLine;
  const winSet = winning !== null && winning.length > 0 ? new Set<number>(winning) : null;

  // ── 操作 ───────────────────────────────────────────────────

  const handleCellClick = (x: number, y: number) => {
    if (eng.over !== 0 || thinking) return;
    if (eng.mode === 'ai' && eng.colorToMove !== eng.humanColor) return;
    if (eng.colorAt(x, y) !== 0) return;
    clearConfirm(); // 落子即视为继续对局
    eng.place(x, y, eng.colorToMove);
    bump();
  };

  /** 悔棋：双人退 1 步；人机退回玩家回合（撤销 AI + 玩家各一步） */
  const handleUndo = () => {
    if (eng.over !== 0 || eng.history.length === 0) return;
    clearConfirm();
    if (eng.mode === 'ai') {
      clearAiTimer();
      setThinking(false);
      eng.undo(2); // 退回空盘且轮到 AI 时，onMove 会自动调度 AI 重下
    } else {
      eng.undo(1);
    }
    bump();
  };

  /** 重开/切换（mode/aiLevel/playerColor 为覆盖项，缺省沿用当前引擎设置） */
  const startNewGame = (
    patch?: Partial<Pick<GomokuOptions, 'mode' | 'aiLevel' | 'playerColor'>>
  ) => {
    cancelPersist();
    clearAiTimer();
    clearConfirm();
    const current = propsRef.current;
    const prev = engineRef.current;
    // 旧局仍在盘上（未终局）→ 丢弃其存档，避免退出后恢复旧局
    if (current?.api && prev && prev.over === 0 && prev.history.length > 0) {
      void clearSave(current.api, current.viewId);
    }
    if (patch && current?.api) {
      void patchViewOptions(current.api, current.viewId, patch);
    }
    const next: GomokuOptions = {
      mode: patch?.mode ?? prev?.mode ?? optionsRef.current.mode,
      aiLevel: patch?.aiLevel ?? prev?.aiLevel ?? optionsRef.current.aiLevel,
      playerColor: patch?.playerColor ?? prev?.playerColor ?? optionsRef.current.playerColor,
      recordScores: optionsRef.current.recordScores,
    };
    const eng2 = GomokuEngine.newGame(next.mode, next.aiLevel, next.playerColor, onMoveProxy);
    engineRef.current = eng2;
    setEngineState(eng2);
    setThinking(false);
    setOverlayDismissed(false);
    setPrefs((p) => ({ ...p, hover: -1 }));
    bump();
    rootRef.current?.focus({ preventScroll: true });
  };

  const handleNewGame = () => startNewGame();

  /** 进行中的对局点按即生效的破坏性操作：需要二次确认 */
  const guardRestart = (id: string, run: () => void) => {
    const engNow = engineRef.current;
    const hasProgress = !!engNow && engNow.history.length > 0 && engNow.over === 0;
    if (!hasProgress) {
      clearConfirm();
      run();
      return;
    }
    if (confirmId === id && confirmRunRef.current) {
      clearConfirm();
      run();
    } else {
      confirmRunRef.current = run;
      setConfirmId(id);
      if (confirmTimerRef.current !== null) window.clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = window.setTimeout(() => {
        confirmTimerRef.current = null;
        confirmRunRef.current = null;
        setConfirmId(null);
      }, CONFIRM_WINDOW_MS);
    }
  };

  /** 切换 AI 难度：不打断对局，对下一手 AI 决策即时生效 */
  const applyAiLevel = (level: AiLevel) => {
    const engNow = engineRef.current;
    if (!engNow || engNow.mode !== 'ai' || engNow.aiLevel === level) return;
    clearConfirm();
    engNow.aiLevel = level;
    bump();
    const current = propsRef.current;
    if (current?.api) void patchViewOptions(current.api, current.viewId, { aiLevel: level });
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
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
      guardRestart('new', handleNewGame);
      return;
    }
  };

  // ── 渲染 ───────────────────────────────────────────────────

  const winnerText =
    eng.over === 3
      ? '和棋'
      : eng.mode === 'ai' && eng.over === eng.humanColor
        ? '你赢了！'
        : eng.mode === 'ai'
          ? 'AI 获胜'
          : `${COLOR_LABELS[eng.over]}方胜利`;

  const turnText = (() => {
    if (eng.over !== 0) return winnerText;
    if (aiToMove) return 'AI 思考中…';
    return eng.mode === 'ai'
      ? `轮到你（执${COLOR_LABELS[eng.colorToMove]}）`
      : `轮到${COLOR_LABELS[eng.colorToMove]}棋`;
  })();

  const moveCountText = eng.over !== 0 ? `共 ${eng.history.length} 手` : `第 ${eng.history.length + 1} 手`;

  // 状态栏回合圆点：终局显示胜方颜色，进行中显示当前执子色（和棋不显示）
  const chipColor =
    eng.over !== 0 && eng.over !== 3
      ? eng.over === BLACK
        ? 'b'
        : 'w'
      : eng.colorToMove === BLACK
        ? 'b'
        : 'w';

  const lastIdx = eng.history.length > 0 ? eng.history[eng.history.length - 1] : -1;

  // 手数标注：棋盘格 idx → 第几手落子
  const moveNoMap = new Map<number, number>();
  if (showNums) {
    for (let i = 0; i < eng.history.length; i++) moveNoMap.set(eng.history[i], i + 1);
  }

  const cells: ReactNode[] = [];
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const idx = y * BOARD_SIZE + x;
      const c = eng.colorAt(x, y);
      const isStar = STAR_POINTS.has(idx);
      const isWin = winSet !== null && c !== 0 && winSet.has(idx);
      const dim = winSet !== null && c !== 0 && !winSet.has(idx);
      const cls =
        `${CSS_PREFIX}point` +
        (c ? ` ${CSS_PREFIX}stone ${CSS_PREFIX}stone--${c === BLACK ? 'b' : 'w'}` : '') +
        (dim ? ` ${CSS_PREFIX}stone--dim` : '');
      cells.push(
        <div
          key={idx}
          className={cls}
          style={{ left: gridPos(x), top: gridPos(y) }}
          onClick={() => handleCellClick(x, y)}
          onPointerEnter={() => setPrefs((p) => ({ ...p, hover: idx }))}
          onPointerLeave={() => setPrefs((p) => ({ ...p, hover: -1 }))}
        >
          {isStar && !c && <span className={CSS_PREFIX + 'star'} />}
          {!c && hover === idx && humanTurn && !terminal && !thinking && (
            <span
              className={`${CSS_PREFIX}ghost ${CSS_PREFIX}stone--${eng.colorToMove === BLACK ? 'b' : 'w'}`}
            />
          )}
          {c !== 0 && showNums && (
            <span className={CSS_PREFIX + 'num'}>{moveNoMap.get(idx)}</span>
          )}
          {idx === lastIdx && winSet === null && (
            <span
              className={`${CSS_PREFIX}lastMark ${c === BLACK ? '' : CSS_PREFIX + 'lastMark--w'}`}
            />
          )}
          {isWin && <span className={CSS_PREFIX + 'winMark'} />}
        </div>
      );
    }
  }

  const statusMain = (
    <div className={CSS_PREFIX + 'statusMain'}>
      {aiToMove && !terminal ? (
        <span className={CSS_PREFIX + 'spinner'} aria-hidden="true" />
      ) : eng.over === 3 ? null : (
        <span className={`${CSS_PREFIX}turnChip ${CSS_PREFIX}turnChip--${chipColor}`} aria-hidden="true" />
      )}
      <span>{turnText}</span>
      <span className={CSS_PREFIX + 'statusMeta'}>{moveCountText}</span>
    </div>
  );

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
          <div className={CSS_PREFIX + 'mode'} title="15×15 · 无禁手 · 连成五子（含长连）即胜">
            {eng.mode === 'ai' ? `人机 · ${AI_LABELS[eng.aiLevel]}` : '双人'} · 15×15
          </div>
        </div>
        {eng.mode === 'ai' && stats && (
          <div className={CSS_PREFIX + 'stats'} title="人机对战累计战绩（设置页可重置）">
            战绩&nbsp;
            <span className={CSS_PREFIX + 'statNum'}>{stats.wins}</span>胜
            <span className={CSS_PREFIX + 'statNum'}>{stats.losses}</span>负
            <span className={CSS_PREFIX + 'statNum'}>{stats.draws}</span>和
          </div>
        )}
        <div className={CSS_PREFIX + 'actions'}>
          <button
            type="button"
            className={`${CSS_PREFIX}btn${showNums ? ` ${CSS_PREFIX}btn--on` : ''}`}
            aria-pressed={showNums}
            onClick={() => setPrefs((p) => ({ ...p, showMoveNumbers: !p.showMoveNumbers }))}
            title="显示/隐藏手数：在棋子上标注第几手落子，复盘更清晰"
          >
            手数
          </button>
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
            className={`${CSS_PREFIX}btn ${CSS_PREFIX}btn--primary${confirmId === 'new' ? ` ${CSS_PREFIX}btn--confirm` : ''}`}
            onClick={() => guardRestart('new', handleNewGame)}
            title={confirmId === 'new' ? '进行中的对局将被放弃，再点一次确认' : '新开一局（N）'}
          >
            {confirmId === 'new' ? '确认开新局？' : '新游戏'}
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
                className={`${CSS_PREFIX}segBtn${eng.mode === m ? ` ${CSS_PREFIX}segBtn--on` : ''}${confirmId === `mode:${m}` ? ` ${CSS_PREFIX}segBtn--confirm` : ''}`}
                aria-pressed={eng.mode === m}
                onClick={() => guardRestart(`mode:${m}`, () => startNewGame({ mode: m }))}
                title={confirmId === `mode:${m}` ? '进行中的对局将被放弃，再点一次确认' : m === 'ai' ? '与电脑对战' : '本地双人同屏（黑先）'}
              >
                {confirmId === `mode:${m}` ? '确认切换？' : MODE_LABELS[m]}
              </button>
            ))}
          </div>
        </div>
        {eng.mode === 'ai' && (
          <>
            <div className={CSS_PREFIX + 'segGroup'} role="group" aria-label="切换 AI 难度">
              <span className={CSS_PREFIX + 'segLabel'}>AI 难度</span>
              <div className={CSS_PREFIX + 'segmented'}>
                {AI_ORDER.map((l) => (
                  <button
                    type="button"
                    key={l}
                    className={`${CSS_PREFIX}segBtn${eng.aiLevel === l ? ` ${CSS_PREFIX}segBtn--on` : ''}`}
                    aria-pressed={eng.aiLevel === l}
                    onClick={() => applyAiLevel(l)}
                    title={`AI 难度：${AI_LABELS[l]}（不打断对局，立即生效）`}
                  >
                    {AI_LABELS[l]}
                  </button>
                ))}
              </div>
            </div>
            <div className={CSS_PREFIX + 'segGroup'} role="group" aria-label="玩家执子">
              <span className={CSS_PREFIX + 'segLabel'}>执子</span>
              <div className={CSS_PREFIX + 'segmented'}>
                {(['black', 'white'] as PlayerColor[]).map((p) => (
                  <button
                    type="button"
                    key={p}
                    className={`${CSS_PREFIX}segBtn${eng.playerColor === p ? ` ${CSS_PREFIX}segBtn--on` : ''}${confirmId === `color:${p}` ? ` ${CSS_PREFIX}segBtn--confirm` : ''}`}
                    aria-pressed={eng.playerColor === p}
                    onClick={() => guardRestart(`color:${p}`, () => startNewGame({ playerColor: p }))}
                    title={confirmId === `color:${p}` ? '进行中的对局将被放弃，再点一次确认' : p === 'black' ? '你执黑先行' : '你执白后行（AI 先手）'}
                  >
                    {confirmId === `color:${p}` ? '确认换边？' : p === 'black' ? '执黑先手' : '执白后手'}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <div
        className={`${CSS_PREFIX}board ${CSS_PREFIX}boardWrap${aiToMove || thinking ? ` ${CSS_PREFIX}boardWrap--waiting` : ''}`}
      >
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
            const s = svgCoord(k);
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

          {/* 获胜连线：穿过全部连珠的发光直线（与落点同坐标系） */}
          {winning !== null && winning.length >= 2 && (
            <svg
              className={CSS_PREFIX + 'winSvg'}
              viewBox="0 0 1000 1000"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <line
                className={CSS_PREFIX + 'winLine'}
                pathLength={1}
                x1={svgCoord(winning[0] % BOARD_SIZE)}
                y1={svgCoord(Math.floor(winning[0] / BOARD_SIZE))}
                x2={svgCoord(winning[winning.length - 1] % BOARD_SIZE)}
                y2={svgCoord(Math.floor(winning[winning.length - 1] / BOARD_SIZE))}
              />
            </svg>
          )}

          {thinking && !overlayShown && (
            <div className={CSS_PREFIX + 'thinkingBar'} aria-hidden="true" />
          )}

          {overlayShown && (
            <div
              className={`${CSS_PREFIX}overlay ${CSS_PREFIX}overlay--${eng.over === 3 ? 'draw' : 'win'}`}
            >
              <div className={CSS_PREFIX + 'overlayTitle'}>
                {eng.over === 3
                  ? '🤝 和棋'
                  : eng.mode === 'ai' && eng.over === eng.humanColor
                    ? '🎉 你赢了！'
                    : eng.mode === 'ai'
                      ? '🤖 AI 获胜'
                      : '🏆 对局结束'}
              </div>
              <div className={CSS_PREFIX + 'overlayMsg'}>
                {winnerText} · 共 {eng.history.length} 手
              </div>
              <div className={CSS_PREFIX + 'overlayBtns'}>
                <button
                  type="button"
                  className={`${CSS_PREFIX}btn ${CSS_PREFIX}btn--primary`}
                  onClick={handleNewGame}
                >
                  再来一局
                </button>
                <button type="button" className={CSS_PREFIX + 'btn'} onClick={() => setOverlayDismissed(true)}>
                  欣赏棋盘
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className={CSS_PREFIX + 'status'}>
        {statusMain}
        <div className={CSS_PREFIX + 'statusKbd'}>
          <span>
            <kbd>Z</kbd> 悔棋
          </span>
          <span>
            <kbd>N</kbd> 新局
          </span>
        </div>
      </div>
    </div>
  );
}
