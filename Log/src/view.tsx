/** @jsxImportSource react */
import { createRoot, type Root } from 'react-dom/client';
import { useState, useEffect, type CSSProperties } from 'react';
import {
  DatabaseViewProps,
  DEFAULT_HABITS,
  STAGE_NAMES,
  HabitFileData,
  HabitTask
} from './types';
import {
  SpriteSheet,
  CropStage,
  normalizePath,
  ASSET_SPECS,
  resolveAssetsPath,
  checkAssetFiles,
  AssetSpec,
} from './sprite-helper';
import { getCropConfigs } from './crop-loader';
import {
  getHabitFile,
  getOrCreateHabitFile,
  syncAndLoadHabitFile,
  updateHabitFileRecord,
  plantCrop,
  harvestCrop,
  clearWitheredCrop,
  getCropStageIndex,
  stringifyYaml
} from './habit-file';

// ── 将 SpriteSheet 返回的 kebab-case 样式对象转换为 React 兼容的 camelCase ──
function toReactStyle(obj: Record<string, string>): CSSProperties {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const camel = k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    out[camel] = v;
  }
  return out as CSSProperties;
}

// ─────────────────────────────────────────────────────────────
// 对外渲染器：管理 React Root 生命周期
// plugin-core 每次 onUpdate 调用 update()，onDestroy 调用 destroy()。
// ─────────────────────────────────────────────────────────────
export function createFarmRenderer() {
  let root: Root | null = null;
  let lastContainer: HTMLElement | null = null;

  return {
    update(props: DatabaseViewProps) {
      if (!root || lastContainer !== props.container) {
        if (root) root.unmount();
        props.container.replaceChildren();
        root = createRoot(props.container);
        lastContainer = props.container;
      }
      root.render(<FarmView props={props} />);
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

function FarmView({ props }: { props: DatabaseViewProps }) {
  const { app, moment, viewData, viewDefinition, api } = props;

  // ── 读取 Obsidian 官方日记 (Daily Notes) 配置 ──
  let dateFormat = 'YYYY-MM-DD';
  const dailyNotesPlugin = (app as any).internalPlugins?.plugins?.['daily-notes'];
  if (dailyNotesPlugin?.enabled && dailyNotesPlugin.instance) {
    dateFormat = dailyNotesPlugin.instance.options?.format ?? 'YYYY-MM-DD';
  }

  // 1. 获取所有行，动态验证文件名日期格式并基于时间排序
  const allRows = viewData.groups.flatMap(g => g.rows ?? []);
  const sortedRows = allRows
    .filter(r => {
      const basename = r.$item.file?.basename;
      if (!basename) return false;
      return moment(basename, dateFormat, true).isValid();
    })
    .sort((a, b) => {
      const dateA = moment(a.$item.file.basename, dateFormat);
      const dateB = moment(b.$item.file.basename, dateFormat);
      return dateA.diff(dateB);
    });

  const todayStr = moment().format(dateFormat);
  const [selectedDateStr, setSelectedDateStr] = useState(todayStr);

  // 2. 从配置中读取激活的习惯字段和作物映射
  const options = viewDefinition.options ?? {};
  const activeHabits = options.habits ?? DEFAULT_HABITS;
  const activeFields = activeHabits.map((h: any) => h.field);

  // ── 异步加载习惯单文件及懒同步对账 ──
  const [habitsData, setHabitsData] = useState<Record<string, HabitFileData>>({});
  const [loading, setLoading] = useState(true);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  useEffect(() => {
    let active = true;
    async function runReconciliation() {
      const data: Record<string, HabitFileData> = {};
      for (const habit of activeHabits) {
        const dailyNotesData = sortedRows.map(row => {
          const dateStr = row.$item.file.basename;
          const val = row.$item[habit.field];
          const isDone = val === true || val === 'true' || val === 1 || val === 'checked';
          return { dateStr, isDone };
        });

        const file = getHabitFile(app, options, habit.field);
        if (file) {
          const res = await syncAndLoadHabitFile(app, file, dailyNotesData, dateFormat, selectedDateStr);
          data[habit.field] = res;
        } else {
          // 只读加载时若打卡单文件不存在，绝不自动重新创建文件，完美遵守以物理文件为主的原则
          data[habit.field] = {
            metadata: { current_crop: null, crop_history: [] },
            tasks: []
          };
        }
      }
      if (active) {
        setHabitsData(data);
        setLoading(false);
      }
    }
    runReconciliation();
    return () => {
      active = false;
    };
  }, [viewData, selectedDateStr, refreshTrigger, activeHabits.map(h => h.field).join(',')]);

  // 3. 计算选中日期的状态与连续打卡天数 (从 habitsData 衍生数据，保证单一数据源)
  const habitStats = activeHabits.map((habit: any) => {
    const habitFile = habitsData[habit.field];
    const tasks = habitFile?.tasks ?? [];

    const taskForSelected = tasks.find(t => t.dateStr === selectedDateStr);
    const isDoneSelected = taskForSelected ? taskForSelected.isDone : false;

    let streak = 0;
    let checkDate = moment(selectedDateStr, 'YYYY-MM-DD');
    if (isDoneSelected) {
      while (true) {
        const dateKey = checkDate.format('YYYY-MM-DD');
        const t = tasks.find(x => x.dateStr === dateKey);
        if (t && t.isDone) {
          streak++;
          checkDate.subtract(1, 'days');
        } else {
          break;
        }
      }
    } else {
      checkDate.subtract(1, 'days');
      while (true) {
        const dateKey = checkDate.format('YYYY-MM-DD');
        const t = tasks.find(x => x.dateStr === dateKey);
        if (t && t.isDone) {
          streak++;
          checkDate.subtract(1, 'days');
        } else {
          break;
        }
      }
    }

    const history = [];
    const start = moment(selectedDateStr, 'YYYY-MM-DD').subtract(6, 'days');
    for (let i = 0; i < 7; i++) {
      const dateKey = start.format('YYYY-MM-DD');
      const t = tasks.find(x => x.dateStr === dateKey);
      history.push({
        date: start.format('MM-DD'),
        status: t ? t.isDone : false
      });
      start.add(1, 'days');
    }

    return {
      ...habit,
      isDoneSelected,
      streak,
      history,
      fileData: habitFile
    };
  });

  const doneCount = habitStats.filter(h => h.isDoneSelected).length;
  const totalCount = habitStats.length;
  const completionRate = totalCount > 0 ? doneCount / totalCount : 0;

  const avgStreak =
    habitStats.length > 0
      ? habitStats.reduce((sum, h) => sum + h.streak, 0) / habitStats.length
      : 0;
  let houseStage = 0;
  if (avgStreak >= 2 && avgStreak < 5) houseStage = 1;
  else if (avgStreak >= 5) houseStage = 2;

  // 4. 解析素材包目录并校验
  const assetsPath = resolveAssetsPath(options);
  const presence = checkAssetFiles(app, assetsPath);
  const missingSpecs = ASSET_SPECS.filter(s => !presence?.[s.filename]);

  if (missingSpecs.length > 0) {
    return <AssetMissingNotice assetsPath={assetsPath} missingSpecs={missingSpecs} />;
  }

  // 5. 构建精灵图加载器
  const spriteByName: Record<string, SpriteSheet> = {};
  for (const spec of ASSET_SPECS) {
    spriteByName[spec.filename] = new SpriteSheet(
      app,
      `${assetsPath}/${spec.filename}`,
      spec.imgWidth,
      spec.imgHeight,
      spec.spriteWidth,
      spec.spriteHeight
    );
  }
  const cropsSprite = spriteByName['crops.png'];
  const housesSprite = spriteByName['houses.png'];
  const hoeDirtSprite = spriteByName['hoeDirt.png'];

  // 天空渐变
  let skyGradient =
    'linear-gradient(to bottom, #75b8e7 0%, #a4daf2 40%, #ffde9c 80%, #f7d2aa 100%)';
  if (completionRate === 0) {
    skyGradient =
      'linear-gradient(to bottom, #2b3a4a 0%, #4a5d6e 40%, #8b6b58 80%, #a87b65 100%)';
  } else if (completionRate > 0 && completionRate < 1) {
    skyGradient =
      'linear-gradient(to bottom, #609ec8 0%, #85cadf 40%, #fab475 80%, #e2946c 100%)';
  }

  const sunLeftOffset = 20 + completionRate * 60;

  if (loading) {
    return (
      <div className="stardewHabit--Shell">
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          minHeight: '400px',
          fontFamily: 'inherit',
          fontSize: '1.2em',
          fontWeight: 'bold',
          color: '#5a3c20',
          backgroundColor: '#f7e0b5',
          border: '4px solid #5a3c20',
          borderRadius: '8px',
          boxShadow: 'inset -3px -3px 0 #d8a065'
        }}>
          🌾 正在对账习惯数据并维护成长进度...
        </div>
      </div>
    );
  }

  return (
    <div className="stardewHabit--Shell">
      <header className="stardewHabit--Toolbar">
        <div className="stardewHabit--Brand">
          <span className="stardewHabit--BrandIcon">🌾</span>
          <div className="stardewHabit--BrandText">
            <strong>星露谷农场打卡</strong>
            <small>作物随打卡次数累计成长</small>
          </div>
        </div>
        <div className="stardewHabit--ToolbarRight">
          <input
            type="date"
            className="stardewHabit--DateSelect"
            value={moment(selectedDateStr, dateFormat).format('YYYY-MM-DD')}
            max={moment().format('YYYY-MM-DD')}
            onChange={e => {
              const v = e.target.value;
              if (v) {
                setSelectedDateStr(moment(v, 'YYYY-MM-DD').format(dateFormat));
              }
            }}
          />
        </div>
      </header>

      <section className="stardewHabit--Stage">
        <div className="stardewHabit--Container">
          <div className="stardewHabit--Root" style={{ background: skyGradient }}>
            <div className="stardewHabit--Header">
              <div className="stardewHabit--Sun" style={{ left: `${sunLeftOffset}%` }} />
              <div className="stardewHabit--HouseContainer">
                <div
                  className="stardewHabit--Sprite"
                  style={toReactStyle(housesSprite.getStyleObject(0, houseStage, 0.8))}
                />
              </div>
            </div>

            <div className="stardewHabit--FarmGrid">
              {habitStats.map(stat => (
                <HabitCard
                  key={stat.field}
                  stat={stat}
                  app={app}
                  options={options}
                  dateFormat={dateFormat}
                  selectedDateStr={selectedDateStr}
                  cropsSprite={cropsSprite}
                  hoeDirtSprite={hoeDirtSprite}
                  onToggle={async value => {
                    // 1. 更新单文件 tasks
                    const file = await getOrCreateHabitFile(app, options, stat.field, stat.crop);
                    if (file) {
                      await updateHabitFileRecord(app, file, selectedDateStr, value, dateFormat);
                    }
                    // 2. 更新日记中对应的属性
                    const todayRow = sortedRows.find(r => r.$item.file.basename === selectedDateStr);
                    if (todayRow) {
                      await api.updateCell(todayRow.id, stat.field, value);
                    } else {
                      await createTodayFile(props, selectedDateStr, sortedRows, activeFields, stat.field, value);
                    }
                    // 3. 触发看板拉取最新状态
                    setRefreshTrigger(prev => prev + 1);
                  }}
                  onRefresh={() => setRefreshTrigger(prev => prev + 1)}
                />
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// 单个习惯卡片 (集成完整的作物生命周期种植/收获/枯萎交互)
// ═════════════════════════════════════════════════════════════
interface HabitCardProps {
  stat: {
    field: string;
    label: string;
    crop: string;
    customStages?: CropStage[];
    isDoneSelected: boolean;
    streak: number;
    history: Array<{ date: string; status: boolean }>;
    fileData: HabitFileData;
  };
  app: any;
  options: Record<string, any>;
  dateFormat: string;
  selectedDateStr: string;
  cropsSprite: SpriteSheet;
  hoeDirtSprite: SpriteSheet;
  onToggle: (value: boolean) => Promise<void>;
  onRefresh: () => void;
}

function HabitCard({
  stat,
  app,
  options,
  dateFormat,
  selectedDateStr,
  cropsSprite,
  hoeDirtSprite,
  onToggle,
  onRefresh
}: HabitCardProps) {
  const metadata = stat.fileData?.metadata || { current_crop: null, crop_history: [] };
  const currentCrop = metadata.current_crop;

  // 1. 空地状态 (currentCrop 为空)
  if (!currentCrop) {
    const cropConfigs = getCropConfigs();
    const handlePlant = async (cropId: string) => {
      const file = await getOrCreateHabitFile(app, options, stat.field, stat.crop);
      if (file) {
        await plantCrop(app, file, cropId, selectedDateStr, dateFormat);
        onRefresh();
      }
    };

    return (
      <div className="stardewHabit--Card">
        <div className="stardewHabit--CardHeader">
          <div className="stardewHabit--HabitTitle">{stat.field}</div>
          <div className="stardewHabit--StageText">空闲耕地</div>
        </div>
        <div className="stardewHabit--FieldArea">
          <div
            className="stardewHabit--Soil stardewHabit--Sprite"
            style={toReactStyle(hoeDirtSprite.getStyleObject(0, 0, 1.2))}
            title="尚未种植作物"
          />
          <div className="stardewHabit--CheckWrap" style={{ flex: 1, marginLeft: '12px' }}>
            <span style={{ fontSize: '0.82em', color: '#8c5a36', marginBottom: '4px', fontWeight: 'bold' }}>
              种植新种子：
            </span>
            <SeedPlanter cropConfigs={cropConfigs} onPlant={handlePlant} />
          </div>
        </div>
        <div className="stardewHabit--HistoryTrack">
          {stat.history.map(hist => (
            <div key={hist.date} className="stardewHabit--HistoryDay">
              <span className="stardewHabit--HistoryDate">{hist.date}</span>
              <span className="stardewHabit--HistoryDot" data-status={String(hist.status)} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // 2. 有作物状态 (生长中 / 已成熟 / 枯萎)
  const isWithered = currentCrop.status === 'withered';
  const cropConfig = getCropConfigs().find(c => c.id === currentCrop.id) || getCropConfigs()[0];
  const daysInPhase = cropConfig.daysInPhase;
  const growthDays = cropConfig.growthDays;
  const wateredDays = currentCrop.watered_days;
  const isMature = wateredDays >= growthDays;

  // 根据浇水天数计算当前生长阶段，成熟则直接显示最后一个阶段 (harvest/bloom 态)
  const baseStageIndex = getCropStageIndex(wateredDays, daysInPhase);
  const stageIndex = isMature ? cropConfig.stages.length - 1 : baseStageIndex;

  const stages = cropConfig.stages;
  const currentStage = stages[Math.min(stageIndex, stages.length - 1)];
  const cropW = currentStage.width ?? 16;
  const cropH = currentStage.height ?? 16;

  // 是否打过卡决定泥土干湿 (湿=1，干=0)
  const soilCol = stat.isDoneSelected ? 1 : 0;

  const handleToggle = async () => {
    if (isWithered) return;
    await onToggle(!stat.isDoneSelected);
  };

  const handleCheckboxChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isWithered) return;
    await onToggle(e.target.checked);
  };

  const handleHarvest = async () => {
    const file = await getOrCreateHabitFile(app, options, stat.field, stat.crop);
    if (file) {
      await harvestCrop(app, file, selectedDateStr, dateFormat);
      onRefresh();
    }
  };

  const handleClearWithered = async () => {
    const file = await getOrCreateHabitFile(app, options, stat.field, stat.crop);
    if (file) {
      await clearWitheredCrop(app, file, selectedDateStr, dateFormat);
      onRefresh();
    }
  };

  return (
    <div className="stardewHabit--Card">
      <div className="stardewHabit--CardHeader">
        <div className="stardewHabit--HabitTitle">{stat.field}</div>
        <div className="stardewHabit--StageText">
          {isWithered ? '枯萎' : (isMature ? '已成熟' : `${STAGE_NAMES[Math.min(stageIndex, STAGE_NAMES.length - 1)]} (${wateredDays}/${growthDays}天)`)}
        </div>
      </div>

      <div className="stardewHabit--FieldArea">
        <div
          className="stardewHabit--Soil stardewHabit--Sprite"
          style={toReactStyle(hoeDirtSprite.getStyleObject(soilCol, 0, 1.2))}
          onClick={handleToggle}
          title={isWithered ? "作物已枯干" : "点击切换打卡状态"}
        >
          <div
            className="stardewHabit--CropImg stardewHabit--Sprite"
            data-withered={isWithered ? "true" : "false"}
            style={toReactStyle(
              cropsSprite.getStyleObject(currentStage.col, currentStage.row, 2.5, cropW, cropH)
            )}
          />
        </div>

        <div className="stardewHabit--CheckWrap" style={{ flex: 1, marginLeft: '12px' }}>
          {isWithered ? (
            <button className="stardewHabit--Button" onClick={handleClearWithered}>
              🪓 清理枯死作物
            </button>
          ) : isMature ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ fontSize: '0.82em', color: '#2a8a2a', fontWeight: 'bold' }}>🎉 作物已成熟！</span>
              <button className="stardewHabit--Button" onClick={handleHarvest}>
                🧺 收获{cropConfig.name}
              </button>
            </div>
          ) : (
            <label className="stardewHabit--CheckboxLabel">
              <input
                type="checkbox"
                className="stardewHabit--CheckboxInput"
                checked={stat.isDoneSelected}
                onChange={handleCheckboxChange}
              />
              <span className="stardewHabit--CustomCheck" />
              <span style={{ fontSize: '0.9em' }}>浇水打卡 ({stat.streak}天)</span>
            </label>
          )}
        </div>
      </div>

      <div className="stardewHabit--HistoryTrack">
        {stat.history.map(hist => (
          <div key={hist.date} className="stardewHabit--HistoryDay">
            <span className="stardewHabit--HistoryDate">{hist.date}</span>
            <span className="stardewHabit--HistoryDot" data-status={String(hist.status)} />
          </div>
        ))}
      </div>
    </div>
  );
}

function SeedPlanter({ cropConfigs, onPlant }: { cropConfigs: any[], onPlant: (id: string) => void }) {
  const [selectedId, setSelectedId] = useState(cropConfigs[0]?.id || '24');
  return (
    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
      <select
        value={selectedId}
        onChange={e => setSelectedId(e.target.value)}
        className="stardewHabit--Select"
        style={{
          border: '2px solid #5a3c20',
          borderRadius: '4px',
          padding: '2px 4px',
          backgroundColor: '#fffdf5',
          fontFamily: 'inherit',
          fontSize: '0.85em',
          color: '#3f2214',
          fontWeight: 'bold',
          cursor: 'pointer'
        }}
      >
        {cropConfigs.map(c => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      <button
        onClick={() => onPlant(selectedId)}
        className="stardewHabit--Button"
        style={{ padding: '2px 8px', fontSize: '0.85em', fontWeight: 'bold' }}
      >
        种植
      </button>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// 素材包缺失兜底组件
// ═════════════════════════════════════════════════════════════
function AssetMissingNotice({
  assetsPath,
  missingSpecs,
}: {
  assetsPath: string;
  missingSpecs: AssetSpec[];
}) {
  return (
    <div
      className="stardewHabit--AssetMissing"
      style={{ maxWidth: '560px', margin: '24px auto' }}
    >
      <div className="stardewHabit--AssetMissingHeader">
        <div className="stardewHabit--AssetMissingTitle">🌾 素材包未就绪</div>
      </div>

      <div style={{ margin: '8px 0' }}>
        当前素材包目录（来自设置）：<code>{assetsPath}</code>
      </div>

      <div style={{ margin: '4px 0 8px' }}>
        请将以下文件放入上述目录，或在视图设置中修正目录路径：
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {missingSpecs.map(spec => (
          <div
            key={spec.filename}
            style={{
              backgroundColor: '#fde8e0',
              border: '2px solid #b03020',
              borderRadius: '6px',
              padding: '6px 8px',
            }}
          >
            <b style={{ color: '#b03020' }}>✗ {spec.filename}</b>{' '}
            <span style={{ color: '#666' }}>
              ({spec.imgWidth}×{spec.imgHeight}px)
            </span>
            <br />
            <span style={{ fontSize: '0.82em', color: '#5a3c20' }}>{spec.description}</span>
          </div>
        ))}
      </div>

      <div
        style={{
          fontSize: '0.78em',
          color: '#8c5a36',
          fontStyle: 'italic',
          marginTop: '8px',
        }}
      >
        注：Crops.json（作物数据）在构建时已内联进插件，无需放入素材包目录。
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// 今日日记文件创建辅助
// ═════════════════════════════════════════════════════════════
async function createTodayFile(
  props: DatabaseViewProps,
  todayStr: string,
  sortedRows: any[],
  activeFields: string[],
  targetField: string,
  targetValue: boolean,
  allTrue: boolean = false
) {
  let dailyNotesFolder = props.viewDefinition.options?.dailyNotesFolder;
  if (!dailyNotesFolder) {
    const dailyNotesPlugin = (props.app as any).internalPlugins?.plugins?.['daily-notes'];
    if (dailyNotesPlugin?.enabled && dailyNotesPlugin.instance) {
      dailyNotesFolder = dailyNotesPlugin.instance.options?.folder ?? '';
    }
  }

  const normalizedFolder = dailyNotesFolder ? normalizePath(dailyNotesFolder) : '';

  if (normalizedFolder) {
    const folderExists = props.app.vault.getAbstractFileByPath(normalizedFolder);
    if (!folderExists) {
      try {
        await props.app.vault.createFolder(normalizedFolder);
      } catch (e) {
        console.warn(`[Stardew Habit] 创建日记文件夹失败（可能已存在）:`, e);
      }
    }
  }

  const todayFilePath = normalizedFolder
    ? `${normalizedFolder}/${todayStr}.md`
    : `${todayStr}.md`;

  let yamlObj: Record<string, any> = {
    tags: 'daily-note'
  };
  activeFields.forEach(f => {
    let val = false;
    if (allTrue) {
      val = true;
    } else if (f === targetField) {
      val = targetValue;
    }
    yamlObj[f] = val;
  });

  const yamlStr = stringifyYaml(yamlObj);
  const content = `---\n${yamlStr}---\n\n# 今日打卡\n\n`;

  try {
    await props.app.vault.create(todayFilePath, content);
    new props.obsidian.Notice(`📖 已为您自动创建今日日记: ${todayFilePath}`);
  } catch (err: any) {
    console.error('[Stardew Habit] 创建今日日记失败', err);
    new props.obsidian.Notice(`✗ 创建今日日记失败: ${err?.message ?? err}`);
  }
}
