/** @jsxImportSource react */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
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
// 长按阈值：按住超过该时长后松开，需仍在原格内才执行（移出 = 取消）
const LONG_PRESS_MS = 400;
// 破坏性操作（重开/切难度）二次确认窗口（ms）
const CONFIRM_WINDOW_MS = 2500;

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
  /** 本局是否刷新该难度最佳（结算面板 🏅 文案） */
  const [isRecord, setIsRecord] = useState(false);
  const [version, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);

  const saveTimerRef = useRef<number | null>(null);
  // 防误触二次确认：有进度的对局上，重开/切难度需 2.5s 内再点一次
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const confirmRunRef = useRef<(() => void) | null>(null);
  const confirmTimerRef = useRef<number | null>(null);
  // 按压判定：pointerdown 记录起点与时刻，pointerup 按「位移 + 按住时长」决定
  // 是否执行主操作（短按小位移容差 / 长按需同格松开；单一路径，无 click 竞态）
  const pressRef = useRef<{ cell: number; x: number; y: number; t0: number } | null>(null);
  const [pressedCell, setPressedCell] = useState(-1);
  /** 棋盘格按住中：HUD 笑脸变 😮（经典行为，松开/取消恢复） */
  const [faceDown, setFaceDown] = useState(false);

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
    if (usable) return MinesweeperEngine.fromSave(save, settledProxy);
    if (mode === 'daily') return MinesweeperEngine.newDaily(settledProxy);
    return MinesweeperEngine.newFree(optionsRef.current.level, settledProxy);
  };

  // 首次渲染即初始化当前模式的引擎
  if (!enginesRef.current[activeMode]) {
    enginesRef.current[activeMode] = createEngine(activeMode);
  }
  const engine = enginesRef.current[activeMode]!;
  const terminal = engine.state === 'won' || engine.state === 'lost';

  /** 引擎是否已有可见进度（重开/切难度的防误触判定依据） */
  const boardTouched = (eng: MinesweeperEngine | null): boolean => {
    if (!eng || eng.state === 'won' || eng.state === 'lost') return false;
    return eng.state !== 'ready' || eng.revealed.size > 0 || eng.flags.size > 0;
  };

  /** 引擎是否完全空白（无任何操作的新局：无恢复价值，不落盘） */
  const isPristine = (eng: MinesweeperEngine | null): boolean => {
    if (!eng || eng.state === 'won' || eng.state === 'lost') return false;
    return (
      eng.state === 'ready' &&
      eng.revealed.size === 0 &&
      eng.flags.size === 0 &&
      eng.elapsedMs === 0
    );
  };

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
      // 全新未开局：清掉可能残留的旧存档，避免退出后恢复回旧局
      if (isPristine(eng)) {
        void clearSlot(current.api, current.viewId, key);
        continue;
      }
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

  const clearConfirm = () => {
    confirmRunRef.current = null;
    if (confirmTimerRef.current !== null) {
      window.clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = null;
    }
    setConfirmId(null);
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
    const record = isWin && (prevBest === undefined || eng.elapsedMs < prevBest);
    setIsRecord(record);
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
    if (isWin && eng.mode === 'daily' && eng.day) {
      void patchViewOptions(current.api, current.viewId, { dailyDone: eng.day });
    }

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
    return () => {
      persistNow();
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

  /** 暂停中点击控件 = 先继续再执行（避免对遮罩后的棋盘盲操作） */
  const resumeIfPaused = () => {
    if (paused) setPaused(false);
  };

  /** 主操作：未翻开 = 翻开；已翻开的数字格 = 和弦展开；
      插旗模式下左键 = 插旗/拔旗（旗格只在翻格模式下受保护） */
  const doPrimary = (idx: number) => {
    if (terminal) return;
    if (engine.isRevealed(idx)) {
      engine.chord(idx);
    } else if (flagMode) {
      engine.toggleFlag(idx);
    } else {
      if (engine.isFlagged(idx)) return;
      engine.reveal(idx);
    }
    bump();
  };

  /** 右键按下 = 立即插旗/拔旗（比等 contextmenu 更快；触屏长按不再标旗） */
  const handleFlagPointerDown = (idx: number) => {
    if (terminal) return;
    setSelected(idx);
    setPressedCell(-1);
    pressRef.current = null;
    resumeIfPaused();
    engine.toggleFlag(idx);
    bump();
  };

  /** 松开时指针是否仍落在原格内（长按需同格松开才执行） */
  const insideCell = (idx: number, e: React.PointerEvent): boolean => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return (
      e.clientX >= rect.left &&
      e.clientX <= rect.right &&
      e.clientY >= rect.top &&
      e.clientY <= rect.bottom
    );
  };

  const handlePointerDown = (idx: number, e: React.PointerEvent) => {
    if (terminal) return;
    if (e.button === 2) {
      handleFlagPointerDown(idx);
      return;
    }
    if (e.button !== 0) return;
    setSelected(idx);
    setPressedCell(idx);
    setFaceDown(true); // 按住棋盘格：笑脸变 😮（经典行为，松开恢复）
    pressRef.current = { cell: idx, x: e.clientX, y: e.clientY, t0: Date.now() };
    // 指针捕获：按住滑出格界仍算本格，按压判定不因 pointerleave 中断
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
    setFaceDown(false);
    if (!press || press.cell !== idx || terminal) return;
    // 短按：小位移容差内即执行；长按：必须松开时仍在原格内才执行（移出 = 取消）
    const held = Date.now() - press.t0;
    if (held < LONG_PRESS_MS) {
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) return;
    } else if (!insideCell(idx, e)) {
      return;
    }
    resumeIfPaused();
    doPrimary(idx);
  };

  const handlePointerCancel = () => {
    pressRef.current = null;
    setPressedCell(-1);
    setFaceDown(false);
  };

  /** 统一屏蔽宿主菜单（鼠标右键/触屏长按的系统菜单都走这里，不执行任何操作） */
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
  };

  /** 同模式新局：每日 = 重开今日局（同种子同雷局），自由 = 换一局 */
  const handleNewGame = () => {
    persistNow();
    const current = propsRef.current;
    const key = activeMode === 'daily' ? 'dailySave' : 'save';
    if (current?.api) void clearSlot(current.api, current.viewId, key);
    const next =
      activeMode === 'daily'
        ? MinesweeperEngine.newDaily(settledProxy)
        : MinesweeperEngine.newFree(engine.level, settledProxy);
    enginesRef.current[activeMode] = next;
    setSelected(0);
    setPaused(false);
    setOverlayDismissed(false);
    setIsRecord(false);
    bump();
    rootRef.current?.focus({ preventScroll: true });
  };

  /** 模式切换：另一模式的局驻留在内存，切回即恢复（不丢进度，无需确认） */
  const handleSwitchMode = (mode: MineMode) => {
    if (mode === activeMode) return;
    persistNow();
    clearConfirm();
    if (!enginesRef.current[mode]) enginesRef.current[mode] = createEngine(mode);
    setActiveMode(mode);
    setSelected(0);
    setPaused(false);
    setIsRecord(false);
    setOverlayDismissed(false);
    const current = propsRef.current;
    if (current?.api) void patchViewOptions(current.api, current.viewId, { mode });
    bump();
    rootRef.current?.focus({ preventScroll: true });
  };

  /** 难度切换：立即开对应自由局；每日模式下点击 = 转入自由模式。
      会替换自由引擎——若旧自由局已有进度，需二次确认（防误触）。 */
  const handleSwitchLevel = (level: MineLevel) => {
    if (activeMode === 'free' && engine.level === level) return;
    persistNow();
    const current = propsRef.current;
    if (current?.api) void clearSlot(current.api, current.viewId, 'save');
    enginesRef.current.free = MinesweeperEngine.newFree(level, settledProxy);
    setActiveMode('free');
    setSelected(0);
    setPaused(false);
    setOverlayDismissed(false);
    setIsRecord(false);
    if (current?.api) {
      void patchViewOptions(current.api, current.viewId, { level, mode: 'free' });
    }
    bump();
    rootRef.current?.focus({ preventScroll: true });
  };

  /** 有进度的对局上点按即生效的破坏性操作：需要二次确认 */
  const guardRestart = (id: string, run: () => void) => {
    // 每日模式下切难度不破坏当前每日局（引擎驻留），只可能丢弃自由旧局
    const victim =
      id.startsWith('level:') ? enginesRef.current.free : enginesRef.current[activeMode];
    if (!boardTouched(victim)) {
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

  // 键盘：整个根容器为聚焦容器，不劫持 Obsidian 全局快捷键
  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
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
      guardRestart('new', handleNewGame);
      return;
    }
  };

  // 焦点追踪：子元素间移动会先冒泡 blur，延迟一拍看最终落点是否仍在根内
  const handleRootBlur = () => {
    window.setTimeout(() => {
      if (!rootRef.current?.contains(document.activeElement)) setFocused(false);
    }, 0);
  };

  /** 点棋盘/遮罩任意处 = 回到棋盘并获得键盘焦点（失焦遮罩消失、计时恢复） */
  const focusRoot = () => {
    setPaused(false);
    rootRef.current?.focus({ preventScroll: true });
  };

  // ── 渲染 ───────────────────────────────────────────────────
  const cfg = LEVEL_CONFIG[engine.level];
  const bestMs = stats?.best?.[engine.level];
  // 笑脸状态：确认重开 🤨 / 按住棋盘格(进行中) 😮 / 胜利 😎 / 踩雷 😵 / 待机 🙂
  const face =
    confirmId === 'new'
      ? '🤨'
      : faceDown && !terminal
        ? '😮'
        : engine.state === 'won'
          ? '😎'
          : engine.state === 'lost'
            ? '😵'
            : '🙂';
  const terminalShown = terminal && !overlayDismissed;
  const confirmNew = confirmId === 'new';
  const dailyDoneToday =
    activeMode === 'daily' && options.dailyDone === MinesweeperEngine.todayKey();

  const cells: ReactNode[] = [];
  for (let i = 0; i < engine.total; i++) {
    const revealed = engine.isRevealed(i);
    const flagged = engine.isFlagged(i);
    const mine = engine.isMine(i);
    const lost = engine.state === 'lost';
    const won = engine.state === 'won';

    // 终局展示：雷格亮出（踩中的加红底）、错旗打叉；未翻的非雷格保持抬起
    let content: ReactNode = null;
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
        onContextMenu={handleContextMenu}
      >
        {content}
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className={CSS_PREFIX + 'root'}
      style={{ '--cols': cfg.cols, '--rows': cfg.rows } as React.CSSProperties}
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
            {MODE_LABELS[engine.mode]} · {LEVEL_LABELS[engine.level]} · {cfg.cols}×{cfg.rows} ·{' '}
            {cfg.mines} 雷
          </div>
        </div>
        <div className={CSS_PREFIX + 'actions'}>
          <button
            type="button"
            className={`${CSS_PREFIX}btn${flagMode ? ` ${CSS_PREFIX}btn--on` : ''}`}
            aria-pressed={flagMode}
            onClick={() => {
              resumeIfPaused();
              setFlagMode((v) => !v);
            }}
            title="插旗模式：左键点击即插旗/拔旗（触屏推荐）；未开启时左键翻格，右键随时可插旗"
          >
            🚩 插旗{flagMode ? '·开' : ''}
          </button>
          <button
            type="button"
            className={`${CSS_PREFIX}btn${paused ? ` ${CSS_PREFIX}btn--on` : ''}`}
            onClick={() => {
              setPaused((v) => !v);
              rootRef.current?.focus({ preventScroll: true });
            }}
            title="暂停计时并盖住棋盘（Esc），点击遮罩或按任意键继续"
          >
            {paused ? '▶ 继续' : '⏸ 暂停'}
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
                title={m === 'daily' ? '每日一局：同日同难度，同首击同雷局' : '自由练习：自选难度随机局'}
              >
                {MODE_LABELS[m]}
              </button>
            ))}
          </div>
        </div>
        <div className={CSS_PREFIX + 'segGroup'} role="group" aria-label="切换难度">
          <span className={CSS_PREFIX + 'segLabel'}>难度</span>
          <div className={CSS_PREFIX + 'segmented'}>
            {LEVEL_ORDER.map((l) => {
              const armed = confirmId === `level:${l}`;
              const on =
                engine.level === l &&
                (activeMode === 'free' || (activeMode === 'daily' && confirmId === null));
              return (
                <button
                  type="button"
                  key={l}
                  className={`${CSS_PREFIX}segBtn${on ? ` ${CSS_PREFIX}segBtn--on` : ''}${armed ? ` ${CSS_PREFIX}segBtn--confirm` : ''}`}
                  aria-pressed={on}
                  onClick={() => guardRestart(`level:${l}`, () => handleSwitchLevel(l))}
                  title={
                    armed
                      ? '进行中的自由局将被放弃，再点一次确认'
                      : activeMode === 'daily'
                        ? `转入自由模式 · ${LEVEL_LABELS[l]}（立即开局）`
                        : `切换到${LEVEL_LABELS[l]}（立即开局）`
                  }
                >
                  {armed ? '确认切换？' : LEVEL_LABELS[l]}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* 经典状态条：剩余雷 · 笑脸(新局) · 用时/最佳 */}
      <div className={CSS_PREFIX + 'hud'}>
        <div
          className={`${CSS_PREFIX}hudBox${engine.minesLeft < 0 ? ` ${CSS_PREFIX}hudBox--neg` : ''}`}
          title="剩余雷数 = 总雷数 − 已插旗数"
        >
          <span className={CSS_PREFIX + 'hudIcon'} aria-hidden="true">💣</span>
          <span className={CSS_PREFIX + 'hudValue'}>{engine.minesLeft}</span>
        </div>
        <button
          type="button"
          className={`${CSS_PREFIX}hudFace${confirmNew ? ` ${CSS_PREFIX}hudFace--confirm` : ''}`}
          onClick={() => guardRestart('new', handleNewGame)}
          title={confirmNew ? '进行中的一局将被放弃，再点一次确认' : '新开一局（N）'}
          aria-label="新开一局"
        >
          <span className={CSS_PREFIX + 'face'}>{face}</span>
        </button>
        <div className={CSS_PREFIX + 'hudBox'} title={paused ? '已暂停（Esc 或点任意控件继续）' : '本局用时'}>
          <span className={CSS_PREFIX + 'hudIcon'} aria-hidden="true">{paused ? '⏸' : '⏱'}</span>
          <span className={CSS_PREFIX + 'hudValue'}>{formatTime(engine.elapsedMs)}</span>
          {bestMs !== undefined && !terminal && (
            <span className={CSS_PREFIX + 'hudBest'}>最佳 {formatTime(bestMs)}</span>
          )}
        </div>
      </div>

      <div className={CSS_PREFIX + 'board'}>
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
                  {isRecord
                    ? ' · 🏅 新最佳！'
                    : bestMs !== undefined
                      ? ` · 最佳 ${formatTime(bestMs)}`
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

        {(paused || !focused) && !terminal && (
          <div
            className={CSS_PREFIX + 'veil'}
            onClick={focusRoot}
            onContextMenu={(e) => e.preventDefault()}
            role="button"
            aria-label="继续游戏"
          >
            <span className={CSS_PREFIX + 'veilText'}>
              {paused ? '⏸ 已暂停 · 点击继续' : '点击继续 · 计时已暂停'}
            </span>
          </div>
        )}
      </div>

      <div className={CSS_PREFIX + 'status'}>
        <div className={CSS_PREFIX + 'statusMain'}>
          {flagMode && !terminal ? (
            <span className={CSS_PREFIX + 'statusFlag'}>🚩 插旗模式：左键 = 旗/拔旗</span>
          ) : (
            <span className={CSS_PREFIX + 'statusHint'}>
              {terminal ? (engine.state === 'won' ? '扫雷完成 🎉' : '踩雷了，点 😀 再来一局') : '左键翻格 · 右键插旗 · 数字再点 = 和弦'}
            </span>
          )}
          {dailyDoneToday && !terminal && (
            <span className={CSS_PREFIX + 'statusDone'}>✅ 今日已完成</span>
          )}
        </div>
        <div className={CSS_PREFIX + 'statusKbd'}>
          <span><kbd>␣</kbd> 翻格/和弦</span>
          <span><kbd>F</kbd> 旗</span>
          <span><kbd>N</kbd> 新局</span>
        </div>
      </div>
    </div>
  );
}
