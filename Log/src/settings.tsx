/** @jsxImportSource react */
import { createRoot, type Root } from 'react-dom/client';
import { useState, useEffect } from 'react';
import {
  ViewSettingsProps,
  ViewDefinition,
  HabitOption,
  DEFAULT_HABITS,
  DEFAULT_HABIT_FOLDER
} from './types';
import {
  CropStage,
  normalizePath,
  resolveAssetsPath,
} from './sprite-helper';
import { getCropConfigs } from './crop-loader';

const WOODEN_BOX_CLASS = 'stardewHabit--Box';

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
const getOfficialDailyNotesFolder = (app: any): string => {
  if (!app) return '';
  const dailyNotesPlugin = app.internalPlugins?.plugins?.['daily-notes'];
  if (dailyNotesPlugin?.enabled && dailyNotesPlugin.instance) {
    return dailyNotesPlugin.instance.options?.folder ?? '';
  }
  return '';
};

// ═════════════════════════════════════════════════════════════
// 设置面板主组件
// ═════════════════════════════════════════════════════════════
function SettingsView({ props }: { props: ViewSettingsProps }) {
  const { viewDefinition, setViewDefinition } = props;
  const options = viewDefinition.options ?? {};
  const assetsPathVal = resolveAssetsPath(options);
  const habitFolderVal = options.habitFolder ?? DEFAULT_HABIT_FOLDER;
  const dailyNotesFolderVal = options.dailyNotesFolder ?? '';
  const habits: HabitOption[] = options.habits ?? DEFAULT_HABITS;

  // 素材包目录、打卡保存目录与日记目录输入（用本地 state 缓冲输入）
  const [assetsPath, setAssetsPath] = useState(assetsPathVal);
  const [habitFolder, setHabitFolder] = useState(habitFolderVal);
  const [dailyNotesFolder, setDailyNotesFolder] = useState(dailyNotesFolderVal);

  useEffect(() => {
    setAssetsPath(assetsPathVal);
  }, [assetsPathVal]);

  useEffect(() => {
    setHabitFolder(habitFolderVal);
  }, [habitFolderVal]);

  useEffect(() => {
    setDailyNotesFolder(dailyNotesFolderVal);
  }, [dailyNotesFolderVal]);

  const commitAssetsPath = () => {
    const normalized = normalizePath(assetsPath);
    void setViewDefinition(current => ({
      ...current,
      options: { ...(current.options ?? {}), assetsPath: normalized },
    }));
  };

  const commitHabitFolder = async () => {
    const oldFolder = normalizePath(options.habitFolder ?? DEFAULT_HABIT_FOLDER);
    const newFolder = normalizePath(habitFolder || DEFAULT_HABIT_FOLDER);

    // 若文件夹路径发生变化，则将所有现有习惯文件移动到新文件夹
    if (oldFolder !== newFolder && props.app) {
      // 确保新文件夹存在
      if (newFolder) {
        const newFolderExists = props.app.vault.getAbstractFileByPath(newFolder);
        if (!newFolderExists) {
          try {
            await props.app.vault.createFolder(newFolder);
          } catch (e) {
            console.warn('[Stardew Habit] 创建新打卡文件夹失败（可能已存在）:', e);
          }
        }
      }

      // 逐一迁移每个习惯文件
      for (const habit of habits) {
        const oldPath = oldFolder ? `${oldFolder}/${habit.field}.md` : `${habit.field}.md`;
        const newPath = newFolder ? `${newFolder}/${habit.field}.md` : `${habit.field}.md`;
        if (oldPath === newPath) continue;
        const existingFile = props.app.vault.getAbstractFileByPath(oldPath);
        if (existingFile) {
          const targetExists = props.app.vault.getAbstractFileByPath(newPath);
          if (!targetExists) {
            try {
              await props.app.vault.rename(existingFile, newPath);
              console.log(`[Stardew Habit] 已迁移: ${oldPath} -> ${newPath}`);
            } catch (e) {
              console.error(`[Stardew Habit] 迁移文件失败: ${oldPath}`, e);
            }
          } else {
            console.warn(`[Stardew Habit] 目标文件已存在，跳过迁移: ${newPath}`);
          }
        }
      }
    }

    void setViewDefinition(current => ({
      ...current,
      options: { ...(current.options ?? {}), habitFolder: newFolder },
    }));
  };

  const commitDailyNotesFolder = () => {
    const normalized = normalizePath(dailyNotesFolder);
    void setViewDefinition(current => ({
      ...current,
      options: { ...(current.options ?? {}), dailyNotesFolder: normalized },
    }));
  };

  const handleResetDailyFolder = () => {
    const official = getOfficialDailyNotesFolder(props.app);
    setDailyNotesFolder(official);
    void setViewDefinition(current => ({
      ...current,
      options: { ...(current.options ?? {}), dailyNotesFolder: official }
    }));
  };

  const addHabit = () => {
    const baseField = '新习惯';
    let field = baseField;
    
    let counter = 1;
    while (habits.some(h => h.field === field)) {
      field = `${baseField}${counter}`;
      counter++;
    }

    const newHabit: HabitOption = { field, crop: '24' }; // 默认防风草 '24'
    void setViewDefinition(current => ({
      ...current,
      options: { ...(current.options ?? {}), habits: [...(current.options?.habits ?? []), newHabit] },
    }));
  };

  const updateHabit = (index: number, key: keyof HabitOption, val: any) => {
    void setViewDefinition(current => {
      const list = [...(current.options?.habits ?? [])];
      const oldHabit = list[index];
      if (oldHabit) {
        let finalVal = val;
        if (key === 'field') {
          const cleanField = val.trim();
          let unique = cleanField;
          let counter = 1;
          while (list.some((h, idx) => idx !== index && h.field === unique)) {
            unique = `${cleanField}${counter}`;
            counter++;
          }
          finalVal = unique;

          // 同步重命名磁盘文件，防丢历史
          const oldField = oldHabit.field;
          if (oldField && oldField !== finalVal && props.app) {
            const folder = (options?.habitFolder as string | undefined)?.trim();
            const normalized = normalizePath(folder || DEFAULT_HABIT_FOLDER);
            const oldPath = `${normalized}/${oldField}.md`;
            const newPath = `${normalized}/${finalVal}.md`;

            const oldFile = props.app.vault.getAbstractFileByPath(oldPath);
            if (oldFile) {
              const newFileExists = props.app.vault.getAbstractFileByPath(newPath);
              if (!newFileExists) {
                props.app.vault.rename(oldFile, newPath)
                  .then(() => console.log(`[Stardew Habit] 重命名单文件成功: ${oldPath} -> ${newPath}`))
                  .catch((e: any) => console.error(`[Stardew Habit] 重命名单文件失败:`, e));
              }
            }
          }
        }
        list[index] = { ...list[index], [key]: finalVal };
      }
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

      {/* 打卡单文件保存文件夹配置项 */}
      <div style={assetsRowStyle}>
        <span style={{ fontWeight: 'bold' }}>打卡单文件保存文件夹:</span>
        <input
          type="text"
          value={habitFolder}
          placeholder="例如 Habits (留空代表库根目录)"
          style={inputStyle}
          onChange={e => setHabitFolder(e.target.value)}
          onBlur={commitHabitFolder}
        />
      </div>

      {/* 日记保存文件夹配置项 */}
      <div style={assetsRowStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%' }}>
          <span style={{ fontWeight: 'bold' }}>日记保存文件夹:</span>
          <input
            type="text"
            value={dailyNotesFolder}
            placeholder={`例如 DailyNotes (官方默认: ${getOfficialDailyNotesFolder(props.app) || '根目录'})`}
            style={{ ...inputStyle, flex: 1 }}
            onChange={e => setDailyNotesFolder(e.target.value)}
            onBlur={commitDailyNotesFolder}
          />
          <button
            className="stardewHabit--Button clickable-icon"
            style={{ padding: '2px 8px', fontSize: '0.85em' }}
            onClick={handleResetDailyFolder}
          >
            重置
          </button>
        </div>
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
        className="stardewHabit--Button clickable-icon"
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
  useEffect(() => setField(habit.field), [habit.field]);

  return (
    <div style={itemBoxStyle}>
      {/* 第一排：基础设置 */}
      <div style={row1Style}>
        <span style={{ fontWeight: 'bold' }}>字段:</span>
        <input
          type="text"
          style={{ ...inputStyle, width: '120px' }}
          value={field}
          onChange={e => setField(e.target.value)}
          onBlur={() => onUpdate('field', field)}
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
          className="stardewHabit--Button clickable-icon"
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

      <button className="stardewHabit--Button clickable-icon" onClick={handleSave}>
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
