/** @jsxImportSource react */
import { createRoot, type Root } from 'react-dom/client';
import type { CSSProperties } from 'react';
import { DatabaseViewProps } from './types';
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

const WOODEN_BOX_CLASS = 'stardewHabit--Box';

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

// ── 默认习惯配置（与原 view.ts 保持一致） ──
const DEFAULT_HABITS: Array<{
  field: string;
  label: string;
  crop: string;
  customStages?: CropStage[];
}> = [
  { field: '锻炼', label: '锻炼打卡', crop: '472' }, // 防风草
  { field: '阅读', label: '阅读打卡', crop: '481' }, // 蒁越莆
  { field: '日记', label: '日记打卡', crop: '490' }, // 南瓜
];

const STAGE_NAMES = [
  '种子', '初芽', '成长中', '抽苗', '成熟期', '大丰收',
  '大丰收', '大丰收', '大丰收', // 兜底，防止多阶段作物越界
];

// ═════════════════════════════════════════════════════════════
// 主视图组件
// ═════════════════════════════════════════════════════════════
function FarmView({ props }: { props: DatabaseViewProps }) {
  const { app, moment, viewData, viewDefinition, obsidian, api } = props;

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

  // 2. 从配置中读取激活的习惯字段和作物映射
  const options = viewDefinition.options ?? {};
  const activeHabits = options.habits ?? DEFAULT_HABITS;
  const activeFields = activeHabits.map((h: any) => h.field);

  // 3. 计算今日状态与连续打卡天数
  const todayRow = sortedRows.find(r => r.$item.file.basename === todayStr) ?? null;

  const habitStats = activeHabits.map((habit: any) => {
    const todayVal = todayRow ? todayRow.$item[habit.field] : null;
    const isDoneToday =
      todayVal === true || todayVal === 'true' || todayVal === 1 || todayVal === 'checked';

    let startIndex = sortedRows.length - 1;
    if (
      sortedRows.length > 0 &&
      sortedRows[sortedRows.length - 1].$item.file.basename === todayStr &&
      !isDoneToday
    ) {
      startIndex = sortedRows.length - 2;
    }

    let streak = 0;
    for (let i = startIndex; i >= 0; i--) {
      const val = sortedRows[i].$item[habit.field];
      const isDone = val === true || val === 'true' || val === 1 || val === 'checked';
      if (isDone) streak++;
      else break;
    }

    const history: Array<{ date: string; status: boolean }> = [];
    for (let i = Math.max(0, sortedRows.length - 6); i < sortedRows.length; i++) {
      const row = sortedRows[i];
      const val = row.$item[habit.field];
      history.push({
        date: row.$item.file.basename.slice(5),
        status: val === true || val === 'true' || val === 1 || val === 'checked',
      });
    }

    return { ...habit, isDoneToday, streak, history };
  });

  // 今日总完成度 → 天空 + 太阳
  const doneCount = habitStats.filter(h => h.isDoneToday).length;
  const totalCount = habitStats.length;
  const completionRate = totalCount > 0 ? doneCount / totalCount : 0;

  // 平均连续天数 → 房屋等级
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

  // 过一天按钮
  const onNextDay = async () => {
    new obsidian.Notice('☀️ 新的一天！正在保存今日所有未打卡记录为完成。');
    await updateTodayHabits(props, activeFields, sortedRows, todayStr, true);
  };

  // 生产环境复刻预览的四层结构：
  //   preview-shell  → stardewHabit--Shell      (纵向 flex 占满视图区)
  //   preview-toolbar→ stardewHabit--Toolbar    (木质顶栏：品牌标识)
  //   preview-stage  → stardewHabit--Stage      (深色斜纹「桌面」)
  //   preview-container → stardewHabit--Container(白色圆角卡片)
  //   stardewHabit--Root 仍是最内层的农场画布。
  // 这样 Obsidian 中的渲染与本地预览像素级对齐，仅 class 命名不同。
  return (
    <div className="stardewHabit--Shell">
      <header className="stardewHabit--Toolbar">
        <div className="stardewHabit--Brand">
          <span className="stardewHabit--BrandIcon">🌾</span>
          <div className="stardewHabit--BrandText">
            <strong>星露谷农场打卡</strong>
            <small>作物随连续打卡天数生长</small>
          </div>
        </div>
      </header>

      <section className="stardewHabit--Stage">
        <div className="stardewHabit--Container">
          <div className="stardewHabit--Root" style={{ background: skyGradient }}>
            {/* ── 头部环境区 ── */}
            <div className="stardewHabit--Header">
        <div className="stardewHabit--Sun" style={{ left: `${sunLeftOffset}%` }} />
        <div className="stardewHabit--HouseContainer">
          <div
            className="stardewHabit--Sprite"
            style={toReactStyle(housesSprite.getStyleObject(0, houseStage, 0.8))}
          />
        </div>

        {/* 左侧今日简报控制台 */}
        <div className={`stardewHabit--SummaryPanel ${WOODEN_BOX_CLASS}`}>
          <div className="stardewHabit--SummaryHeader">
            <div className="stardewHabit--DateTitle">{todayStr}</div>
            <button className="stardewHabit--Button" onClick={onNextDay}>
              过一天
            </button>
          </div>
          <div className="stardewHabit--SummaryTasks">
            {habitStats.map(stat => (
              <div key={stat.field} className="stardewHabit--SummaryTaskItem">
                <span
                  className="stardewHabit--HistoryDot"
                  data-status={String(stat.isDoneToday)}
                />
                <span>
                  {stat.label} ({stat.isDoneToday ? '已打卡' : '未打卡'})
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── 农田卡片网格 ── */}
      <div className="stardewHabit--FarmGrid">
        {habitStats.map(stat => (
          <HabitCard
            key={stat.field}
            stat={stat}
            cropsSprite={cropsSprite}
            hoeDirtSprite={hoeDirtSprite}
            onToggle={async value => {
              await updateSingleHabit(props, stat.field, value, sortedRows, todayStr, activeFields);
            }}
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
// 单个习惯卡片
// ═════════════════════════════════════════════════════════════
interface HabitCardProps {
  stat: {
    field: string;
    label: string;
    crop: string;
    customStages?: CropStage[];
    isDoneToday: boolean;
    streak: number;
    history: Array<{ date: string; status: boolean }>;
  };
  cropsSprite: SpriteSheet;
  hoeDirtSprite: SpriteSheet;
  onToggle: (value: boolean) => Promise<void>;
}

function HabitCard({ stat, cropsSprite, hoeDirtSprite, onToggle }: HabitCardProps) {
  // 解析作物生长阶段定义
  let stages: CropStage[];
  if (stat.crop === 'custom' && Array.isArray(stat.customStages) && stat.customStages.length > 0) {
    stages = stat.customStages;
  } else {
    const cropConfig =
      getCropConfigs().find(c => c.id === stat.crop) || getCropConfigs()[0];
    stages = cropConfig.stages;
  }

  const stageIndex = Math.min(stat.streak, stages.length - 1);
  const currentStage = stages[stageIndex];
  const cropW = currentStage.width ?? 16;
  const cropH = currentStage.height ?? 16;

  const soilCol = stat.isDoneToday ? 1 : 0;

  const onSoilClick = async () => {
    await onToggle(!stat.isDoneToday);
  };

  const onCheckboxChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    await onToggle(e.target.checked);
  };

  return (
    <div className="stardewHabit--Card">
      {/* 卡片头部 */}
      <div className="stardewHabit--CardHeader">
        <div className="stardewHabit--HabitTitle">{stat.label}</div>
        <div className="stardewHabit--StageText">
          {STAGE_NAMES[stageIndex]} · {stat.streak}天
        </div>
      </div>

      {/* 耕地与作物区 */}
      <div className="stardewHabit--FieldArea">
        <div
          className="stardewHabit--Soil stardewHabit--Sprite"
          style={toReactStyle(hoeDirtSprite.getStyleObject(soilCol, 0, 1.2))}
          onClick={onSoilClick}
          title="点击切换打卡状态"
        >
          <div
            className="stardewHabit--CropImg stardewHabit--Sprite"
            style={toReactStyle(
              cropsSprite.getStyleObject(currentStage.col, currentStage.row, 2.5, cropW, cropH)
            )}
          />
        </div>

        {/* 右侧复选框 */}
        <div className="stardewHabit--CheckWrap">
          <label className="stardewHabit--CheckboxLabel">
            <input
              type="checkbox"
              className="stardewHabit--CheckboxInput"
              checked={stat.isDoneToday}
              onChange={onCheckboxChange}
            />
            <span className="stardewHabit--CustomCheck" />
            <span>完成今日打卡</span>
          </label>
        </div>
      </div>

      {/* 历史轨迹 */}
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
      className={`stardewHabit--SummaryPanel ${WOODEN_BOX_CLASS}`}
      style={{ maxWidth: '560px', margin: '24px auto' }}
    >
      <div className="stardewHabit--SummaryHeader">
        <div className="stardewHabit--DateTitle">🌾 素材包未就绪</div>
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
// 数据更新辅助方法（保留原命令式逻辑，仅迁移自 React 事件回调）
// ═════════════════════════════════════════════════════════════
async function updateSingleHabit(
  props: DatabaseViewProps,
  field: string,
  value: boolean,
  sortedRows: any[],
  todayStr: string,
  activeFields: string[]
) {
  const todayRow = sortedRows.find(r => r.$item.file.basename === todayStr);
  if (todayRow) {
    await props.api.updateCell(todayRow.id, field, value);
  } else {
    await createTodayFile(props, todayStr, sortedRows, activeFields, field, value);
  }
}

async function updateTodayHabits(
  props: DatabaseViewProps,
  fields: string[],
  sortedRows: any[],
  todayStr: string,
  value: boolean
) {
  const todayRow = sortedRows.find(r => r.$item.file.basename === todayStr);
  if (todayRow) {
    const updates: Record<string, any> = {};
    fields.forEach(f => {
      updates[f] = value;
    });
    await props.api.updateRow(todayRow.id, updates);
  } else {
    await createTodayFile(props, todayStr, sortedRows, fields, '', value, true);
  }
}

async function createTodayFile(
  props: DatabaseViewProps,
  todayStr: string,
  sortedRows: any[],
  activeFields: string[],
  targetField: string,
  targetValue: boolean,
  allTrue: boolean = false
) {
  let dailyNotesFolder = '';
  const dailyNotesPlugin = (props.app as any).internalPlugins?.plugins?.['daily-notes'];
  if (dailyNotesPlugin?.enabled && dailyNotesPlugin.instance) {
    dailyNotesFolder = dailyNotesPlugin.instance.options?.folder ?? '';
  }

  const normalizedFolder = normalizePath(dailyNotesFolder);

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

  let content = `---\ntags: daily-note\n---\n\n# 今日打卡\n\n`;
  activeFields.forEach(f => {
    let val = false;
    if (allTrue) {
      val = true;
    } else if (f === targetField) {
      val = targetValue;
    }
    content += `[${f}:: ${val}]\n`;
  });

  try {
    await props.app.vault.create(todayFilePath, content);
    new props.obsidian.Notice(`📖 已为您自动创建今日日记: ${todayFilePath}`);
  } catch (err: any) {
    console.error('[Stardew Habit] 创建今日日记失败', err);
    new props.obsidian.Notice(`✗ 创建今日日记失败: ${err?.message ?? err}`);
  }
}
