import { DatabaseViewProps } from './types';
import { SpriteSheet, CropStage, normalizePath } from './sprite-helper';
import { getCropConfigs } from './crop-loader';

const WOODEN_BOX_CLASS = 'stardewHabit--Box';

export function renderFarmView(props: DatabaseViewProps) {
  props.container.replaceChildren();

  // ── 读取 Obsidian 官方日记 (Daily Notes) 配置 ──
  let dateFormat = 'YYYY-MM-DD';
  const dailyNotesPlugin = (props.app as any).internalPlugins?.plugins?.['daily-notes'];
  if (dailyNotesPlugin?.enabled && dailyNotesPlugin.instance) {
    dateFormat = dailyNotesPlugin.instance.options?.format ?? 'YYYY-MM-DD';
  }

  // 1. 获取所有行，动态验证文件名日期格式并基于时间排序
  const allRows = props.viewData.groups.flatMap(g => g.rows ?? []);
  const sortedRows = allRows
    .filter(r => {
      const basename = r.$item.file?.basename;
      if (!basename) return false;
      return props.moment(basename, dateFormat, true).isValid();
    })
    .sort((a, b) => {
      const dateA = props.moment(a.$item.file.basename, dateFormat);
      const dateB = props.moment(b.$item.file.basename, dateFormat);
      return dateA.diff(dateB);
    });

  // 获取符合官方格式的今天日期字符串
  const todayStr = props.moment().format(dateFormat);

  // 2. 从配置中读取激活的习惯字段和作物映射
  const options = props.viewDefinition.options ?? {};
  const activeHabits: Array<{ 
    field: string; 
    label: string; 
    crop: string;
    // 自定义坐标模式：直接手填各阶段的 CropStage 数组
    customStages?: CropStage[];
  }> = options.habits ?? [
    { field: '锻炼', label: '锻炼打卡', crop: '472' }, // 防风草
    { field: '阅读', label: '阅读打卡', crop: '481' }, // 蒓越莆
    { field: '日记', label: '日记打卡', crop: '490' }, // 南瓜
  ];

  const activeFields = activeHabits.map(h => h.field);

  // 3. 计算各个习惯的今日状态与连续打卡天数 (Streak)
  const todayRow = sortedRows.find(r => r.$item.file.basename === todayStr);
  
  const habitStats = activeHabits.map(habit => {
    const todayVal = todayRow ? todayRow.$item[habit.field] : null;
    const isDoneToday = todayVal === true || todayVal === 'true' || todayVal === 1 || todayVal === 'checked';

    // 计算 Streak 算法：若今日未打卡，延用昨天的连续打卡数；否则从今天开始往前倒推
    let startIndex = sortedRows.length - 1;
    if (sortedRows.length > 0 && sortedRows[sortedRows.length - 1].$item.file.basename === todayStr && !isDoneToday) {
      startIndex = sortedRows.length - 2;
    }

    let streak = 0;
    for (let i = startIndex; i >= 0; i--) {
      const val = sortedRows[i].$item[habit.field];
      const isDone = val === true || val === 'true' || val === 1 || val === 'checked';
      if (isDone) {
        streak++;
      } else {
        break;
      }
    }

    // 获取最近 6 天的历史记录
    const history: Array<{ date: string; status: boolean }> = [];
    for (let i = Math.max(0, sortedRows.length - 6); i < sortedRows.length; i++) {
      const row = sortedRows[i];
      const val = row.$item[habit.field];
      history.push({
        date: row.$item.file.basename.slice(5), // 仅保留 MM-DD
        status: val === true || val === 'true' || val === 1 || val === 'checked'
      });
    }

    return {
      ...habit,
      isDoneToday,
      streak,
      history
    };
  });

  // 计算今日总完成度，用于控制天空与太阳
  const doneCount = habitStats.filter(h => h.isDoneToday).length;
  const totalCount = habitStats.length;
  const completionRate = totalCount > 0 ? doneCount / totalCount : 0;

  // 根据平均打卡连续天数确定房屋等级
  const avgStreak = habitStats.length > 0 ? habitStats.reduce((sum, h) => sum + h.streak, 0) / habitStats.length : 0;
  let houseStage = 0; // 0: 草棚, 1: 木屋, 2: 双层大木屋
  if (avgStreak >= 2 && avgStreak < 5) {
    houseStage = 1;
  } else if (avgStreak >= 5) {
    houseStage = 2;
  }

  // 4. 构建精灵图加载器
  const assetsPath = (options.assetsPath as string | undefined) || 'Log/assets/stardew-habit';
  const cropsSprite = new SpriteSheet(props.app, `${assetsPath}/crops.png`, 256, 1024, 16, 16);
  const housesSprite = new SpriteSheet(props.app, `${assetsPath}/houses.png`, 272, 432, 160, 144);
  const hoeDirtSprite = new SpriteSheet(props.app, `${assetsPath}/hoeDirt.png`, 192, 64, 64, 64);

  // 5. 渲染页面 DOM 结构
  const root = document.createElement('div');
  root.className = 'stardewHabit--Root';

  // 根据今日完成度，调整天空渐变底色
  let skyGradient = 'linear-gradient(to bottom, #75b8e7 0%, #a4daf2 40%, #ffde9c 80%, #f7d2aa 100%)';
  if (completionRate === 0) {
    skyGradient = 'linear-gradient(to bottom, #2b3a4a 0%, #4a5d6e 40%, #8b6b58 80%, #a87b65 100%)';
  } else if (completionRate > 0 && completionRate < 1) {
    skyGradient = 'linear-gradient(to bottom, #609ec8 0%, #85cadf 40%, #fab475 80%, #e2946c 100%)';
  }
  root.style.background = skyGradient;

  // ── 渲染头部环境区 ──
  const header = document.createElement('div');
  header.className = 'stardewHabit--Header';

  // 渲染太阳位置（随打卡比例从左向右移动）
  const sun = document.createElement('div');
  sun.className = 'stardewHabit--Sun';
  const sunLeftOffset = 20 + completionRate * 60;
  sun.style.left = `${sunLeftOffset}%`;
  header.appendChild(sun);

  // 渲染农舍房屋
  const houseContainer = document.createElement('div');
  houseContainer.className = 'stardewHabit--HouseContainer';
  const houseDiv = document.createElement('div');
  houseDiv.style.cssText = housesSprite.getStyleText(0, houseStage, 0.8);
  houseContainer.appendChild(houseDiv);
  header.appendChild(houseContainer);

  // 渲染左侧今日简报控制台
  const summaryPanel = document.createElement('div');
  summaryPanel.className = `stardewHabit--SummaryPanel ${WOODEN_BOX_CLASS}`;

  const summaryHeader = document.createElement('div');
  summaryHeader.className = 'stardewHabit--SummaryHeader';
  
  const dateTitle = document.createElement('div');
  dateTitle.className = 'stardewHabit--DateTitle';
  dateTitle.textContent = todayStr;
  summaryHeader.appendChild(dateTitle);

  // "过一天" / 一键全部打卡完成按钮
  const nextDayBtn = document.createElement('button');
  nextDayBtn.className = 'stardewHabit--Button';
  nextDayBtn.textContent = '过一天';
  nextDayBtn.addEventListener('click', async () => {
    new props.obsidian.Notice('☀️ 新的一天！正在保存今日所有未打卡记录为完成。');
    await updateTodayHabits(props, activeFields, sortedRows, todayStr, true);
  });
  summaryHeader.appendChild(nextDayBtn);
  summaryPanel.appendChild(summaryHeader);

  const summaryTasks = document.createElement('div');
  summaryTasks.className = 'stardewHabit--SummaryTasks';

  habitStats.forEach(stat => {
    const taskItem = document.createElement('div');
    taskItem.className = 'stardewHabit--SummaryTaskItem';
    
    const statusDot = document.createElement('span');
    statusDot.className = 'stardewHabit--HistoryDot';
    statusDot.setAttribute('data-status', String(stat.isDoneToday));
    statusDot.style.width = '16px';
    statusDot.style.height = '16px';

    const taskLabel = document.createElement('span');
    taskLabel.textContent = `${stat.label} (${stat.isDoneToday ? '已打卡' : '未打卡'})`;

    taskItem.appendChild(statusDot);
    taskItem.appendChild(taskLabel);
    summaryTasks.appendChild(taskItem);
  });
  summaryPanel.appendChild(summaryTasks);
  header.appendChild(summaryPanel);

  root.appendChild(header);

  // ── 渲染农田卡片网格 ──
  const farmGrid = document.createElement('div');
  farmGrid.className = 'stardewHabit--FarmGrid';

  habitStats.forEach(stat => {
    const card = document.createElement('div');
    card.className = 'stardewHabit--Card';

    // 卡片头部
    const cardHeader = document.createElement('div');
    cardHeader.className = 'stardewHabit--CardHeader';

    const cardTitle = document.createElement('div');
    cardTitle.className = 'stardewHabit--HabitTitle';
    cardTitle.textContent = stat.label;

    const stageText = document.createElement('div');
    stageText.className = 'stardewHabit--StageText';
    
    // ── 解析该作物的所有生长阶段定义 ──
    let stages: CropStage[];
    if (stat.crop === 'custom' && Array.isArray(stat.customStages) && stat.customStages.length > 0) {
      stages = stat.customStages;
    } else {
      const cropConfig = getCropConfigs().find(c => c.id === stat.crop) || getCropConfigs()[0];
      stages = cropConfig.stages;
    }

    // 将 streak 映射到实际阶段索引（不超出 stages 数组范围）
    const stageIndex = Math.min(stat.streak, stages.length - 1);
    const stageNames = [
      '种子', '初芽', '成长中', '抽苗', '成熟期', '大丰收',
      '大丰收', '大丰收', '大丰收' // 兜底，防止多阶段作物越界
    ];
    stageText.textContent = `${stageNames[stageIndex]} · ${stat.streak}天`;

    cardHeader.appendChild(cardTitle);
    cardHeader.appendChild(stageText);
    card.appendChild(cardHeader);

    // 耕地与作物区
    const fieldArea = document.createElement('div');
    fieldArea.className = 'stardewHabit--FieldArea';

    const soil = document.createElement('div');
    soil.className = 'stardewHabit--Soil';
    
    // 泥土定位：已打卡使用 col:1 (湿泥土)，未打卡使用 col:0 (干泥土)
    const soilCol = stat.isDoneToday ? 1 : 0;
    soil.style.cssText = hoeDirtSprite.getStyleText(soilCol, 0, 1.2);

    // ── 精确定位当前生长阶段的作物贴图（支持每一阶段独立的 width / height） ──
    const currentStage = stages[stageIndex];
    const cropW = currentStage.width ?? 16;
    const cropH = currentStage.height ?? 16;

    const cropImg = document.createElement('div');
    cropImg.className = 'stardewHabit--CropImg';
    cropImg.style.cssText = cropsSprite.getStyleText(
      currentStage.col,
      currentStage.row,
      2.5,
      cropW,
      cropH
    );
    soil.appendChild(cropImg);

    // 点击泥土直接切换打卡状态
    soil.addEventListener('click', async () => {
      const nextVal = !stat.isDoneToday;
      await updateSingleHabit(props, stat.field, nextVal, sortedRows, todayStr, activeFields);
    });

    fieldArea.appendChild(soil);

    // 右侧控制区域（复选框）
    const checkWrap = document.createElement('div');
    checkWrap.className = 'stardewHabit--CheckWrap';
    
    const checkboxLabel = document.createElement('label');
    checkboxLabel.className = 'stardewHabit--CheckboxLabel';
    
    const cbInput = document.createElement('input');
    cbInput.type = 'checkbox';
    cbInput.className = 'stardewHabit--CheckboxInput';
    cbInput.checked = stat.isDoneToday;
    cbInput.addEventListener('change', async () => {
      await updateSingleHabit(props, stat.field, cbInput.checked, sortedRows, todayStr, activeFields);
    });

    const customCheck = document.createElement('span');
    customCheck.className = 'stardewHabit--CustomCheck';

    const textSpan = document.createElement('span');
    textSpan.textContent = '完成今日打卡';

    checkboxLabel.appendChild(cbInput);
    checkboxLabel.appendChild(customCheck);
    checkboxLabel.appendChild(textSpan);
    checkWrap.appendChild(checkboxLabel);
    fieldArea.appendChild(checkWrap);

    card.appendChild(fieldArea);

    // 历史轨迹展示区
    const historyTrack = document.createElement('div');
    historyTrack.className = 'stardewHabit--HistoryTrack';
    
    stat.history.forEach(hist => {
      const histDay = document.createElement('div');
      histDay.className = 'stardewHabit--HistoryDay';

      const dateSpan = document.createElement('span');
      dateSpan.className = 'stardewHabit--HistoryDate';
      dateSpan.textContent = hist.date;

      const dot = document.createElement('span');
      dot.className = 'stardewHabit--HistoryDot';
      dot.setAttribute('data-status', String(hist.status));

      histDay.appendChild(dateSpan);
      histDay.appendChild(dot);
      historyTrack.appendChild(histDay);
    });

    card.appendChild(historyTrack);
    farmGrid.appendChild(card);
  });

  root.appendChild(farmGrid);
  props.container.appendChild(root);
}

// 辅助方法：更新单个习惯状态
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

// 一键快速打卡过一天
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

// 创建今天日记并写入打卡
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
