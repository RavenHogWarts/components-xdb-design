#!/usr/bin/env node
// 逻辑层自测驱动：用根目录共享的 esbuild 把 selftest-entry.ts 打包成
// 临时 CJS 再以 node 执行（与插件产物同一套编译配置，不依赖 ts-node）。

import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'gocoach-selftest-'));

try {
  await build({
    entryPoints: [join(ROOT, 'scripts', 'selftest-entry.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    outfile: join(tmp, 'selftest.cjs'),
    loader: { '.json': 'json' },
    logLevel: 'warning',
    external: ['obsidian'],
  });
  execFileSync(process.execPath, [join(tmp, 'selftest.cjs')], {
    stdio: 'inherit',
    cwd: ROOT,
    env: { ...process.env, GOCOACH_ROOT: ROOT },
  });
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
