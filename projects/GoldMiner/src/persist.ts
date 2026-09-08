// View 内部写配置：宿主不为 View props 提供 setViewDefinition，
// 必须先从 api.getDefinition() 重读目标 View，再 api.updateView() 写回，
// 避免用旧闭包覆盖并发修改的 filter / sort / layouts（见 skill references/xdb-view.md）。

import { PLUGIN_ID } from './types';

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** 把 patch 合并进当前 View 的 options[PLUGIN_ID]；View 不存在时静默返回 false */
export async function patchViewOptions(
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
    console.error('[xdb-plugin] gold-miner: 写回视图配置失败', error);
    return false;
  }
}

/** 重置战绩：把 stats 字段从插件配置中移除（保留其它设置） */
export async function resetViewStats(api: any, viewId: string): Promise<boolean> {
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
    console.error('[xdb-plugin] gold-miner: 重置战绩失败', error);
    return false;
  }
}
