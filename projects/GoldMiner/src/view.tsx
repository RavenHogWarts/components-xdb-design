/** @jsxImportSource react */
import { useEffect, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { GoldMinerEngine } from './game/engine';
import { patchViewOptions } from './persist';
import {
  CSS_PREFIX,
  PLUGIN_ID,
  GameStatsRecord,
  GameViewProps,
  GameOptions,
  GameOverStats,
  parseGameOptions,
  parseGameSave,
  parseGameStats,
} from './types';

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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<GoldMinerEngine | null>(null);
  // onUpdate 每轮传入最新 props；异步回调通过 ref 取当前值，避免闭包过期
  const propsRef = useRef(props);
  propsRef.current = props;

  const pluginOptions = asRecord(props.viewDefinition?.options?.[PLUGIN_ID]);
  const options: GameOptions = parseGameOptions(pluginOptions);
  const stats = parseGameStats(pluginOptions.stats);
  const initialSave = parseGameSave(pluginOptions.save);
  const optionsKey = JSON.stringify(pluginOptions);

  // 进度存档：引擎自动快照 → 写入视图配置；游戏结束清除
  const handleSave = (data: unknown) => {
    const current = propsRef.current;
    if (!current?.api) return;
    void patchViewOptions(current.api, current.viewId, { save: data });
  };

  // 一局结束：合并战绩写回视图配置；按设置把战绩写入当前数据库
  const handleGameOver = (result: GameOverStats) => {
    const current = propsRef.current;
    const api = current?.api;
    if (!api) return;
    const moment = current.moment;
    const dateText = moment
      ? moment(result.date).format('YYYY-MM-DD HH:mm')
      : new Date(result.date).toLocaleString();

    const fresh = asRecord(
      api.getDefinition?.()?.views?.find((view: any) => view.id === current.viewId)?.options?.[
        PLUGIN_ID
      ]
    );
    const prev = parseGameStats(fresh.stats);
    const nextStats: GameStatsRecord = {
      bestScore: Math.max(prev?.bestScore ?? 0, result.score),
      bestLevel: Math.max(prev?.bestLevel ?? 0, result.level),
      totalCoins: (prev?.totalCoins ?? 0) + result.score,
      games: (prev?.games ?? 0) + 1,
      lastDate: dateText,
    };
    void patchViewOptions(api, current.viewId, { stats: nextStats });

    const freshOptions = parseGameOptions(fresh);
    if (freshOptions.recordScores && typeof api.createRow === 'function') {
      void api
        .createRow({
          viewId: current.viewId,
          values: {
            'gold-miner': true,
            score: result.score,
            level: result.level,
            difficulty: result.difficulty,
            date: dateText,
          },
        })
        .catch((error: unknown) => {
          console.error('[xdb-plugin] gold-miner: 写入战绩行失败', error);
        });
    }
  };

  // 引擎只挂载一次；容器销毁（unmount）时释放
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new GoldMinerEngine(canvas, options, {
      onGameOver: handleGameOver,
      onSave: handleSave,
      initialSave,
    });
    engine.applySettings(options, stats);
    engine.start();
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 设置变化热应用：音效立即生效，难度/时间等下一局生效
  useEffect(() => {
    engineRef.current?.applySettings(options, stats);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optionsKey]);

  return (
    <div className={CSS_PREFIX + 'root'}>
      <div className={CSS_PREFIX + 'stage'}>
        <canvas ref={canvasRef} />
      </div>
      <div className={CSS_PREFIX + 'hint'}>
        <span>点击 / 空格：放出钩爪</span>
        <span>P：暂停</span>
        <span>X：使用炸药</span>
        <span>R：重新开始</span>
        <span>限时内达到目标金额进入下一关</span>
      </div>
    </div>
  );
}
