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
        '经典黄金矿工：摆动钩爪挖掘金块、钻石与神秘袋，石头很重、TNT 会爆炸。限时达到目标金额进入商店，购买道具挑战更高关卡。'
      );

      setting.divider();
      setting.title('游戏规则');
      setting.description('操作：点击画面或按空格放出钩爪；X 使用炸药；R 重新开始。');

      setting.divider();
      setting.title('游戏设置');

      setting.picker({
        key: 'difficulty',
        label: '难度',
        description: '影响每关目标金额与钩爪摆动速度',
        value: options.difficulty,
        options: [
          { value: 'easy', label: '轻松', description: '目标金额约 8 折，摆速较慢' },
          { value: 'normal', label: '标准', description: '经典手感' },
          { value: 'hard', label: '困难', description: '目标金额更高，摆速更快' },
        ],
        onChange(value: string) {
          if (value === 'easy' || value === 'normal' || value === 'hard') {
            patch({ difficulty: value });
          }
        },
      });

      setting.picker({
        key: 'swingSpeed',
        label: '摆锤速度',
        description: '钩爪来回摆动的快慢',
        value: options.swingSpeed,
        options: [
          { value: 'auto', label: '跟随难度' },
          { value: 'slow', label: '慢速' },
          { value: 'normal', label: '标准' },
          { value: 'fast', label: '快速' },
        ],
        onChange(value: string) {
          if (value === 'auto' || value === 'slow' || value === 'normal' || value === 'fast') {
            patch({ swingSpeed: value });
          }
        },
      });

      setting.numberInput({
        key: 'timeLimit',
        label: '每关时间',
        description: '每关的倒计时（秒），下一局生效',
        value: options.timeLimit,
        min: 30,
        max: 120,
        step: 5,
        suffix: '秒',
        onChange(value: number) {
          if (Number.isFinite(value)) {
            patch({ timeLimit: Math.min(120, Math.max(30, Math.round(value))) });
          }
        },
      });

      setting.switch({
        key: 'sound',
        label: '音效',
        description: '挖掘、金币与爆炸提示音（合成音源，立即生效）',
        value: options.sound,
        onChange(value: boolean) {
          patch({ sound: value });
        },
      });

      setting.divider();
      setting.title('XDB 联动');

      const canCreateRow = typeof api?.createRow === 'function';
      setting.switch({
        key: 'recordScores',
        label: '记录战绩到当前数据库',
        description: canCreateRow
          ? '每局结束后在当前视图新建一行战绩（score / level / difficulty / date 字段）'
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
          `最高分 $${stats.bestScore} · 最高关卡 ${stats.bestLevel} · 累计金币 $${stats.totalCoins} · 共 ${stats.games} 局` +
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
