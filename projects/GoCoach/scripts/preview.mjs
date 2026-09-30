import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

// 预览打包：把 preview/entry.tsx（主视图）与 entry-settings.tsx（设置页）
// 打进 preview/dist/*.js，打开 index.html / settings.html 用浏览器直接查看
// （不依赖 Obsidian 宿主）。
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const common = {
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2020',
  jsx: 'automatic',
  jsxImportSource: 'react',
  // 与 scripts/build.mjs 相同的注入常量（types.ts 读取；预览给占位值）
  define: {
    __PLUGIN_ID__: JSON.stringify('go-coach'),
    __PLUGIN_NAME__: JSON.stringify('xdb-go-coach-preview'),
    __PLUGIN_DESCRIPTION__: JSON.stringify(''),
    __PLUGIN_AUTHOR__: JSON.stringify(''),
    __PLUGIN_VERSION__: JSON.stringify('0.0.0'),
    __PLUGIN_ICON__: JSON.stringify('Grid3x3'),
  },
  logLevel: 'info',
};

await build({
  ...common,
  entryPoints: [join(ROOT, 'preview', 'entry.tsx')],
  outfile: join(ROOT, 'preview', 'dist', 'board.js'),
});

await build({
  ...common,
  entryPoints: [join(ROOT, 'preview', 'entry-settings.tsx')],
  outfile: join(ROOT, 'preview', 'dist', 'settings.js'),
});

console.log('✅ 预览已构建: preview/dist/index.html 与 settings.html');
