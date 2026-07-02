import { App, Component } from 'obsidian';

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

// 严格保证 module.exports 在文件最顶部导出，便于宿主进行正则预扫描和识别
module.exports = {
  id: 'xdb-stardew-habit-tracker',
  name: '星露谷物语打卡插件',
  description: '将习惯追踪变成星露谷物语像素风的农场模拟经营体验。',
  author: 'Google DeepMind Team',
  version: '1.0.0',

  install(ctx: any) {
    // 注册全局样式 (利用函数声明提升，避免 Temporal Dead Zone 报错)
    ctx.registerStyleSheet(getStyleText());

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
              const cropConfig = getCropDefinitions().find(c => c.id === stat.crop) || getCropDefinitions()[0];
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
              // 自动规范化输入的相对路径
              const normalized = normalizePath(assetsPathInput.value);
              void props.setViewDefinition(current => ({
                ...current,
                options: { ...(current.options ?? {}), assetsPath: normalized }
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
              
              getCropDefinitions().forEach(def => {
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

// ── 所有的辅助类、数据定义与 CSS 样式均声明在下方，利用提升避免 TDZ 报错，同时保证 module.exports 在文件最首部 ──

class SpriteSheet {
  private app: App;
  private vaultPath: string;
  private imgWidth: number;
  private imgHeight: number;
  private spriteWidth: number;
  private spriteHeight: number;
  private cachedUrl: string | null = null;

  constructor(
    app: App,
    vaultPath: string,
    imgWidth: number,
    imgHeight: number,
    spriteWidth: number = 16,
    spriteHeight: number = 16
  ) {
    this.app = app;
    this.vaultPath = vaultPath;
    this.imgWidth = imgWidth;
    this.imgHeight = imgHeight;
    this.spriteWidth = spriteWidth;
    this.spriteHeight = spriteHeight;
  }

  public getUrl(): string {
    if (this.cachedUrl) {
      return this.cachedUrl;
    }
    // 规范化路径为标准的 Obsidian 库内相对路径 (去首尾斜杠及点)
    const normalizedPath = normalizePath(this.vaultPath);
    
    let file = this.app.vault.getAbstractFileByPath(normalizedPath);
    if (file) {
      // 彻底修复参数错配：使用标准公开的 app.vault.getResourcePath(file) 获取真实资源路径，完美解决 TypeError 报错！
      this.cachedUrl = this.app.vault.getResourcePath(file as any);
      return this.cachedUrl;
    }
    console.warn(`[Stardew Habit] 素材文件未找到: ${normalizedPath}`);
    return '';
  }

  public getStyleObject(col: number, row: number, scale: number = 3): Record<string, string> {
    const url = this.getUrl();
    const width = this.spriteWidth * scale;
    const height = this.spriteHeight * scale;
    const sizeX = this.imgWidth * scale;
    const sizeY = this.imgHeight * scale;
    const posX = -(col * this.spriteWidth * scale);
    const posY = -(row * this.spriteHeight * scale);

    return {
      'display': 'inline-block',
      'width': `${width}px`,
      'height': `${height}px`,
      'background-image': `url("${url}")`,
      'background-repeat': 'no-repeat',
      'background-size': `${sizeX}px ${sizeY}px`,
      'background-position': `${posX}px ${posY}px`,
      'image-rendering': 'pixelated',
    };
  }

  public getStyleText(col: number, row: number, scale: number = 3): string {
    const obj = this.getStyleObject(col, row, scale);
    return Object.entries(obj)
      .map(([k, v]) => `${k}: ${v};`)
      .join(' ');
  }
}

// 路径清洗与规范化：确保符合 Obsidian 库内相对路径标准 (不以/或./开头)
function normalizePath(path: string): string {
  let cleaned = path.trim();
  cleaned = cleaned.replace(/\\/g, '/');
  
  if (cleaned.startsWith('./')) {
    cleaned = cleaned.slice(2);
  }
  
  while (cleaned.startsWith('/')) {
    cleaned = cleaned.slice(1);
  }
  
  while (cleaned.endsWith('/')) {
    cleaned = cleaned.slice(0, -1);
  }
  
  cleaned = cleaned.replace(/\/+/g, '/');
  return cleaned;
}

function getCropDefinitions() {
  return [
    { id: 'parsnip', name: '防风草 (Parsnip)', row: 0, maxStage: 5 },
    { id: 'greenbean', name: '绿豆 (Green Bean)', row: 1, maxStage: 5 },
    { id: 'cauliflower', name: '椰菜 (Cauliflower)', row: 2, maxStage: 5 },
    { id: 'potato', name: '土豆 (Potato)', row: 3, maxStage: 5 },
    { id: 'garlic', name: '大蒜 (Garlic)', row: 4, maxStage: 5 },
    { id: 'kale', name: '甘蓝 (Kale)', row: 5, maxStage: 5 },
    { id: 'rhubarb', name: '大黄 (Rhubarb)', row: 6, maxStage: 5 },
    { id: 'melon', name: '甜瓜 (Melon)', row: 7, maxStage: 5 },
    { id: 'tomato', name: '番茄 (Tomato)', row: 8, maxStage: 5 },
    { id: 'blueberry', name: '蓝莓 (Blueberry)', row: 9, maxStage: 5 },
    { id: 'hotpepper', name: '辣椒 (Hot Pepper)', row: 10, maxStage: 5 },
    { id: 'starfruit', name: '杨桃 (Starfruit)', row: 11, maxStage: 5 },
    { id: 'corn', name: '玉米 (Corn)', row: 12, maxStage: 5 },
    { id: 'hops', name: '啤酒花 (Hops)', row: 13, maxStage: 5 },
    { id: 'eggplant', name: '茄子 (Eggplant)', row: 14, maxStage: 5 },
    { id: 'pumpkin', name: '南瓜 (Pumpkin)', row: 15, maxStage: 5 },
    { id: 'bokchoy', name: '小白菜 (Bok Choy)', row: 16, maxStage: 5 },
    { id: 'taro', name: '芋头 (Taro)', row: 17, maxStage: 5 },
    { id: 'cranberry', name: '蔓越莓 (Cranberry)', row: 18, maxStage: 5 },
    { id: 'sunflower', name: '向日葵 (Sunflower)', row: 19, maxStage: 5 },
    { id: 'cactus', name: '仙人掌 (Cactus)', row: 20, maxStage: 5 }
  ];
}

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
    await props.api.updateCell(todayRow.id, field, value);
  } else {
    await createTodayFile(props, todayStr, sortedRows, activeFields, field, value);
  }
}

// 更新今日所有习惯（一键快速打卡过一天）
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
  let parentFolder = '';
  if (sortedRows.length > 0) {
    const path = sortedRows[0].$item.file.path;
    const parts = path.split('/');
    if (parts.length > 1) {
      parentFolder = parts.slice(0, -1).join('/') + '/';
    }
  }

  const todayFilePath = `${parentFolder}${todayStr}.md`;

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

function getStyleText() {
  return `/* 星露谷风格打卡插件全局样式表 */

/* 摇摆动画 - 模拟微风拂过作物 */
@keyframes stardewHabit--sway {
  0% { transform: rotate(0deg); }
  25% { transform: rotate(-3deg) skewX(-2deg); }
  75% { transform: rotate(3deg) skewX(2deg); }
  100% { transform: rotate(0deg); }
}

/* 太阳升降/呼吸微动画 */
@keyframes stardewHabit--sunPulse {
  0% { transform: scale(1); filter: drop-shadow(0 0 4px rgba(247, 196, 68, 0.6)); }
  50% { transform: scale(1.05); filter: drop-shadow(0 0 12px rgba(247, 196, 68, 0.9)); }
  100% { transform: scale(1); filter: drop-shadow(0 0 4px rgba(247, 196, 68, 0.6)); }
}

.stardewHabit--Root {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 500px;
  background: linear-gradient(to bottom, #75b8e7 0%, #a4daf2 40%, #ffde9c 80%, #f7d2aa 100%);
  font-family: 'Outfit', 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: #3f2214;
  padding: 16px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
  image-rendering: pixelated;
}

/* 像素风木纹对话框样式 */
.stardewHabit--Box {
  background-color: #f7e0b5;
  border: 4px solid #5a3c20;
  border-radius: 8px;
  box-shadow: 
    inset -3px -3px 0px 0px #d8a065,
    inset 3px 3px 0px 0px #fff7e6,
    0px 4px 10px rgba(0, 0, 0, 0.15);
  padding: 16px;
  position: relative;
}

/* 顶部环境区 */
.stardewHabit--Header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  height: 160px;
  position: relative;
  border-bottom: 4px dashed #5a3c20;
  padding-bottom: 8px;
}

/* 太阳 */
.stardewHabit--Sun {
  width: 48px;
  height: 48px;
  background-color: #f7c444;
  border-radius: 50%;
  position: absolute;
  top: 20px;
  right: 50px;
  border: 4px solid #5a3c20;
  animation: stardewHabit--sunPulse 4s ease-in-out infinite;
  z-index: 1;
}

/* 农居 */
.stardewHabit--HouseContainer {
  position: relative;
  width: 120px;
  height: 120px;
  margin-right: 120px;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

/* 农田网格 */
.stardewHabit--FarmGrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
  padding: 8px 0;
}

/* 习惯农田卡片 */
.stardewHabit--Card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background-color: #f7e0b5;
  border: 4px solid #5a3c20;
  border-radius: 8px;
  padding: 12px;
  box-shadow: 
    inset -3px -3px 0px 0px #d8a065,
    inset 3px 3px 0px 0px #fff7e6;
  position: relative;
}

.stardewHabit--CardHeader {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 2px solid #bfa07a;
  padding-bottom: 6px;
}

.stardewHabit--HabitTitle {
  font-weight: 800;
  font-size: 1.1em;
  color: #3f2214;
}

.stardewHabit--StageText {
  font-size: 0.85em;
  color: #8c5a36;
  background-color: #ecd8b0;
  padding: 2px 6px;
  border-radius: 4px;
  border: 2px solid #5a3c20;
}

/* 作物耕地区 */
.stardewHabit--FieldArea {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background-color: #e5cc9c;
  border: 2px solid #5a3c20;
  border-radius: 6px;
  padding: 8px;
}

/* 泥土 */
.stardewHabit--Soil {
  width: 48px;
  height: 48px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: transform 0.1s ease;
  border: 2px solid #5a3c20;
}

.stardewHabit--Soil:hover {
  transform: scale(1.05);
}

.stardewHabit--CropImg {
  animation: stardewHabit--sway 3s ease-in-out infinite;
  transform-origin: bottom center;
}

/* 卡片里的打卡控制框 */
.stardewHabit--CheckWrap {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.9em;
}

.stardewHabit--CheckboxLabel {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

/* 星露谷风格复选框 */
.stardewHabit--CheckboxInput {
  display: none;
}

.stardewHabit--CustomCheck {
  width: 20px;
  height: 20px;
  border: 3px solid #5a3c20;
  background-color: #ecd8b0;
  border-radius: 4px;
  position: relative;
  box-shadow: inset -2px -2px 0px 0px #bfa07a;
}

.stardewHabit--CheckboxInput:checked + .stardewHabit--CustomCheck {
  background-color: #4ebf3f;
}

.stardewHabit--CheckboxInput:checked + .stardewHabit--CustomCheck::after {
  content: "";
  position: absolute;
  left: 4px;
  top: 1px;
  width: 6px;
  height: 10px;
  border: solid white;
  border-width: 0 3px 3px 0;
  transform: rotate(45deg);
}

/* 历史轨迹记录 */
.stardewHabit--HistoryTrack {
  display: flex;
  gap: 4px;
  margin-top: 4px;
  justify-content: space-between;
  background: #dfc89f;
  padding: 4px;
  border-radius: 4px;
  border: 2px solid #5a3c20;
}

.stardewHabit--HistoryDay {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  flex: 1;
}

.stardewHabit--HistoryDate {
  font-size: 0.7em;
  color: #7a5435;
  font-weight: bold;
}

.stardewHabit--HistoryDot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 1px solid #5a3c20;
}

.stardewHabit--HistoryDot[data-status="true"] {
  background-color: #4ebf3f;
}

.stardewHabit--HistoryDot[data-status="false"] {
  background-color: #d1563f;
}

/* 今日看板 */
.stardewHabit--SummaryPanel {
  max-width: 320px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.stardewHabit--SummaryHeader {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.stardewHabit--DateTitle {
  font-size: 1.4em;
  font-weight: 900;
  color: #3f2214;
}

.stardewHabit--SummaryTasks {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.stardewHabit--SummaryTaskItem {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.95em;
  color: #3f2214;
}

/* 一键打卡/过一天按钮 */
.stardewHabit--Button {
  background-color: #f7a244;
  border: 3px solid #5a3c20;
  border-radius: 6px;
  color: white;
  font-weight: bold;
  padding: 4px 12px;
  cursor: pointer;
  box-shadow: 
    inset -2px -2px 0px 0px #b56c22,
    0px 2px 4px rgba(0, 0, 0, 0.1);
  text-shadow: 1px 1px 0px #5a3c20;
  transition: transform 0.1s ease;
}

.stardewHabit--Button:hover {
  transform: translateY(-2px);
  background-color: #fcae58;
}

.stardewHabit--Button:active {
  transform: translateY(1px);
}
`;
}
