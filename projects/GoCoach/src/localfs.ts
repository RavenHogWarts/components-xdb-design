// ═════════════════════════════════════════════════════════════
// 本地文件系统访问（SGF 文件夹加载）：复用 engine.ts 的 require 探测。
// 仅宿主桌面端（Electron nodeIntegration）可用；浏览器/移动端返回空/降级。
// ═════════════════════════════════════════════════════════════

import { nodeRequire } from './engine';

/** 环境是否支持本地目录读取 */
export function localFsAvailable(): boolean {
  return nodeRequire() !== undefined;
}

/** 列出目录下的 SGF 棋谱文件名（.sgf，不递归，按名排序）；目录不可读返回空数组 */
export function listSgfFiles(dir: string): string[] {
  const req = nodeRequire();
  if (!req || !dir) return [];
  try {
    const fs = req('fs');
    const names: string[] = fs.readdirSync(dir);
    return names
      .filter((n) => typeof n === 'string' && /\.sgf$/i.test(n))
      .sort((a: string, b: string) => a.localeCompare(b, undefined, { numeric: true }));
  } catch {
    return [];
  }
}

/** 读取本地文本文件（SGF 一般为 UTF-8；历史文件可能是 GBK——解码失败时按 latin1 兜底返回） */
export function readLocalText(path: string): string {
  const req = nodeRequire();
  if (!req) throw new Error('当前环境不支持读取本地文件（需宿主桌面端）。');
  const fs = req('fs');
  const buf = fs.readFileSync(path) as { toString(enc: string): string };
  const text = buf.toString('utf8');
  // UTF-8 解码出替换字符说明编码不对：GBK 常见于老中文 SGF，按 latin1 保字节不炸
  return text.includes('\uFFFD') ? buf.toString('latin1') : text;
}

/** 目录路径拼接（Windows/POSIX 通吃，不依赖 node:path） */
export function joinPath(dir: string, name: string): string {
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
  return dir.replace(/[\\/]+$/, '') + sep + name;
}

/** 从文件的绝对路径取所在目录（webkitdirectory 选择后用首个文件反推） */
export function dirOfFile(path: string): string {
  const i = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
  return i > 0 ? path.slice(0, i) : '';
}
