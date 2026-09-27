/** @jsxImportSource react */
import { useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import Runner, { type RunnerSnapshot } from './game/runner';
import { patchViewOptions } from './persist';
import {
  CSS_PREFIX,
  PLUGIN_ID,
  GameViewProps,
  GameOptions,
  GameSize,
  GameStatsRecord,
  GAME_SIZE_WIDTH,
  parseGameOptions,
  parseGameStats,
} from './types';

// HUD 状态轮询间隔（游戏画面本身在 canvas 内自绘，无需 60fps 同步）
const POLL_MS = 150;
// 防误触二次确认窗口（ms）
const CONFIRM_MS = 2500;

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

function ViewApp({ props }: { props: GameViewProps }) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const runnerRef = useRef<any>(null);
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
  const [, setStatsTick] = useState(0);

  const [snap, setSnap] = useState<RunnerSnapshot | null>(null);
  // 终局是否刷新最高分（新纪录提示）
  const [overRecord, setOverRecord] = useState(false);
  // 防误触二次确认：有进度的对局上，重开需 2.5s 内再点一次
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const confirmRunRef = useRef<(() => void) | null>(null);
  const confirmTimerRef = useRef<number | null>(null);

  // 终局一次性入账：最高分 / 累计 / 局数
  const persistEnd = (score: number, isNewRecord: boolean) => {
    const current = propsRef.current;
    const api = current?.api;
    setOverRecord(isNewRecord);
    if (!api) return;
    const prev = statsRef.current;
    const nextStats: GameStatsRecord = {
      bestScore: Math.max(prev?.bestScore ?? 0, score),
      totalScore: (prev?.totalScore ?? 0) + score,
      games: (prev?.games ?? 0) + 1,
      lastDate: new Date().toLocaleString(),
    };
    statsRef.current = nextStats; // 本地同步，避免同会话连续终局读到旧值
    setStatsTick((t) => t + 1);
    void patchViewOptions(api, current.viewId, { stats: nextStats });
  };

  // 挂载原版引擎（容器内自建 canvas / 触控层，destroy 时一并清理）
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const initialStats = statsRef.current;
    const runner = new Runner(
      stage,
      {
        highScore: initialStats?.bestScore ?? 0,
        soundEnabled: optionsRef.current.sound,
        maxWidth: GAME_SIZE_WIDTH[optionsRef.current.size],
      },
      { onGameOver: persistEnd }
    );
    runnerRef.current = runner;

    const timer = window.setInterval(() => {
      setSnap(runner.snapshot());
    }, POLL_MS);

    return () => {
      window.clearInterval(timer);
      runner.destroy();
      runnerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 音效开关 / 画面大小热更（尺寸变化经 ResizeObserver 由引擎自适应重排）
  useEffect(() => {
    runnerRef.current?.setSoundEnabled(options.sound);
    runnerRef.current.maxWidth = GAME_SIZE_WIDTH[options.size];
  }, [options.sound, options.size]);

  // ── 暂停 / 继续 / 重开（防误触确认） ──────────────────────

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

  const startNewGame = () => {
    runnerRef.current?.forceRestart();
    setOverRecord(false);
    disarmConfirm();
  };

  const handleNewGame = () => {
    const runner = runnerRef.current;
    const inProgress = Boolean(
      runner && runner.activated && runner.playing && !runner.crashed
    );
    if (inProgress) {
      runProtected('new', startNewGame);
    } else {
      startNewGame();
    }
  };

  const togglePause = () => {
    const runner = runnerRef.current;
    if (!runner || !runner.activated || runner.crashed) return;
    if (runner.paused) {
      runner.play();
    } else {
      runner.stop();
    }
  };

  // 键盘辅助键：P 暂停 / N 重开（仅键盘响应权在本实例时）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const runner = runnerRef.current;
      if (!runner || !runner.isKeyboardActive()) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }
      if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        togglePause();
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        handleNewGame();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmId]);

  // ── 触屏 / 无障碍按钮：复用引擎按键语义（按住生效） ────────

  const holdHandlers = (press: () => void, release: () => void) => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      press();
    },
    onPointerUp: () => release(),
    onPointerLeave: () => release(),
    onPointerCancel: () => release(),
  });

  // ── 渲染 ───────────────────────────────────────────────────

  const started = snap?.started ?? false;
  const crashed = snap?.crashed ?? false;
  const paused = snap?.paused ?? false;
  const confirmNew = confirmId === 'new';
  const bestDisplay = Math.max(statsRef.current?.bestScore ?? 0, snap?.highScore ?? 0);

  return (
    <div
      className={CSS_PREFIX + 'root'}
      style={{ '--gameMaxW': `${GAME_SIZE_WIDTH[options.size]}px` } as React.CSSProperties}
    >
      <div className={CSS_PREFIX + 'topbar'}>
        <div className={CSS_PREFIX + 'brand'}>
          <div className={CSS_PREFIX + 'logo'}>T-REX&nbsp;RUNNER</div>
          <div className={CSS_PREFIX + 'mode'}>
            Chrome 断网彩蛋同款{snap ? ` · 速度 ${snap.speed.toFixed(1)} / 13.0` : ''}
          </div>
        </div>
        <div className={CSS_PREFIX + 'actions'}>
          <button
            type="button"
            className={CSS_PREFIX + 'btn'}
            onClick={togglePause}
            disabled={!started || crashed}
            title="暂停 / 继续（P）"
          >
            {paused && !crashed && started ? '▶ 继续' : '⏸ 暂停'}
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

      {/* 记分条：得分 · 最高分 · 局数 · 音效状态 */}
      <div className={CSS_PREFIX + 'hud'}>
        <div className={`${CSS_PREFIX}hudBox ${CSS_PREFIX}hudBox--score`}>
          <span className={CSS_PREFIX + 'hudLabel'}>得分</span>
          <span className={CSS_PREFIX + 'hudValue'}>{snap?.score ?? 0}</span>
        </div>
        <div className={CSS_PREFIX + 'hudBox'} title="画布右上角 HI 为本视图历史最高分">
          <span className={CSS_PREFIX + 'hudLabel'}>最高分</span>
          <span className={CSS_PREFIX + 'hudValue'}>{bestDisplay}</span>
        </div>
        <div className={CSS_PREFIX + 'hudBox'}>
          <span className={CSS_PREFIX + 'hudLabel'}>累计局数</span>
          <span className={CSS_PREFIX + 'hudValue'}>{statsRef.current?.games ?? 0}</span>
        </div>
        <div className={CSS_PREFIX + 'hudBox'}>
          <span className={CSS_PREFIX + 'hudLabel'}>累计得分</span>
          <span className={CSS_PREFIX + 'hudValue'}>{statsRef.current?.totalScore ?? 0}</span>
        </div>
        <div className={CSS_PREFIX + 'hudBox'}>
          <span className={CSS_PREFIX + 'hudLabel'}>音效</span>
          <span className={CSS_PREFIX + 'hudValue'}>{options.sound ? '开' : '关'}</span>
        </div>
      </div>

      {/* 游戏区：原版 canvas 在此挂载；日夜反转只作用于本区域 */}
      <div className={CSS_PREFIX + 'stageWrap'}>
        <div
          ref={stageRef}
          className={CSS_PREFIX + 'stage'}
          role="application"
          aria-label={`小恐龙跑酷，得分 ${snap?.score ?? 0}，最高分 ${bestDisplay}`}
        />

        {/* 开始前提示（点击游戏区即开始） */}
        {!started && !crashed && (
          <div className={CSS_PREFIX + 'veil'}>
            <span className={CSS_PREFIX + 'veilText'}>
              按 空格 / ↑ / W 或点击游戏区开始 · 断网了也能跑
            </span>
          </div>
        )}

        {/* 暂停遮罩 */}
        {started && paused && !crashed && (
          <div className={CSS_PREFIX + 'veil'}>
            <span className={CSS_PREFIX + 'veilText'}>已暂停 · 空格 / P / 点击继续</span>
          </div>
        )}

        {/* 终局新纪录提示（canvas 内已有 GAME OVER 面板） */}
        {crashed && overRecord && (
          <div className={CSS_PREFIX + 'recordBadge'}>🏅 新纪录 {snap?.score ?? 0} 分</div>
        )}
      </div>

      {/* 触屏 / 无障碍操作（按住生效，与键盘同语义） */}
      <div className={CSS_PREFIX + 'touchRow'}>
        <button
          type="button"
          className={CSS_PREFIX + 'touchBtn'}
          {...holdHandlers(
            () => runnerRef.current?.pressJump(),
            () => runnerRef.current?.releaseJump()
          )}
        >
          ⬆ 跳跃（按住更高）
        </button>
        <button
          type="button"
          className={CSS_PREFIX + 'touchBtn'}
          {...holdHandlers(
            () => runnerRef.current?.pressDuck(),
            () => runnerRef.current?.releaseDuck()
          )}
        >
          ⬇ 下蹲 / 速降
        </button>
      </div>

      <div className={CSS_PREFIX + 'status'}>
        <div className={CSS_PREFIX + 'statusMain'}>
          {crashed ? (
            <span className={CSS_PREFIX + 'statusOver'}>
              本局结束 · 空格 / 回车 / 点击「新游戏」再来一局
            </span>
          ) : paused && started ? (
            <span>已暂停 · 空格 / P / 点击继续</span>
          ) : !started ? (
            <span>待开始 · 速度随距离提升，700 分起日夜交替</span>
          ) : (
            <span>跑起来了 · 越跑越快，小心仙人掌和翼龙</span>
          )}
        </div>
        <div className={CSS_PREFIX + 'statusKbd'}>
          <span><kbd>空格</kbd>/<kbd>↑</kbd>/<kbd>W</kbd> 跳跃</span>
          <span><kbd>↓</kbd>/<kbd>S</kbd> 下蹲/速降</span>
          <span><kbd>P</kbd> 暂停</span>
          <span><kbd>N</kbd> 新局</span>
          <span><kbd>回车</kbd> 终局重开</span>
        </div>
      </div>
    </div>
  );
}
