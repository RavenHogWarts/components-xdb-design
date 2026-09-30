/** @jsxImportSource react */
// 完整视图预览（仅开发用）：经 createViewRenderer 渲染真实 GoCoachApp，
// 不依赖 Obsidian 宿主（storage 使用浏览器 localStorage/IndexedDB）。
// scripts/preview.mjs 打包到 preview/dist/，配合 index.html 用浏览器查看。

import { createViewRenderer } from '../src/view';

const renderer = createViewRenderer();
renderer.update({
  container: document.getElementById('app')!,
  viewId: 'preview-view',
  viewDefinition: { options: {} },
  viewData: { groups: [] },
  api: null,
  app: null,
  moment: null,
} as any);

// 模拟宿主行为：每次都用全新 props 对象反复调用 onUpdate（重渲染）
(window as any).__simulateHostUpdate = (n = 3) => {
  for (let i = 0; i < n; i++) {
    renderer.update({
      container: document.getElementById('app')!,
      viewId: 'preview-view',
      viewDefinition: { options: { 'go-coach': { showMoveNumbers: true, showCoords: false } } },
      viewData: { groups: [] },
      api: null,
      app: null,
      moment: null,
    } as any);
  }
};

// 模拟宿主整树重挂载：destroy 后重新 update（模块级展开态应保留）
(window as any).__remount = () => {
  renderer.destroy();
  renderer.update({
    container: document.getElementById('app')!,
    viewId: 'preview-view',
    viewDefinition: { options: {} },
    viewData: { groups: [] },
    api: null,
    app: null,
    moment: null,
  } as any);
};
