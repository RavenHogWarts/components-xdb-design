#!/usr/bin/env node
/**
 * validate-xdb.mjs —— 校验 .xdb 数据库定义文件的结构合规性。
 *
 * .xdb 文件就是一段 JSON（DatabaseDefinition）。本脚本只做静态结构检查，给出确定性
 * 结论，比凭记忆核对可靠。生成或手改 .xdb 后都应跑一遍。
 *
 * 硬错（errors，退出码 1）——产物无法正常工作：
 *   - 不是合法 JSON / 顶层不是对象
 *   - fields 缺失或非数组；字段 name 为空或重复
 *   - views 非数组；视图 id 为空或重复
 *   - 视图 parentId（非空）指向不存在或非 group 的视图，或层级形成环
 *   - filter 顶层不是 group、节点缺 id / 重复 id、仍使用旧 condition
 *   - filter expression 含确定不属于当前 DSL 的常见 JavaScript 写法
 *   - source 存在但不是 'file' / 'task'
 *   - Root Group / 内置视图的 style 形状非法，或把 light/dark/css 错写到对象顶层
 *
 * 软警（warnings，不改变退出码）——通常该修，但不致命：
 *   - 视图 type 不在内置集合（视图可由插件扩展，故只警告）
 *   - kanban 缺 group（会显示空状态）
 *   - gantt / calendar 的 startField/endField 指向不存在的字段
 *   - gantt / calendar 缺 startField（会显示空状态）
 *   - calendar viewType、gantt zoom 取值非法
 *   - group 的 groupType 不在 tabs/vertical-tabs/dashboard
 *   - metric / charts / group summary / table summary 的 aggregate 配置形状非法
 *   - charts 的 chartType 不在内置集合；category/seriesBy 不是 {field} 形状；measures 项缺 aggregate
 *   - linkOpenMode 不在合法枚举
 *   - binding 的 file/items 形状非法、绑定项会被忽略（空 property/text、
 *     control.type 非法、日期时间变量缺 blockId）、配了会被忽略的数据视图字段
 *   - 自定义 Action type 无法静态确认其插件与 scope
 *   - button 字段仍使用 options.steps，或 Button View 仍使用 action
 *   - Action 列表不是数组、缺 id、id 重复；内置 type 与入口不匹配；自定义 type 需要确认插件与 scope
 *   - binding 的 items 非数组，或绑定项缺 id / id 重复
 *   - select 字段 options.items 形状不对
 *   - reference 字段 valueField/multiple 形状非法
 *   - layouts 的键不是 laptop/mobile
 *
 * 查不了（仍靠文档当人工判断）：
 *   表达式（formula/aggregate）以及 filter expression 的字段类型和完整语义能否
 *   求值、select 选项颜色是否合法、视图配置的业务合理性、插件视图的私有 options 是否正确。
 *   注：metric 的 aggregate 与 charts 的 chartType/measures 等都是**顶层字段**（不在
 *   options 里）。validator 检查 aggregate 的结构和字段引用，不模拟运行时求值。
 *   filter 只拦截确定错误的语法模式，不替代宿主里的真实 DSL 编译与试跑。
 *
 * 用法：node validate-xdb.mjs <file.xdb> [<file.xdb> ...]
 */

import { readFileSync } from 'node:fs';
import process from 'node:process';

// 内置视图类型（随插件发行；.xdb.js 插件可注册更多，故表外只警告）。
const BUILTIN_VIEW_TYPES = new Set([
  'table',
  'kanban',
  'gallery',
  'waterfall',
  'list',
  'gantt',
  'calendar',
  'metric',
  'group',
  'markdown',
  'charts',
  'reference',
  'button',
  'binding',
  'date-page',
]);

const VALID_SOURCES = new Set(['file', 'task']);
const VALID_CALENDAR_VIEW_TYPES = new Set(['days', 'week', 'month', 'list']);
const VALID_GANTT_ZOOM = new Set(['year', 'month', 'week', 'day']);
const VALID_LAYOUT_KEYS = new Set(['laptop', 'mobile']);
const VALID_GROUP_TYPES = new Set(['tabs', 'vertical-tabs', 'dashboard']);
const VALID_NEW_ROW_ACTION_TYPES = new Set(['create-file', 'command', 'prompt', 'script']);
const VALID_BUTTON_VIEW_ACTION_TYPES = new Set(['create-file', 'open-file', 'open-url', 'command', 'prompt', 'script']);
const VALID_BUTTON_FIELD_ACTION_TYPES = new Set([
  ...VALID_BUTTON_VIEW_ACTION_TYPES,
  'cform',
  'templater',
  'update-row',
  'move-row',
  'delete-row',
]);
const BUILTIN_ACTION_TYPES = new Set([...VALID_BUTTON_FIELD_ACTION_TYPES, ...VALID_NEW_ROW_ACTION_TYPES]);
const VALID_UPDATE_ROW_OPERATIONS = new Set(['set', 'append', 'delete']);
const VALID_UPDATE_ROW_VALUE_MODES = new Set(['literal', 'formula']);
const VALID_CHART_TYPES = new Set([
  'bar',
  'stackedBar',
  'horizontalBar',
  'stackedHorizontalBar',
  'line',
  'pie',
  'heatmap',
]);
const VALID_AGGREGATE_TYPES = new Set([
  'count',
  'sum',
  'average',
  'minimum',
  'maximum',
  'filled',
  'empty',
  'unique',
  'filledRows',
  'emptyRows',
  'optionCount',
  'uniqueOptions',
  'checked',
  'unchecked',
  'earliestDate',
  'latestDate',
  'earliestDateTime',
  'latestDateTime',
  'uniqueDays',
  'longestStreak',
]);
const VALID_LINK_OPEN_MODES = new Set([
  'tab',
  'split',
  'window',
  'current',
  'none',
  'modal-center',
  'modal-right',
  'modal-left',
]);
const VALID_BINDING_CONTROL_TYPES = new Set([
  'toggle',
  'text',
  'number',
  'select',
  'radio',
  'time',
  'date',
  'datetime',
]);
const VALID_BINDING_INSERT_POSITIONS = new Set(['append', 'prepend', 'append-under-heading', 'prepend-under-heading']);

function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim() !== '';
}

// ── 单文件校验 ──
function validate(filePath) {
  const errors = [];
  const warnings = [];

  // 1) 解析 JSON
  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (e) {
    errors.push(`读不到文件：${e?.message ?? e}`);
    return { filePath, parsed: false, summary: null, errors, warnings };
  }

  let def;
  try {
    def = JSON.parse(raw);
  } catch (e) {
    errors.push(`不是合法 JSON：${e?.message ?? e}`);
    return { filePath, parsed: false, summary: null, errors, warnings };
  }

  if (!isPlainObject(def)) {
    errors.push(`顶层应为对象，实际为 ${Array.isArray(def) ? '数组' : typeof def}`);
    return { filePath, parsed: true, summary: null, errors, warnings };
  }

  // 2) source
  if ('source' in def && def.source != null && !VALID_SOURCES.has(def.source)) {
    errors.push(`source 非法：${JSON.stringify(def.source)}（应为 'file' 或 'task'）`);
  }

  // 2b) Root Group
  if (def.rootGroup != null) {
    if (!isPlainObject(def.rootGroup)) {
      errors.push('rootGroup 应为对象');
    } else {
      if (def.rootGroup.type != null && !VALID_GROUP_TYPES.has(def.rootGroup.type)) {
        errors.push(`rootGroup.type 非法：${JSON.stringify(def.rootGroup.type)}（应为 tabs/vertical-tabs/dashboard）`);
      }
      validateViewStyle(errors, def.rootGroup, 'Root Group', true);
    }
  }

  // 3) fields
  const fieldNames = new Set();
  if (!Array.isArray(def.fields)) {
    errors.push('fields 缺失或不是数组');
  } else {
    for (const field of def.fields) {
      if (!isPlainObject(field)) {
        warnings.push(`fields 中存在非对象条目：${JSON.stringify(field)}`);
        continue;
      }
      if (!isNonEmptyString(field.name)) {
        errors.push(`字段缺少合法 name（非空字符串）：${JSON.stringify(field)}`);
        continue;
      }
      if (fieldNames.has(field.name)) {
        errors.push(`字段 name 重复：${field.name}`);
      }
      fieldNames.add(field.name);

      // select / multi-select 的选项形状
      if (field.type === 'select' || field.type === 'multi-select') {
        const items = field.options?.items;
        if (items != null) {
          if (!Array.isArray(items)) {
            warnings.push(`字段 ${field.name} 的 options.items 应为数组`);
          } else {
            for (const item of items) {
              if (!isPlainObject(item) || !('value' in item)) {
                warnings.push(`字段 ${field.name} 的某个选项缺少 value`);
              }
            }
          }
        }
      }

      if (field.type === 'reference') {
        const valueField = field.options?.valueField;
        if (valueField != null && (typeof valueField !== 'string' || !valueField.trim())) {
          warnings.push(`reference 字段 ${field.name} 的 options.valueField 应为非空字符串`);
        }
        const multiple = field.options?.multiple;
        if (multiple != null && typeof multiple !== 'boolean') {
          warnings.push(`reference 字段 ${field.name} 的 options.multiple 应为 boolean`);
        }
        if (field.options?.filter != null) {
          validateFilter(errors, field.options.filter, `reference 字段 ${field.name}`);
        }
      }

      if (field.type === 'button') {
        if (field.options?.steps != null) {
          errors.push(`按钮字段 ${field.name} 仍使用已删除的 options.steps；改用 options.actions`);
        }
        if (field.options?.actions != null) {
          validateActionList(
            errors,
            warnings,
            field.options.actions,
            `按钮字段 ${field.name}`,
            VALID_BUTTON_FIELD_ACTION_TYPES
          );
        }
      }
    }
  }

  // 4) views
  /** @type {Map<string, object>} */
  const viewsById = new Map();
  /** @type {object[]|null} */
  let views = null;
  if ('views' in def && def.views != null) {
    if (!Array.isArray(def.views)) {
      errors.push('views 不是数组');
    } else {
      views = def.views;
      for (const view of views) {
        if (!isPlainObject(view)) {
          errors.push(`views 中存在非对象条目：${JSON.stringify(view)}`);
          continue;
        }
        if (!isNonEmptyString(view.id)) {
          errors.push(`视图缺少合法 id（非空字符串）：${JSON.stringify(view)}`);
          continue;
        }
        if (viewsById.has(view.id)) {
          errors.push(`视图 id 重复：${view.id}`);
        }
        viewsById.set(view.id, view);
      }
    }
  }

  // 5) 视图逐项检查（type / parentId / 各视图专属）
  if (views) {
    for (const view of views) {
      if (!isPlainObject(view) || !isNonEmptyString(view.id)) continue;

      if (!isNonEmptyString(view.type)) {
        errors.push(`视图 ${view.id} 缺少 type`);
      } else if (!BUILTIN_VIEW_TYPES.has(view.type)) {
        warnings.push(`视图 ${view.id} 的 type '${view.type}' 不在内置集合（可能是插件视图，确认其 options 是否正确）`);
      }

      validateViewStyle(errors, view, `视图 ${view.id}`);

      // parentId 引用
      if (view.parentId != null) {
        const parent = viewsById.get(view.parentId);
        if (!parent) {
          errors.push(`视图 ${view.id} 的 parentId '${view.parentId}' 指向不存在的视图`);
        } else if (parent.type !== 'group') {
          errors.push(
            `视图 ${view.id} 的 parentId 指向非 group 视图 '${view.parentId}'（${parent.type}）；子视图只能挂在 group 下`
          );
        }
      }

      // layouts 键
      if (isPlainObject(view.layouts)) {
        for (const key of Object.keys(view.layouts)) {
          if (!VALID_LAYOUT_KEYS.has(key)) {
            warnings.push(`视图 ${view.id} 的 layouts 键 '${key}' 不是 laptop/mobile`);
          }
        }
      }

      // linkOpenMode（任意视图都可设）
      if (view.linkOpenMode != null && !VALID_LINK_OPEN_MODES.has(view.linkOpenMode)) {
        warnings.push(`视图 ${view.id} 的 linkOpenMode 非法：${JSON.stringify(view.linkOpenMode)}`);
      }

      // newRowAction（单 Action；task 源可借此提供自定义创建流程）
      if (view.newRowAction != null) {
        const na = view.newRowAction;
        if (isPlainObject(na) && (na.type === 'file' || na.type === 'markdown')) {
          errors.push(
            `视图 ${view.id} 的 newRowAction.type 为 '${na.type}'（旧版 schema，已废弃）。改用 'create-file' / 'command' / 'prompt' / 'script'，或已注册且支持 new-row 的自定义 Action type`
          );
        } else {
          validateAction(errors, warnings, na, `视图 ${view.id} 的 newRowAction`, VALID_NEW_ROW_ACTION_TYPES, false);
        }
      }

      if (view.group?.summary != null) {
        validateAggregateConfiguration(
          warnings,
          fieldNames,
          view.group.summary,
          `视图 ${view.id} 的 group.summary`,
          true
        );
      }
      if (view.summary != null) {
        validateTableSummary(warnings, fieldNames, view.summary, `视图 ${view.id} 的 summary`);
      }

      // 各视图专属
      switch (view.type) {
        case 'kanban': {
          const by = view.group?.by;
          if (!Array.isArray(by) || by.length === 0) {
            warnings.push(`视图 ${view.id}（kanban）没有配 group.by，看板会是空状态`);
          }
          break;
        }
        case 'gantt': {
          checkFieldRef(warnings, fieldNames, view.id, 'gantt', view.options?.startField, 'startField');
          checkFieldRef(warnings, fieldNames, view.id, 'gantt', view.options?.endField, 'endField');
          if (view.options?.zoom != null && !VALID_GANTT_ZOOM.has(view.options.zoom)) {
            warnings.push(`视图 ${view.id}（gantt）zoom 非法：${view.options.zoom}`);
          }
          if (!isNonEmptyString(view.options?.startField)) {
            warnings.push(`视图 ${view.id}（gantt）缺 startField，会显示空状态`);
          }
          break;
        }
        case 'calendar': {
          checkFieldRef(warnings, fieldNames, view.id, 'calendar', view.options?.startField, 'startField');
          checkFieldRef(warnings, fieldNames, view.id, 'calendar', view.options?.endField, 'endField');
          if (view.options?.viewType != null && !VALID_CALENDAR_VIEW_TYPES.has(view.options.viewType)) {
            warnings.push(`视图 ${view.id}（calendar）viewType 非法：${view.options.viewType}`);
          }
          if (!isNonEmptyString(view.options?.startField)) {
            warnings.push(`视图 ${view.id}（calendar）缺 startField，看不到事件`);
          }
          break;
        }
        case 'waterfall': {
          const ranges = [
            ['minCardWidth', 100, 800],
            ['maxCardWidth', 100, 800],
            ['cardMaxHeight', 180, 1200],
          ];
          for (const [key, min, max] of ranges) {
            const value = view.options?.[key];
            if (value != null && (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)) {
              warnings.push(`视图 ${view.id}（waterfall）的 ${key} 应在 ${min}–${max} 之间`);
            }
          }
          if (
            typeof view.options?.minCardWidth === 'number' &&
            typeof view.options?.maxCardWidth === 'number' &&
            view.options.minCardWidth > view.options.maxCardWidth
          ) {
            warnings.push(`视图 ${view.id}（waterfall）的 minCardWidth 不应大于 maxCardWidth`);
          }
          if (view.options?.hideFieldName != null && typeof view.options.hideFieldName !== 'boolean') {
            warnings.push(`视图 ${view.id}（waterfall）的 hideFieldName 应为 boolean`);
          }
          break;
        }
        case 'group': {
          const gt = view.options?.groupType;
          if (gt != null && !VALID_GROUP_TYPES.has(gt)) {
            warnings.push(`视图 ${view.id}（group）groupType 非法：${gt}（应为 tabs/vertical-tabs/dashboard）`);
          }
          break;
        }
        case 'metric': {
          if (view.aggregate != null) {
            validateAggregateConfiguration(
              warnings,
              fieldNames,
              view.aggregate,
              `视图 ${view.id}（metric）的 metric.aggregate`,
              true
            );
          }
          if (view.expression != null) {
            if (!isNonEmptyString(view.expression)) {
              warnings.push(`视图 ${view.id}（metric）的旧 expression 应为非空字符串`);
            } else {
              warnings.push(
                `视图 ${view.id}（metric）仍使用旧 expression；改用 aggregate: { "type": "expression", "expression": "..." }`
              );
            }
          }
          break;
        }
        case 'markdown': {
          if (view.options?.markdown != null && typeof view.options.markdown !== 'string') {
            warnings.push(`视图 ${view.id}（markdown）的 options.markdown 应为字符串`);
          }
          break;
        }
        case 'charts': {
          const ct = view.chartType;
          if (ct != null && !VALID_CHART_TYPES.has(ct)) {
            warnings.push(
              `视图 ${view.id}（charts）chartType 非法：${ct}（内置支持 bar/stackedBar/horizontalBar/stackedHorizontalBar/line/pie/heatmap）`
            );
          }
          // category / seriesBy 应为 { field } 形状
          for (const key of ['category', 'seriesBy']) {
            const v = view[key];
            if (v != null && !(isPlainObject(v) && isNonEmptyString(v.field))) {
              warnings.push(`视图 ${view.id}（charts）的 ${key} 应为 { "field": "<字段名>" } 形状`);
            }
          }
          // measures 应为数组，每项 { aggregate: AggregateConfiguration, label? }
          if (view.measures != null) {
            if (!Array.isArray(view.measures)) {
              warnings.push(`视图 ${view.id}（charts）的 measures 应为数组（顶层字段，不在 options 里）`);
            } else {
              view.measures.forEach((m, i) => {
                if (!isPlainObject(m) || m.aggregate == null) {
                  warnings.push(`视图 ${view.id}（charts）的 measures[${i}] 缺 aggregate`);
                  return;
                }
                validateAggregateConfiguration(
                  warnings,
                  fieldNames,
                  m.aggregate,
                  `视图 ${view.id}（charts）的 measures[${i}].aggregate`,
                  true
                );
              });
            }
          }
          break;
        }
        case 'reference': {
          if (view.options?.targetLink != null && typeof view.options.targetLink !== 'string') {
            warnings.push(`视图 ${view.id}（reference）的 options.targetLink 应为字符串（指向目标 .xdb 的链接）`);
          }
          if (!isNonEmptyString(view.options?.targetLink)) {
            warnings.push(`视图 ${view.id}（reference）缺 options.targetLink，看不到引用内容`);
          }
          if (view.options?.targetViewName != null && typeof view.options.targetViewName !== 'string') {
            warnings.push(`视图 ${view.id}（reference）的 options.targetViewName 应为字符串（目标视图名）`);
          }
          break;
        }
        case 'button': {
          if (view.action != null) {
            errors.push(`视图 ${view.id}（button）仍使用已删除的 action；改用 actions 数组`);
          }
          if (view.actions != null) {
            validateActionList(
              errors,
              warnings,
              view.actions,
              `视图 ${view.id}（button）`,
              VALID_BUTTON_VIEW_ACTION_TYPES
            );
            if (Array.isArray(view.actions)) {
              view.actions.forEach((action, index) => {
                if (
                  isPlainObject(action) &&
                  action.type === 'script' &&
                  typeof action.script === 'string' &&
                  (/\$item\b/.test(action.script) || /\brow\s*[.[]/.test(action.script))
                ) {
                  warnings.push(
                    `视图 ${view.id}（button）actions[${index}] 的 Script 使用了 row/$item，但 Button View 没有当前行`
                  );
                }
              });
            }
          }
          break;
        }
        case 'binding': {
          validateBindingView(errors, warnings, view);
          break;
        }
        case 'date-page': {
          // date-page 不是数据视图：不读 source，忽略 filter/sort/group/visibleFields/newRowAction。
          if (view.options?.folder != null && typeof view.options.folder !== 'string') {
            warnings.push(`视图 ${view.id}（date-page）的 options.folder 应为字符串`);
          }
          if (view.options?.template != null && typeof view.options.template !== 'string') {
            warnings.push(`视图 ${view.id}（date-page）的 options.template 应为字符串`);
          }
          const ignored = ['filter', 'sort', 'group', 'visibleFields', 'newRowAction', 'newRowFile'];
          for (const key of ignored) {
            if (view[key] != null) {
              warnings.push(`视图 ${view.id}（date-page）配置了 ${key}，但 date-page 不读 source、会忽略该字段`);
            }
          }
          break;
        }
        default:
          break;
      }
    }

    validateViewHierarchy(errors, viewsById);
  }

  // 6) 全局 filter 形状
  if (def.filter != null) {
    validateFilter(errors, def.filter, '全局');
  }
  if (views) {
    for (const view of views) {
      if (isPlainObject(view) && view.filter != null) {
        validateFilter(errors, view.filter, `视图 ${view.id}`);
      }
    }
  }

  const summary = {
    source: def.source ?? 'file',
    fieldCount: fieldNames.size,
    views: views ?? [],
    hasGlobalFilter: def.filter != null,
  };

  return { filePath, parsed: true, summary, errors, warnings };
}

function validateActionList(errors, warnings, actions, where, allowedTypes) {
  if (!Array.isArray(actions)) {
    errors.push(`${where} 的 actions 应为数组`);
    return;
  }
  const ids = new Set();
  actions.forEach((action, index) => {
    const actionWhere = `${where} actions[${index}]`;
    validateAction(errors, warnings, action, actionWhere, allowedTypes, true);
    if (!isPlainObject(action) || !isNonEmptyString(action.id)) return;
    if (ids.has(action.id)) {
      errors.push(`${where} 的 Action id 重复：${action.id}`);
    }
    ids.add(action.id);
  });
}

function validateViewStyle(errors, view, where, requireNestedStyle = false) {
  if (requireNestedStyle || BUILTIN_VIEW_TYPES.has(view.type)) {
    for (const misplacedKey of ['light', 'dark', 'css']) {
      if (view[misplacedKey] != null) {
        errors.push(`${where} 把 ${misplacedKey} 写在视图顶层；改用 style.${misplacedKey}`);
      }
    }
  }

  if (view.style == null) return;
  if (!isPlainObject(view.style)) {
    errors.push(`${where} 的 style 应为对象`);
    return;
  }

  const allowedKeys = new Set(['light', 'dark', 'css']);
  for (const key of Object.keys(view.style)) {
    if (!allowedKeys.has(key)) {
      errors.push(`${where} 的 style.${key} 不受支持（仅支持 light、dark、css）`);
    }
  }

  for (const theme of ['light', 'dark']) {
    const tokens = view.style[theme];
    if (tokens == null) continue;
    if (!isPlainObject(tokens)) {
      errors.push(`${where} 的 style.${theme} 应为 Token 对象`);
      continue;
    }
    for (const [property, value] of Object.entries(tokens)) {
      if (!property.startsWith('--')) {
        errors.push(`${where} 的 style.${theme}.${property} 不是 CSS Token；属性名应以 -- 开头`);
      }
      if (!isNonEmptyString(value)) {
        errors.push(`${where} 的 style.${theme}.${property} 应为非空字符串`);
      }
    }
  }

  if (view.style.css != null && typeof view.style.css !== 'string') {
    errors.push(`${where} 的 style.css 应为字符串`);
  }
}

// binding 是 Plain View：不读 source，专属字段 file/items 都在视图顶层。
// 只做静态形状检查；目标文件是否存在、任务能否匹配由运行时判断。
function validateBindingView(errors, warnings, view) {
  const where = `视图 ${view.id}（binding）`;

  if (view.options != null) {
    warnings.push(`${where} 配置了 options，但专属字段在视图顶层（file/items），options 会被忽略`);
  }

  const ignored = ['filter', 'sort', 'group', 'visibleFields', 'newRowFile', 'newRowAction'];
  for (const key of ignored) {
    if (view[key] != null) {
      warnings.push(`${where} 配置了 ${key}，但 binding 不读 source、会忽略该字段`);
    }
  }

  const file = view.file;
  if (file != null && file !== 'thisFile' && file !== 'activeFile') {
    if (typeof file === 'string') {
      warnings.push(`${where} 的 file '${file}' 不是 'thisFile'/'activeFile'；固定路径要写成 { "path": "..." }`);
    } else if (!isPlainObject(file)) {
      warnings.push(`${where} 的 file 应为 'thisFile'、'activeFile' 或 { "path": "...", "template": "..." }`);
    } else if (!isNonEmptyString(file.path)) {
      warnings.push(`${where} 的 file.path 应为非空字符串`);
    } else if (!file.path.trim().toLowerCase().endsWith('.md')) {
      warnings.push(`${where} 的 file.path '${file.path}' 应指向 Markdown 文件（.md 结尾）`);
    } else if (file.template != null && !isNonEmptyString(file.template)) {
      warnings.push(`${where} 的 file.template 应为非空字符串（vault 内的 .md 模板路径）`);
    }
  }

  if (view.items == null) return;
  if (!Array.isArray(view.items)) {
    errors.push(`${where} 的 items 应为数组`);
    return;
  }

  const ids = new Set();
  view.items.forEach((item, index) => {
    const itemWhere = `${where} items[${index}]`;
    if (!isPlainObject(item)) {
      warnings.push(`${itemWhere} 应为对象`);
      return;
    }
    if (!isNonEmptyString(item.id)) {
      errors.push(`${itemWhere} 缺少稳定且唯一的 id`);
    } else if (ids.has(item.id)) {
      errors.push(`${where} 的绑定项 id 重复：${item.id}`);
    } else {
      ids.add(item.id);
    }

    const binding = item.binding;
    if (!isPlainObject(binding)) {
      warnings.push(`${itemWhere} 缺少 binding（应为 file-property 或 task）`);
      return;
    }
    if (binding.type === 'file-property') {
      if (!isNonEmptyString(binding.property)) {
        warnings.push(`${itemWhere} 的 property 为空，该绑定项会被忽略`);
      }
    } else if (binding.type === 'task') {
      if (!isNonEmptyString(binding.text)) {
        warnings.push(`${itemWhere} 的 text 为空，该绑定项会被忽略`);
      } else if (!isNonEmptyString(binding.blockId) && /\{\{\s*(?:date|time)(?::[^}]*)?\s*\}\}/.test(binding.text)) {
        warnings.push(`${itemWhere} 的 text 使用日期时间变量但缺 blockId，绑定无法锚定到同一任务`);
      }
      if (binding.blockId != null && !isNonEmptyString(binding.blockId)) {
        warnings.push(`${itemWhere} 的 blockId 应为非空字符串（文件语法里的 ^ 不算 id 的一部分）`);
      }
      if (binding.insert != null) {
        const position = isPlainObject(binding.insert) ? binding.insert.position : undefined;
        if (!VALID_BINDING_INSERT_POSITIONS.has(position)) {
          warnings.push(
            `${itemWhere} 的 insert.position 非法：${JSON.stringify(position)}（应为 append/prepend/append-under-heading/prepend-under-heading）`
          );
        } else if (
          (position === 'append-under-heading' || position === 'prepend-under-heading') &&
          !isNonEmptyString(binding.insert.heading)
        ) {
          warnings.push(`${itemWhere} 的 insert.position '${position}' 需要 heading`);
        }
      }
    } else {
      warnings.push(
        `${itemWhere} 的 binding.type 非法：${JSON.stringify(binding.type)}（应为 'file-property' 或 'task'，其它取值会被忽略）`
      );
    }

    const control = item.control;
    if (control == null) return;
    if (!isPlainObject(control)) {
      warnings.push(`${itemWhere} 的 control 应为对象`);
      return;
    }
    if (!VALID_BINDING_CONTROL_TYPES.has(control.type)) {
      warnings.push(`${itemWhere} 的 control.type 非法：${JSON.stringify(control.type)}`);
    }
    if (control.multiple != null && typeof control.multiple !== 'boolean') {
      warnings.push(`${itemWhere} 的 control.multiple 应为 boolean`);
    }
    if (
      control.options != null &&
      (!Array.isArray(control.options) || control.options.some((o) => typeof o !== 'string'))
    ) {
      warnings.push(`${itemWhere} 的 control.options 应为字符串数组`);
    }
  });
}

function validateAction(errors, warnings, action, where, allowedTypes, requireId) {
  if (!isPlainObject(action)) {
    errors.push(`${where} 应为对象`);
    return;
  }
  if (requireId && !isNonEmptyString(action.id)) {
    errors.push(`${where} 缺少稳定且唯一的 id`);
  }
  if (!isNonEmptyString(action.type)) {
    errors.push(`${where} 缺少 type`);
    return;
  }
  if (!allowedTypes.has(action.type)) {
    if (BUILTIN_ACTION_TYPES.has(action.type)) {
      errors.push(`${where} 的内置 type '${action.type}' 不支持当前入口`);
    } else {
      warnings.push(
        `${where} 使用自定义 Action type '${action.type}'；请确认对应 *.xdb.js 插件已注册，且 handler 支持当前入口（match 只控制 picker）`
      );
    }
    return;
  }
  if (action.type === 'update-row') {
    if (!Array.isArray(action.updates)) {
      errors.push(`${where}（update-row）的 updates 应为数组`);
    } else {
      const updateIds = new Set();
      const fields = new Set();
      action.updates.forEach((update, index) => {
        const updateWhere = `${where} updates[${index}]`;
        if (!isPlainObject(update)) {
          errors.push(`${updateWhere} 应为对象`);
          return;
        }
        if (!isNonEmptyString(update.id)) {
          errors.push(`${updateWhere} 缺少稳定且唯一的 id`);
        } else if (updateIds.has(update.id)) {
          errors.push(`${where} 的 update id 重复：${update.id}`);
        } else {
          updateIds.add(update.id);
        }
        if (!isNonEmptyString(update.field)) {
          warnings.push(`${updateWhere} 缺少 field`);
        } else if (fields.has(update.field)) {
          errors.push(`${where} 重复更新字段：${update.field}`);
        } else {
          fields.add(update.field);
        }
        if (!VALID_UPDATE_ROW_OPERATIONS.has(update.operation)) {
          errors.push(`${updateWhere} 的 operation 非法：${JSON.stringify(update.operation)}`);
          return;
        }
        if (update.operation === 'delete') return;
        if (!VALID_UPDATE_ROW_VALUE_MODES.has(update.mode)) {
          errors.push(`${updateWhere} 的 mode 非法：${JSON.stringify(update.mode)}`);
        }
        if (update.mode === 'formula' && !isNonEmptyString(update.formula)) {
          warnings.push(`${updateWhere}（formula）缺少 formula`);
        }
      });
    }
  }
  if (action.type === 'move-row' && !isNonEmptyString(action.targetFolder)) {
    warnings.push(`${where}（move-row）缺少 targetFolder`);
  }
}

function validateTableSummary(warnings, fieldNames, summary, where) {
  if (!isPlainObject(summary)) {
    warnings.push(`${where} 应为 { "<字段名>": AggregateConfiguration } 对象`);
    return;
  }
  for (const [fieldName, configuration] of Object.entries(summary)) {
    if (!fieldNames.has(fieldName) && !fieldName.startsWith('file.')) {
      warnings.push(`${where}.${fieldName} 不是已定义字段，也不是 file.* 内置字段`);
    }
    validateAggregateConfiguration(warnings, fieldNames, configuration, `${where}.${fieldName}`, false);
  }
}

function validateAggregateConfiguration(warnings, fieldNames, configuration, where, fieldRequired) {
  if (typeof configuration === 'string') {
    if (!isNonEmptyString(configuration)) {
      warnings.push(`${where} 的旧字符串表达式应为非空字符串`);
    } else {
      warnings.push(`${where} 使用旧字符串表达式；改用 { "type": "expression", "expression": "..." }`);
    }
    return;
  }
  if (!isPlainObject(configuration)) {
    warnings.push(`${where} 应为 AggregateConfiguration 对象`);
    return;
  }
  if (!isNonEmptyString(configuration.type)) {
    warnings.push(`${where} 缺少 type`);
    return;
  }
  if (configuration.type === 'expression') {
    if (!isNonEmptyString(configuration.expression)) {
      warnings.push(`${where} 的 expression 应为非空字符串`);
    }
    return;
  }
  if (!VALID_AGGREGATE_TYPES.has(configuration.type)) {
    warnings.push(`${where} 的 aggregate type '${configuration.type}' 不受支持`);
    return;
  }
  if (fieldRequired && !isNonEmptyString(configuration.field)) {
    warnings.push(`${where} 的内置计算缺少 field`);
    return;
  }
  if (configuration.field != null && !isNonEmptyString(configuration.field)) {
    warnings.push(`${where} 的 field 应为非空字符串`);
    return;
  }
  if (
    isNonEmptyString(configuration.field) &&
    !fieldNames.has(configuration.field) &&
    !configuration.field.startsWith('file.')
  ) {
    warnings.push(`${where} 的 field '${configuration.field}' 不是已定义字段，也不是 file.* 内置字段`);
  }
}

// 字段引用检查：值要么是已定义字段，要么是 file.* 内置字段。
function checkFieldRef(warnings, fieldNames, viewId, viewType, value, label) {
  if (value == null) return;
  if (typeof value !== 'string') {
    warnings.push(`视图 ${viewId}（${viewType}）的 ${label} 不是字符串：${JSON.stringify(value)}`);
    return;
  }
  const ok = fieldNames.has(value) || value.startsWith('file.');
  if (!ok) {
    warnings.push(`视图 ${viewId}（${viewType}）的 ${label} '${value}' 不是已定义字段，也不是 file.* 内置字段`);
  }
}

function validateViewHierarchy(errors, viewsById) {
  const reportedCycles = new Set();
  for (const startId of viewsById.keys()) {
    const path = [];
    const positionById = new Map();
    let currentId = startId;
    while (viewsById.has(currentId)) {
      const cycleStart = positionById.get(currentId);
      if (cycleStart != null) {
        const cycle = [...path.slice(cycleStart), currentId];
        const key = [...new Set(cycle)].sort().join('\u0000');
        if (!reportedCycles.has(key)) {
          reportedCycles.add(key);
          errors.push(`视图层级形成环：${cycle.join(' -> ')}`);
        }
        break;
      }
      positionById.set(currentId, path.length);
      path.push(currentId);
      const parentId = viewsById.get(currentId)?.parentId;
      if (parentId == null) break;
      currentId = parentId;
    }
  }
}

function validateFilter(errors, node, where) {
  if (!isPlainObject(node) || node.type !== 'group') {
    errors.push(`${where} filter 顶层必须是 group`);
  }
  walkFilter(errors, node, where, new Set());
}

function walkFilter(errors, node, where, ids) {
  if (!isPlainObject(node)) {
    errors.push(`${where} 的 filter 节点不是对象`);
    return;
  }
  if (!isNonEmptyString(node.id)) {
    errors.push(`${where} 的 filter 节点缺少稳定 id`);
  } else if (ids.has(node.id)) {
    errors.push(`${where} 的 filter 节点 id 重复：${node.id}`);
  } else {
    ids.add(node.id);
  }
  switch (node.type) {
    case 'group':
      if (node.join !== 'and' && node.join !== 'or') {
        errors.push(`${where} 的 filter group join 应为 and/or`);
      }
      if (!Array.isArray(node.items)) {
        errors.push(`${where} 的 filter group 缺少 items 数组`);
      } else {
        for (const child of node.items) walkFilter(errors, child, where, ids);
      }
      break;
    case 'condition':
      errors.push(`${where} 的 filter 仍使用旧 condition；改成 type: "expression"`);
      break;
    case 'expression':
      if (!isNonEmptyString(node.expression)) {
        errors.push(`${where} 的 filter expression 缺少 expression`);
      } else {
        validateFilterExpressionSyntax(errors, node.expression, `${where} 的 filter ${node.id ?? '(no id)'}`);
      }
      break;
    default:
      errors.push(`${where} 的 filter 节点 type 未知：${JSON.stringify(node.type)}`);
  }
}

function validateFilterExpressionSyntax(errors, expression, where) {
  // 去掉合法的双引号字符串后再匹配，避免把字符串内容误判成语法。
  const code = expression.replace(/"(?:\\.|[^"\\])*"/g, '""');
  const unsupported = [
    [/\bmoment\s*\(/, 'moment(...)；请改用 date(...)、now()、today() 或 duration(...)'],
    [/===|!==/, '=== / !==；请使用 == / !='],
    [/=>/, '箭头函数'],
    [/\.(?:map|filter|reduce)\s*\(/, 'JavaScript 数组方法'],
    [/[;?]/, '分号或三元表达式'],
    [/'/, 'JavaScript 单引号字符串；DSL 字符串必须用双引号'],
  ];
  for (const [pattern, label] of unsupported) {
    if (pattern.test(code)) errors.push(`${where} expression 含不支持的 ${label}`);
  }
}

// ── 报告打印 ──
function mark(ok) {
  return ok ? '✓' : '✗';
}

function plural(n) {
  return n === 1 ? '' : 's';
}

// 把平铺 views 渲染成树（root = parentId 为空的视图）。
function renderViewTree(views) {
  const childrenOf = new Map();
  const roots = [];
  for (const v of views) {
    if (!isPlainObject(v)) continue;
    const pid = v.parentId;
    if (pid == null) {
      roots.push(v);
    } else {
      if (!childrenOf.has(pid)) childrenOf.set(pid, []);
      childrenOf.get(pid).push(v);
    }
  }
  const lines = [];
  const visited = new Set();
  const walk = (view, prefix, isLast, isRoot = false) => {
    if (visited.has(view.id)) return;
    visited.add(view.id);
    const branch = isRoot ? '' : isLast ? '└─ ' : '├─ ';
    const detail = view.type
      ? ` (${view.type}${view.type === 'group' && view.options?.groupType ? ` · ${view.options.groupType}` : ''})`
      : '';
    lines.push(`${prefix}${branch}${view.id ?? '(no id)'}${detail}`);
    const kids = childrenOf.get(view.id) ?? [];
    const nextPrefix = isRoot ? '' : prefix + (isLast ? '   ' : '│  ');
    kids.forEach((k, i) => walk(k, nextPrefix, i === kids.length - 1, false));
  };
  roots.forEach((r, i) => walk(r, '', i === roots.length - 1, true));
  return lines;
}

function report(r) {
  const { filePath, parsed, summary, errors, warnings } = r;
  const out = ['', `═══ ${filePath} ═══`, ''];

  if (!parsed) {
    for (const e of errors) out.push(`✗ ${e}`);
    out.push('', `→ FAIL (${errors.length} error${plural(errors.length)})`);
    return out.join('\n');
  }

  out.push('概要');
  out.push(`  source:   ${summary.source}`);
  out.push(`  fields:   ${summary.fieldCount}`);
  const rootCount = summary.views.filter((v) => isPlainObject(v) && v.parentId == null).length;
  out.push(`  views:    ${summary.views.length}${summary.views.length ? `（顶层 ${rootCount}）` : ''}`);
  out.push(
    `  filter:   ${summary.hasGlobalFilter ? '✓ 已设置全局 filter' : '— 未设置全局 filter（行集 = 全部源数据）'}`
  );

  if (summary.views.length > 0) {
    out.push('', '视图树');
    for (const line of renderViewTree(summary.views)) out.push(`  ${line}`);
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
    process.stderr.write('用法：node validate-xdb.mjs <file.xdb> [<file.xdb> ...]\n');
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
    process.stdout.write(
      `\n汇总：${files.length} 个文件，${totalErrors > 0 ? `${totalErrors} 个 error` : '全部通过'}\n`
    );
  }
  process.exit(totalErrors > 0 ? 1 : 0);
}

main();
