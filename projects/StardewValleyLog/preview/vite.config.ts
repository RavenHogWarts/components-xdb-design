/**
 * 预览环境 Vite 配置。
 *
 * 设计原则：零侵入式预览。
 *  - alias 把 `obsidian` 指向 preview/obsidian-mock.ts，源码无需修改；
 *  - 直接复用 src/ 全部源码与样式，预览不复制任何业务逻辑；
 *  - 生产构建（scripts/build.mjs → stardew-valley-log.xdb.js）完全不受影响。
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 与 scripts/build.mjs 完全一致的元数据注入（单一来源 package.json 顶层字段），
// 否则预览环境 types.ts 里的 __PLUGIN_*__ 未定义、模块加载即崩。
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
const author = typeof pkg.author === 'string' ? pkg.author : pkg.author?.name ?? '';

export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname),
  base: './',
  resolve: {
    alias: {
      obsidian: path.resolve(__dirname, 'obsidian-mock.ts'),
    },
  },
  define: {
    __PLUGIN_VERSION__: JSON.stringify(pkg.version || '0.0.0'),
    __PLUGIN_ID__: JSON.stringify(pkg.id || pkg.name || ''),
    __PLUGIN_NAME__: JSON.stringify(pkg.name || ''),
    __PLUGIN_DESCRIPTION__: JSON.stringify(pkg.description || ''),
    __PLUGIN_AUTHOR__: JSON.stringify(author),
    __PLUGIN_ICON__: JSON.stringify(pkg.icon || 'PanelTop'),
  },
  server: {
    port: 5173,
    open: false,
  },
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
});
