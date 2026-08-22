#!/usr/bin/env node
/**
 * XDB 统一项目运行器（交互式）
 *
 * 用法（在仓库根目录）:
 *   pnpm dev                  交互选择项目 → 监听模式
 *   pnpm build                交互选择项目 → 生产构建
 *   pnpm build all            非交互：操作全部项目（CI 场景）
 *   pnpm build Log            非交互：指定项目（目录名或包名均可）
 *
 * 交互快捷键:
 *   ↑/↓ 或 j/k    移动光标
 *   空格           选中 / 取消选中当前项目
 *   a             全选 / 全不选（切换）
 *   回车           确认执行
 *   q / Esc       取消退出
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import readline from 'node:readline';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PROJECTS_DIR = join(ROOT, 'projects');
const BUILD_SCRIPT = join(ROOT, 'scripts', 'build.mjs');

// ---------- ANSI 颜色（非 TTY 时自动降级为纯文本） ----------
const supportsColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (str) => (supportsColor ? `\x1b[${code}m${str}\x1b[0m` : str);
const bold = paint('1');
const dim = paint('2');
const red = paint('31');
const green = paint('32');
const yellow = paint('33');
const magenta = paint('35');
const cyan = paint('36');
const TAG_COLORS = [cyan, magenta, yellow, green];

// ---------- 参数解析 ----------
const [modeArg = 'dev', ...selectors] = process.argv.slice(2);
const mode = ['production', 'prod', 'build'].includes(modeArg) ? 'production' : 'dev';

// ---------- 项目发现 ----------
function discoverProjects() {
  if (!existsSync(PROJECTS_DIR)) return [];
  return readdirSync(PROJECTS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .flatMap((e) => {
      const dir = join(PROJECTS_DIR, e.name);
      const pkgPath = join(dir, 'package.json');
      if (!existsSync(pkgPath)) return [];
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      return [{
        dir,
        dirName: e.name,
        name: pkg.name || e.name,
        description: pkg.description || '',
      }];
    })
    .sort((a, b) => a.dirName.localeCompare(b.dirName));
}

// ---------- 非交互选择：按目录名 / 包名匹配 ----------
function resolveSelection(projects, args) {
  if (!args.length) return null; // 无参数 → 交给交互式选择
  if (args.some((s) => ['all', '--all', '-a'].includes(s))) return projects;
  const picked = [];
  for (const s of args) {
    const p = projects.find((x) => x.dirName === s || x.name === s);
    if (!p) {
      console.error(red(`✗ 未找到项目 “${s}”`));
      console.error(`  可用项目: ${projects.map((x) => `${x.dirName} (${x.name})`).join(dim('、'))}`);
      process.exit(1);
    }
    if (!picked.includes(p)) picked.push(p);
  }
  return picked;
}

// ---------- 交互式多选（纯 Node，无第三方依赖） ----------
function multiselect(projects) {
  return new Promise((resolve) => {
    let cursor = 0;
    let selected = new Set(); // 默认不选中任何项目，由用户自行勾选
    let notice = '';
    let linesRendered = 0;
    let done = false;

    const title = bold(`◆ XDB ${mode === 'dev' ? '开发监听' : '生产构建'} · 选择项目`);
    const hint = dim('↑/↓ 移动 · 空格 选择 · a 全选/全不选 · 回车 确认 · q 取消');

    const write = (s) => process.stdout.write(s);

    function render() {
      if (linesRendered) write(`\x1b[${linesRendered}A\x1b[J`); // 回到首行并清除旧内容
      const out = [title];
      projects.forEach((p, i) => {
        const pointer = i === cursor ? cyan('❯') : ' ';
        const box = selected.has(i) ? green('[✓]') : dim('[ ]');
        const name = i === cursor ? cyan(bold(p.dirName)) : p.dirName;
        out.push(`  ${pointer} ${box} ${name} ${dim(p.description)}`);
      });
      if (notice) out.push(red(notice));
      out.push(hint, '');
      write(out.join('\n') + '\n');
      linesRendered = out.length;
    }

    function finish(result) {
      if (done) return;
      done = true;
      process.stdin.removeListener('keypress', onKey);
      try { process.stdin.setRawMode(false); } catch { /* 已是非 raw 模式 */ }
      process.stdin.pause();
      write('\x1b[?25h\n'); // 恢复光标
      resolve(result);
    }

    function onKey(_str, key) {
      if (!key || done) return;
      const k = key.name;
      if (key.ctrl && k === 'c') {
        finish(null);
      } else if (k === 'up' || k === 'k') {
        notice = '';
        cursor = (cursor - 1 + projects.length) % projects.length;
        render();
      } else if (k === 'down' || k === 'j') {
        notice = '';
        cursor = (cursor + 1) % projects.length;
        render();
      } else if (k === 'space') {
        notice = '';
        if (selected.has(cursor)) selected.delete(cursor);
        else selected.add(cursor);
        render();
      } else if (k === 'a') {
        notice = '';
        selected = selected.size === projects.length
          ? new Set()
          : new Set(projects.map((_, i) => i));
        render();
      } else if (k === 'return') {
        if (!selected.size) {
          notice = '至少选择一个项目（按 a 全选）';
          render();
        } else {
          finish([...selected].sort((x, y) => x - y).map((i) => projects[i]));
        }
      } else if (k === 'escape' || k === 'q') {
        finish(null);
      }
    }

    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    write('\x1b[?25l'); // 隐藏光标
    process.stdin.on('keypress', onKey);
    render();
  });
}

// ---------- 子进程执行 ----------
function pipePrefixed(child, tag) {
  for (const stream of [child.stdout, child.stderr]) {
    const target = stream === child.stderr ? process.stderr : process.stdout;
    const rl = readline.createInterface({ input: stream });
    rl.on('line', (line) => target.write(`${tag} ${line}\n`));
  }
}

function spawnProject(p, modeArg, tag) {
  const child = spawn(process.execPath, [BUILD_SCRIPT, modeArg], {
    cwd: p.dir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  pipePrefixed(child, tag);
  return child;
}

function makeTag(p, index, maxLen) {
  const color = TAG_COLORS[index % TAG_COLORS.length];
  return color(`[${p.dirName}]`.padEnd(maxLen + 3));
}

/** 生产构建：逐个串行执行，全部完成后输出汇总 */
async function runBuilds(list) {
  const maxLen = Math.max(...list.map((p) => p.dirName.length));
  const results = [];
  for (const p of list) {
    const t0 = performance.now();
    const code = await new Promise((resolve) => {
      const child = spawnProject(p, 'production', makeTag(p, results.length, maxLen));
      child.on('error', (err) => {
        console.error(red(`✗ 无法启动 ${p.dirName}: ${err.message}`));
        resolve(1);
      });
      child.on('close', (c) => resolve(c ?? 1));
    });
    const sec = ((performance.now() - t0) / 1000).toFixed(1);
    results.push({ p, ok: code === 0 });
    console.log(`${code === 0 ? green('✅') : red('❌')} ${bold(p.dirName)} ${code === 0 ? '构建完成' : `构建失败 (exit ${code})`} ${dim(`(${sec}s)`)}`);
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.error(red(`\n✗ ${failed.length}/${results.length} 个项目构建失败: ${failed.map((r) => r.p.dirName).join('、')}`));
    process.exit(1);
  }
  console.log(`\n${green('✔')} 全部构建完成 (${results.length}/${results.length})`);
}

/** 开发监听：并发启动所有选中项目的 watch 进程 */
async function runWatch(list) {
  const maxLen = Math.max(...list.map((p) => p.dirName.length));
  const children = list.map((p) => {
    const child = spawnProject(p, 'dev', makeTag(p, list.indexOf(p), maxLen));
    child.on('close', (code) => {
      if (code !== 0 && code !== null) {
        console.error(red(`[${p.dirName}] 监听进程异常退出 (exit ${code})`));
      }
    });
    return child;
  });

  const shutdown = () => {
    for (const c of children) c.kill();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log(dim(`\n👀 正在监听 ${children.length} 个项目，Ctrl+C 退出\n`));
  await new Promise(() => {}); // 挂起等待退出信号
}

// ---------- 主流程 ----------
async function main() {
  const projects = discoverProjects();
  if (!projects.length) {
    console.error(red('✗ 未在 projects/ 下发现任何项目'));
    process.exit(1);
  }

  let picked = resolveSelection(projects, selectors);
  if (picked === null) {
    if (process.stdin.isTTY && process.stdout.isTTY) {
      picked = await multiselect(projects);
      if (!picked) {
        console.log(dim('已取消'));
        process.exit(0);
      }
    } else {
      console.log(yellow('ℹ 非交互环境，默认选择全部项目（可用项目名参数指定）'));
      picked = projects;
    }
  }

  console.log(`\n${bold(`▶ ${mode === 'dev' ? '监听' : '构建'} ${picked.length} 个项目:`)} ${picked.map((p) => cyan(p.dirName)).join(dim('、'))}\n`);

  if (mode === 'dev') await runWatch(picked);
  else await runBuilds(picked);
}

main();
