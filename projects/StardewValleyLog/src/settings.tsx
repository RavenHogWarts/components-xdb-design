/** @jsxImportSource react */
import { createRoot } from 'react-dom/client';
import { PLUGIN_ID, CSS_PREFIX, ViewSettingsProps } from './types';

// ─────────────────────────────────────────────────────────────
// 对外设置渲染器（React 自由定制方案）
// 原生控件（props.setting.*）由宿主渲染；自定义 React 内容通过
// setting.custom() 的 render(container) 挂载进设置列表，返回的
// cleanup 在重渲染/移除时由宿主调用，无需自行管理 React Root 生命周期。
// 间距：宿主不为插件独立 tab 提供 Settings 包裹，这里给 container 加
// settingsRoot 标记类，style.css 通过 :has() 据此仅对本插件的面板加
// padding（不影响内置 tab；不支持 :has 时降级为无 padding）。
// 声明式控件必须在 onUpdate 同步 pass 内声明，不要放进 React 异步渲染。
// ─────────────────────────────────────────────────────────────
export function createSettingsRenderer() {
  return {
    update(props: ViewSettingsProps) {
      const { viewDefinition, setViewDefinition, setting, container } = props;

      // 激活面板级 padding 的标记（见 style.css 的 :has() 规则）
      container.classList.add(`${CSS_PREFIX}settingsRoot`);

      // 每次从 viewDefinition 读取插件命名空间下的配置，不维护第二份可编辑状态
      const options = viewDefinition.options?.[PLUGIN_ID] ?? {};

      // 写回时保留同一对象上的其它字段
      const updateOptions = (patch: Record<string, unknown>) => {
        void setViewDefinition((current: any) => ({
          ...current,
          options: {
            ...(current.options ?? {}),
            [PLUGIN_ID]: {
              ...(current.options?.[PLUGIN_ID] ?? {}),
              ...patch,
            },
          },
        }));
      };

      // 1) 宿主原生控件：图鉴
      setting.switch({
        key: 'compact',
        label: '紧凑模式',
        description: '图鉴页减少行间距，显示更多内容',
        value: options.compact ?? false,
        onChange(value: boolean) {
          updateOptions({ compact: value });
        },
      });

      // 2) 宿主原生控件：打卡留痕
      setting.switch({
        key: 'trace',
        label: '打卡留痕到日记',
        description: '打卡时在当日 Daily Note 的指定标题下追加一条已完成清单（失败不阻断打卡）',
        value: options.trace ?? true,
        onChange(value: boolean) {
          updateOptions({ trace: value });
        },
      });

      // 3) 自定义 React 区域（渲染进宿主设置列表，随列表统一布局）
      setting.custom({
        key: 'custom-area',
        render(el: HTMLElement) {
          const root = createRoot(el);
          root.render(<SettingsView options={options} onChange={updateOptions} />);
          return () => root.unmount();
        },
      });
    },
    destroy() {
      // setting.custom 的 cleanup 由宿主调用，无需手动清理
    },
  };
}

function SettingsView({
  options,
  onChange,
}: {
  options: Record<string, any>;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const heading = options.traceHeading ?? '🌱 星露谷农场';

  return (
    <div className={`${CSS_PREFIX}settingsCard`}>
      <div className={`${CSS_PREFIX}settingsCardTitle`}>打卡设置</div>
      <label className={`${CSS_PREFIX}settingRow`}>
        <span>留痕标题（Daily Note 中的完整标题行）</span>
        <input
          type="text"
          value={heading}
          placeholder="🌱 星露谷农场"
          onChange={(e) => onChange({ traceHeading: e.target.value })}
        />
      </label>
      <div className={`${CSS_PREFIX}settingsHint`}>
        留痕格式：`- [x] 习惯名 [[习惯文件]] #stardew/habit`。标题不存在时自动退化为追加到笔记末尾。
        习惯本身是数据库中的文件行（frontmatter 加 type: habit），可在表格视图直接管理。
      </div>
      <button
        className={`${CSS_PREFIX}resetBtn`}
        onClick={() => onChange({ saves: {}, activeSlot: null, defaultSlot: null, player: null })}
        title="删除全部存档槽（捏人/等级/金币），下次打开从存档选择重新开始"
      >
        ♻ 清空全部存档
      </button>
    </div>
  );
}
