/**
 * 模拟打卡数据生成器。
 *
 * 生成结构必须与 src/view.tsx 实际从 Obsidian 拿到的 viewData 形状一致：
 *   viewData.groups[].rows[].{ id, $item: { file:{basename,path}, [field]: boolean } }
 *
 * 默认三个习惯字段：锻炼 / 阅读 / 日记（与 src/view.tsx 的 DEFAULT_HABITS 对齐）。
 */
import moment from 'moment';

export type ScenarioKey =
  | 'empty'        // 无任何记录
  | 'no-today'     // 有历史但今天还没创建
  | 'partial'      // 今日部分打卡
  | 'perfect'      // 连续 7 天全打卡（测试房屋满级 / 作物成熟）
  | 'broken';      // 中断的 streak（昨日断了）

export interface MockRow {
  id: string;
  $item: {
    file: { basename: string; path: string };
    [field: string]: any;
  };
}

export interface MockScenarioMeta {
  key: ScenarioKey;
  label: string;
  description: string;
}

export const SCENARIOS: MockScenarioMeta[] = [
  { key: 'empty',    label: '空数据',         description: '数据库里一条记录都没有（首次安装场景）' },
  { key: 'no-today', label: '今天未创建',     description: '前几天有打卡，今天还没生成日记文件' },
  { key: 'partial',  label: '今日部分打卡',   description: '3 个习惯里只完成了 1 个（天空呈现过渡色）' },
  { key: 'perfect',  label: '完美连续 7 天',  description: '连续 7 天全勤 → 房屋满级 / 作物大丰收' },
  { key: 'broken',   label: '中断 streak',    description: '今天打卡了但昨天断了，streak 从 1 重新计' },
];

const FIELDS = ['锻炼', '阅读', '日记'] as const;

function fmt(d: moment.Moment): string {
  return d.format('YYYY-MM-DD');
}

/**
 * 在指定日期生成一条打卡记录。
 * statusForField 接收字段名，返回该字段的打卡状态。
 */
function makeRow(
  date: moment.Moment,
  statusForField: (field: string) => boolean
): MockRow {
  const basename = fmt(date);
  const $item: MockRow['$item'] = {
    file: { basename, path: `${basename}.md` },
  };
  for (const f of FIELDS) $item[f] = statusForField(f);
  return { id: `row-${basename}`, $item };
}

/**
 * 按场景生成最近的打卡记录数组（按时间升序，与 view.tsx 排序后一致）。
 */
export function generateScenarioRows(scenario: ScenarioKey): MockRow[] {
  const today = moment().startOf('day');

  switch (scenario) {
    case 'empty':
      return [];

    case 'no-today': {
      // 前 5 天历史，今天没记录
      const rows: MockRow[] = [];
      for (let i = 5; i >= 1; i--) {
        const d = moment(today).subtract(i, 'days');
        rows.push(makeRow(d, () => Math.random() > 0.4));
      }
      return rows;
    }

    case 'partial': {
      // 今天 + 前 4 天历史；今天只完成 1 个
      const rows: MockRow[] = [];
      for (let i = 4; i >= 1; i--) {
        const d = moment(today).subtract(i, 'days');
        rows.push(makeRow(d, f => f === '锻炼' || f === '阅读'));
      }
      rows.push(makeRow(today, f => f === '锻炼'));
      return rows;
    }

    case 'perfect': {
      // 连续 7 天全打卡，今天也全打卡
      const rows: MockRow[] = [];
      for (let i = 7; i >= 1; i--) {
        const d = moment(today).subtract(i, 'days');
        rows.push(makeRow(d, () => true));
      }
      rows.push(makeRow(today, () => true));
      return rows;
    }

    case 'broken': {
      // 前 4 天连续，昨天断了，今天又恢复打卡
      const rows: MockRow[] = [];
      for (let i = 4; i >= 2; i--) {
        const d = moment(today).subtract(i, 'days');
        rows.push(makeRow(d, () => true));
      }
      // 昨天断
      rows.push(makeRow(moment(today).subtract(1, 'days'), () => false));
      // 今天恢复
      rows.push(makeRow(today, () => true));
      return rows;
    }

    default:
      return [];
  }
}

/**
 * 默认习惯配置（与 src/view.tsx 的 DEFAULT_HABITS 完全一致）。
 * 预览面板通过 viewDefinition.options.habits 传入。
 */
export const DEFAULT_PREVIEW_HABITS = [
  { field: '锻炼', label: '锻炼打卡', crop: '472' },
  { field: '阅读', label: '阅读打卡', crop: '481' },
  { field: '日记', label: '日记打卡', crop: '490' },
];
