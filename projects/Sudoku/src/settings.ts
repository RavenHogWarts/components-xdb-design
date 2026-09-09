import {
  PLUGIN_ID,
  PLUGIN_NAME,
  CSS_PREFIX,
  DIFFICULTY_LABELS,
  DIFFICULTY_ORDER,
  ViewSettingsProps,
  SudokuOptions,
  parseGameOptions,
  parseGameStats,
} from './types';
import { resetViewStats } from './persist';

// ─────────────────────────────────────────────────────────────
// 设置渲染器（声明式控件方案）：只使用宿主原生设置控件（props.setting.*）
// 把每次 onUpdate(props) 当作一次 render：从本轮 props 读取 value
// 声明当前应存在的控件（key 必须稳定），变化通过 setViewDefinition 写回。
//
// 间距：宿主不为插件独立 tab 提供 Settings 包裹，这里给 container 加
// settingsRoot 标记类，style.css 通过 :has() 据此仅对本插件的面板加
// padding（不影响内置 tab；不支持 :has 时降级为无 padding）。
// ─────────────────────────────────────────────────────────────

function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

export function createSettingsRenderer() {
  return {
    update(props: ViewSettingsProps) {
      const { viewDefinition, setViewDefinition, setting, api, viewId } = props;

      // 激活面板级 padding 的标记（见 style.css 的 :has() 规则）
      props.container.classList.add(`${CSS_PREFIX}settingsRoot`);

      // 每次从 viewDefinition 读取插件命名空间下的配置，不维护第二份可编辑状态
      const viewOptions =
        viewDefinition?.options && typeof viewDefinition.options === 'object'
          ? (viewDefinition.options as Record<string, unknown>)
          : {};
      const pluginRaw = viewOptions[PLUGIN_ID];
      const pluginRecord =
        pluginRaw && typeof pluginRaw === 'object' && !Array.isArray(pluginRaw)
          ? (pluginRaw as Record<string, unknown>)
          : {};
      const options: SudokuOptions = parseGameOptions(pluginRaw);
      const stats = parseGameStats(pluginRecord.stats);

      const patch = (partial: Partial<SudokuOptions>) => {
        void setViewDefinition((current: any) => ({
          ...current,
          options: {
            ...(current.options ?? {}),
            [PLUGIN_ID]: {
              ...(current.options?.[PLUGIN_ID] ?? {}),
              ...partial,
            },
          },
        }));
      };

      setting.title(PLUGIN_NAME);
      setting.description(
        '经典数独：每行、每列、每宫 1-9 不重复。生成采用「终盘 + 挖洞」管线并逐一校验唯一解；每日一题按日期种子全局同题，难度四档轮换。'
      );

      setting.divider();
      setting.title('游戏设置');

      setting.picker({
        key: 'difficulty',
        label: '自由模式难度',
        description: '下一局生效；进行中的一局不受影响（棋盘上方切难度会立即开新局，有进度时需二次确认）',
        value: options.difficulty,
        options: DIFFICULTY_ORDER.map((d) => ({
          value: d,
          label: DIFFICULTY_LABELS[d],
          description: `目标提示数 ${d === 'easy' ? 40 : d === 'medium' ? 34 : d === 'hard' ? 30 : 26}`,
        })),
        onChange(value: string) {
          if (value === 'easy' || value === 'medium' || value === 'hard' || value === 'expert') {
            patch({ difficulty: value });
          }
        },
      });

      setting.switch({
        key: 'highlightSame',
        label: '同数高亮',
        description: '选中数字时高亮棋盘上所有相同数字',
        value: options.highlightSame,
        onChange(value: boolean) {
          patch({ highlightSame: value });
        },
      });

      setting.switch({
        key: 'showConflicts',
        label: '错误高亮',
        description: '与唯一解不符的填入标红（关闭即为无校验的盲填模式）',
        value: options.showConflicts,
        onChange(value: boolean) {
          patch({ showConflicts: value });
        },
      });

      setting.divider();
      setting.title('XDB 联动');

      const canCreateRow = typeof api?.createRow === 'function';
      setting.switch({
        key: 'recordScores',
        label: '记录战绩到当前数据库',
        description: canCreateRow
          ? '完成后在当前视图新建一行战绩（difficulty / mode / seconds / hints / result / date 字段）'
          : '当前数据库 source 不支持新建行，此开关不会生效',
        disabled: !canCreateRow,
        value: options.recordScores,
        onChange(value: boolean) {
          patch({ recordScores: value });
        },
      });

      setting.divider();
      setting.title('战绩存档（本视图）');
      if (stats) {
        const bestParts = DIFFICULTY_ORDER.map(
          (d) => `${DIFFICULTY_LABELS[d]} ${stats.best[d] !== undefined ? formatTime(stats.best[d]!) : '—'}`
        );
        setting.description(
          `已完成 ${stats.solved} 局 · 累计用时 ${formatTime(stats.totalTime)} · 最佳：${bestParts.join(' / ')}` +
            (stats.lastDate ? ` · 最近 ${stats.lastDate}` : '')
        );
      } else {
        setting.description('还没有战绩，开一局吧！');
      }
      setting.action({
        key: 'resetStats',
        label: '重置战绩',
        description: '清空本视图的完成数与最佳用时统计',
        variant: 'danger',
        onClick() {
          if (api && viewId) {
            void resetViewStats(api, viewId);
          }
        },
      });
    },
    destroy() {
      // 声明式控件由宿主管理，无需手动清理
    },
  };
}
