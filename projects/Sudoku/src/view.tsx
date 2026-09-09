/** @jsxImportSource react */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PEERS, SudokuEngine } from './game/engine';
import { clearSlot, patchViewOptions } from './persist';
import {
  CSS_PREFIX,
  PLUGIN_ID,
  DIFFICULTY_LABELS,
  DIFFICULTY_ORDER,
  MODE_LABELS,
  parseGameOptions,
  parseGameSave,
  parseGameStats,
  type SudokuDifficulty,
  type SudokuMode,
  type SudokuOptions,
  type SudokuStatsRecord,
  type SudokuViewProps,
} from './types';

// 存档防抖间隔（ms）：落子/铅笔/擦除高频触发，落盘合并到 trailing 一次
const PERSIST_DEBOUNCE_MS = 400;
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
    update(props: SudokuViewProps) {
      if (!root || lastContainer !== props.container) {
        if (root) root.unmount();
        props.container.replaceChildren();
        root = createRoot(props.container);
        lastContainer = props.container;
      }
      root.render(<SudokuApp props={props} />);
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

function SudokuApp({ props }: { props: SudokuViewProps }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  // onUpdate 每轮传入最新 props；异步回调通过 ref 取当前值，避免闭包过期
  const propsRef = useRef(props);
  propsRef.current = props;

  const pluginOptions = asRecord(props.viewDefinition?.options?.[PLUGIN_ID]);
  const options: SudokuOptions = parseGameOptions(pluginOptions);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const stats = parseGameStats(pluginOptions.stats);
  const statsRef = useRef<SudokuStatsRecord | null>(stats);
  statsRef.current = stats;
  // 两份存档只在挂载时读取一次：之后由本视图自己的写回驱动 viewDefinition 变化
  const freeSave = useMemo(() => parseGameSave(pluginOptions.save), []); // eslint-disable-line react-hooks/exhaustive-deps
  const dailySave = useMemo(() => parseGameSave(pluginOptions.dailySave), []); // eslint-disable-line react-hooks/exhaustive-deps

  // 引擎状态：引擎为纯数据对象，双模式各持一个、切换即换指针（避免反复重生成）
  const enginesRef = useRef<{ free: SudokuEngine | null; daily: SudokuEngine | null }>({
    free: null,
    daily: null,
  });
  const [activeMode, setActiveMode] = useState<SudokuMode>(() =>
    options.mode === 'daily' ? 'daily' : 'free'
  );
  const [selected, setSelected] = useState(40);
  const [pencilMode, setPencilMode] = useState(false);
  // 主动暂停：盖住棋盘停表（失焦暂停之外的手动开关）
  const [paused, setPaused] = useState(false);
  const [solvedShown, setSolvedShown] = useState(false);
  // 本局是否刷新该难度最佳（用于结算面板 🏆 文案）
  const [isRecord, setIsRecord] = useState(false);
  const [focused, setFocused] = useState(false);
  const [version, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);

  const saveTimerRef = useRef<number | null>(null);
  // 防误触二次确认：有进度的对局上，重开/切难度需 2.5s 内再点一次
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const confirmRunRef = useRef<(() => void) | null>(null);
  const confirmTimerRef = useRef<number | null>(null);

  // onSettled 由引擎持有，代理到 ref 保证回调始终是最新实现
  const settledRef = useRef<(engine: SudokuEngine) => void>(() => undefined);
  const settledProxy = useRef((engine: SudokuEngine) => settledRef.current(engine)).current;

  /** 引擎是否已有可见进度（重开/切难度的防误触判定依据） */
  const boardTouched = (eng: SudokuEngine | null): boolean => {
    if (!eng || eng.solved) return false;
    if (eng.hints > 0) return true;
    for (let i = 0; i < 81; i++) {
      if (eng.values[i] !== 0 || eng.pencils[i] !== 0) return true;
    }
    return false;
  };

  /** 取某模式的引擎：优先已驻留的，其次恢复存档，最后生成新局 */
  const createEngine = (mode: SudokuMode): SudokuEngine => {
    const today = SudokuEngine.todayKey();
    const save = mode === 'daily' ? dailySave : freeSave;
    const usable =
      save !== null &&
      save.mode === mode &&
      (mode === 'free' || save.day === today);
    if (usable) return SudokuEngine.fromSave(save, settledProxy);
    if (mode === 'daily') {
      const eng = SudokuEngine.newDaily(settledProxy);
      // 今日已完成（dailyDone 记录）且无进行中存档 → 重建完成盘供回顾
      if (eng.day !== null && eng.day === optionsRef.current.dailyDone) {
        for (let i = 0; i < 81; i++) eng.values[i] = eng.solution[i];
        eng.solved = true;
        eng.restoredDone = true;
      }
      return eng;
    }
    return SudokuEngine.newFree(optionsRef.current.difficulty, settledProxy);
  };

  // 首次渲染即初始化当前模式的引擎（生成耗时通常几十至几百毫秒，一次性）
  if (!enginesRef.current[activeMode]) {
    enginesRef.current[activeMode] = createEngine(activeMode);
  }
  const engine = enginesRef.current[activeMode]!;

  // 恢复/切换到已完成引擎时展示结算面板（完成于会话内的由 settledRef 处理）
  useEffect(() => {
    if (engine && engine.solved) setSolvedShown(true);
  }, [engine]);

  // ── 持久化：防抖落盘所有进行中的局；完成时清槽位并结算 ──
  const persistNow = () => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const current = propsRef.current;
    if (!current?.api) return;
    for (const eng of [enginesRef.current.free, enginesRef.current.daily]) {
      if (!eng || eng.solved) continue;
      const key = eng.mode === 'daily' ? 'dailySave' : 'save';
      // 无任何落子且未计时：清除槽位（含撤销回初始的空局，避免恢复陈旧存档）
      if (eng.elapsedMs === 0 && eng.hints === 0) {
        let empty = true;
        for (let i = 0; i < 81; i++) {
          if (eng.values[i] !== 0 || eng.pencils[i] !== 0) {
            empty = false;
            break;
          }
        }
        if (empty) {
          void clearSlot(current.api, current.viewId, key);
          continue;
        }
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

  settledRef.current = (eng: SudokuEngine) => {
    if (!eng.solved) {
      schedulePersist();
      return;
    }
    // 完成：展示面板、清存档、刷新战绩统计、按需写战绩行
    setSolvedShown(true);
    const current = propsRef.current;
    if (!current?.api) return;
    const key = eng.mode === 'daily' ? 'dailySave' : 'save';
    void clearSlot(current.api, current.viewId, key);
    const prev = statsRef.current;
    const prevBest = prev?.best?.[eng.difficulty];
    const record = prevBest === undefined || eng.elapsedMs < prevBest;
    setIsRecord(record);
    const nextStats: SudokuStatsRecord = {
      solved: (prev?.solved ?? 0) + 1,
      totalTime: (prev?.totalTime ?? 0) + eng.elapsedMs,
      best: {
        ...(prev?.best ?? {}),
        [eng.difficulty]: Math.min(prevBest ?? eng.elapsedMs, eng.elapsedMs),
      },
      lastDate: new Date().toLocaleString(),
    };
    statsRef.current = nextStats; // 本地同步，避免同会话连续完成读到旧值
    void patchViewOptions(current.api, current.viewId, { stats: nextStats });
    if (eng.mode === 'daily' && eng.day) {
      void patchViewOptions(current.api, current.viewId, { dailyDone: eng.day });
    }
  };

  // 卸载前把进行中的局落盘（patch 为 fire-and-forget，不受卸载影响）
  useEffect(() => {
    const timer = saveTimerRef;
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      persistNow();
    };
  }, []);

  // 计时：视图聚焦、未暂停且未完成时每秒累加
  useEffect(() => {
    if (!focused || paused || engine.solved) return;
    const id = window.setInterval(() => {
      engine.addElapsed(1000);
      bump();
    }, 1000);
    return () => window.clearInterval(id);
  }, [focused, engine, paused]);

  // 首次挂载聚焦，键盘立即可用
  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
  }, []);

  // ── 输入 ───────────────────────────────────────────────────

  /** 暂停中点击控件 = 先继续再执行（避免对遮罩后的棋盘盲操作） */
  const resumeIfPaused = () => {
    if (paused) setPaused(false);
  };

  const inputDigit = (digit: number, asPencil: boolean) => {
    resumeIfPaused();
    if (asPencil) engine.pencil(selected, digit);
    else engine.place(selected, digit);
    bump();
  };

  const eraseSelected = () => {
    resumeIfPaused();
    engine.erase(selected);
    bump();
  };

  const handleHint = () => {
    resumeIfPaused();
    engine.hint(selected);
    bump();
  };

  const handleUndo = () => {
    resumeIfPaused();
    engine.undo();
    bump();
  };

  /** 同模式重开：每日 = 重开今日题（同种子同题面），自由 = 换一题 */
  const handleNewGame = () => {
    persistNow();
    const current = propsRef.current;
    const key = activeMode === 'daily' ? 'dailySave' : 'save';
    if (current?.api) void clearSlot(current.api, current.viewId, key);
    // 已完成盘上点重开 = 重玩：清除今日完成标记（自由模式无此标记）
    if (activeMode === 'daily' && engine.solved && current?.api && engine.day) {
      void patchViewOptions(current.api, current.viewId, { dailyDone: '' });
    }
    const next =
      activeMode === 'daily'
        ? SudokuEngine.newDaily(settledProxy)
        : SudokuEngine.newFree(engine.difficulty, settledProxy);
    enginesRef.current[activeMode] = next;
    setSelected(40);
    setSolvedShown(false);
    setIsRecord(false);
    setPaused(false);
    bump();
    rootRef.current?.focus({ preventScroll: true });
  };

  /** 模式切换：另一模式的局驻留在内存，切回即恢复（不丢进度，无需确认） */
  const handleSwitchMode = (mode: SudokuMode) => {
    if (mode === activeMode) return;
    persistNow();
    clearConfirm();
    if (!enginesRef.current[mode]) enginesRef.current[mode] = createEngine(mode);
    setActiveMode(mode);
    setSelected(40);
    setPaused(false);
    setIsRecord(false);
    const eng = enginesRef.current[mode]!;
    setSolvedShown(eng.solved);
    const current = propsRef.current;
    if (current?.api) void patchViewOptions(current.api, current.viewId, { mode });
    bump();
    rootRef.current?.focus({ preventScroll: true });
  };

  /** 难度切换：立即开对应自由局；每日模式下点击 = 转入自由模式。
      会替换自由引擎——若旧自由局已有进度，需二次确认（防误触）。 */
  const handleSwitchDifficulty = (difficulty: SudokuDifficulty) => {
    if (activeMode === 'free' && engine.difficulty === difficulty) return;
    persistNow();
    const current = propsRef.current;
    if (current?.api) void clearSlot(current.api, current.viewId, 'save');
    enginesRef.current.free = SudokuEngine.newFree(difficulty, settledProxy);
    setActiveMode('free');
    setSelected(40);
    setSolvedShown(false);
    setIsRecord(false);
    setPaused(false);
    if (current?.api) {
      void patchViewOptions(current.api, current.viewId, { difficulty, mode: 'free' });
    }
    bump();
    rootRef.current?.focus({ preventScroll: true });
  };

  /** 有进度的对局上点按即生效的破坏性操作：需要二次确认 */
  const guardRestart = (id: string, run: () => void) => {
    // 每日模式下切难度不破坏当前每日局（引擎驻留），只可能丢弃自由旧局
    const victim =
      id.startsWith('diff:') ? enginesRef.current.free : enginesRef.current[activeMode];
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

  // 键盘：整个根容器为聚焦容器（点数字键盘等子控件不丢失按键），
  // 不劫持 Obsidian 全局快捷键；输入框内按键直接放行
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
    const move = (dr: number, dc: number) => {
      const r = Math.min(8, Math.max(0, ((selected / 9) | 0) + dr));
      const c = Math.min(8, Math.max(0, (selected % 9) + dc));
      setSelected(r * 9 + c);
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
    // 数字：主行区（Digit*）支持 Shift 转铅笔，小键盘区直接落子
    let digit = -1;
    let fromCode = false;
    if (/^Digit[1-9]$/.test(e.code)) {
      digit = Number(e.code.slice(5));
      fromCode = true;
    } else if (/^[1-9]$/.test(e.key)) {
      digit = Number(e.key);
    }
    if (digit > 0) {
      e.preventDefault();
      inputDigit(digit, fromCode ? e.shiftKey || pencilMode : pencilMode);
      return;
    }
    if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0' || e.key === 'x' || e.key === 'X') {
      e.preventDefault();
      eraseSelected();
      return;
    }
    if (e.key === 'p' || e.key === 'P') {
      e.preventDefault();
      setPencilMode((v) => !v);
      return;
    }
    if (e.key === 'z' || e.key === 'Z') {
      e.preventDefault();
      handleUndo();
      return;
    }
    if (e.key === 'h' || e.key === 'H') {
      e.preventDefault();
      handleHint();
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

  /** 点棋盘任意处 = 回到棋盘并获得键盘焦点（失焦遮罩随之消失、计时恢复） */
  const selectCell = (i: number) => {
    setSelected(i);
    rootRef.current?.focus({ preventScroll: true });
  };

  // ── 渲染辅助 ───────────────────────────────────────────────
  const peerSet = useMemo(() => new Set(PEERS[selected]), [selected]);
  const selVal = engine.values[selected] || engine.puzzle[selected];
  const bestMs = stats?.best?.[engine.difficulty];

  // 概览计数：剩余空格 / 错误数 / 每个数字盘面出现次数（数字余量）
  let emptyCount = 0;
  let errorCount = 0;
  const seen = new Array<number>(10).fill(0);
  for (let i = 0; i < 81; i++) {
    const v = engine.puzzle[i] || engine.values[i];
    if (v) {
      seen[v]++;
      if (
        options.showConflicts &&
        !engine.puzzle[i] &&
        engine.values[i] !== 0 &&
        engine.values[i] !== engine.solution[i]
      ) {
        errorCount++;
      }
    } else if (engine.values[i] === 0) {
      emptyCount++;
    }
  }
  const remain = (d: number) => Math.max(0, 9 - seen[d]);

  const cells: ReactNode[] = [];
  for (let i = 0; i < 81; i++) {
    const r = (i / 9) | 0;
    const c = i % 9;
    const given = engine.puzzle[i] !== 0;
    const val = given ? engine.puzzle[i] : engine.values[i];
    const pencilMask = !val ? engine.pencils[i] : 0;
    const isPeer = peerSet.has(i);
    const same =
      options.highlightSame && selVal !== 0 && val === selVal && i !== selected;
    const error =
      options.showConflicts && !given && val !== 0 && val !== engine.solution[i];
    const classes = [
      CSS_PREFIX + 'cell',
      given ? ` ${CSS_PREFIX}cell--given` : '',
      !given && engine.hinted.has(i) ? ` ${CSS_PREFIX}cell--hinted` : '',
      !given && val && !engine.hinted.has(i) ? ` ${CSS_PREFIX}cell--user` : '',
      i === selected ? ` ${CSS_PREFIX}cell--sel` : '',
      isPeer ? ` ${CSS_PREFIX}cell--peer` : '',
      same ? ` ${CSS_PREFIX}cell--same` : '',
      error ? ` ${CSS_PREFIX}cell--error` : '',
      (c === 2 || c === 5) ? ` ${CSS_PREFIX}cell--br` : '',
      (r === 2 || r === 5) ? ` ${CSS_PREFIX}cell--bb` : '',
    ].join('');
    cells.push(
      <div key={i} className={classes} onClick={() => selectCell(i)}>
        {val ? (
          <span className={CSS_PREFIX + 'cellValue'}>{val}</span>
        ) : pencilMask ? (
          Array.from({ length: 9 }, (_, d) => (
            <span
              key={d}
              className={
                CSS_PREFIX +
                'pencilDigit' +
                (options.highlightSame && selVal !== 0 && d + 1 === selVal
                  ? ` ${CSS_PREFIX}pencilDigit--hit`
                  : '')
              }
            >
              {pencilMask & (1 << d) ? d + 1 : ''}
            </span>
          ))
        ) : null}
      </div>
    );
  }

  const overlayShown = engine.solved && solvedShown;
  // 当天重进回顾完成盘（视图重建的已完成引擎）→ 按「今日已完成」面板呈现
  const restoredDone = engine.solved && engine.restoredDone;
  const confirmNew = confirmId === 'new';

  return (
    <div
      ref={rootRef}
      className={CSS_PREFIX + 'root'}
      tabIndex={0}
      role="application"
      aria-label={`数独棋盘，${MODE_LABELS[engine.mode]}，${DIFFICULTY_LABELS[engine.difficulty]}`}
      onKeyDown={handleKeyDown}
      onFocus={() => setFocused(true)}
      onBlur={handleRootBlur}
    >
      <div className={CSS_PREFIX + 'topbar'}>
        <div className={CSS_PREFIX + 'brand'}>
          <div className={CSS_PREFIX + 'logo'}>数独</div>
          <div className={CSS_PREFIX + 'mode'}>
            {MODE_LABELS[engine.mode]} · {DIFFICULTY_LABELS[engine.difficulty]}
          </div>
        </div>
        <div
          className={`${CSS_PREFIX}time${paused ? ` ${CSS_PREFIX}time--paused` : ''}`}
          title={paused ? '已暂停（Esc 或点任意控件继续）' : '本局用时'}
        >
          <span className={CSS_PREFIX + 'timeIcon'}>{paused ? '⏸' : '⏱'}</span>
          <span className={CSS_PREFIX + 'timeValue'}>{formatTime(engine.elapsedMs)}</span>
          {bestMs !== undefined && !engine.solved && (
            <span className={CSS_PREFIX + 'timeBest'}>最佳 {formatTime(bestMs)}</span>
          )}
        </div>
        <div className={CSS_PREFIX + 'actions'}>
          <button
            type="button"
            className={CSS_PREFIX + 'btn'}
            onClick={handleUndo}
            disabled={!engine.canUndo || engine.solved}
            title="撤销上一步（Z）"
          >
            ↩ 撤销
          </button>
          <button
            type="button"
            className={CSS_PREFIX + 'btn'}
            onClick={handleHint}
            disabled={engine.solved}
            title="揭示选中格答案（H）"
          >
            💡 提示
          </button>
          <button
            type="button"
            className={`${CSS_PREFIX}btn ${CSS_PREFIX}btn--primary${confirmNew ? ` ${CSS_PREFIX}btn--confirm` : ''}`}
            onClick={() => guardRestart('new', handleNewGame)}
            title={confirmNew ? '进行中的一局将被放弃，再点一次确认' : activeMode === 'daily' ? '重开今日题（N）' : '换一题（N）'}
          >
            {confirmNew
              ? '确认重开？'
              : activeMode === 'daily'
                ? '重开今日'
                : '新游戏'}
          </button>
        </div>
      </div>

      <div className={CSS_PREFIX + 'switchRow'}>
        <div className={CSS_PREFIX + 'segGroup'} role="group" aria-label="切换模式">
          <span className={CSS_PREFIX + 'segLabel'}>模式</span>
          <div className={CSS_PREFIX + 'segmented'}>
            {(['daily', 'free'] as SudokuMode[]).map((m) => (
              <button
                type="button"
                key={m}
                className={`${CSS_PREFIX}segBtn${activeMode === m ? ` ${CSS_PREFIX}segBtn--on` : ''}`}
                aria-pressed={activeMode === m}
                onClick={() => handleSwitchMode(m)}
                title={m === 'daily' ? '每日一题：同日同题，难度按日轮换' : '自由练习：自选难度随机题'}
              >
                {MODE_LABELS[m]}
              </button>
            ))}
          </div>
        </div>
        <div className={CSS_PREFIX + 'segGroup'} role="group" aria-label="切换难度">
          <span className={CSS_PREFIX + 'segLabel'}>难度</span>
          <div className={CSS_PREFIX + 'segmented'}>
            {DIFFICULTY_ORDER.map((d) => {
              const armed = confirmId === `diff:${d}`;
              const on =
                engine.difficulty === d &&
                (activeMode === 'free' || (activeMode === 'daily' && confirmId === null));
              return (
                <button
                  type="button"
                  key={d}
                  className={`${CSS_PREFIX}segBtn${on ? ` ${CSS_PREFIX}segBtn--on` : ''}${armed ? ` ${CSS_PREFIX}segBtn--confirm` : ''}`}
                  aria-pressed={on}
                  onClick={() => guardRestart(`diff:${d}`, () => handleSwitchDifficulty(d))}
                  title={armed ? '进行中的自由局将被放弃，再点一次确认' : activeMode === 'daily' ? `转入自由模式 · ${DIFFICULTY_LABELS[d]}（立即开新局）` : `切换到${DIFFICULTY_LABELS[d]}（立即开新局）`}
                >
                  {armed ? '确认切换？' : DIFFICULTY_LABELS[d]}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className={CSS_PREFIX + 'board'}>
        <div className={CSS_PREFIX + 'boardInner'}>{cells}</div>

        {overlayShown && (
          <div className={`${CSS_PREFIX}overlay ${CSS_PREFIX}overlay--win`}>
            <div className={CSS_PREFIX + 'overlayTitle'}>
              {restoredDone ? '🎉 今日已完成' : '完成！'}
            </div>
            <div className={CSS_PREFIX + 'overlayMsg'}>
              {restoredDone
                ? `${MODE_LABELS.daily} · ${DIFFICULTY_LABELS[engine.difficulty]}` +
                  (bestMs !== undefined ? ` · 最佳 ${formatTime(bestMs)}` : '')
                : `${DIFFICULTY_LABELS[engine.difficulty]} · 用时 ${formatTime(engine.elapsedMs)}` +
                  (engine.hints > 0 ? ` · 提示 ${engine.hints} 次` : '') +
                  (isRecord ? ' · 🏆 新纪录！' : '')}
            </div>
            <div className={CSS_PREFIX + 'overlayBtns'}>
              <button
                type="button"
                className={`${CSS_PREFIX}btn ${CSS_PREFIX}btn--primary`}
                onClick={handleNewGame}
              >
                {restoredDone || activeMode === 'daily' ? '重玩今日' : '再来一局'}
              </button>
              <button
                type="button"
                className={CSS_PREFIX + 'btn'}
                onClick={() => setSolvedShown(false)}
              >
                欣赏棋盘
              </button>
            </div>
          </div>
        )}

        {(paused || !focused) && !engine.solved && (
          <div
            className={CSS_PREFIX + 'veil'}
            onClick={() => {
              setPaused(false);
              rootRef.current?.focus({ preventScroll: true });
            }}
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
          <span>{engine.solved ? '已完成' : `剩 ${emptyCount} 格`}</span>
          {!engine.solved && errorCount > 0 && (
            <span className={CSS_PREFIX + 'statusErr'}>错 {errorCount}</span>
          )}
          {pencilMode && !engine.solved && (
            <span className={CSS_PREFIX + 'statusPencil'}>✏ 笔记中</span>
          )}
        </div>
        <div className={CSS_PREFIX + 'statusKbd'}>
          <span><kbd>Z</kbd> 撤销</span>
          <span><kbd>H</kbd> 提示</span>
          <span><kbd>N</kbd> 新局</span>
        </div>
      </div>

      <div
        className={
          CSS_PREFIX + 'numpad' + (pencilMode ? ` ${CSS_PREFIX}numpad--pencil` : '')
        }
      >
        <div className={CSS_PREFIX + 'digitRow'}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => {
            const rem = remain(d);
            const exhausted = rem === 0 && !pencilMode && !engine.solved;
            return (
              <button
                type="button"
                key={d}
                className={`${CSS_PREFIX}npBtn${exhausted ? ` ${CSS_PREFIX}npBtn--exhausted` : ''}`}
                onClick={() => inputDigit(d, pencilMode)}
                title={exhausted ? `${d} 已全部填完（还可在笔记中标记）` : `填入 ${d}（剩 ${rem} 个可填）`}
              >
                <span className={CSS_PREFIX + 'npDigit'}>{d}</span>
                {rem < 9 && !engine.solved && (
                  <span className={`${CSS_PREFIX}npCount${rem === 0 ? ` ${CSS_PREFIX}npCount--zero` : ''}`}>
                    {rem}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className={CSS_PREFIX + 'toolRow'}>
          <button
            type="button"
            className={`${CSS_PREFIX}npTool${paused ? ` ${CSS_PREFIX}npTool--on` : ''}`}
            onClick={() => {
              setPaused((v) => !v);
              rootRef.current?.focus({ preventScroll: true });
            }}
            title="暂停计时并盖住棋盘（Esc），点击遮罩或按任意键继续"
          >
            {paused ? '▶ 继续' : '⏸ 暂停'}
          </button>
          <button
            type="button"
            className={`${CSS_PREFIX}npTool${pencilMode ? ` ${CSS_PREFIX}npTool--on` : ''}`}
            onClick={() => setPencilMode((v) => !v)}
            title="笔记模式：把数字以小字记在空格里做候选排除，不影响判定；快捷键 P，或按住 Shift 点数字"
          >
            ✏ 笔记
          </button>
          <button
            type="button"
            className={CSS_PREFIX + 'npTool'}
            onClick={eraseSelected}
            title="擦除选中格（⌫ / 0）"
          >
            ⌫ 擦除
          </button>
        </div>
      </div>
    </div>
  );
}
