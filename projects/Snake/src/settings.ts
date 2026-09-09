import {
  PLUGIN_ID,
  PLUGIN_NAME,
  CSS_PREFIX,
  ViewSettingsProps,
  GameOptions,
  parseGameOptions,
  parseGameStats,
} from './types';
import { MAZE_IDS, MAZE_NAMES, MAZE_DESC, MazeId } from './game/levels';
import { SPEED_LEVELS, SpeedLevel } from './game/engine';
import { resetViewStats } from './persist';

const SPEED_DESC: Record<SpeedLevel, string | undefined> = {
  1: '诺基亚经典节奏',
  2: undefined,
  3: undefined,
  4: undefined,
  5: '推荐默认',
  6: undefined,
  7: undefined,
  8: undefined,
  9: '极速挑战',
};

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
        '经典诺基亚贪吃蛇（Snake II，3310 同款）：单色 LCD 像素屏、四周边界回绕、五套迷宫关卡、限时食物与高分奖励物、越吃越快。'
      );

      setting.divider();
      setting.title('游戏规则');
      setting.description(
        '蛇自动前进不可停止：方向键 / WASD / 小键盘 2·4·6·8 转向（不可 180° 掉头），触屏滑动转向；撞迷宫墙或咬到自己即终局，屏幕四边可穿越（从一侧出去从对侧进来）。'
      );
      setting.description(
        '计分：食物 +10（25 步内没吃到会换位置），每吃 5 个食物出现奖励物 +50（约 6 秒后消失）；每吃一个食物略微加速，开局速度可在下方 1-9 档选择。'
      );

      setting.divider();
      setting.title('游戏设置');

      setting.picker({
        key: 'maze',
        label: '迷宫关卡',
        description: '视图内可直接切换（有进度需二次确认）；关卡 1 为空场，2-5 墙壁逐渐变多',
        value: String(options.maze),
        options: MAZE_IDS.map((id) => ({
          value: String(id),
          label: `关卡 ${id} · ${MAZE_NAMES[id]}`,
          description: MAZE_DESC[id],
        })),
        onChange(value: string) {
          const n = Number(value);
          if (MAZE_IDS.includes(n as MazeId)) {
            patch({ maze: n as MazeId });
          }
        },
      });

      setting.picker({
        key: 'speed',
        label: '初始速度',
        description: '视图内可直接切换（有进度需二次确认）；局内每吃一个食物都会更快',
        value: String(options.speed),
        options: SPEED_LEVELS.map((n) => ({
          value: String(n),
          label: `${n} 档`,
          description: SPEED_DESC[n],
        })),
        onChange(value: string) {
          const n = Number(value);
          if (SPEED_LEVELS.includes(n as SpeedLevel)) {
            patch({ speed: n as SpeedLevel });
          }
        },
      });

      setting.switch({
        key: 'animation',
        label: '像素动画',
        description: '食物/奖励物闪烁与终局屏闪（立即生效，关闭可降低动效）',
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
          ? '终局后在当前视图新建一行战绩（snake / score / length / maze / speed / result / date 字段）'
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
          `最高分 ${stats.bestScore} · 最长 ${stats.bestLength} 格 · 累计得分 ${stats.totalScore} · 共 ${stats.games} 局` +
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
