import esbuild from 'esbuild';
import { readFileSync } from 'node:fs';
import process from 'node:process';

// 参数解析：dev / prod 两种模式
// 用法: node build.mjs [dev|prod|production]
const args = process.argv.slice(2);
const mode = args[0] || 'dev';
const prod = mode === 'production' || mode === 'prod';
const outfile = 'stardew-habit.xdb.js';

const banner = `/*
 * 本文件由 esbuild 自动打包生成 (xdb-stardew-habit)
 * 如需查看源码，请前往 src/ 目录
 */
`;

/**
 * CSS 内联插件：将 .css 压缩后作为默认导出字符串返回
 * 配合插件内的 ctx.registerStyleSheet(styleText) 使用。
 * （XDB 需要以字符串形式注入样式表，因此不能用 esbuild 默认的独立 CSS 产物）
 */
const inlineCssPlugin = (minify) => ({
  name: 'inline-css',
  setup(build) {
    build.onLoad({ filter: /\.css$/ }, async (args) => {
      const css = readFileSync(args.path, 'utf8');
      const result = await esbuild.transform(css, {
        loader: 'css',
        minify,
      });
      return {
        contents: `export default ${JSON.stringify(result.code)};`,
        loader: 'js',
      };
    });
  },
});

// 创建 esbuild context
const ctx = await esbuild.context({
  banner: { js: banner },
  entryPoints: ['src/plugin-core.ts'],
  bundle: true,
  outfile,
  platform: 'neutral',
  format: 'cjs',
  target: 'es2020',
  minify: prod,
  treeShaking: true,
  sourcemap: prod ? false : 'inline',
  drop: prod ? ['console'] : [],
  external: ['obsidian'],
  jsx: 'automatic',
  jsxImportSource: 'react',
  loader: { '.json': 'json', '.tsx': 'tsx', '.ts': 'ts' },
  plugins: [inlineCssPlugin(prod)],
  logLevel: 'info',
});

if (prod) {
  // 生产模式：构建一次后退出
  await ctx.rebuild();
  await ctx.dispose();
  console.log('✅ 生产构建完成: ' + outfile);
  process.exit(0);
} else {
  // 开发模式：监听文件变化
  console.log('👀 开发模式启动，监听文件变化...');
  await ctx.watch();
}
