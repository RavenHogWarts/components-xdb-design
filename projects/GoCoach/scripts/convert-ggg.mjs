#!/usr/bin/env node
// Go Game Guru 题库转换脚本（离线工具，不进插件产物）。
// 读取 references/go-coach/data/gogameguru/lessons.json（上游固定 commit、
// 已经 go-coach 校验过的结构化题目），压缩为本插件紧凑格式，
// 输出 assets/ggg-lessons.json 供设置页导入（IndexedDB 存储）。
//
// 许可：原题 CC BY-NC-SA 4.0（David Ormerod、An Younggil）。
// 本脚本只做体积压缩（坐标扁平化 / 去掉冗余原始题面），保留逐题署名与
// 许可字段（source.attribution / license / url / commit），不改动题意。
// 产物与插件代码许可分离，仅限非商业使用，再分发须同许可共享。
//
// 用法：node scripts/convert-ggg.mjs [--in <lessons.json>] [--out <ggg-lessons.json>]

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const readArg = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};
const input = readArg('--in') ?? join(ROOT, 'references', 'go-coach', 'data', 'gogameguru', 'lessons.json');
const output = readArg('--out') ?? join(ROOT, 'assets', 'ggg-lessons.json');

const lessons = JSON.parse(readFileSync(input, 'utf8'));
if (!Array.isArray(lessons) || !lessons.length) {
  console.error('❌ 输入不是题目数组：', input);
  process.exit(1);
}

// 英文解说汉化（离线整句词典，264 条全覆盖；oe 保留原文供对照）
import { translateGggExplanation } from './ggg-i18n.mjs';

let translatedNodes = 0;

const compactTree = (node) => {
  const { zh, oe } = translateGggExplanation(node.explanation ?? '');
  if (oe) translatedNodes += 1;
  return {
    m: node.move ? [node.move[0], node.move[1]] : undefined,
    e: zh || undefined,
    oe: oe || undefined,
    r: node.result || undefined,
    a: node.author_verdict || undefined,
    c: (node.children ?? []).map(compactTree),
  };
};

const out = lessons.map((lesson) => {
  // 去掉最长的 original_prompt（英文原题面），保留中文题面与署名字段
  const { id, title, prompt, hint, size, to_play, skill, difficulty, stones, objective, marks, source, concept } = lesson;
  const src = { ...source };
  delete src.original_prompt;
  return {
    id,
    t: title,
    p: prompt,
    h: hint,
    z: size,
    f: to_play,
    k: skill,
    d: difficulty,
    c: concept || undefined,
    s: stones.flatMap((s) => [s.x, s.y, s.color]),
    o: objective,
    m: marks && marks.length ? marks : undefined,
    src,
    tr: compactTree(lesson.tree),
  };
});

const first = lessons[0].source ?? {};
const doc = {
  format: 'gocoach-ggg',
  version: 1,
  generatedAt: new Date().toISOString(),
  meta: {
    title: first.title ?? 'Go Game Guru Weekly Go Problems',
    author: first.author ?? 'David Ormerod and An Younggil',
    license: first.license ?? 'CC BY-NC-SA-4.0',
    attribution: first.attribution ?? '',
    url: 'https://github.com/gogameguru/go-problems',
    commit: first.commit ?? '',
    note: '由 xdb-go-coach 转换脚本压缩并汉化解说（离线整句词典，保留英文原文 oe 字段供对照）；题意与变化未改动。导入时逐题回放校验。',
    counts: {
      total: out.length,
      byLevel: out.reduce((acc, l) => {
        const level = (l.id.match(/ggg-(easy|intermediate|hard)-/) ?? [])[1] ?? 'other';
        acc[level] = (acc[level] ?? 0) + 1;
        return acc;
      }, {}),
    },
  },
  lessons: out,
};

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(doc));
const before = (readFileSync(input).length / 1024).toFixed(0);
const after = (readFileSync(output).length / 1024).toFixed(0);
console.log(`✅ 转换完成：${out.length} 题  ${before}KB → ${after}KB`);
console.log(`   输出：${output}`);
console.log(`   许可：${doc.meta.license} · ${doc.meta.author}`);
console.log(`   汉化: ${translatedNodes} 个英文解说节点已翻译（原文保留在 oe 字段）`)
console.log('   在插件设置页「题库管理 → 导入题库文件」选择该 JSON 即可练习。');
