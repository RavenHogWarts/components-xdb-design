import {
  PLUGIN_ID,
  PLUGIN_NAME,
  CSS_PREFIX,
  ViewSettingsProps,
  GameOptions,
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
      const options: GameOptions = parseGameOptions(pluginRaw);
      const stats = parseGameStats(pluginRecord.stats);

      const patch = (partial: Partial<GameOptions>) => {
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
        '经典 2048：滑动棋盘让相同数字相撞合并，数值翻倍逐级登顶。方块采用「落日光谱」配色——从纸与沙出发，燃过日落，越过皇家色，最终加冕 2048 金色方块。'
      );

      setting.divider();
      setting.title('游戏规则');
      setting.description(
        '操作：方向键 / WASD 移动，触屏滑动同样有效；Z 撤销上一步，N 新开一局。每步有效移动自动存档，退出重进可继续。'
      );

      setting.divider();
      setting.title('游戏设置');

      setting.picker({
        key: 'boardSize',
        label: '盘面尺寸',
        description: '下一局生效；进行中的一局不受影响',
        value: String(options.boardSize),
        options: [
          { value: '3', label: '3 × 3', description: '紧凑快节奏' },
          { value: '4', label: '4 × 4', description: '经典盘面' },
          { value: '5', label: '5 × 5', description: '大局缓铺陈' },
        ],
        onChange(value: string) {
          const n = Number(value);
          if (n === 3 || n === 4 || n === 5) {
            patch({ boardSize: n });
          }
        },
      });

      setting.picker({
        key: 'target',
        label: '胜利目标',
        description: '合成该数值方块即胜利（可继续挑战）',
        value: String(options.target),
        options: [
          { value: '2048', label: '2048', description: '经典目标' },
          { value: '4096', label: '4096', description: '进阶挑战' },
          { value: '0', label: '无尽', description: '不设目标，只拼分数' },
        ],
        onChange(value: string) {
          const t = Number(value);
          if (t === 2048 || t === 4096 || t === 0) {
            patch({ target: t });
          }
        },
      });

      setting.switch({
        key: 'animation',
        label: '方块动画',
        description: '滑动、生成与合并动效（立即生效）',
        value: options.animation,
        onChange(value: boolean) {
          patch({ animation: value });
        },
      });

      setting.divider();
      setting.title('XDB 联动');

      const canCreateRow = typeof api?.createRow === 'function';
      setting.switch({
        key: 'recordScores',
        label: '记录战绩到当前数据库',
        description: canCreateRow
          ? '终局或达成目标后在当前视图新建一行战绩（score / maxTile / moves / boardSize / result / date 字段）'
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
        setting.description(
          `最高分 ${stats.bestScore} · 最大方块 ${stats.bestTile} · 累计得分 ${stats.totalScore} · 共 ${stats.games} 局` +
            (stats.lastDate ? ` · 最近 ${stats.lastDate}` : '')
        );
      } else {
        setting.description('还没有战绩，开一局吧！');
      }
      setting.action({
        key: 'resetStats',
        label: '重置战绩',
        description: '清空本视图的最高分与累计统计',
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
