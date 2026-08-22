import esbuild from 'esbuild';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

// 解析参数：dev / prod 两种模式
// 用法: 在子项目目录下执行 node ../../scripts/build.mjs [dev|prod|production]
const args = process.argv.slice(2);
const mode = args[0] || 'dev';
const prod = mode === 'production' || mode === 'prod';

// 读取当前子项目 package.json
let pkg;
try {
  const pkgPath = join(process.cwd(), 'package.json');
  pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
} catch (err) {
  console.error('❌ 无法读取当前项目目录下的 package.json:', err.message);
  process.exit(1);
}

const outfile = pkg.main;
if (!outfile) {
  console.error('❌ 请在当前项目的 package.json 中配置 "main" 字段作为输出文件名 (如: "stardew-habit.xdb.js")。');
  process.exit(1);
}

const banner = `/*
 * 本文件由 esbuild 自动打包生成 (${pkg.name || 'xdb-plugin'})
 * 如需查看源码，请前往 src/ 目录
 */
`;

/**
 * CSS 内联插件：将 .css 压缩后作为默认导出字符串返回
 * 配合插件内的 ctx.registerStyleSheet(styleText) 使用。
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
const entryPoints = ['src/plugin-core.ts'];

// 插件元数据单一来源：各项目 package.json 顶层字段
//   标准字段：name（显示名）/ version / description / author
//   扩展字段：id（插件 id）/ icon（Lucide 图标，PascalCase）
const author = typeof pkg.author === 'string' ? pkg.author : pkg.author?.name ?? '';

const ctx = await esbuild.context({
  banner: { js: banner },
  entryPoints,
  bundle: true,
  outfile,
  platform: 'neutral',
  format: 'cjs',
  target: 'es2020',
  define: {
    __PLUGIN_VERSION__: JSON.stringify(pkg.version || '0.0.0'),
    __PLUGIN_ID__: JSON.stringify(pkg.id || pkg.name || ''),
    __PLUGIN_NAME__: JSON.stringify(pkg.name || ''),
    __PLUGIN_DESCRIPTION__: JSON.stringify(pkg.description || ''),
    __PLUGIN_AUTHOR__: JSON.stringify(author),
    __PLUGIN_ICON__: JSON.stringify(pkg.icon || 'PanelTop'),
  },
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
  console.log(`✅ 生产构建完成: ${outfile}`);
  process.exit(0);
} else {
  // 开发模式：监听文件变化
  console.log(`👀 开发模式启动，监听文件变化并输出到: ${outfile}`);
  await ctx.watch();
}
