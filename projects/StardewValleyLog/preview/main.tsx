/**
 * 预览页面 React 入口。
 *
 * 「本地和实际环境一样」：直接挂载 src/view.tsx 的真实渲染器，
 * 只 mock 宿主边界（DatabaseViewProps / obsidian 模块经 vite alias），
 * 样式也走 src/style.css 原文件（真实环境由 plugin-core registerStyleSheet 注入）。
 */
import { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import moment from 'moment';
(window as any).moment = moment;

import { createViewRenderer } from '../src/view';
import { createMockProps } from './mock-props';

// 真实环境由 plugin-core.ts 经 ctx.registerStyleSheet 注入，预览直接进 <head>
import '../src/style.css';
import './preview.css';

function PreviewApp() {
  const rendererRef = useRef<ReturnType<typeof createViewRenderer> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (!rendererRef.current) rendererRef.current = createViewRenderer();
    // 与宿主 onUpdate 协议一致：同步、可重复 render
    rendererRef.current.update(createMockProps(container));
  }, []);

  return (
    <div className="sdvlPreview">
      <header className="sdvlPreview__bar">
        <span className="sdvlPreview__title">xdb-stardew-valley-log · 本地预览</span>
        <span className="sdvlPreview__note">
          与实际产物同代码路径（src/view + src/style.css），仅宿主边界为 mock
        </span>
      </header>
      <main className="sdvlPreview__stage">
        <div ref={containerRef} className="sdvlPreview__viewContainer" />
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<PreviewApp />);
