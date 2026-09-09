/** @jsxImportSource react */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Game2048Engine, type Dir, type Tile } from './game/engine';
import { clearGameSave, patchViewOptions } from './persist';
import {
  CSS_PREFIX,
  PLUGIN_ID,
  GameViewProps,
  GameOptions,
  GameStatsRecord,
  BoardSize,
  WinTarget,
  parseGameOptions,
  parseGameSave,
  parseGameStats,
} from './types';

// 滑动过渡时长（ms）：move → settle 的两阶段间隔与 CSS transition 保持一致
const MOVE_MS = 100;

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

/** 数值 → 配色类名：2048 及以下逐级配色，之上统一“超越”色 */
function tileClass(value: number): string {
  return value <= 2048 ? `v${value}` : 'vSuper';
}

function ViewApp({ props }: { props: GameViewProps }) {
  const boardRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<Game2048Engine | null>(null);
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

  const [tiles, setTiles] = useState<Tile[]>([]);
  const [score, setScore] = useState(0);
  const [over, setOver] = useState(false);
  const [showWin, setShowWin] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [locked, setLocked] = useState(false);
  const [focused, setFocused] = useState(false);
  // 本局战绩是否已入账（达成目标或终局时各至多一次，防止一局重复计数）
  const countedRef = useRef(Boolean(initialSave?.won));
  const pointerStart = useRef<{ x: number; y: number } | null>(null);

  // 每步结算后的持久化：进行中落存档 + 刷新最高分；终局清存档并入账战绩
  const persistSettled = (engine: Game2048Engine) => {
    const current = propsRef.current;
    const api = current?.api;
    if (!api) return;
    const prev = statsRef.current;
    const nextStats: GameStatsRecord = {
      bestScore: Math.max(prev?.bestScore ?? 0, engine.score),
      bestTile: Math.max(prev?.bestTile ?? 0, engine.maxTile),
      totalScore: prev?.totalScore ?? 0,
      games: prev?.games ?? 0,
      lastDate: prev?.lastDate,
    };
    const recordRow = (result: 'win' | 'over') => {
      const fresh = parseGameOptions(
        asRecord(
          api.getDefinition?.()?.views?.find((view: any) => view.id === current.viewId)?.options?.[
            PLUGIN_ID
          ]
        )
      );
      if (!fresh.recordScores || typeof api.createRow !== 'function') return;
      const date = new Date().toISOString();
      const moment = current.moment;
      const dateText = moment
        ? moment(date).format('YYYY-MM-DD HH:mm')
        : new Date(date).toLocaleString();
      void api
        .createRow({
          viewId: current.viewId,
          values: {
            'game-2048': true,
            score: engine.score,
            maxTile: engine.maxTile,
            moves: engine.moves,
            boardSize: engine.n,
            result,
            date: dateText,
          },
        })
        .catch((error: unknown) => {
          console.error('[xdb-plugin] game-2048: 写入战绩行失败', error);
        });
    };

    if (engine.over) {
      // 终局：清存档；一局只入账一次（达成目标时已入账则仅刷新最高分）
      void clearGameSave(api, current.viewId);
      if (!countedRef.current) {
        countedRef.current = true;
        nextStats.totalScore += engine.score;
        nextStats.games += 1;
        nextStats.lastDate = new Date().toLocaleString();
        recordRow('over');
      }
      void patchViewOptions(api, current.viewId, { stats: nextStats });
      return;
    }

    if (!engine.won || countedRef.current) {
      void patchViewOptions(api, current.viewId, { save: engine.snapshot(), stats: nextStats });
      return;
    }
    // 首次达成目标：游戏继续，但战绩当回合入账一次
    countedRef.current = true;
    nextStats.totalScore += engine.score;
    nextStats.games += 1;
    nextStats.lastDate = new Date().toLocaleString();
    recordRow('win');
    void patchViewOptions(api, current.viewId, { save: engine.snapshot(), stats: nextStats });
  };

  // 引擎只创建一次；盘面/目标取自存档（恢复局）或当前设置（新局）
  useEffect(() => {
    const save = initialSave;
    const engine = new Game2048Engine(
      save?.n ?? optionsRef.current.boardSize,
      save?.target ?? optionsRef.current.target,
      save,
      { onSettled: persistSettled }
    );
    engineRef.current = engine;
    setTiles([...engine.tiles]);
    setScore(engine.score);
    setOver(engine.over);
    setCanUndo(engine.canUndo);
    boardRef.current?.focus({ preventScroll: true });
    return () => {
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const syncFromEngine = () => {
    const engine = engineRef.current;
    if (!engine) return;
    setTiles([...engine.tiles]);
    setScore(engine.score);
    setOver(engine.over);
    setCanUndo(engine.canUndo);
  };

  const handleMove = (dir: Dir) => {
    const engine = engineRef.current;
    if (!engine || locked || over || showWin || engine.isStaging) return;
    const slide = engine.move(dir);
    if (!slide) return;
    setTiles([...slide.tiles]);
    setLocked(true);
    // 第二阶段：等滑动过渡结束后收合合并、生成新块并结算
    window.setTimeout(
      () => {
        // 滑动窗口内局面被切换/重开：过期结算直接丢弃，避免旧盘面闪回
        if (engineRef.current !== engine) return;
        const settled = engine.settle();
        setTiles([...settled.tiles]);
        setScore(settled.score);
        setLocked(false);
        setCanUndo(engine.canUndo);
        if (settled.won) setShowWin(true);
        if (settled.over) setOver(true);
      },
      optionsRef.current.animation ? MOVE_MS : 0
    );
  };

  const handleUndo = () => {
    const engine = engineRef.current;
    if (!engine || !engine.undo()) return;
    setOver(false);
    syncFromEngine();
    // 撤销可能恢复被清掉的存档（终局撤回）
    const current = propsRef.current;
    if (current?.api) {
      void patchViewOptions(current.api, current.viewId, { save: engine.snapshot() });
    }
    boardRef.current?.focus({ preventScroll: true });
  };

  // 以指定配置开新局：新游戏按钮与盘面/模式切换器共用
  const startGame = (size: BoardSize, goal: WinTarget) => {
    const current = propsRef.current;
    const hadProgress = (engineRef.current?.moves ?? 0) > 0;
    const engine = new Game2048Engine(size, goal, null, {
      onSettled: persistSettled,
    });
    engineRef.current = engine;
    countedRef.current = false;
    setShowWin(false);
    setOver(false);
    setLocked(false);
    setScore(0);
    syncFromEngine();
    // 放弃进行中的一局：只清存档（最高分已在每步实时刷新，不重复入账）
    if (hadProgress && current?.api) {
      void clearGameSave(current.api, current.viewId);
    }
    boardRef.current?.focus({ preventScroll: true });
  };

  const handleNewGame = () => {
    const opts = optionsRef.current;
    startGame(opts.boardSize, opts.target);
  };

  // 界面内切换盘面/模式：写入视图配置（与设置页同源）并立即按新配置开新局；
  // 未切换的维度沿用当前局（与切换器显示一致），点当前项则不重开
  const handleSwitch = (patch: Partial<Pick<GameOptions, 'boardSize' | 'target'>>) => {
    const engine = engineRef.current;
    const curSize = (engine?.n ?? optionsRef.current.boardSize) as BoardSize;
    const curGoal = (engine?.target ?? optionsRef.current.target) as WinTarget;
    const size = patch.boardSize ?? curSize;
    const goal = patch.target ?? curGoal;
    if (size === curSize && goal === curGoal) return;
    const current = propsRef.current;
    if (current?.api) {
      void patchViewOptions(current.api, current.viewId, patch);
    }
    startGame(size, goal);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
    ) {
      return;
    }
    const dirMap: Record<string, Dir> = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
      w: 'up',
      W: 'up',
      s: 'down',
      S: 'down',
      a: 'left',
      A: 'left',
      d: 'right',
      D: 'right',
    };
    const dir = dirMap[e.key];
    if (dir) {
      e.preventDefault(); // 方向键不再滚动页面 / 触发宿主导航
      handleMove(dir);
      return;
    }
    if (e.key === 'z' || e.key === 'Z') {
      e.preventDefault();
      handleUndo();
    } else if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      handleNewGame();
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    pointerStart.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = pointerStart.current;
    pointerStart.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return; // 轻点只用于聚焦
    const dir: Dir =
      Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
    handleMove(dir);
  };

  const engine = engineRef.current;
  const n = engine?.n ?? options.boardSize;
  const target = engine?.target ?? options.target;
  const bestDisplay = Math.max(stats?.bestScore ?? 0, score);
  const animationClass = options.animation ? '' : ` ${CSS_PREFIX}noAnim`;

  return (
    <div className={CSS_PREFIX + 'root' + animationClass}>
      <div className={CSS_PREFIX + 'topbar'}>
        <div className={CSS_PREFIX + 'brand'}>
          <div className={CSS_PREFIX + 'logo'}>2048</div>
          <div className={CSS_PREFIX + 'mode'}>
            {n}×{n} · {target === 0 ? '无尽模式' : `目标 ${target}`}
          </div>
        </div>
        <div className={CSS_PREFIX + 'scores'}>
          <div className={CSS_PREFIX + 'scoreBox'}>
            <span className={CSS_PREFIX + 'scoreLabel'}>得分</span>
            <span className={CSS_PREFIX + 'scoreValue'}>{score}</span>
          </div>
          <div className={CSS_PREFIX + 'scoreBox'}>
            <span className={CSS_PREFIX + 'scoreLabel'}>最佳</span>
            <span className={CSS_PREFIX + 'scoreValue'}>{bestDisplay}</span>
          </div>
        </div>
        <div className={CSS_PREFIX + 'actions'}>
          <button
            type="button"
            className={CSS_PREFIX + 'btn'}
            onClick={handleUndo}
            disabled={!canUndo || locked}
            title="撤销上一步（Z）"
          >
            ↩ 撤销
          </button>
          <button
            type="button"
            className={`${CSS_PREFIX}btn ${CSS_PREFIX}btn--primary`}
            onClick={handleNewGame}
            title="重新开始（N）"
          >
            新游戏
          </button>
        </div>
      </div>

      <div className={CSS_PREFIX + 'switchRow'}>
        <div className={CSS_PREFIX + 'segGroup'} role="group" aria-label="切换盘面大小">
          <span className={CSS_PREFIX + 'segLabel'}>盘面</span>
          <div className={CSS_PREFIX + 'segmented'}>
            {([3, 4, 5] as BoardSize[]).map((s) => (
              <button
                type="button"
                key={s}
                className={`${CSS_PREFIX}segBtn${n === s ? ` ${CSS_PREFIX}segBtn--on` : ''}`}
                aria-pressed={n === s}
                onClick={() => handleSwitch({ boardSize: s })}
                title={`切换到 ${s} × ${s}（立即开新局）`}
              >
                {s}×{s}
              </button>
            ))}
          </div>
        </div>
        <div className={CSS_PREFIX + 'segGroup'} role="group" aria-label="切换游戏模式">
          <span className={CSS_PREFIX + 'segLabel'}>模式</span>
          <div className={CSS_PREFIX + 'segmented'}>
            {([2048, 4096, 0] as WinTarget[]).map((g) => (
              <button
                type="button"
                key={g}
                className={`${CSS_PREFIX}segBtn${target === g ? ` ${CSS_PREFIX}segBtn--on` : ''}`}
                aria-pressed={target === g}
                onClick={() => handleSwitch({ target: g })}
                title={g === 0 ? '切换到无尽模式（立即开新局）' : `目标切换为 ${g}（立即开新局）`}
              >
                {g === 0 ? '无尽' : g}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div
        ref={boardRef}
        className={`${CSS_PREFIX}board ${CSS_PREFIX}n${n}`}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        role="application"
        aria-label={`2048 棋盘，当前得分 ${score}`}
      >
        <div className={CSS_PREFIX + 'boardInner'}>
          <div className={CSS_PREFIX + 'cells'}>
            {Array.from({ length: n * n }, (_, i) => (
              <div key={i} className={CSS_PREFIX + 'cell'} />
            ))}
          </div>

          {tiles.map((t) => (
            <div
              key={t.id}
              className={[
                CSS_PREFIX + 'tile',
                `${CSS_PREFIX}${tileClass(t.value)}`,
                t.isNew ? `${CSS_PREFIX}tile--new` : '',
                t.isMerged ? `${CSS_PREFIX}tile--merged` : '',
              ].join(' ')}
              style={{ '--tx': t.c, '--ty': t.r } as CSSProperties}
              data-len={Math.min(String(t.value).length, 5)}
            >
              {t.value}
            </div>
          ))}

          {over && (
            <div className={`${CSS_PREFIX}overlay ${CSS_PREFIX}overlay--over`}>
              <div className={CSS_PREFIX + 'overlayTitle'}>无路可走</div>
              <div className={CSS_PREFIX + 'overlayMsg'}>
                本局得分 {score} · 最大方块 {engine?.maxTile ?? 0}
              </div>
              <button
                type="button"
                className={`${CSS_PREFIX}btn ${CSS_PREFIX}btn--primary`}
                onClick={handleNewGame}
              >
                再来一局
              </button>
            </div>
          )}

          {showWin && !over && (
            <div className={`${CSS_PREFIX}overlay ${CSS_PREFIX}overlay--win`}>
              <div className={CSS_PREFIX + 'overlayTitle'}>达成 {target}！</div>
              <div className={CSS_PREFIX + 'overlayMsg'}>当前得分 {score}，还可以继续冲击更高</div>
              <div className={CSS_PREFIX + 'overlayBtns'}>
                <button
                  type="button"
                  className={`${CSS_PREFIX}btn ${CSS_PREFIX}btn--primary`}
                  onClick={() => {
                    setShowWin(false);
                    boardRef.current?.focus({ preventScroll: true });
                  }}
                >
                  继续挑战
                </button>
                <button type="button" className={CSS_PREFIX + 'btn'} onClick={handleNewGame}>
                  新游戏
                </button>
              </div>
            </div>
          )}

          {!focused && !over && !showWin && (
            <div className={CSS_PREFIX + 'veil'}>
              <span className={CSS_PREFIX + 'veilText'}>点击棋盘开始 · 方向键移动</span>
            </div>
          )}
        </div>
      </div>

      <div className={CSS_PREFIX + 'hint'}>
        <span>方向键 / WASD 移动</span>
        <span>触屏滑动同样有效</span>
        <span>Z 撤销</span>
        <span>N 新游戏</span>
        <span>相同数字相撞合并，冲击{target === 0 ? '更高分数' : `${target} 金色方块`}</span>
      </div>
    </div>
  );
}
