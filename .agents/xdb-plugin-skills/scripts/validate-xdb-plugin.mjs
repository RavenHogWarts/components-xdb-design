#!/usr/bin/env node
/**
 * validate-xdb-plugin.mjs —— 校验 *.xdb.js 插件文件的结构合规性。
 *
 * 它复刻宿主的加载方式（eval 包裹 + install(ctx)），用一个「记录型 mock ctx」跑一遍
 * install，检查插件在「加载 / 注册阶段」是否合规，并打印结构摘要。
 *
 * 查什么（确定性的，镜像宿主 validatePluginShape + skill 规则）：
 *   - shape：id（非空）/ name（非空）/ description（字符串）/ install（函数）
 *   - cleanup：install() 是否返回函数（不返回只警告，与宿主一致）
 *   - 废弃 API：是否调了 registerDatabaseViewSettings
 *   - CSS：registerStyleSheet 是否用了宿主保留前缀 `components--`（硬错）；
 *          class 是否带一致前缀（警告）
 *
 * 查不了（仍靠文档当人工 guidance）：
 *   onUpdate 幂等性、配置写对位置（options / extensionData）、运行时是否抛错、
 *   icon 是否合法 Lucide、extension id 是否运行时拼接（mock 拿到时已是值）。
 *
 * 安全：本脚本会像 Obsidian 一样 eval 执行目标文件，仅用于校验你信任的插件文件。
 *
 * 用法：node validate-xdb-plugin.mjs <file.xdb.js> [<file.xdb.js> ...]
 */

import { readFileSync } from 'node:fs';
import process from 'node:process';

const RESERVED_CSS_PREFIX = 'components--';

// ── 宿主外部依赖的宽松 mock ──
// 插件顶层的 obsidian.X / app.Y / require(z) 都不会因此崩溃；我们只关心结构。
function makeNoopMock() {
  const target = function noop() {};
  return new Proxy(target, {
    get(_t, prop) {
      if (prop === 'then') return undefined; // 不要被当成 thenable
      if (prop === Symbol.toPrimitive) return () => '';
      if (typeof prop === 'symbol') return undefined;
      return makeNoopMock();
    },
    apply() {
      return makeNoopMock();
    },
    construct() {
      return makeNoopMock();
    },
    has() {
      return true;
    },
  });
}

// ── 复刻宿主 evaluateScriptPlugin 的 eval 包裹 ──
function loadPlugin(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const exports = {};
  const mod = { exports };

  const wrapper = globalThis.eval(
    `(function anonymous(require, module, exports, obsidian, app){\n${content}\n})\n//# sourceURL=xdb-plugin://${filePath}\n`
  );
  wrapper(makeNoopMock(), mod, exports, makeNoopMock(), makeNoopMock());

  return exports.default ?? mod.exports;
}

// ── 记录型 mock ctx：每个 registerXxx 记下扩展，registerStyleSheet 记下 css ──
function makeRecordingCtx() {
  const registrations = [];
  const stylesheets = [];

  const record = (kind) => (arg) => {
    const id = arg != null && typeof arg === 'object' && 'id' in arg ? arg.id : undefined;
    const name = arg != null && typeof arg === 'object' && 'name' in arg ? arg.name : undefined;
    registrations.push({ kind, id, name });
  };

  const ctx = {
    registerView: record('view'),
    registerViewSettings: record('viewSettings'),
    registerDatabaseView: record('databaseView'),
    registerDatabaseViewSettings: record('databaseViewSettings'),
    registerCardCoverView: record('cardCoverView'),
    registerCardCoverViewSettings: record('cardCoverViewSettings'),
    registerDatabaseViewRowStyleProvider: record('rowStyleProvider'),
    registerButtonStep: record('buttonStep'),
    registerButtonStepSettings: record('buttonStepSettings'),
    registerStyleSheet: (css) => {
      stylesheets.push(typeof css === 'string' ? css : '');
    },
  };

  return { ctx, registrations, stylesheets };
}

// ── CSS class 前缀分析（启发式，仅用于警告）──
function analyzeCssPrefix(cssBlocks) {
  const all = cssBlocks.join('\n');
  const classTokens = new Set();
  const re = /\.([A-Za-z_][\w-]*)/g;
  let m;
  while ((m = re.exec(all))) classTokens.add(m[1]);

  const prefixes = new Set();
  for (const tok of classTokens) {
    const i = tok.indexOf('--');
    if (i > 0) prefixes.add(tok.slice(0, i));
  }
  return { classCount: classTokens.size, prefixes: [...prefixes] };
}

function isBlank(s) {
  return typeof s !== 'string' || s.trim() === '';
}

function isNonBlankString(v) {
  return typeof v === 'string' && !isBlank(v);
}

// ── 单文件校验 ──
function validate(filePath) {
  const errors = [];
  const warnings = [];
  const shape = {
    id: { ok: false, value: undefined },
    name: { ok: false, value: undefined },
    description: { ok: false, value: undefined },
    install: { ok: false },
  };
  const summary = {
    registrations: [],
    stylesheetCount: 0,
    cssPrefixes: [],
    cleanupOk: false,
  };
  let installRan = false;

  // 1) 加载（eval 包裹）
  let candidate;
  try {
    candidate = loadPlugin(filePath);
  } catch (e) {
    errors.push(`加载失败（eval 抛错）：${e?.message ?? e}`);
    return { filePath, loaded: false, shape, installRan, summary, errors, warnings };
  }

  if (candidate == null || typeof candidate !== 'object') {
    errors.push(`module.exports 不是对象（得到 ${typeof candidate}）`);
    return { filePath, loaded: true, shape, installRan, summary, errors, warnings };
  }

  // 2) shape（镜像 validatePluginShape）
  const { id, name, description, install, author, version } = candidate;
  shape.id = { ok: isNonBlankString(id), value: id };
  shape.name = { ok: isNonBlankString(name), value: name };
  shape.description = { ok: typeof description === 'string', value: description };
  shape.install = { ok: typeof install === 'function' };

  if (!shape.id.ok) errors.push('缺少合法 id（非空字符串，全局唯一）');
  if (!shape.name.ok) errors.push('缺少合法 name（非空字符串）');
  if (!shape.description.ok) errors.push('缺少合法 description（字符串）');
  if (!shape.install.ok) errors.push('缺少合法 install（函数，且应返回 cleanup）');
  if (author == null) warnings.push('未填写 author（可选，会显示在插件管理视图）');
  if (version == null) warnings.push('未填写 version（可选）');

  if (typeof install !== 'function') {
    return { filePath, loaded: true, shape, installRan, summary, errors, warnings };
  }

  // 3) 跑 install（mock ctx）
  const { ctx, registrations, stylesheets } = makeRecordingCtx();
  let cleanup;
  try {
    cleanup = install.call(candidate, ctx);
    installRan = true;
  } catch (e) {
    errors.push(`install(ctx) 抛错：${e?.message ?? e}`);
    summary.registrations = registrations;
    summary.stylesheetCount = stylesheets.length;
    return { filePath, loaded: true, shape, installRan, summary, errors, warnings };
  }

  summary.registrations = registrations;
  summary.stylesheetCount = stylesheets.length;
  summary.cleanupOk = typeof cleanup === 'function';

  // 4) cleanup（宿主只 warn，不 fail）
  if (!summary.cleanupOk) {
    warnings.push('install() 没有返回 cleanup 函数（宿主会 warn 并兜底 no-op）');
  }

  // 5) 废弃 API
  if (registrations.some((r) => r.kind === 'databaseViewSettings')) {
    warnings.push('用了已废弃的 registerDatabaseViewSettings，改用 registerViewSettings');
  }

  // 6) CSS 前缀
  if (stylesheets.length > 0) {
    if (stylesheets.some((c) => c.includes(RESERVED_CSS_PREFIX))) {
      errors.push(`registerStyleSheet 用了宿主保留前缀 '${RESERVED_CSS_PREFIX}'，换成本插件自己的前缀`);
    }
    const { classCount, prefixes } = analyzeCssPrefix(stylesheets);
    summary.cssPrefixes = prefixes;
    if (classCount > 0 && prefixes.length === 0) {
      warnings.push("registerStyleSheet 的 class 没有 '前缀--' 命名，易与他人撞样式");
    } else if (prefixes.length > 1) {
      warnings.push(`registerStyleSheet 出现多个 class 前缀：${prefixes.join(', ')}（建议统一成一个）`);
    }
  }

  return { filePath, loaded: true, shape, installRan, summary, errors, warnings };
}

// ── 报告打印 ──
const KIND_LABEL = {
  view: 'view',
  viewSettings: 'viewSettings',
  databaseView: 'databaseView',
  databaseViewSettings: 'databaseViewSettings ⚠deprecated',
  cardCoverView: 'cardCoverView',
  cardCoverViewSettings: 'cardCoverViewSettings',
  rowStyleProvider: 'rowStyleProvider',
  buttonStep: 'buttonStep',
  buttonStepSettings: 'buttonStepSettings',
};

function mark(ok) {
  return ok ? '✓' : '✗';
}

function truncate(s, n = 60) {
  return s.length > n ? `${s.slice(0, n - 3)}...` : s;
}

function plural(n) {
  return n === 1 ? '' : 's';
}

function report(r) {
  const { filePath, shape, installRan, summary, errors, warnings } = r;
  const out = ['', `═══ ${filePath} ═══`, ''];

  out.push('shape');
  out.push(`  ${mark(shape.id.ok)} id            ${shape.id.value ?? '(missing)'}`);
  out.push(`  ${mark(shape.name.ok)} name          ${shape.name.value ?? '(missing)'}`);
  const descText = shape.description.ok
    ? shape.description.value === ''
      ? '(empty)'
      : truncate(shape.description.value)
    : '(missing)';
  out.push(`  ${mark(shape.description.ok)} description   ${descText}`);
  out.push(`  ${mark(shape.install.ok)} install       ${shape.install.ok ? 'function' : '(missing)'}`);

  if (installRan) {
    out.push('', 'install (mock run)');
    if (summary.registrations.length === 0) {
      out.push('  (没有调用任何 ctx.registerXxx)');
    } else {
      for (const reg of summary.registrations) {
        const label = (KIND_LABEL[reg.kind] ?? reg.kind).padEnd(24);
        const head = `${reg.id ?? '(no id)'}`;
        out.push(`  ${label} ${head}${reg.name ? ` — ${reg.name}` : ''}`);
      }
    }
    const prefixInfo = summary.cssPrefixes.length ? `, prefix=${summary.cssPrefixes.join('/')}` : '';
    out.push(`  stylesheet: ${summary.stylesheetCount} block(s)${prefixInfo}`);
    out.push(`  cleanup:    ${summary.cleanupOk ? '✓ function' : '⚠ 非 function'}`);
  }

  out.push('');
  if (errors.length === 0 && warnings.length === 0) {
    out.push('✓ 无问题');
  } else {
    for (const e of errors) out.push(`✗ ${e}`);
    for (const w of warnings) out.push(`⚠ ${w}`);
  }

  const status =
    errors.length > 0
      ? `FAIL (${errors.length} error${plural(errors.length)}, ${warnings.length} warning${plural(warnings.length)})`
      : `PASS (${warnings.length} warning${plural(warnings.length)})`;
  out.push('', `→ ${status}`);
  return out.join('\n');
}

// ── CLI ──
function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    process.stderr.write('用法：node validate-xdb-plugin.mjs <file.xdb.js> [<file.xdb.js> ...]\n');
    process.exit(2);
  }

  let totalErrors = 0;
  const reports = [];
  for (const f of files) {
    const r = validate(f);
    totalErrors += r.errors.length;
    reports.push(report(r));
  }

  process.stdout.write(`${reports.join('\n')}\n`);
  if (files.length > 1) {
    process.stdout.write(`\n汇总：${files.length} 个文件，${totalErrors > 0 ? `${totalErrors} 个 error` : '全部通过'}\n`);
  }
  process.exit(totalErrors > 0 ? 1 : 0);
}

main();
