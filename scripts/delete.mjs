#!/usr/bin/env node
/**
 * XDB 移除插件项目（支持交互式与非交互式）
 *
 * 用法（在仓库根目录）:
 *   pnpm delete              交互式选择项目 → 确认后删除（人类终端用）
 *   pnpm delete <项目>       指定项目（目录名 / 包名 / 插件 id 均可），TTY 下需确认
 *   pnpm delete <项目> -y    跳过确认直接删除（AI / CI 用）
 *
 * 行为与安全边界:
 *   · 一次只删一个项目，仅允许删除 projects/ 下含 package.json 的已识别项目
 *   · 项目存在未提交的 git 更改时，确认摘要会显著提示（删除不可恢复）
 *   · 删除后自动 pnpm install 同步 workspace（失败仅提示，不影响删除结果）
 *   · 只删除仓库内项目，不会卸载已装入 Obsidian 库的插件（需手动删库内 *.xdb.js）
 *
 * 交互按键（选择 / 确认列表通用）:
 *   ↑/↓ 或 j/k 移动 · 回车 确认 · q/Esc 取消
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import readline from 'node:readline';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PROJECTS_DIR = join(ROOT, 'projects');

// ---------- ANSI 颜色（非 TTY 时自动降级为纯文本） ----------
const supportsColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (str) => (supportsColor ? `\x1b[${code}m${str}\x1b[0m` : str);
const bold = paint('1');
const dim = paint('2');
const red = paint('31');
const green = paint('32');
const yellow = paint('33');
const cyan = paint('36');

// ---------- 项目发现（与 run.mjs 保持一致，另读 id / main 字段） ----------
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
        id: pkg.id || '',
        main: pkg.main || (pkg.id ? `${pkg.id}.xdb.js` : ''),
        description: pkg.description || '',
      }];
    })
    .sort((a, b) => a.dirName.localeCompare(b.dirName));
}

// ---------- 解析待删项目：目录名 / 包名 / 插件 id 均可 ----------
function resolveOne(projects, key) {
  if (['all', '--all', '-a'].includes(key)) {
    console.error(red('✗ 删除不支持 all，一次只能删除一个项目'));
    process.exit(1);
  }
  const hit = projects.filter((p) => p.dirName === key || p.name === key || p.id === key);
  if (hit.length === 1) return hit[0];
  if (hit.length > 1) {
    console.error(red(`✗ “${key}” 同时匹配到多个项目: ${hit.map((p) => p.dirName).join('、')}，请用目录名精确指定`));
    process.exit(1);
  }
  console.error(red(`✗ 未找到项目 “${key}”`));
  console.error(`  可用项目: ${projects.map((p) => `${p.dirName} (${p.name})`).join(dim('、'))}`);
  process.exit(1);
}

// ---------- git 未提交更改检测（不在 git 仓库 / git 不可用时返回 null） ----------
function gitDirty(dir) {
  try {
    const rel = relative(ROOT, dir).replaceAll('\\', '/');
    const res = spawnSync('git', ['status', '--porcelain', '--', rel], { cwd: ROOT, encoding: 'utf8' });
    if (res.status !== 0) return null;
    return res.stdout.trim().length > 0;
  } catch {
    return null;
  }
}

// ---------- 交互组件（纯 Node，无第三方依赖） ----------
function useKeypress(handler) {
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('keypress', handler);
  return () => {
    process.stdin.removeListener('keypress', handler);
    try { process.stdin.setRawMode(false); } catch { /* 已是非 raw 模式 */ }
    process.stdin.pause();
  };
}

/** 单选列表；Esc/q 或 Ctrl+C 返回 null */
function select({ title, items }) {
  return new Promise((resolve) => {
    let cursor = 0;
    let linesRendered = 0;
    let done = false;

    const write = (s) => process.stdout.write(s);
    const hint = dim('↑/↓ 移动 · 回车 确认 · q 取消');

    function render() {
      if (linesRendered) write(`\x1b[${linesRendered}A\x1b[J`);
      const out = [`${cyan('?')} ${title}`];
      items.forEach((item, i) => {
        const pointer = i === cursor ? cyan('❯') : ' ';
        const label = i === cursor ? cyan(item.label) : item.label;
        const desc = item.description ? dim(` ${item.description}`) : '';
        out.push(`  ${pointer} ${label}${desc}`);
      });
      out.push(hint, '');
      write(out.join('\n') + '\n');
      linesRendered = out.length;
    }

    function finish(result) {
      if (done) return;
      done = true;
      detach();
      write('\x1b[?25h\n');
      resolve(result);
    }

    const onKey = (_str, key) => {
      if (!key || done) return;
      const k = key.name;
      if (key.ctrl && k === 'c') return finish(null);
      if (k === 'up' || k === 'k') { cursor = (cursor - 1 + items.length) % items.length; render(); }
      else if (k === 'down' || k === 'j') { cursor = (cursor + 1) % items.length; render(); }
      else if (k === 'return') finish(items[cursor].value);
      else if (k === 'escape' || k === 'q') finish(null);
    };

    const detach = useKeypress(onKey);
    write('\x1b[?25l');
    render();
  });
}

// ---------- 摘要与确认 ----------
function printSummary(p, dirty) {
  console.log(bold('\n◆ 即将删除：'));
  const rows = [
    ['目录', `projects/${p.dirName}`],
    ['包名', p.name],
    ['插件 ID', p.id || '(未声明)'],
    ['产物', p.main || '(未声明)'],
  ];
  if (p.description) rows.push(['描述', p.description]);
  for (const [k, v] of rows) console.log(`  ${dim(`${k}:`.padEnd(8))} ${v}`);
  if (dirty) console.log(yellow('  ⚠ 该项目存在未提交的 git 更改，删除后无法从版本库恢复'));
  console.log(red('  删除操作不可恢复！'));
}

async function confirmDelete() {
  // 默认光标停在「取消」，避免回车误删
  return select({
    title: '确认删除？（不可恢复）',
    items: [
      { label: '取消', value: false },
      { label: '删除', value: true },
    ],
  });
}

// ---------- 主流程 ----------
async function main() {
  const args = process.argv.slice(2);
  const force = args.some((a) => a === '-y' || a === '--yes');
  const selectors = args.filter((a) => a !== '-y' && a !== '--yes');
  if (selectors.length > 1) {
    console.error(red('✗ 一次只能删除一个项目'));
    process.exit(1);
  }

  const projects = discoverProjects();
  if (!projects.length) {
    console.error(red('✗ 未在 projects/ 下发现任何项目'));
    process.exit(1);
  }

  let picked;
  if (selectors.length) {
    picked = resolveOne(projects, selectors[0]);
  } else {
    if (!(process.stdin.isTTY && process.stdout.isTTY)) {
      console.error(red('✗ 非交互环境请使用带参数形式：pnpm delete <项目> [-y]'));
      console.error(red('  加 -y 跳过确认直接删除（AI / CI 用）'));
      process.exit(1);
    }
    console.log(`\n${bold('◆ XDB 移除插件项目')}\n`);
    picked = await select({
      title: '选择要移除的项目',
      items: projects.map((p) => ({
        label: p.dirName,
        description: `${p.name}${p.description ? ` · ${p.description}` : ''}`,
        value: p,
      })),
    });
    if (!picked) {
      console.log(dim('已取消'));
      process.exit(0);
    }
  }

  printSummary(picked, gitDirty(picked.dir));

  if (!force) {
    if (!(process.stdin.isTTY && process.stdout.isTTY)) {
      console.error(red('\n✗ 非交互环境删除需要显式确认：pnpm delete <项目> -y'));
      process.exit(1);
    }
    if (!(await confirmDelete())) {
      console.log(dim('已取消'));
      process.exit(0);
    }
  }

  rmSync(picked.dir, { recursive: true, force: true });
  console.log(green(`\n✓ 已删除 projects/${picked.dirName}`));

  console.log(dim('\n· pnpm install（同步 workspace）'));
  const inst = spawnSync('pnpm', ['install'], { cwd: ROOT, stdio: 'inherit', shell: true });
  if (inst.status !== 0) {
    console.error(yellow('! pnpm install 失败，请稍后在仓库根目录手动执行'));
  }

  console.log(`\n${green('✔')} 项目已移除。
  ${dim('·')} 此操作只删除仓库内项目，不影响已装入 Obsidian 库的插件
  ${dim('·')} 如需卸载插件，请删除库中的 ${cyan(picked.main || `${picked.id}.xdb.js`)}
`);
}

main();
