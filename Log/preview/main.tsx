/**
 * 预览页面 React 入口。
 *
 * 顶部工具栏：
 *   - 左：农场视图 / 设置面板 两个标签页切换
 *   - 中：5 种典型数据场景（仅对农场视图生效）
 *   - 右：刷新按钮
 * 农场视图与设置面板共享同一份 viewDefinition —— 在设置里改 habits/assetsPath
 * 后切回农场视图即可立即看到效果，模拟真实 XDB 配置流程。
 */
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import moment from 'moment';

// 让全局 moment 可用（view.tsx 通过 props.moment 接收，但部分场景也会直接读 window.moment）
(window as any).moment = moment;

import { createFarmRenderer } from '../src/view';
import { createSettingsRenderer } from '../src/settings';
import {
  SCENARIOS,
  generateScenarioRows,
  type MockRow,
  type ScenarioKey,
} from './mock-data';
import {
  createDefaultViewDefinition,
  createMockProps,
  createMockSettingsProps,
  type MockState,
} from './mock-props';

// 注入全局样式（plugin-core.ts 在真实环境里通过 registerStyleSheet 注入，
// 预览环境直接 import css 让 Vite 自动打到 <head>）
import '../src/style.css';
import './preview.css';

type Tab = 'farm' | 'settings';

function PreviewApp() {
  // 两个渲染器各自管理 React Root 生命周期
  const farmRendererRef = useRef(createFarmRenderer());
  const settingsRendererRef = useRef(createSettingsRenderer());
  const farmContainerRef = useRef<HTMLDivElement>(null);
  const settingsContainerRef = useRef<HTMLDivElement>(null);

  // mock 数据 state；切换场景时只重建 rows，viewDefinition 保留用户配置
  const stateRef = useRef<MockState | null>(null);
  const [scenario, setScenario] = useState<ScenarioKey>('partial');
  const [tab, setTab] = useState<Tab>('farm');
  // 数据 mutation 计数，用于触发 useEffect 重渲染
  const [version, setVersion] = useState(0);

  // 首次初始化 viewDefinition；切换场景只重建 rows
  useEffect(() => {
    if (!stateRef.current) {
      stateRef.current = {
        rows: generateScenarioRows(scenario),
        viewDefinition: createDefaultViewDefinition(scenario),
      };
    } else {
      stateRef.current.rows = generateScenarioRows(scenario);
    }
    setVersion(v => v + 1);
  }, [scenario]);

  // 农场视图渲染：tab 或数据变化时刷新
  useEffect(() => {
    if (tab !== 'farm' || !farmContainerRef.current || !stateRef.current) return;
    const props = createMockProps({
      state: stateRef.current,
      container: farmContainerRef.current,
      onMutate: () => setVersion(v => v + 1),
    });
    farmRendererRef.current.update(props);
  }, [tab, version]);

  // 设置面板渲染：tab 或 viewDefinition 变化时刷新
  useEffect(() => {
    if (tab !== 'settings' || !settingsContainerRef.current || !stateRef.current) return;
    const props = createMockSettingsProps({
      state: stateRef.current,
      container: settingsContainerRef.current,
      onMutate: () => setVersion(v => v + 1),
    });
    settingsRendererRef.current.update(props);
  }, [tab, version]);

  // 卸载时清理
  useEffect(() => {
    return () => {
      farmRendererRef.current.destroy();
      settingsRendererRef.current.destroy();
    };
  }, []);

  const reload = () => setVersion(v => v + 1);

  return (
    <div className="preview-shell">
      <header className="preview-toolbar">
        <div className="preview-brand">
          <span className="preview-brand-icon">🌾</span>
          <div className="preview-brand-text">
            <strong>星露谷打卡 · 本地预览</strong>
            <small>纯前端 mock，不会触碰真实 Obsidian 数据</small>
          </div>
        </div>

        {/* 视图 / 设置 标签切换 */}
        <div className="preview-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === 'farm'}
            className={'preview-tab-btn' + (tab === 'farm' ? ' is-active' : '')}
            onClick={() => setTab('farm')}
          >
            🌻 农场视图
          </button>
          <button
            role="tab"
            aria-selected={tab === 'settings'}
            className={'preview-tab-btn' + (tab === 'settings' ? ' is-active' : '')}
            onClick={() => setTab('settings')}
          >
            ⚙️ 设置面板
          </button>
        </div>

        {/* 数据场景切换（仅农场视图生效） */}
        {tab === 'farm' && (
          <nav className="preview-scenarios" aria-label="场景切换">
            {SCENARIOS.map(s => (
              <button
                key={s.key}
                className={'preview-scene-btn' + (scenario === s.key ? ' is-active' : '')}
                onClick={() => setScenario(s.key)}
                title={s.description}
              >
                {s.label}
              </button>
            ))}
          </nav>
        )}

        <button className="preview-reload-btn" onClick={reload} title="重新渲染当前视图">
          ↻ 刷新
        </button>
      </header>

      <section className="preview-stage">
        {/* 农场视图挂载点；保留 DOM 但切换 tab 时隐藏，避免 React Root 反复重建 */}
        <div
          ref={farmContainerRef}
          className="preview-container"
          style={{ display: tab === 'farm' ? 'block' : 'none' }}
        />
        {/* 设置面板挂载点 */}
        <div
          ref={settingsContainerRef}
          className="preview-container preview-container--settings"
          style={{ display: tab === 'settings' ? 'block' : 'none' }}
        />
      </section>
    </div>
  );
}

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(<PreviewApp />);
}
