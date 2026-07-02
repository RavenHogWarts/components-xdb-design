import { build } from 'esbuild';
import { readFileSync, writeFileSync, unlinkSync } from 'fs';

async function runBuild() {
  const tempFile = 'stardew-habit.temp.js';
  
  console.log('⚡ 正在预先压缩 CSS 样式表...');
  // 1. 读取并压缩 CSS，清除注释、空格与所有换行
  const rawCss = readFileSync('src/style.css', 'utf8');
  const minifiedCss = rawCss
    .replace(/\/\*[\s\S]*?\*\//g, '')     // 去除注释
    .replace(/\s+/g, ' ')                 // 合并空白
    .replace(/\s*([\{\}:;\,])\s*/g, '$1') // 去除符号周围的多余空格
    .trim();
  writeFileSync('src/style.min.css', minifiedCss, 'utf8');

  console.log('⚡ 正在编译打包分离式 TS 源码核心 (并启用 Minify 压缩)...');
  // 2. 编译核心，生成临时 CommonJS
  await build({
    entryPoints: ['src/plugin-core.ts'],
    bundle: true,
    platform: 'neutral',
    format: 'cjs',
    minify: true,
    outfile: tempFile,
    external: ['obsidian'],
    loader: { '.css': 'text', '.json': 'json' },
    logLevel: 'info',
  });

  // 3. 读取核心逻辑，并彻底剥离所有物理换行符
  let coreContent = readFileSync(tempFile, 'utf8').trim();
  
  // 安全地将物理换行替换为单空格
  coreContent = coreContent.replace(/\r?\n/g, ' ');

  if (coreContent.endsWith(';')) {
    coreContent = coreContent.slice(0, -1);
  }

  // 4. 拼接输出为纯单行 JavaScript 插件（不包含任何物理换行）
  const singleLineOutput = `"use strict";module.exports={id:"xdb-stardew-habit-tracker",name:"星露谷物语打卡插件",description:"将习惯追踪变成星露谷物语像素风的农场模拟经营体验。",author:"Google DeepMind Team",version:"1.0.0",install(ctx){return corePlugin.install(ctx)}};const corePlugin=(()=>{const exports={};const module={exports};${coreContent};return module.exports})();`;

  writeFileSync('stardew-habit.xdb.js', singleLineOutput, 'utf8');
  
  // 清理临时文件
  try {
    unlinkSync(tempFile);
    unlinkSync('src/style.min.css');
  } catch (e) {}

  console.log('✔ 成功构建符合 XDB 规范的极致单行插件: stardew-habit.xdb.js');
}

runBuild().catch(err => {
  console.error('✗ 构建失败:', err);
  process.exit(1);
});
