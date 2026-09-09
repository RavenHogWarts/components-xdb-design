/** @jsxImportSource react */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MinesweeperEngine } from './game/engine';
import { clearSlot, patchViewOptions } from './persist';
import {
  CSS_PREFIX,
  PLUGIN_ID,
  LEVEL_CONFIG,
  LEVEL_LABELS,
  LEVEL_ORDER,
  MODE_LABELS,
  parseGameOptions,
  parseGameSave,
  parseGameStats,
  type MineGameOptions,
  type MineLevel,
  type MineMode,
  type MineStatsRecord,
  type MineViewProps,
} from './types';

// 存档防抖间隔（ms）：翻格/插旗高频触发，落盘合并到 trailing 一次
const PERSIST_DEBOUNCE_MS = 400;
// 触屏长按插旗阈值（ms）
const LONG_PRESS_MS = 380;

// ─────────────────────────────────────────────────────────────
// 对外渲染器：管理 React Root 生命周期
// plugin-core 每次 onUpdate 调用 update()，onDestroy 调用 destroy()。
// onUpdate 是同步、可重复的 render 协议：容器变化时重建 Root。
// ─────────────────────────────────────────────────────────────
export function createViewRenderer() {
  let root: Root | null = null;
  let lastContainer: HTMLElement | null = null;

  return {
    update(props: MineViewProps) {
      if (!root || lastContainer !== props.container) {
        if (root) root.unmount();
        props.container.replaceChildren();
        root = createRoot(props.container);
        lastContainer = props.container;
      }
      root.render(<MineApp props={props} />);
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

function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

/** 数字配色类：1-8 经典扫雷色 */
function numClass(n: number): string {
  return `${CSS_PREFIX}num${n}`;
}

function MineApp({ props }: { props: MineViewProps }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  // onUpdate 每轮传入最新 props；异步回调通过 ref 取当前值，避免闭包过期
  const propsRef = useRef(props);
  propsRef.current = props;

  const pluginOptions = asRecord(props.viewDefinition?.options?.[PLUGIN_ID]);
  const options: MineGameOptions = parseGameOptions(pluginOptions);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const stats = parseGameStats(pluginOptions.stats);
  const statsRef = useRef<MineStatsRecord | null>(stats);
  statsRef.current = stats;
  // 两份存档只在挂载时读取一次：之后由本视图自己的写回驱动 viewDefinition 变化
  const freeSave = useMemo(() => parseGameSave(pluginOptions.save), []); // eslint-disable-line react-hooks/exhaustive-deps
  const dailySave = useMemo(() => parseGameSave(pluginOptions.dailySave), []); // eslint-disable-line react-hooks/exhaustive-deps

  // 引擎状态：双模式各持一个、切换即换指针（避免反复重新开局）
  const enginesRef = useRef<{ free: MinesweeperEngine | null; daily: MinesweeperEngine | null }>({
    free: null,
    daily: null,
  });
  const [activeMode, setActiveMode] = useState<MineMode>(() =>
    options.mode === 'daily' ? 'daily' : 'free'
  );
  /** 键盘/触屏选中格 */
  const [selected, setSelected] = useState(0);
  /** 插旗模式：点击未翻格 = 插旗/拔旗（右键/长按不受此开关限制） */
  const [flagMode, setFlagMode] = useState(false);
  /** 主动暂停：盖住棋盘停表（失焦暂停之外的手动开关） */
  const [paused, setPaused] = useState(false);
  const [focused, setFocused] = useState(false);
  /** 终局遮罩是否已关闭（胜利局可关掉遮罩看终盘） */
  const [overlayDismissed, setOverlayDismissed] = useState(false);
  const [version, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);

  const saveTimerRef = useRef<number | null>(null);
  // 按压判定：pointerdown 记录起点，pointerup 按「时长 + 位移」区分
  // 短按 = 主操作 / 长按 = 插旗（单一路径，无 click 竞态）
  const pressRef = useRef<{ cell: number; x: number; y: number; t0: number } | null>(null);
  const [pressedCell, setPressedCell] = useState(-1);

  // onSettled 由引擎持有，代理到 ref 保证回调始终是最新实现
  const settledRef = useRef<(engine: MinesweeperEngine, result: 'won' | 'lost' | null) => void>(
    () => undefined
  );
  const settledProxy = useRef(
    (engine: MinesweeperEngine, result: 'won' | 'lost' | null) =>
      settledRef.current(engine, result)
  ).current;

  /** 取某模式的引擎：优先已驻留的，其次恢复未终局的存档，最后开新局 */
  const createEngine = (mode: MineMode): MinesweeperEngine => {
    const today = MinesweeperEngine.todayKey();
    const save = mode === 'daily' ? dailySave : freeSave;
    const usable =
      save !== null &&
      save.mode === mode &&
      save.state !== 'won' &&
      save.state !== 'lost' &&
      (mode === 'free' || save.day === today);
    if (usable) return new MinesweeperEngine({ save, onSettled: settledProxy });
    if (mode === 'daily') return MinesweeperEngine.newDaily(settledProxy);
    return MinesweeperEngine.newFree(optionsRef.current.level, settledProxy);
  };

  // 首次渲染即初始化当前模式的引擎
  if (!enginesRef.current[activeMode]) {
    enginesRef.current[activeMode] = createEngine(activeMode);
  }
  const engine = enginesRef.current[activeMode]!;
  const terminal = engine.state === 'won' || engine.state === 'lost';

  // ── 持久化：防抖落盘进行中的局；终局清槽位并结算 ──
  const persistNow = () => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const current = propsRef.current;
    if (!current?.api) return;
    for (const eng of [enginesRef.current.free, enginesRef.current.daily]) {
      if (!eng || eng.state === 'won' || eng.state === 'lost') continue;
      const key = eng.mode === 'daily' ? 'dailySave' : 'save';
      void patchViewOptions(current.api, current.viewId, { [key]: eng.snapshot() });
    }
  };

  const schedulePersist = () => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      persistNow();
    }, PERSIST_DEBOUNCE_MS);
  };

  settledRef.current = (eng: MinesweeperEngine, result: 'won' | 'lost' | null) => {
    if (!result) {
      schedulePersist();
      return;
    }
    // 终局：展示遮罩、清存档、刷新统计、按需写战绩行
    const isWin = result === 'won';
    setOverlayDismissed(false);
    const current = propsRef.current;
    if (!current?.api) return;
    const key = eng.mode === 'daily' ? 'dailySave' : 'save';
    void clearSlot(current.api, current.viewId, key);
    const prev = statsRef.current;
    const prevBest = prev?.best?.[eng.level];
    const nextStats: MineStatsRecord = {
      solved: (prev?.solved ?? 0) + (isWin ? 1 : 0),
      games: (prev?.games ?? 0) + 1,
      best: isWin
        ? {
            ...(prev?.best ?? {}),
            [eng.level]: Math.min(prevBest ?? eng.elapsedMs, eng.elapsedMs),
          }
        : { ...(prev?.best ?? {}) },
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
          minesweeper: true,
          difficulty: LEVEL_LABELS[eng.level],
          mode: MODE_LABELS[eng.mode],
          seconds: Math.round(eng.elapsedMs / 1000),
          result: isWin ? 'solved' : 'boom',
          date: dateText,
        },
      })
      .catch((error: unknown) => {
        console.error('[xdb-plugin] minesweeper: 写入战绩行失败', error);
      });
  };

  // 卸载前把进行中的局落盘（patch 为 fire-and-forget，不受卸载影响）
  useEffect(() => {
    const timer = saveTimerRef;
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      const current = propsRef.current;
      if (!current?.api) return;
      for (const eng of [enginesRef.current.free, enginesRef.current.daily]) {
        if (!eng || eng.state === 'won' || eng.state === 'lost') continue;
        const key = eng.mode === 'daily' ? 'dailySave' : 'save';
        void patchViewOptions(current.api, current.viewId, { [key]: eng.snapshot() });
      }
    };
  }, []);

  // 计时：视图聚焦、未暂停且未终局时每秒累加（引擎内部再按 playing 态收口）
  useEffect(() => {
    if (!focused || paused || terminal) return;
    const id = window.setInterval(() => {
      engine.addElapsed(1000);
      bump();
    }, 1000);
    return () => window.clearInterval(id);
  }, [focused, paused, terminal, engine]);

  // 首次挂载聚焦，键盘立即可用
  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
  }, []);

  // ── 输入 ───────────────────────────────────────────────────

  /** 主操作：未翻开 = 翻开；已翻开的数字格 = 和弦展开 */
  const doPrimary = (idx: number) => {
    if (terminal) return;
    if (engine.isFlagged(idx)) return;
    if (engine.isRevealed(idx)) {
      engine.chord(idx);
    } else if (flagMode) {
      engine.toggleFlag(idx);
    } else {
      engine.reveal(idx);
    }
    bump();
  };

  const handlePointerDown = (idx: number, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    setSelected(idx);
    setPressedCell(idx);
    pressRef.current = { cell: idx, x: e.clientX, y: e.clientY, t0: Date.now() };
    // 指针捕获：按住滑出格界仍算本格，长按判定不因 pointerleave 中断
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* 个别环境不支持捕获，忽略 */
    }
  };

  const handlePointerUp = (idx: number, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const press = pressRef.current;
    pressRef.current = null;
    setPressedCell(-1);
    if (!press || press.cell !== idx || terminal) return;
    // 位移超过 10px 视为滑动（误触/滚动），不执行任何操作
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) return;
    const held = Date.now() - press.t0;
    if (held >= LONG_PRESS_MS && !engine.isRevealed(idx)) {
      engine.toggleFlag(idx); // 长按插旗（触屏无右键的替代路径）
      bump();
      return;
    }
    doPrimary(idx);
  };

  const handlePointerCancel = () => {
    pressRef.current = null;
    setPressedCell(-1);
  };

  const handleContextMenu = (idx: number, e: React.MouseEvent) => {
    e.preventDefault(); // 屏蔽宿主导航菜单
    setSelected(idx);
    if (pressRef.current) {
      // 触屏长按由系统先发 contextmenu 的路径：这里完成插旗并清掉按压态，
      // 随后的 pointerup 不再重复翻转（旧实现的“插了又拔”根因）
      engine.toggleFlag(idx);
      bump();
      pressRef.current = null;
      setPressedCell(-1);
      return;
    }
    engine.toggleFlag(idx); // 鼠标右键
    bump();
  };

  /** 同模式新局：每日 = 重开今日局（同种子同雷局），自由 = 换一局 */
  const handleNewGame = () => {
    persistNow();
    const next =
      activeMode === 'daily'
        ? MinesweeperEngine.newDaily(settledProxy)
        : MinesweeperEngine.newFree(engine.level, settledProxy);
    enginesRef.current[activeMode] = next;
    setSelected(0);
    setFlagMode(false);
    setPaused(false);
    setOverlayDismissed(false);
    bump();
    rootRef.current?.focus({ preventScroll: true });
  };

  /** 模式切换：另一模式的局驻留在内存，切回即恢复 */
  const handleSwitchMode = (mode: MineMode) => {
    if (mode === activeMode) return;
    persistNow();
    if (!enginesRef.current[mode]) enginesRef.current[mode] = createEngine(mode);
    setActiveMode(mode);
    setSelected(0);
    setPaused(false);
    setOverlayDismissed(false);
    const current = propsRef.current;
    if (current?.api) void patchViewOptions(current.api, current.viewId, { mode });
    bump();
    rootRef.current?.focus({ preventScroll: true });
  };

  /** 难度切换：立即开对应自由局；每日模式下点击 = 转入自由模式 */
  const handleSwitchLevel = (level: MineLevel) => {
    if (activeMode === 'free' && engine.level === level) return;
    persistNow();
    enginesRef.current.free = MinesweeperEngine.newFree(level, settledProxy);
    setActiveMode('free');
    setSelected(0);
    setFlagMode(false);
    setPaused(false);
    setOverlayDismissed(false);
    const current = propsRef.current;
    if (current?.api) {
      void patchViewOptions(current.api, current.viewId, { level, mode: 'free' });
    }
    bump();
    rootRef.current?.focus({ preventScroll: true });
  };

  // 键盘：整个根容器为聚焦容器，不劫持 Obsidian 全局快捷键
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
    ) {
      return;
    }
    // Esc 任意时刻切换暂停；暂停中按其它任何键 = 恢复（该次按键不落到棋盘）
    if (e.key === 'Escape') {
      e.preventDefault();
      setPaused((v) => !v);
      return;
    }
    if (paused) {
      e.preventDefault();
      setPaused(false);
      return;
    }
    const cols = engine.cols;
    const move = (dr: number, dc: number) => {
      const r = Math.min(engine.rows - 1, Math.max(0, ((selected / cols) | 0) + dr));
      const c = Math.min(cols - 1, Math.max(0, (selected % cols) + dc));
      setSelected(r * cols + c);
    };
    switch (e.key) {
      case 'ArrowUp':
      case 'w':
      case 'W':
        e.preventDefault();
        move(-1, 0);
        return;
      case 'ArrowDown':
      case 's':
      case 'S':
        e.preventDefault();
        move(1, 0);
        return;
      case 'ArrowLeft':
      case 'a':
      case 'A':
        e.preventDefault();
        move(0, -1);
        return;
      case 'ArrowRight':
      case 'd':
      case 'D':
        e.preventDefault();
        move(0, 1);
        return;
    }
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      setSelected(selected);
      doPrimary(selected);
      return;
    }
    if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      if (!engine.isRevealed(selected)) {
        engine.toggleFlag(selected);
        bump();
      }
      return;
    }
    if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      handleNewGame();
      return;
    }
  };

  // 焦点追踪：子元素间移动会先冒泡 blur，延迟一拍看最终落点是否仍在根内
  const handleRootBlur = () => {
    window.setTimeout(() => {
      if (!rootRef.current?.contains(document.activeElement)) setFocused(false);
    }, 0);
  };

  // ── 渲染 ───────────────────────────────────────────────────
  const cfg = LEVEL_CONFIG[engine.level];
  const bestMs = stats?.best?.[engine.level];
  const face = engine.state === 'won' ? '😎' : engine.state === 'lost' ? '😵' : '🙂';
  const terminalShown = terminal && !overlayDismissed;

  const cells: React.ReactNode[] = [];
  for (let i = 0; i < engine.total; i++) {
    const revealed = engine.isRevealed(i);
    const flagged = engine.isFlagged(i);
    const mine = engine.isMine(i);
    const lost = engine.state === 'lost';
    const won = engine.state === 'won';

    // 终局展示：雷格亮出（踩中的加红底）、错旗打叉；未翻的非雷格保持抬起
    let content: React.ReactNode = null;
    let kind = '';
    if (revealed) {
      const n = engine.numberAt(i);
      content = n > 0 ? (
        <span className={`${CSS_PREFIX}cellDigit ${numClass(n)}`}>{n}</span>
      ) : null;
      kind = 'open';
    } else if (flagged) {
      if (won || !lost || mine) {
        content = '🚩';
        kind = 'flag';
      } else {
        content = '❌';
        kind = 'wrong';
      }
    } else if (lost && mine) {
      content = '💣';
      kind = i === engine.explodedAt ? 'boom' : 'mine';
    }
    cells.push(
      <div
        key={i}
        className={[
          CSS_PREFIX + 'cell',
          kind ? ` ${CSS_PREFIX}cell--${kind}` : '',
          i === selected ? ` ${CSS_PREFIX}cell--sel` : '',
          i === pressedCell ? ` ${CSS_PREFIX}cell--down` : '',
        ].join('')}
        onPointerDown={(e) => handlePointerDown(i, e)}
        onPointerUp={(e) => handlePointerUp(i, e)}
        onPointerCancel={handlePointerCancel}
        onContextMenu={(e) => handleContextMenu(i, e)}
      >
        {content}
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className={CSS_PREFIX + 'root'}
      tabIndex={0}
      role="application"
      aria-label={`扫雷棋盘，${MODE_LABELS[engine.mode]}，${LEVEL_LABELS[engine.level]}`}
      onKeyDown={handleKeyDown}
      onFocus={() => setFocused(true)}
      onBlur={handleRootBlur}
    >
      <div className={CSS_PREFIX + 'topbar'}>
        <div className={CSS_PREFIX + 'brand'}>
          <div className={CSS_PREFIX + 'logo'}>扫雷</div>
          <div className={CSS_PREFIX + 'mode'}>
            {MODE_LABELS[engine.mode]} · {LEVEL_LABELS[engine.level]} ·{' '}
            {cfg.cols}×{cfg.rows} · {cfg.mines} 雷
          </div>
        </div>
        <div className={CSS_PREFIX + 'scores'}>
          <div className={CSS_PREFIX + 'scoreBox'}>
            <span className={CSS_PREFIX + 'scoreLabel'}>💣 雷</span>
            <span className={CSS_PREFIX + 'scoreValue'}>{engine.minesLeft}</span>
          </div>
          <div className={CSS_PREFIX + 'scoreBox'}>
            <span className={CSS_PREFIX + 'scoreLabel'}>用时</span>
            <span className={CSS_PREFIX + 'scoreValue'}>{formatTime(engine.elapsedMs)}</span>
          </div>
          <div className={CSS_PREFIX + 'scoreBox'}>
            <span className={CSS_PREFIX + 'scoreLabel'}>最佳</span>
            <span className={CSS_PREFIX + 'scoreValue'}>
              {bestMs !== undefined ? formatTime(bestMs) : '—'}
            </span>
          </div>
        </div>
        <div className={CSS_PREFIX + 'actions'}>
          <button
            type="button"
            className={CSS_PREFIX + 'faceBtn'}
            onClick={handleNewGame}
            title="新开一局（N）"
            aria-label="新开一局"
          >
            <span className={CSS_PREFIX + 'face'}>{face}</span>
          </button>
        </div>
      </div>

      <div className={CSS_PREFIX + 'switchRow'}>
        <div className={CSS_PREFIX + 'segGroup'} role="group" aria-label="切换模式">
          <span className={CSS_PREFIX + 'segLabel'}>模式</span>
          <div className={CSS_PREFIX + 'segmented'}>
            {(['daily', 'free'] as MineMode[]).map((m) => (
              <button
                type="button"
                key={m}
                className={`${CSS_PREFIX}segBtn${activeMode === m ? ` ${CSS_PREFIX}segBtn--on` : ''}`}
                aria-pressed={activeMode === m}
                onClick={() => handleSwitchMode(m)}
              >
                {MODE_LABELS[m]}
              </button>
            ))}
          </div>
        </div>
        <div className={CSS_PREFIX + 'segGroup'} role="group" aria-label="切换难度">
          <span className={CSS_PREFIX + 'segLabel'}>难度</span>
          <div className={CSS_PREFIX + 'segmented'}>
            {LEVEL_ORDER.map((l) => (
              <button
                type="button"
                key={l}
                className={`${CSS_PREFIX}segBtn${engine.level === l ? ` ${CSS_PREFIX}segBtn--on` : ''}`}
                aria-pressed={engine.level === l}
                onClick={() => handleSwitchLevel(l)}
                title={
                  activeMode === 'daily'
                    ? `转入自由模式 · ${LEVEL_LABELS[l]}（立即开局）`
                    : `切换到${LEVEL_LABELS[l]}（立即开局）`
                }
              >
                {LEVEL_LABELS[l]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div
        className={CSS_PREFIX + 'board'}
        style={{ '--cols': cfg.cols, '--rows': cfg.rows } as React.CSSProperties}
      >
        <div className={CSS_PREFIX + 'boardInner'}>{cells}</div>

        {terminalShown && (
          <div className={`${CSS_PREFIX}overlay ${CSS_PREFIX}overlay--${engine.state}`}>
            <div className={CSS_PREFIX + 'overlayTitle'}>
              {engine.state === 'won' ? '🎉 扫清了！' : '💥 踩到雷了'}
            </div>
            <div className={CSS_PREFIX + 'overlayMsg'}>
              {engine.state === 'won' ? (
                <>
                  {LEVEL_LABELS[engine.level]} · 用时 {formatTime(engine.elapsedMs)}
                  {bestMs !== undefined && engine.elapsedMs === bestMs
                    ? ' · 🏅 新最佳！'
                    : ''}
                </>
              ) : (
                <>本局用时 {formatTime(engine.elapsedMs)}，再试一次？</>
              )}
            </div>
            <div className={CSS_PREFIX + 'overlayBtns'}>
              {engine.state === 'won' && (
                <button
                  type="button"
                  className={`${CSS_PREFIX}btn ${CSS_PREFIX}btn--primary`}
                  onClick={() => setOverlayDismissed(true)}
                >
                  欣赏棋盘
                </button>
              )}
              <button type="button" className={CSS_PREFIX + 'btn'} onClick={handleNewGame}>
                {activeMode === 'daily' ? '重开今日' : '再来一局'}
              </button>
            </div>
          </div>
        )}

        {paused && !terminal && (
          <div
            className={CSS_PREFIX + 'veil'}
            onClick={() => setPaused(false)}
            role="button"
            aria-label="继续游戏"
          >
            <span className={CSS_PREFIX + 'veilText'}>⏸ 已暂停 · 点击或按任意键继续</span>
          </div>
        )}

        {!focused && !paused && !terminalShown && (
          <div className={CSS_PREFIX + 'veil'}>
            <span className={CSS_PREFIX + 'veilText'}>点击任意处开始 · 计时已暂停</span>
          </div>
        )}
      </div>

      <div className={CSS_PREFIX + 'toolRow'}>
        <button
          type="button"
          className={`${CSS_PREFIX}npTool${flagMode ? ` ${CSS_PREFIX}npTool--on` : ''}`}
          onClick={() => setFlagMode((v) => !v)}
          title="插旗模式：左键点击即插旗/拔旗；未开启时左键翻格，右键/长按随时可插旗"
        >
          🚩 插旗{flagMode ? ' 开' : ''}
        </button>
        <button
          type="button"
          className={`${CSS_PREFIX}npTool${paused ? ` ${CSS_PREFIX}npTool--on` : ''}`}
          onClick={() => {
            setPaused((v) => !v);
            rootRef.current?.focus({ preventScroll: true });
          }}
          title="暂停计时并盖住棋盘（Esc），按任意键继续"
        >
          {paused ? '▶ 继续' : '⏸ 暂停'}
        </button>
      </div>

      <div className={CSS_PREFIX + 'hint'}>
        <span>左键翻格 / 右键或长按插旗</span>
        <span>数字上再点 = 和弦展开</span>
        <span>方向键 / WASD 移动</span>
        <span>空格 翻格 / F 插旗</span>
        <span>N 新局</span>
        <span>Esc 暂停</span>
      </div>
    </div>
  );
}
