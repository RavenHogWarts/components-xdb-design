/** @jsxImportSource react */
import { createRoot, type Root } from 'react-dom/client';
import { useState, useEffect } from 'react';
import { ViewSettingsProps, ViewDefinition } from './types';
import {
  CropStage,
  normalizePath,
  resolveAssetsPath,
} from './sprite-helper';
import { getCropConfigs } from './crop-loader';

const WOODEN_BOX_CLASS = 'stardewHabit--Box';

// ─────────────────────────────────────────────────────────────
// 对外渲染器：管理 React Root 生命周期
// ─────────────────────────────────────────────────────────────
export function createSettingsRenderer() {
  let root: Root | null = null;
  let lastContainer: HTMLElement | null = null;

  return {
    update(props: ViewSettingsProps) {
      if (!root || lastContainer !== props.container) {
        if (root) root.unmount();
        props.container.replaceChildren();
        root = createRoot(props.container);
        lastContainer = props.container;
      }
      root.render(<SettingsView props={props} />);
    },
    destroy() {
      if (root) {
        root.unmount();
        root = null;
        lastContainer = null;
      }
    },
  };
}

// 习惯条目类型
interface HabitOption {
  field: string;
  label: string;
  crop: string;
  customStages?: CropStage[];
}

// 默认习惯（与原 settings.ts 保持一致）
const DEFAULT_HABITS: HabitOption[] = [
  { field: '锻炼', label: '锻炼打卡', crop: '472' },
  { field: '阅读', label: '阅读打卡', crop: '481' },
  { field: '日记', label: '日记打卡', crop: '490' },
];

// 自定义阶段示例
const DEFAULT_CUSTOM_STAGES: CropStage[] = [
  { col: 0, row: 0 },
  { col: 1, row: 0 },
  { col: 2, row: 0 },
  { col: 3, row: 0 },
  { col: 4, row: 0, height: 32 },
];

// ═════════════════════════════════════════════════════════════
// 设置面板主组件
// ═════════════════════════════════════════════════════════════
function SettingsView({ props }: { props: ViewSettingsProps }) {
  const { viewDefinition, setViewDefinition } = props;
  const options = viewDefinition.options ?? {};
  const assetsPathVal = resolveAssetsPath(options);
  const habits: HabitOption[] = options.habits ?? DEFAULT_HABITS;

  // 素材包目录输入（受控，但用本地 state 缓冲输入）
  const [assetsPath, setAssetsPath] = useState(assetsPathVal);
  useEffect(() => {
    setAssetsPath(assetsPathVal);
  }, [assetsPathVal]);

  const commitAssetsPath = () => {
    const normalized = normalizePath(assetsPath);
    void setViewDefinition(current => ({
      ...current,
      options: { ...(current.options ?? {}), assetsPath: normalized },
    }));
  };

  const addHabit = () => {
    const newHabit: HabitOption = { field: '新习惯', label: '新打卡习惯', crop: 'parsnip' };
    void setViewDefinition(current => ({
      ...current,
      options: { ...(current.options ?? {}), habits: [...(current.options?.habits ?? []), newHabit] },
    }));
  };

  const updateHabit = (index: number, key: keyof HabitOption, val: any) => {
    void setViewDefinition(current => {
      const list = [...(current.options?.habits ?? [])];
      if (list[index]) list[index] = { ...list[index], [key]: val };
      return {
        ...current,
        options: { ...(current.options ?? {}), habits: list },
      };
    });
  };

  const deleteHabit = (index: number) => {
    void setViewDefinition(current => {
      const list = [...(current.options?.habits ?? [])];
      const next = list.filter((_, idx) => idx !== index);
      return {
        ...current,
        options: { ...(current.options ?? {}), habits: next },
      };
    });
  };

  return (
    <div
      className={WOODEN_BOX_CLASS}
      style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
    >
      <h3
        style={{
          margin: '0 0 8px 0',
          borderBottom: '2px solid #5a3c20',
          paddingBottom: '4px',
        }}
      >
        星露谷农场打卡设置
      </h3>

      {/* 素材目录配置项 */}
      <div style={assetsRowStyle}>
        <span style={{ fontWeight: 'bold' }}>素材包目录路径:</span>
        <input
          type="text"
          value={assetsPath}
          style={inputStyle}
          onChange={e => setAssetsPath(e.target.value)}
          onBlur={commitAssetsPath}
        />
      </div>

      {/* 配置习惯表单 */}
      {habits.map((habit, index) => (
        <HabitItem
          key={index}
          habit={habit}
          onUpdate={(key, val) => updateHabit(index, key, val)}
          onDelete={() => deleteHabit(index)}
        />
      ))}

      <button
        className="stardewHabit--Button"
        style={{ alignSelf: 'flex-start' }}
        onClick={addHabit}
      >
        添加新习惯
      </button>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// 单条习惯编辑卡片
// ═════════════════════════════════════════════════════════════
interface HabitItemProps {
  habit: HabitOption;
  onUpdate: (key: keyof HabitOption, val: any) => void;
  onDelete: () => void;
}

function HabitItem({ habit, onUpdate, onDelete }: HabitItemProps) {
  // 本地缓冲输入，避免每次按键触发异步 setViewDefinition 导致焦点丢失
  const [field, setField] = useState(habit.field);
  const [label, setLabel] = useState(habit.label);
  useEffect(() => setField(habit.field), [habit.field]);
  useEffect(() => setLabel(habit.label), [habit.label]);

  return (
    <div style={itemBoxStyle}>
      {/* 第一排：基础设置 */}
      <div style={row1Style}>
        <span style={{ fontWeight: 'bold' }}>字段:</span>
        <input
          type="text"
          style={{ ...inputStyle, width: '70px' }}
          value={field}
          onChange={e => setField(e.target.value)}
          onBlur={() => onUpdate('field', field)}
        />

        <span style={{ fontWeight: 'bold' }}>显示名:</span>
        <input
          type="text"
          style={{ ...inputStyle, width: '90px' }}
          value={label}
          onChange={e => setLabel(e.target.value)}
          onBlur={() => onUpdate('label', label)}
        />

        <span style={{ fontWeight: 'bold' }}>作物:</span>
        <select
          style={inputStyle}
          defaultValue={habit.crop}
          onChange={e => onUpdate('crop', e.target.value)}
        >
          {getCropConfigs().map(def => (
            <option key={def.id} value={def.id}>
              {def.name.split(' (')[0]}
            </option>
          ))}
          <option value="custom">⚙️ 自定义阶段坐标...</option>
        </select>

        <button
          className="stardewHabit--Button"
          style={{ padding: '2px 6px' }}
          onClick={onDelete}
        >
          删除
        </button>
      </div>

      {/* 第二排：自定义阶段 JSON 编辑器 */}
      {habit.crop === 'custom' && (
        <CustomStagesEditor
          stages={habit.customStages}
          onSave={stages => onUpdate('customStages', stages)}
        />
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// 自定义阶段 JSON 编辑器
// ═════════════════════════════════════════════════════════════
function CustomStagesEditor({
  stages,
  onSave,
}: {
  stages?: CropStage[];
  onSave: (stages: CropStage[]) => void;
}) {
  const initial = stages && stages.length > 0 ? stages : DEFAULT_CUSTOM_STAGES;
  const [jsonText, setJsonText] = useState(() => JSON.stringify(initial, null, 2));
  const [statusColor, setStatusColor] = useState('#8c5a36');
  const [statusText, setStatusText] = useState('');

  const handleSave = () => {
    try {
      const parsed: CropStage[] = JSON.parse(jsonText);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error('必须是非空数组');
      }
      for (const s of parsed) {
        if (typeof s.col !== 'number' || typeof s.row !== 'number') {
          throw new Error('每个阶段必须含有 col 和 row（数字类型）');
        }
      }
      onSave(parsed);
      setStatusColor('#2a8a2a');
      setStatusText(`✔ 已保存 ${parsed.length} 个阶段配置`);
    } catch (e: any) {
      setStatusColor('#b03020');
      setStatusText(`✗ JSON 格式错误: ${e.message}`);
    }
  };

  return (
    <div style={row2Style}>
      <div style={{ fontSize: '0.85em', fontWeight: 'bold', color: '#5a3c20' }}>
        📋 各生长阶段坐标 (JSON 数组)：
      </div>
      <div style={{ fontSize: '0.78em', color: '#8c5a36', lineHeight: 1.5 }}>
        <b>col</b>: 横向第几格（从0开始，每格16px）<br />
        <b>row</b>: 纵向第几格（从0开始，每格16px）<br />
        <b>width</b>: 贴图宽度（默认16，可省略）<br />
        <b>height</b>: 贴图高度（默认16，双高写32）<br />
        数组中每个元素代表一个生长阶段（从种子到成熟）
      </div>

      <textarea
        value={jsonText}
        onChange={e => setJsonText(e.target.value)}
        style={textareaStyle}
      />

      <button className="stardewHabit--Button" onClick={handleSave}>
        ✔ 应用阶段配置
      </button>

      {statusText && (
        <div style={{ fontSize: '0.8em', color: statusColor }}>{statusText}</div>
      )}
    </div>
  );
}

// ── 共用样式对象 ──
const assetsRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: '8px',
  alignItems: 'center',
  backgroundColor: '#ecd8b0',
  padding: '8px',
  borderRadius: '6px',
  border: '2px solid #5a3c20',
};

const itemBoxStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  backgroundColor: '#ecd8b0',
  padding: '10px',
  borderRadius: '6px',
  border: '2px solid #5a3c20',
};

const row1Style: React.CSSProperties = {
  display: 'flex',
  gap: '8px',
  alignItems: 'center',
  flexWrap: 'wrap',
};

const row2Style: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  paddingTop: '8px',
  borderTop: '1px dashed #5a3c20',
};

const inputStyle: React.CSSProperties = {
  border: '2px solid #5a3c20',
  borderRadius: '4px',
  padding: '2px 4px',
};

const textareaStyle: React.CSSProperties = {
  fontFamily: 'monospace',
  fontSize: '0.82em',
  width: '100%',
  minHeight: '140px',
  border: '2px solid #5a3c20',
  borderRadius: '4px',
  padding: '6px',
  backgroundColor: '#fffdf5',
  boxSizing: 'border-box',
  resize: 'vertical',
};
