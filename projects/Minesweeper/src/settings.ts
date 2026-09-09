import {
  PLUGIN_ID,
  PLUGIN_NAME,
  CSS_PREFIX,
  LEVEL_CONFIG,
  LEVEL_LABELS,
  LEVEL_ORDER,
  ViewSettingsProps,
  MineGameOptions,
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
      const options: MineGameOptions = parseGameOptions(pluginRaw);
      const stats = parseGameStats(pluginRecord.stats);

      const patch = (partial: Partial<MineGameOptions>) => {
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
        '经典扫雷：翻开数字推理雷位。首击保证安全开局（零邻域洪泛展开），翻开的数字格上再点一次即和弦展开；每日一局按日期种子、同首击同雷局。'
      );

      setting.divider();
      setting.title('游戏设置');

      setting.picker({
        key: 'level',
        label: '自由模式难度',
        description: '下一局生效；进行中的一局不受影响（棋盘上方切难度会立即开局，有进度时需二次确认）',
        value: options.level,
        options: LEVEL_ORDER.map((l) => ({
          value: l,
          label: LEVEL_LABELS[l],
          description: `${LEVEL_CONFIG[l].cols} × ${LEVEL_CONFIG[l].rows}，${LEVEL_CONFIG[l].mines} 雷`,
        })),
        onChange(value: string) {
          if (value === 'beginner' || value === 'intermediate' || value === 'expert') {
            patch({ level: value });
          }
        },
      });

      setting.divider();
      setting.title('XDB 联动');

      const canCreateRow = typeof api?.createRow === 'function';
      setting.switch({
        key: 'recordScores',
        label: '记录战绩到当前数据库',
        description: canCreateRow
          ? '终局（胜利或踩雷）在当前视图新建一行战绩（difficulty / mode / seconds / result / date 字段）'
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
        const bestParts = LEVEL_ORDER.map(
          (l) => `${LEVEL_LABELS[l]} ${stats.best[l] !== undefined ? formatTime(stats.best[l]!) : '—'}`
        );
        setting.description(
          `胜利 ${stats.solved} / ${stats.games} 局 · 最佳：${bestParts.join(' / ')}` +
            (stats.lastDate ? ` · 最近 ${stats.lastDate}` : '')
        );
      } else {
        setting.description('还没有战绩，开一局吧！');
      }
      setting.action({
        key: 'resetStats',
        label: '重置战绩',
        description: '清空本视图的胜利数与最佳用时统计',
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
