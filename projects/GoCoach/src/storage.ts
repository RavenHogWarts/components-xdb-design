// 持久化：学习档案（作答记录 / 帮过题目）存 localStorage；
// 导入题库体积可达数 MB，存 IndexedDB（localStorage 配额不够）。
// 设置页与视图是两个实例，通过 window 自定义事件同步变更。

import type { Attempt, Lesson } from './go/types';

const PROFILE_KEY = 'go-coach:profile:v1';
const DB_NAME = 'go-coach';
const STORE = 'kv';
const LIB_KEY = 'library'; // 旧版单题库（仅迁移用）
const LIBS_KEY = 'libraries';

export const EVENT_PROFILE_CHANGED = 'go-coach:profile-changed';
export const EVENT_LIBRARY_CHANGED = 'go-coach:library-changed';
export const EVENT_LLM_CHANGED = 'go-coach:llm-changed';
export const EVENT_ENGINE_STATUS = 'go-coach:engine-status';
export const EVENT_ENGINE_CHANGED = 'go-coach:engine-changed';

// ─────────────────────────────────────────────────────────────
// AI 讲解配置（M5.1，OpenAI 兼容端点；密钥仅存本机 localStorage）
// ─────────────────────────────────────────────────────────────

const LLM_KEY = 'go-coach:llm:v1';

export interface LlmConfig {
  /** OpenAI 兼容 Base URL，如 https://api.openai.com/v1、http://localhost:11434/v1 */
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 深度思考：开启后不附加禁思考参数、放宽全部时间限制（Qwen/GLM/DeepSeek-R1 等思考模型） */
  deepThinking?: boolean;
}

export function loadLlmConfig(): LlmConfig {
  try {
    const raw = localStorage.getItem(LLM_KEY);
    if (!raw) return { baseUrl: '', apiKey: '', model: '', deepThinking: false };
    const parsed = JSON.parse(raw) as Partial<LlmConfig>;
    return {
      baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl : '',
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
      model: typeof parsed.model === 'string' ? parsed.model : '',
      deepThinking: parsed.deepThinking === true,
    };
  } catch (err) {
    console.warn('[xdb-plugin] go-coach: AI 配置读取失败', err);
    return { baseUrl: '', apiKey: '', model: '' };
  }
}

export function saveLlmConfig(config: LlmConfig) {
  localStorage.setItem(LLM_KEY, JSON.stringify(config));
  window.dispatchEvent(new CustomEvent(EVENT_LLM_CHANGED, { detail: config }));
}

export function llmConfigured(config: LlmConfig): boolean {
  return Boolean(config.baseUrl.trim() && config.model.trim());
}

// ─────────────────────────────────────────────────────────────
// KataGo 引擎配置（M5.2a；路径仅存本机 localStorage）
// ─────────────────────────────────────────────────────────────

const ENGINE_KEY = 'go-coach:engine:v1';

export type EngineMode = 'off' | 'local' | 'remote';

export interface EngineConfig {
  mode: EngineMode;
  /** 本地模式：katago 可执行文件路径 */
  katagoPath: string;
  /** 本地模式：模型 .bin 路径 */
  modelPath: string;
  /** 每个局面最大 visits（默认 200） */
  visits: number;
  /** 远程模式：分析端点 URL */
  remoteUrl: string;
  /**
   * 本地模式：ONNX 系后端的 onnxProvider（v1.18 起 onnx 构建必填：
   * openvino/directml/cuda/tensorrt/migraphx/cpu）。空 = 按 katago 文件名自动推断。
   */
  onnxProvider?: string;
}

export function loadEngineConfig(): EngineConfig {
  try {
    const raw = localStorage.getItem(ENGINE_KEY);
    if (!raw) return { mode: 'off', katagoPath: '', modelPath: '', visits: 200, remoteUrl: '' };
    const parsed = JSON.parse(raw) as Partial<EngineConfig>;
    const mode = parsed.mode === 'local' || parsed.mode === 'remote' ? parsed.mode : 'off';
    const visits = Number(parsed.visits);
    return {
      mode,
      katagoPath: typeof parsed.katagoPath === 'string' ? parsed.katagoPath : '',
      modelPath: typeof parsed.modelPath === 'string' ? parsed.modelPath : '',
      visits: Number.isFinite(visits) && visits >= 1 && visits <= 10000 ? Math.round(visits) : 200,
      remoteUrl: typeof parsed.remoteUrl === 'string' ? parsed.remoteUrl : '',
      onnxProvider: typeof parsed.onnxProvider === 'string' ? parsed.onnxProvider : '',
    };
  } catch (err) {
    console.warn('[xdb-plugin] go-coach: 引擎配置读取失败', err);
    return { mode: 'off', katagoPath: '', modelPath: '', visits: 200, remoteUrl: '' };
  }
}

export function saveEngineConfig(config: EngineConfig) {
  localStorage.setItem(ENGINE_KEY, JSON.stringify(config));
  window.dispatchEvent(new CustomEvent(EVENT_ENGINE_CHANGED, { detail: config }));
}

// ─────────────────────────────────────────────────────────────
// 打谱：SGF 文件夹（localfs 列目录加载；路径仅存本机）
// ─────────────────────────────────────────────────────────────

const SGF_KEY = 'go-coach:sgf:v1';

export const EVENT_SGF_CHANGED = 'go-coach:sgf-changed';

export interface SgfConfig {
  /** SGF 棋谱文件夹绝对路径（空 = 未配置） */
  dir: string;
}

export function loadSgfConfig(): SgfConfig {
  try {
    const raw = localStorage.getItem(SGF_KEY);
    if (!raw) return { dir: '' };
    const parsed = JSON.parse(raw) as Partial<SgfConfig>;
    return { dir: typeof parsed.dir === 'string' ? parsed.dir : '' };
  } catch {
    return { dir: '' };
  }
}

export function saveSgfConfig(config: SgfConfig) {
  localStorage.setItem(SGF_KEY, JSON.stringify(config));
  window.dispatchEvent(new CustomEvent(EVENT_SGF_CHANGED, { detail: config }));
}

export interface Profile {
  attempts: Attempt[];
  /** 看过答案 / 中途放弃（进入复习池）的题目 id */
  helped: string[];
}

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return { attempts: [], helped: [] };
    const parsed = JSON.parse(raw) as Partial<Profile>;
    return {
      attempts: Array.isArray(parsed.attempts) ? parsed.attempts : [],
      helped: Array.isArray(parsed.helped) ? parsed.helped : [],
    };
  } catch (err) {
    console.warn('[xdb-plugin] go-coach: 学习档案读取失败，按空档案处理', err);
    return { attempts: [], helped: [] };
  }
}

export function saveProfile(profile: Profile) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  window.dispatchEvent(new CustomEvent(EVENT_PROFILE_CHANGED, { detail: profile }));
}

export function appendAttempt(attempt: Attempt): Profile {
  const profile = loadProfile();
  profile.attempts.push(attempt);
  saveProfile(profile);
  return profile;
}

export function markHelped(lessonId: string): Profile {
  const profile = loadProfile();
  if (!profile.helped.includes(lessonId)) {
    profile.helped.push(lessonId);
    saveProfile(profile);
  }
  return profile;
}

export function resetProfile(): Profile {
  saveProfile({ attempts: [], helped: [] });
  return { attempts: [], helped: [] };
}

// ─────────────────────────────────────────────────────────────
// 导入题库（IndexedDB）
// ─────────────────────────────────────────────────────────────

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function kvGet<T>(key: string): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(key);
      request.onsuccess = () => resolve((request.result as T) ?? null);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function kvSet(key: string, value: unknown): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

async function kvDelete(key: string): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

// ─────────────────────────────────────────────────────────────
// 导入文件格式：go-coach 原生数组 或 本插件紧凑格式（convert-ggg.mjs 产物）
// ─────────────────────────────────────────────────────────────

interface CompactLesson {
  id: string;
  t: string; // title
  p: string; // prompt
  h: string; // hint
  z: 9 | 19; // size
  f: 1 | 2; // to_play
  k: 'capture' | 'tsumego'; // skill
  d: number; // difficulty
  s: number[]; // stones: [x,y,color,...]
  o?: { kind: string; targets?: number[][] };
  m?: Array<{ x: number; y: number; label: string }>;
  c?: string; // concept
  src: Record<string, unknown>;
  tr: CompactNode;
}

interface CompactNode {
  m?: [number, number];
  e?: string;
  /** 汉化前的英文原文（对照用） */
  oe?: string;
  r?: string;
  a?: string;
  c?: CompactNode[];
}

function expandCompact(compact: CompactLesson): unknown {
  const stones: Array<{ x: number; y: number; color: 1 | 2 }> = [];
  for (let i = 0; i + 2 < compact.s.length; i += 3) {
    stones.push({ x: compact.s[i], y: compact.s[i + 1], color: compact.s[i + 2] as 1 | 2 });
  }
  const expandTree = (node: CompactNode): unknown => ({
    move: node.m ? [node.m[0], node.m[1]] : undefined,
    explanation: node.e,
    original_explanation: node.oe,
    result: node.r,
    author_verdict: node.a,
    children: (node.c ?? []).map(expandTree),
  });
  return {
    id: compact.id,
    title: compact.t,
    prompt: compact.p,
    hint: compact.h,
    size: compact.z,
    to_play: compact.f,
    skill: compact.k,
    difficulty: compact.d,
    sequence: true,
    concept: compact.c,
    stones,
    objective: compact.o ?? { kind: 'authored_solution' },
    marks: compact.m ?? [],
    source: compact.src,
    tree: expandTree(compact.tr),
  };
}

export interface LibraryFileMeta {
  format: string;
  count: number;
  importedAt?: string;
  attribution?: string;
  license?: string;
  /** 题库名称（紧凑格式 meta.title） */
  title?: string;
}

export interface ImportedLibrary {
  meta: LibraryFileMeta;
  lessons: Lesson[];
}

/** 多题库条目：导入的题库独立存储，可逐个启用/停用/删除 */
export interface LibraryEntry {
  /** 稳定 id（由 format + title 派生；重复导入同一题库则覆盖） */
  id: string;
  meta: LibraryFileMeta;
  lessons: Lesson[];
  enabled: boolean;
  importedAt: string;
}

/** 题库显示名：title → 署名前缀（"XXX by ..."）→ 已知 format 回退 */
export function libraryDisplayName(meta: LibraryFileMeta): string {
  if (meta.title) return meta.title;
  const m = /^(.+?)\s+by\s+/.exec(meta.attribution ?? '');
  if (m) return m[1];
  if (meta.format === 'gocoach-ggg') return 'Go Game Guru Weekly Go Problems';
  return meta.format;
}

/** 由文件元信息派生稳定 id（用显示名，旧数据无 title 时也能与重导入落位同一条目） */
export function libraryEntryId(meta: LibraryFileMeta): string {
  const slug = libraryDisplayName(meta)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${meta.format}-${slug || 'library'}`;
}

/** 解析导入文件（JSON 文本）：兼容原生数组与紧凑格式 */
export function parseLibraryFile(text: string): { meta: LibraryFileMeta; raw: unknown[] } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('文件不是有效的 JSON。');
  }
  if (Array.isArray(data)) {
    return { meta: { format: 'go-coach-lessons', count: data.length }, raw: data };
  }
  if (data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).lessons)) {
    const obj = data as Record<string, unknown>;
    const meta = obj.meta as Record<string, unknown> | undefined;
    const raw = (obj.lessons as unknown[]).map((lesson) => {
      // 紧凑格式判定：有 tr 字段
      if (lesson && typeof lesson === 'object' && 'tr' in (lesson as object)) {
        return expandCompact(lesson as CompactLesson);
      }
      return lesson;
    });
    return {
      meta: {
        format: String(obj.format ?? 'unknown'),
        count: raw.length,
        importedAt: meta?.generatedAt ? String(meta.generatedAt) : undefined,
        attribution: meta?.attribution ? String(meta.attribution) : undefined,
        license: meta?.license ? String(meta.license) : undefined,
        title: meta?.title ? String(meta.title) : undefined,
      },
      raw,
    };
  }
  throw new Error('题库文件需要是题目数组，或含 lessons 字段的对象。');
}

/** 读取全部导入题库（首次访问时把旧版单题库数据迁移为列表条目） */
export async function loadLibraries(): Promise<LibraryEntry[]> {
  const legacy = await kvGet<ImportedLibrary>(LIB_KEY);
  if (legacy) {
    const entry: LibraryEntry = {
      id: libraryEntryId(legacy.meta),
      meta: legacy.meta,
      lessons: legacy.lessons,
      enabled: true,
      importedAt: legacy.meta.importedAt ?? new Date().toISOString(),
    };
    await kvSet(LIBS_KEY, [entry]);
    await kvDelete(LIB_KEY);
    return [entry];
  }
  const stored = await kvGet<LibraryEntry[]>(LIBS_KEY);
  return Array.isArray(stored) ? stored : [];
}

/** 新增/覆盖一个导入题库（按派生 id 匹配覆盖，旧格式数据重导入不产生重复行），并通知视图刷新 */
export async function upsertLibrary(entry: LibraryEntry): Promise<boolean> {
  const list = await loadLibraries();
  const key = libraryEntryId(entry.meta);
  const idx = list.findIndex((e) => e.id === entry.id || libraryEntryId(e.meta) === key);
  if (idx >= 0) list[idx] = entry;
  else list.push(entry);
  const ok = await kvSet(LIBS_KEY, list);
  if (ok) window.dispatchEvent(new CustomEvent(EVENT_LIBRARY_CHANGED));
  return ok;
}

/** 更新启用状态（保留其余字段） */
export async function setLibraryEnabled(id: string, enabled: boolean): Promise<boolean> {
  const list = await loadLibraries();
  const entry = list.find((e) => e.id === id);
  if (!entry) return false;
  entry.enabled = enabled;
  const ok = await kvSet(LIBS_KEY, list);
  if (ok) window.dispatchEvent(new CustomEvent(EVENT_LIBRARY_CHANGED));
  return ok;
}

/** 删除一个导入题库 */
export async function removeLibrary(id: string): Promise<boolean> {
  const list = (await loadLibraries()).filter((e) => e.id !== id);
  const ok = await kvSet(LIBS_KEY, list);
  if (ok) window.dispatchEvent(new CustomEvent(EVENT_LIBRARY_CHANGED));
  return ok;
}
