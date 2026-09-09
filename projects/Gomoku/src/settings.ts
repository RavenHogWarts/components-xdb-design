import {
  PLUGIN_ID,
  PLUGIN_NAME,
  CSS_PREFIX,
  AI_LABELS,
  AI_ORDER,
  ViewSettingsProps,
  GomokuOptions,
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
      const options: GomokuOptions = parseGameOptions(pluginRaw);
      const stats = parseGameStats(pluginRecord.stats);

      const patch = (partial: Partial<GomokuOptions>) => {
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
        '经典五子棋（15×15 无禁手，连五即胜）。AI 四档难度机制分层：简单只会眼前棋、中等一档棋型贪心、困难 α-β 深 4 搜索、专家迭代加深 + 置换表 + 威胁延伸（近似连杀视野）。'
      );

      setting.divider();
      setting.title('AI 难度');

      const aiDesc: Record<string, string> = {
        easy: '只会走眼前棋：自己成五就下、对方成五就堵，平时随手落子',
        medium: '一档棋型贪心：权衡攻防棋型（活四/冲四/活三…）取最高分',
        hard: 'α-β 深度 4 搜索 + 威胁延伸：会主动做双威胁，有节点预算保护',
        expert: '迭代加深 α-β（约 350ms 预算）+ 置换表 + 威胁延伸：接近连杀视野',
      };
      setting.picker({
        key: 'aiLevel',
        label: 'AI 难度',
        value: options.aiLevel,
        options: AI_ORDER.map((x) => ({ value: x, label: AI_LABELS[x] })),
        description: aiDesc[options.aiLevel],
        onChange(value: string) {
          if (value === 'easy' || value === 'medium' || value === 'hard' || value === 'expert') {
            patch({ aiLevel: value });
          }
        },
      });

      setting.divider();
      setting.title('战绩存档（本视图）');
      if (stats) {
        setting.description(
          `共 ${stats.games} 局 · 人机（你）胜 ${stats.wins} 负 ${stats.losses} 和 ${stats.draws}` +
            (stats.lastDate ? ` · 最近 ${stats.lastDate}` : '')
        );
      } else {
        setting.description('还没有战绩，开一局吧！');
      }
      setting.action({
        key: 'resetStats',
        label: '重置战绩',
        description: '清空本视图的对局统计',
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
