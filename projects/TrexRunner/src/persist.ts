// View 内部写配置：宿主不为 View props 提供 setViewDefinition，
// 必须先从 api.getDefinition() 重读目标 View，再 api.updateView() 写回，
// 避免用旧闭包覆盖并发修改的 filter / sort / layouts（见 skill references/xdb-view.md）。
//
// 小恐龙只在终局写一次战绩、改设置时写一次选项，频率不高；这里仍沿用
// 模块级 Promise 队列把 patch 串行化——每个 patch 执行时才重读定义再合并，
// 天然避免两个在途写入基于同一快照互相覆盖（丢失后写的字段）。

import { PLUGIN_ID } from './types';

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

let queue: Promise<unknown> = Promise.resolve();

/** 把 patch 合并进当前 View 的 options[PLUGIN_ID]（串行执行）；View 不存在时静默返回 false */
export function patchViewOptions(
  api: any,
  viewId: string,
  patch: Record<string, unknown>
): Promise<boolean> {
  const run = queue.then(() => doPatch(api, viewId, patch));
  // 队列只做时序约束，单个失败不阻断后续 patch
  queue = run.catch(() => undefined);
  return run;
}

async function doPatch(
  api: any,
  viewId: string,
  patch: Record<string, unknown>
): Promise<boolean> {
  if (!api || typeof api.getDefinition !== 'function' || typeof api.updateView !== 'function') {
    return false;
  }
  const current = api.getDefinition()?.views?.find((view: any) => view.id === viewId);
  if (!current) return false;
  const merged = { ...asRecord(current.options?.[PLUGIN_ID]), ...patch };
  try {
    await api.updateView({
      ...current,
      options: {
        ...(current.options ?? {}),
        [PLUGIN_ID]: merged,
      },
    });
    return true;
  } catch (error) {
    console.error('[xdb-plugin] trex-runner: 写回视图配置失败', error);
    return false;
  }
}

/** 重置战绩：把 stats 字段从插件配置中移除（保留其它设置） */
export function resetViewStats(api: any, viewId: string): Promise<boolean> {
  const run = queue.then(() => doRemove(api, viewId));
  queue = run.catch(() => undefined);
  return run;
}

async function doRemove(api: any, viewId: string): Promise<boolean> {
  if (!api || typeof api.getDefinition !== 'function' || typeof api.updateView !== 'function') {
    return false;
  }
  const current = api.getDefinition()?.views?.find((view: any) => view.id === viewId);
  if (!current) return false;
  const options = asRecord(current.options?.[PLUGIN_ID]);
  const next = { ...options };
  delete next.stats;
  try {
    await api.updateView({
      ...current,
      options: {
        ...(current.options ?? {}),
        [PLUGIN_ID]: next,
      },
    });
    return true;
  } catch (error) {
    console.error('[xdb-plugin] trex-runner: 更新视图配置失败', error);
    return false;
  }
}
