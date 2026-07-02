import { App, Component } from 'obsidian';
import { SpriteSheet, CROP_DEFINITIONS } from './sprite-helper';
import styleText from './style.css';

// 声明外部传入的 props 类型，完全对照 types.md 和 database-view.md
interface viewDefinition {
  id: string;
  name: string;
  type: string;
  options?: Record<string, any>;
}

interface Database {
  updateCell(rowId: string, fieldName: string, value: any): Promise<void>;
  updateRow(id: string, values: Record<string, any>): Promise<void>;
  updateView(view: viewDefinition): Promise<void>;
}

interface DatabaseViewProps {
  app: App;
  moment: any;
  PluginComponent: Component;
  obsidian: any;
  container: HTMLElement;
  api: Database;
  viewId: string;
  viewDefinition: viewDefinition;
  viewData: {
    groups: Array<{
      rows: Array<{
        id: string;
        $item: Record<string, any>;
      }>;
    }>;
  };
}

interface ViewSettingsProps {
  container: HTMLElement;
  api: Database;
  viewDefinition: viewDefinition;
  setViewDefinition: (updater: (current: viewDefinition) => viewDefinition) => Promise<void>;
}

const VIEW_TYPE = 'stardew-farm-habit';
const WOODEN_BOX_CLASS = 'stardewHabit--Box';

module.exports = {
  id: 'xdb-stardew-habit-tracker',
  name: '星露谷物语打卡插件',
  description: '将习惯追踪变成星露谷物语像素风的农场模拟经营体验。',
  author: 'Google DeepMind Team',
  version: '1.0.0',

  install(ctx: any) {
    // 注册全局样式
    ctx.registerStyleSheet(styleText);

    // 注册数据库视图
    ctx.registerDatabaseView({
      id: VIEW_TYPE,
      name: '星露谷农场',
      icon: 'sprout',
      view() {
        return {
          onUpdate(props: DatabaseViewProps) {
            props.container.replaceChildren();

            // 1. 获取所有行并按日期排序
            const allRows = props.viewData.groups.flatMap(g => g.rows ?? []);
            const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
            const sortedRows = allRows
              .filter(r => dateRegex.test(r.$item.file?.basename ?? ''))
              .sort((a, b) => a.$item.file.basename.localeCompare(b.$item.file.basename));

            // 获取今天和昨天的日期字符串
            const todayStr = props.moment().format('YYYY-MM-DD');
            const yesterdayStr = props.moment().subtract(1, 'days').format('YYYY-MM-DD');

            // 2. 从配置中读取激活的习惯字段和作物映射
            const options = props.viewDefinition.options ?? {};
            // 默认的三个习惯
            const activeHabits: Array<{ field: string; label: string; crop: string }> = options.habits ?? [
              { field: '锻炼', label: '每日锻炼', crop: 'parsnip' },
              { field: '阅读', label: '阅读学习', crop: 'blueberry' },
              { field: '日记', label: '撰写日记', crop: 'pumpkin' }
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
            let houseStage = 0; // 0: 草棚, 1: 单层木屋, 2: 双层大木屋
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
            let skyGradient = 'linear-gradient(to bottom, #75b8e7 0%, #a4daf2 40%, #ffde9c 80%, #f7d2aa 100%)'; // 默认白天蓝天
            if (completionRate === 0) {
              skyGradient = 'linear-gradient(to bottom, #2b3a4a 0%, #4a5d6e 40%, #8b6b58 80%, #a87b65 100%)'; // 未打卡：晨曦/微光
            } else if (completionRate > 0 && completionRate < 1) {
              skyGradient = 'linear-gradient(to bottom, #609ec8 0%, #85cadf 40%, #fab475 80%, #e2946c 100%)'; // 部分打卡：夕阳/金黄
            }
            root.style.background = skyGradient;

            // ── 渲染头部环境区 ──
            const header = document.createElement('div');
            header.className = 'stardewHabit--Header';

            // 渲染太阳位置（随打卡比例从左向右移动）
            const sun = document.createElement('div');
            sun.className = 'stardewHabit--Sun';
            const sunLeftOffset = 20 + completionRate * 60; // 在 20% - 80% 之间滑动
            sun.style.left = `${sunLeftOffset}%`;
            header.appendChild(sun);

            // 渲染农舍房屋
            const houseContainer = document.createElement('div');
            houseContainer.className = 'stardewHabit--HouseContainer';
            const houseDiv = document.createElement('div');
            // 房屋精灵图中，每个房子的切图尺寸为宽 160px，高 144px，通过 col:0 和 row:0, 1, 2 分别对应三个升级阶段
            houseDiv.style.cssText = housesSprite.getStyleText(0, houseStage, 0.8); // 稍微缩小适配 header 高度
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
              // 自动将今日所有未打卡项目设置为 true
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
              
              const growthStage = Math.min(stat.streak, 5);
              const stageNames = ['种子', '初芽', '成长中', '抽苗', '成熟期', '大丰收'];
              stageText.textContent = `${stageNames[growthStage]} · ${stat.streak}天`;

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

              // 渲染作物
              const cropConfig = CROP_DEFINITIONS.find(c => c.id === stat.crop) || CROP_DEFINITIONS[0];
              const cropImg = document.createElement('div');
              cropImg.className = 'stardewHabit--CropImg';
              
              // 作物定位：在 crops.png 中，行的坐标为 cropConfig.row，列坐标代表生长阶段 col = growthStage
              cropImg.style.cssText = cropsSprite.getStyleText(growthStage, cropConfig.row, 2.5);
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
          },

          onDestroy() {}
        };
      }
    });

    // 注册视图的配置面板
    ctx.registerViewSettings({
      id: VIEW_TYPE,
      viewTypes: [VIEW_TYPE],
      settings() {
        return {
          onUpdate(props: ViewSettingsProps) {
            props.container.replaceChildren();

            const settingsRoot = document.createElement('div');
            settingsRoot.className = WOODEN_BOX_CLASS;
            settingsRoot.style.display = 'flex';
            settingsRoot.style.flexDirection = 'column';
            settingsRoot.style.gap = '12px';

            const title = document.createElement('h3');
            title.textContent = '星露谷农场打卡设置';
            title.style.margin = '0 0 8px 0';
            title.style.borderBottom = '2px solid #5a3c20';
            title.style.paddingBottom = '4px';
            settingsRoot.appendChild(title);

            // 素材目录配置项
            const currentOptions = props.viewDefinition.options ?? {};
            const assetsPathVal = (currentOptions.assetsPath as string | undefined) || 'Log/assets/stardew-habit';

            const assetsPathDiv = document.createElement('div');
            assetsPathDiv.style.display = 'flex';
            assetsPathDiv.style.gap = '8px';
            assetsPathDiv.style.alignItems = 'center';
            assetsPathDiv.style.backgroundColor = '#ecd8b0';
            assetsPathDiv.style.padding = '8px';
            assetsPathDiv.style.borderRadius = '6px';
            assetsPathDiv.style.border = '2px solid #5a3c20';

            const assetsPathLabel = document.createElement('span');
            assetsPathLabel.textContent = '素材包目录路径:';
            assetsPathLabel.style.fontWeight = 'bold';

            const assetsPathInput = document.createElement('input');
            assetsPathInput.type = 'text';
            assetsPathInput.value = assetsPathVal;
            assetsPathInput.style.flex = '1';
            assetsPathInput.style.border = '2px solid #5a3c20';
            assetsPathInput.style.borderRadius = '4px';
            assetsPathInput.style.padding = '2px 4px';
            assetsPathInput.addEventListener('change', () => {
              void props.setViewDefinition(current => ({
                ...current,
                options: { ...(current.options ?? {}), assetsPath: assetsPathInput.value }
              }));
            });

            assetsPathDiv.appendChild(assetsPathLabel);
            assetsPathDiv.appendChild(assetsPathInput);
            settingsRoot.appendChild(assetsPathDiv);

            // 从配置中获取当前的习惯列表
            const habits: Array<{ field: string; label: string; crop: string }> = currentOptions.habits ?? [
              { field: '锻炼', label: '每日锻炼', crop: 'parsnip' },
              { field: '阅读', label: '阅读学习', crop: 'blueberry' },
              { field: '日记', label: '撰写日记', crop: 'pumpkin' }
            ];

            // 渲染配置习惯表单
            habits.forEach((habit, index) => {
              const itemDiv = document.createElement('div');
              itemDiv.style.display = 'flex';
              itemDiv.style.gap = '8px';
              itemDiv.style.alignItems = 'center';
              itemDiv.style.backgroundColor = '#ecd8b0';
              itemDiv.style.padding = '8px';
              itemDiv.style.borderRadius = '6px';
              itemDiv.style.border = '2px solid #5a3c20';

              // 字段名输入
              const labelField = document.createElement('span');
              labelField.textContent = '打卡字段:';
              const inputField = document.createElement('input');
              inputField.type = 'text';
              inputField.value = habit.field;
              inputField.style.width = '70px';
              inputField.style.border = '2px solid #5a3c20';
              inputField.style.borderRadius = '4px';
              inputField.addEventListener('change', () => {
                updateHabitsOption(props, index, 'field', inputField.value);
              });

              // 展示名称输入
              const labelName = document.createElement('span');
              labelName.textContent = '显示名称:';
              const inputLabel = document.createElement('input');
              inputLabel.type = 'text';
              inputLabel.value = habit.label;
              inputLabel.style.width = '90px';
              inputLabel.style.border = '2px solid #5a3c20';
              inputLabel.style.borderRadius = '4px';
              inputLabel.addEventListener('change', () => {
                updateHabitsOption(props, index, 'label', inputLabel.value);
              });

              // 作物选择
              const labelCrop = document.createElement('span');
              labelCrop.textContent = '作物:';
              const selectCrop = document.createElement('select');
              selectCrop.style.border = '2px solid #5a3c20';
              selectCrop.style.borderRadius = '4px';
              
              CROP_DEFINITIONS.forEach(def => {
                const opt = document.createElement('option');
                opt.value = def.id;
                opt.textContent = def.name.split(' (')[0]; // 仅显示中文
                if (def.id === habit.crop) {
                  opt.selected = true;
                }
                selectCrop.appendChild(opt);
              });

              selectCrop.addEventListener('change', () => {
                updateHabitsOption(props, index, 'crop', selectCrop.value);
              });

              // 删除按钮
              const delBtn = document.createElement('button');
              delBtn.className = 'stardewHabit--Button';
              delBtn.style.padding = '2px 6px';
              delBtn.textContent = '删除';
              delBtn.addEventListener('click', () => {
                const nextHabits = habits.filter((_, idx) => idx !== index);
                void props.setViewDefinition(current => ({
                  ...current,
                  options: { ...(current.options ?? {}), habits: nextHabits }
                }));
              });

              itemDiv.appendChild(labelField);
              itemDiv.appendChild(inputField);
              itemDiv.appendChild(labelName);
              itemDiv.appendChild(inputLabel);
              itemDiv.appendChild(labelCrop);
              itemDiv.appendChild(selectCrop);
              itemDiv.appendChild(delBtn);

              settingsRoot.appendChild(itemDiv);
            });

            // 添加习惯按钮
            const addBtn = document.createElement('button');
            addBtn.className = 'stardewHabit--Button';
            addBtn.textContent = '添加新习惯';
            addBtn.style.alignSelf = 'flex-start';
            addBtn.addEventListener('click', () => {
              const newHabit = { field: '新习惯', label: '新打卡习惯', crop: 'parsnip' };
              void props.setViewDefinition(current => ({
                ...current,
                options: { ...(current.options ?? {}), habits: [...habits, newHabit] }
              }));
            });
            settingsRoot.appendChild(addBtn);

            props.container.appendChild(settingsRoot);
          },

          onDestroy() {}
        };
      }
    });

    return () => undefined;
  }
};

// 辅助方法：在设置面板中更新 habits 配置并保存
function updateHabitsOption(props: ViewSettingsProps, index: number, key: 'field' | 'label' | 'crop', val: string) {
  void props.setViewDefinition(current => {
    const habits = [...(current.options?.habits ?? [])];
    if (habits[index]) {
      habits[index] = { ...habits[index], [key]: val };
    }
    return {
      ...current,
      options: { ...(current.options ?? {}), habits }
    };
  });
}

// 更新单个打卡字段值
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
    // 已经有今日日记，直接更新对应的单元格
    await props.api.updateCell(todayRow.id, field, value);
  } else {
    // 没有今日日记，我们需要新建一个日记文件并写入字段
    await createTodayFile(props, todayStr, sortedRows, activeFields, field, value);
  }
}

// 更新今日所有习惯（例如“过一天”全部置为完成）
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

// 辅助方法：通过 Obsidian API 创建今天的日记文件并写入打卡状态
async function createTodayFile(
  props: DatabaseViewProps,
  todayStr: string,
  sortedRows: any[],
  activeFields: string[],
  targetField: string,
  targetValue: boolean,
  allTrue: boolean = false
) {
  // 查找日记所在的文件夹目录，以库里现存日记为基准
  let parentFolder = '';
  if (sortedRows.length > 0) {
    const path = sortedRows[0].$item.file.path;
    const parts = path.split('/');
    if (parts.length > 1) {
      parentFolder = parts.slice(0, -1).join('/') + '/';
    }
  }

  const todayFilePath = `${parentFolder}${todayStr}.md`;

  // 构建带 Dataview inline field 风格的日记文件内容
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
    new props.obsidian.Notice(`📖 已为您自动创建今日日记: ${todayStr}.md`);
  } catch (err: any) {
    console.error('[Stardew Habit] 创建今日日记失败', err);
    new props.obsidian.Notice(`✗ 创建今日日记失败: ${err?.message ?? err}`);
  }
}
