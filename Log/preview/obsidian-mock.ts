/**
 * Obsidian 运行时模块的本地 mock。
 *
 * 源码（src/types.ts 等）通过 `import { App, Component } from 'obsidian'` 拿到类型；
 * 运行时（src/view.tsx）通过 `props.obsidian.Notice` 调用通知 API。
 * 这里仅实现预览所需的最小集合。
 */

/** 简易 Notice：控制台输出 + 页面顶部 toast */
export class Notice {
  private static readonly TOAST_ID = 'preview-notice-toast';
  constructor(message: string, _durationMs?: number) {
    // eslint-disable-next-line no-console
    console.log('%c[Notice]', 'color:#f7c444;font-weight:bold', message);

    let host = document.getElementById(Notice.TOAST_ID);
    if (!host) {
      host = document.createElement('div');
      host.id = Notice.TOAST_ID;
      host.style.cssText = [
        'position:fixed',
        'top:12px',
        'left:50%',
        'transform:translateX(-50%)',
        'z-index:9999',
        'display:flex',
        'flex-direction:column',
        'gap:6px',
        'pointer-events:none',
      ].join(';');
      document.body.appendChild(host);
    }

    const el = document.createElement('div');
    el.textContent = String(message);
    el.style.cssText = [
      'background:#3f2214',
      'color:#fff7e6',
      'padding:8px 14px',
      'border:2px solid #f7c444',
      'border-radius:6px',
      'font-size:13px',
      'box-shadow:0 4px 12px rgba(0,0,0,.25)',
      'opacity:0',
      'transition:opacity .2s ease',
    ].join(';');
    host.appendChild(el);
    requestAnimationFrame(() => (el.style.opacity = '1'));
    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 250);
    }, 2500);
  }
}

/** 类型占位 —— 仅用于通过 tsc 类型检查，运行时不会真正用到其内部方法 */
export class App {}
export class Component {}
export class Modal {}
export class ItemView {}
export class Setting {}
export class Plugin {}
export class WorkspaceLeaf {}

/** 常用枚举（按需补充） */
export enum Platform {
  isDesktop = true,
  isMobile = false,
}
