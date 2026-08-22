#!/usr/bin/env node
/**
 * XDB 新建插件项目脚手架（交互式）
 *
 * 用法（在仓库根目录）:
 *   pnpm new                  交互式输入项目信息
 *   pnpm new MyBoard          非交互：以默认值创建（脚本/CI 场景）
 *
 * 生成的项目模板位于 templates/plugin/，遵循 .agents/skills/xdb-plugin-skills 约定：
 * 命名空间化的扩展 ID、插件专属 CSS 前缀、update/destroy 渲染器协议、
 * 设置 Tab 特性检测降级；创建后会自动 install → build → 运行 skill validator 校验。
 *
 * 交互按键:
 *   输入框     直接输入 · 回车 确认（空值取默认） · Backspace 删除 · Esc/q 取消
 *   选择列表   ↑/↓ 或 j/k 移动 · 回车 确认 · q/Esc 取消
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import readline from 'node:readline';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TEMPLATES_DIR = join(ROOT, 'templates', 'plugin');
const PROJECTS_DIR = join(ROOT, 'projects');
const BUILD_SCRIPT = join(ROOT, 'scripts', 'build.mjs');
const VALIDATOR = join(ROOT, '.agents', 'skills', 'xdb-plugin-skills', 'scripts', 'validate-xdb-plugin.mjs');

// ---------- ANSI 颜色（非 TTY 时自动降级为纯文本） ----------
const supportsColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (str) => (supportsColor ? `\x1b[${code}m${str}\x1b[0m` : str);
const bold = paint('1');
const dim = paint('2');
const red = paint('31');
const green = paint('32');
const yellow = paint('33');
const cyan = paint('36');

// ---------- 名称工具 ----------
const kebab = (s) =>
  s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[_\s]+/g, '-').toLowerCase();
const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

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

/** 单行文本输入；Esc/q 或 Ctrl+C 返回 null，空值回退 default */
function textInput({ title, default: def = '', validate } = {}) {
  return new Promise((resolve) => {
    let buffer = '';
    let notice = '';
    let linesRendered = 0;
    let done = false;

    const write = (s) => process.stdout.write(s);
    const prompt = def ? `${title} ${dim(`(默认 ${def})`)}: ` : `${title}: `;

    function render() {
      if (linesRendered) write(`\x1b[${linesRendered}A\x1b[J`);
      const out = [`${cyan('?')} ${prompt}${buffer}▌`];
      if (notice) out.push(red(notice));
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

    const onKey = (str, key) => {
      if (!key || done) return;
      const k = key.name;
      if (key.ctrl && k === 'c') return finish(null);
      if (k === 'escape' || k === 'q') return finish(null);
      if (k === 'return') {
        const value = buffer.trim() || def;
        if (!value) {
          notice = '此项为必填';
          return render();
        }
        if (validate) {
          const err = validate(value);
          if (err) {
            notice = err;
            return render();
          }
        }
        return finish(value);
      }
      if (k === 'backspace') {
        notice = '';
        buffer = buffer.slice(0, -1);
        return render();
      }
      // 可打印字符（含中文输入法上屏），排除控制序列与方向键的 ESC 序列
      const seq = key.sequence;
      if (seq && !key.ctrl && !key.meta && !/[\x00-\x1f\x7f]/.test(seq) && !seq.startsWith('\x1b')) {
        notice = '';
        buffer += seq;
        render();
      }
    };

    const detach = useKeypress(onKey);
    write('\x1b[?25l');
    render();
  });
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

// ---------- 输入校验 ----------
function validateDirName(value) {
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(value)) {
    return '目录名需以字母开头，仅含字母/数字/-/_';
  }
  if (existsSync(join(PROJECTS_DIR, value))) {
    return `projects/${value} 已存在`;
  }
  return null;
}

function validatePkgName(value) {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(value)) return '包名仅含字母/数字/./-/_，且以字母或数字开头';
  return null;
}

// ---------- 模板渲染 ----------
function collectTemplateFiles(dir, result = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collectTemplateFiles(full, result);
    else result.push(full);
  }
  return result;
}

function scaffold(v) {
  const target = join(PROJECTS_DIR, v.DIR_NAME);
  const files = collectTemplateFiles(TEMPLATES_DIR);
  for (const file of files) {
    let content = readFileSync(file, 'utf8');
    content = content.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      if (!(key in v)) throw new Error(`模板变量缺失: {{${key}}} (${file})`);
      return String(v[key]);
    });
    const rel = relative(TEMPLATES_DIR, file).replaceAll('\\', '/').replace(/\.tmpl$/, '');
    const outFile = join(target, rel);
    mkdirSync(join(outFile, '..'), { recursive: true });
    writeFileSync(outFile, content);
  }
  return target;
}

// ---------- 主流程 ----------
const ICONS = [
  { label: 'LayoutGrid', value: 'LayoutGrid', description: '网格/卡片' },
  { label: 'List', value: 'List', description: '列表' },
  { label: 'Table', value: 'Table', description: '表格' },
  { label: 'Calendar', value: 'Calendar', description: '日历' },
  { label: 'Image', value: 'Image', description: '图片/封面' },
  { label: 'Map', value: 'Map', description: '地图' },
  { label: 'Clock', value: 'Clock', description: '时间' },
  { label: 'Sparkles', value: 'Sparkles', description: '亮点/推荐' },
  { label: 'Orbit', value: 'Orbit', description: '星球/关系' },
  { label: 'Sprout', value: 'Sprout', description: '生长/习惯' },
  { label: '自定义…', value: '__custom__', description: '手动输入 Lucide 图标名' },
];

async function collectInfo(cliDirName) {
  if (cliDirName) {
    // 非交互模式：目录名来自参数，其余取默认值
    const err = validateDirName(cliDirName);
    if (err) {
      console.error(red(`✗ 目录名 “${cliDirName}” 无效: ${err}`));
      process.exit(1);
    }
    const id = kebab(cliDirName);
    return {
      DIR_NAME: cliDirName,
      PKG_NAME: `xdb-${id}`,
      PLUGIN_ID: id,
      PLUGIN_NAME: cliDirName,
      VIEW_NAME: cliDirName,
      DESCRIPTION: `${cliDirName} XDB 视图插件`,
      AUTHOR: cliDirName,
      ICON: 'LayoutGrid',
      OUTPUT_FILE: `${id}.xdb.js`,
      CSS_PREFIX: `${camel(id)}--`,
    };
  }

  if (!(process.stdin.isTTY && process.stdout.isTTY)) {
    console.error(red('✗ 非交互环境请使用: pnpm new <项目目录名>'));
    process.exit(1);
  }

  console.log(`\n${bold('◆ XDB 新建插件项目')}\n`);

  const dirName = await textInput({
    title: '项目目录名（PascalCase，如 KanbanBoard）',
    validate: validateDirName,
  });
  if (!dirName) return null;

  const id = kebab(dirName);
  const pkgName = await textInput({
    title: '包名',
    default: `xdb-${id}`,
    validate: validatePkgName,
  });
  if (!pkgName) return null;

  const viewName = await textInput({ title: '视图显示名称（宿主中展示）', default: dirName });
  if (!viewName) return null;

  let icon = await select({ title: '视图图标（Lucide，PascalCase）', items: ICONS });
  if (icon === '__custom__') {
    icon = await textInput({ title: '自定义图标名（PascalCase，如 ShieldCheck）' });
    if (!icon) return null;
  }
  if (icon === null) return null;

  const description = await textInput({ title: '插件描述', default: `${viewName} XDB 视图插件` });
  if (!description) return null;

  const author = await textInput({ title: '作者', default: dirName });
  if (!author) return null;

  return {
    DIR_NAME: dirName,
    PKG_NAME: pkgName,
    PLUGIN_ID: id,
    PLUGIN_NAME: viewName,
    VIEW_NAME: viewName,
    DESCRIPTION: description,
    AUTHOR: author,
    ICON: icon,
    OUTPUT_FILE: `${id}.xdb.js`,
    CSS_PREFIX: `${camel(id)}--`,
  };
}

async function main() {
  const [cliDirName] = process.argv.slice(2);
  const v = await collectInfo(cliDirName);
  if (!v) {
    console.log(dim('\n已取消'));
    process.exit(0);
  }

  // 汇总
  console.log(bold('\n◆ 即将创建：'));
  const rows = [
    ['目录', `projects/${v.DIR_NAME}`],
    ['包名', v.PKG_NAME],
    ['插件 ID', v.PLUGIN_ID],
    ['视图名称', v.VIEW_NAME],
    ['图标', v.ICON],
    ['描述', v.DESCRIPTION],
    ['作者', v.AUTHOR],
    ['产物', v.OUTPUT_FILE],
  ];
  for (const [k, val] of rows) console.log(`  ${dim(`${k}:`.padEnd(8))} ${val}`);

  if (!cliDirName) {
    const ok = await select({
      title: '确认创建？',
      items: [
        { label: '创建', value: true },
        { label: '取消', value: false },
      ],
    });
    if (!ok) {
      console.log(dim('已取消'));
      process.exit(0);
    }
  }

  // 1) 生成文件
  const target = scaffold(v);
  console.log(green(`\n✓ 已生成模板: projects/${v.DIR_NAME}`));

  // 2) 注册 workspace 成员
  console.log(dim('\n· pnpm install（注册新项目到 workspace）'));
  const inst = spawnSync('pnpm', ['install'], { cwd: ROOT, stdio: 'inherit', shell: true });
  if (inst.status !== 0) {
    console.error(yellow('! pnpm install 失败，请稍后在仓库根目录手动执行'));
  }

  // 3) 立即构建验证
  console.log(dim('\n· 生产构建验证'));
  const build = spawnSync(process.execPath, [BUILD_SCRIPT, 'production'], { cwd: target, stdio: 'inherit' });
  if (build.status !== 0) {
    console.error(red(`✗ 构建失败，请检查 projects/${v.DIR_NAME} 后重试`));
    process.exit(1);
  }
  console.log(green(`✓ 构建成功: projects/${v.DIR_NAME}/${v.OUTPUT_FILE}`));

  // 4) 用 skill validator 校验产物形状
  if (existsSync(VALIDATOR)) {
    console.log(dim('\n· 运行 xdb-plugin-skills validator'));
    const val = spawnSync(process.execPath, [VALIDATOR, join(target, v.OUTPUT_FILE)], { stdio: 'inherit' });
    console.log(val.status === 0 ? green('✓ validator 校验通过') : yellow('! validator 报告了问题，请按上面的输出处理'));
  } else {
    console.log(yellow('\n! 未找到 xdb-plugin-skills validator，跳过校验'));
  }

  console.log(`\n${green('✔')} 项目创建完成，后续步骤：
  ${dim('·')} 开发监听: ${cyan(`pnpm dev ${v.DIR_NAME}`)} 或 ${cyan(`cd projects/${v.DIR_NAME} && pnpm dev`)}
  ${dim('·')} 修改源码: ${cyan(`projects/${v.DIR_NAME}/src/`)}
  ${dim('·')} 安装产物: 将 ${cyan(v.OUTPUT_FILE)} 放入 XDB 插件目录
`);
}

main();
