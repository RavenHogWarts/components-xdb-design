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
        'Chrome 断网小恐龙跑酷：移植自 Chromium 离线彩蛋（BSD 许可，经 wayou/t-rex-runner 提取），原版物理、精灵与音效完整保留。'
      );

      setting.divider();
      setting.title('游戏规则');
      setting.description(
        '空格 / ↑ 跳跃（按住跳得更高），↓ 下蹲 / 空中速降；点击游戏区同样跳跃。速度随距离从 6 提升到 13，越跑越快。'
      );
      setting.description(
        '得分即奔跑距离（×0.025），每 100 分里程碑音效提示；700 分起进入夜晚（月亮 + 星空 + 反色画面），之后每 700 分昼夜交替一次。'
      );
      setting.description(
        '障碍物：小/大仙人掌（速度达标后成组出现）与三档高度的翼龙（速度 8.5 起，比地面略快或略慢）。撞上即终局，空格 / 回车 / 点击重开。'
      );

      setting.divider();
      setting.title('游戏设置');

      setting.switch({
        key: 'sound',
        label: '音效',
        description: '原版内嵌音效（跳跃 / 撞击 / 得分里程碑），立即生效',
        value: options.sound,
        onChange(value: boolean) {
          patch({ sound: value });
        },
      });

      setting.divider();
      setting.title('战绩存档（本视图）');
      if (stats) {
        setting.description(
          `最高分 ${stats.bestScore} · 累计得分 ${stats.totalScore} · 共 ${stats.games} 局` +
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
