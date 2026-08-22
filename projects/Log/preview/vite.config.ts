/**
 * 预览环境 Vite 配置。
 *
 * 设计原则：零侵入式预览。
 *  - 通过 alias 把 `obsidian` 模块指向本地 mock（preview/obsidian-mock.ts），
 *    源码里 `import { App, Component } from 'obsidian'` 无需修改。
 *  - 通过 `@src` 别名直接复用 src/ 全部源码，preview 不复制任何业务逻辑。
 *  - 生产构建（build.mjs → stardew-habit.xdb.js）完全不受影响。
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname),
  base: './',
  resolve: {
    alias: {
      // 把 Obsidian 全局模块替换为本地 mock
      obsidian: path.resolve(__dirname, 'obsidian-mock.ts'),
    },
  },
  server: {
    port: 5173,
    // 不自动打开浏览器；用户手动访问 http://localhost:5173
    open: false,
    // 允许加载 ../stardew-habit/*.png 作为 url
    fs: {
      strict: false,
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
    // 输出一个独立静态站点，可部署到任何地方预览
  },
});
