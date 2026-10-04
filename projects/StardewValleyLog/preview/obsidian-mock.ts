/**
 * obsidian 模块 mock：预览环境经 vite alias 把 `import ... from 'obsidian'`
 * 指到本文件，源码零修改。当前视图层未直接依赖 obsidian API，
 * 先提供常用桩（App / Component / Notice / normalizePath）。
 */

export type App = any;
export type Component = any;
export type TFile = any;
export type TFolder = any;

export class Notice {
  constructor(public message: string, public timeout = 2500) {
    console.log(`[Notice] ${message}`);
  }
}

export function normalizePath(path: string): string {
  let ret = path.replace(/([\\/])+/g, '/').replace(/(^\/|\/$)/g, '');
  const parts = ret.split('/');
  ret = parts
    .map((p) => p.trim().replace(/(["*\\<>?:|#^[\]])/g, '$1').replace(/ +$/g, ''))
    .join('/');
  return ret || '/';
}

export class ComponentStub {
  load() {}
  onload() {}
  unload() {}
  onunload() {}
  addChild<T>(child: T): T {
    return child;
  }
}

export const Platform = { isMobile: false, isDesktop: true };
