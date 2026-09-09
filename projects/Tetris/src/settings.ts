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
        '经典俄罗斯方块（Tetris Guideline）：SRS 踢墙旋转、7-bag 发牌、幽灵投影、暂存与硬降。方块七色采用官方配色——青 I、蓝 J、橙 L、黄 O、绿 S、紫 T、红 Z。'
      );

      setting.divider();
      setting.title('游戏规则');
      setting.description(
        '操作：← → 移动（按住自动重复），↑/X 顺时针、Z 逆时针旋转，↓ 软降，空格硬降，C/Shift 暂存，P 暂停，N 新游戏（状态行有完整快捷键表）；触屏可用棋盘滑动（横滑平移、下滑硬降、上滑旋转）。每块结算自动存档，退出重进可继续。'
      );
      setting.description(
        '计分：单/双/三/四连消 ×等级，T-Spin 与四连消享受 Back-to-Back ×1.5，连续消行有连击加成，清空整盘触发 PERFECT CLEAR；软降每格 +1、硬降每格 +2。每消 10 行升 1 级，重力随之加快。'
      );

      setting.divider();
      setting.title('游戏设置');

      setting.picker({
        key: 'startLevel',
        label: '开局等级',
        description: '下一局生效；进行中的一局不受影响',
        value: String(options.startLevel),
        options: [
          { value: '1', label: 'Lv 1', description: '经典节奏' },
          { value: '3', label: 'Lv 3', description: '稍快' },
          { value: '5', label: 'Lv 5', description: '进阶' },
          { value: '10', label: 'Lv 10', description: '高手' },
          { value: '15', label: 'Lv 15', description: '极限挑战' },
        ],
        onChange(value: string) {
          const n = Number(value);
          if (n === 1 || n === 3 || n === 5 || n === 10 || n === 15) {
            patch({ startLevel: n });
          }
        },
      });

      setting.switch({
        key: 'ghost',
        label: '幽灵投影',
        description: '显示当前方块的落点轮廓（立即生效）',
        value: options.ghost,
        onChange(value: boolean) {
          patch({ ghost: value });
        },
      });

      setting.switch({
        key: 'animation',
        label: '消行动画',
        description: '消行闪烁与落定脉冲（立即生效，关闭可加快节奏）',
        value: options.animation,
        onChange(value: boolean) {
          patch({ animation: value });
        },
      });

      setting.divider();
      setting.title('战绩存档（本视图）');
      if (stats) {
        setting.description(
          `最高分 ${stats.bestScore} · 最多消行 ${stats.bestLines} · 累计得分 ${stats.totalScore} · 共 ${stats.games} 局` +
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
