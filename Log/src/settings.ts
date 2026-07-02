import { ViewSettingsProps } from './types';
import { CropStage, normalizePath } from './sprite-helper';
import { getCropConfigs } from './crop-loader';

const WOODEN_BOX_CLASS = 'stardewHabit--Box';

export function renderSettingsView(props: ViewSettingsProps) {
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
  const habits: Array<{
    field: string;
    label: string;
    crop: string;
    customStages?: CropStage[];
  }> = currentOptions.habits ?? [
    { field: '锻炼', label: '锻炼打卡', crop: '472' }, // 防风草
    { field: '阅读', label: '阅读打卡', crop: '481' }, // 蒓越莆
    { field: '日记', label: '日记打卡', crop: '490' }, // 南瓜
  ];

  // 渲染配置习惯表单
  habits.forEach((habit, index) => {
    const itemDiv = document.createElement('div');
    itemDiv.style.display = 'flex';
    itemDiv.style.flexDirection = 'column';
    itemDiv.style.gap = '8px';
    itemDiv.style.backgroundColor = '#ecd8b0';
    itemDiv.style.padding = '10px';
    itemDiv.style.borderRadius = '6px';
    itemDiv.style.border = '2px solid #5a3c20';

    // ── 第一排：基础设置 ──
    const row1 = document.createElement('div');
    row1.style.display = 'flex';
    row1.style.gap = '8px';
    row1.style.alignItems = 'center';
    row1.style.flexWrap = 'wrap';

    const labelField = document.createElement('span');
    labelField.textContent = '字段:';
    labelField.style.fontWeight = 'bold';

    const inputField = document.createElement('input');
    inputField.type = 'text';
    inputField.value = habit.field;
    inputField.style.width = '70px';
    inputField.style.border = '2px solid #5a3c20';
    inputField.style.borderRadius = '4px';
    inputField.addEventListener('change', () => {
      updateHabitsOption(props, index, 'field', inputField.value);
    });

    const labelName = document.createElement('span');
    labelName.textContent = '显示名:';
    labelName.style.fontWeight = 'bold';

    const inputLabel = document.createElement('input');
    inputLabel.type = 'text';
    inputLabel.value = habit.label;
    inputLabel.style.width = '90px';
    inputLabel.style.border = '2px solid #5a3c20';
    inputLabel.style.borderRadius = '4px';
    inputLabel.addEventListener('change', () => {
      updateHabitsOption(props, index, 'label', inputLabel.value);
    });

    const labelCrop = document.createElement('span');
    labelCrop.textContent = '作物:';
    labelCrop.style.fontWeight = 'bold';

    const selectCrop = document.createElement('select');
    selectCrop.style.border = '2px solid #5a3c20';
    selectCrop.style.borderRadius = '4px';
    
    getCropConfigs().forEach(def => {
      const opt = document.createElement('option');
      opt.value = def.id;
      opt.textContent = def.name.split(' (')[0];
      if (def.id === habit.crop) opt.selected = true;
      selectCrop.appendChild(opt);
    });

    // 追加自定义阶段选项
    const customOpt = document.createElement('option');
    customOpt.value = 'custom';
    customOpt.textContent = '⚙️ 自定义阶段坐标...';
    if (habit.crop === 'custom') customOpt.selected = true;
    selectCrop.appendChild(customOpt);

    selectCrop.addEventListener('change', () => {
      updateHabitsOption(props, index, 'crop', selectCrop.value);
    });

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

    row1.appendChild(labelField);
    row1.appendChild(inputField);
    row1.appendChild(labelName);
    row1.appendChild(inputLabel);
    row1.appendChild(labelCrop);
    row1.appendChild(selectCrop);
    row1.appendChild(delBtn);
    itemDiv.appendChild(row1);

    // ── 第二排：自定义阶段 JSON 编辑器 ──
    if (habit.crop === 'custom') {
      const row2 = document.createElement('div');
      row2.style.display = 'flex';
      row2.style.flexDirection = 'column';
      row2.style.gap = '6px';
      row2.style.paddingTop = '8px';
      row2.style.borderTop = '1px dashed #5a3c20';

      const helpTitle = document.createElement('div');
      helpTitle.style.fontSize = '0.85em';
      helpTitle.style.fontWeight = 'bold';
      helpTitle.style.color = '#5a3c20';
      helpTitle.textContent = '📋 各生长阶段坐标 (JSON 数组)：';
      row2.appendChild(helpTitle);

      // 说明文字，解释各字段含义
      const helpDesc = document.createElement('div');
      helpDesc.style.fontSize = '0.78em';
      helpDesc.style.color = '#8c5a36';
      helpDesc.style.lineHeight = '1.5';
      helpDesc.innerHTML = [
        '<b>col</b>: 横向第几格（从0开始，每格16px）',
        '<b>row</b>: 纵向第几格（从0开始，每格16px）',
        '<b>width</b>: 贴图宽度（默认16，可省略）',
        '<b>height</b>: 贴图高度（默认16，双高写32）',
        '数组中每个元素代表一个生长阶段（从种子到成熟）'
      ].join('<br>');
      row2.appendChild(helpDesc);

      // JSON 文本编辑区
      const stagesExample: CropStage[] = habit.customStages ?? [
        { col: 0, row: 0 },
        { col: 1, row: 0 },
        { col: 2, row: 0 },
        { col: 3, row: 0 },
        { col: 4, row: 0, height: 32 }
      ];

      const textarea = document.createElement('textarea');
      textarea.value = JSON.stringify(stagesExample, null, 2);
      textarea.style.fontFamily = 'monospace';
      textarea.style.fontSize = '0.82em';
      textarea.style.width = '100%';
      textarea.style.minHeight = '140px';
      textarea.style.border = '2px solid #5a3c20';
      textarea.style.borderRadius = '4px';
      textarea.style.padding = '6px';
      textarea.style.backgroundColor = '#fffdf5';
      textarea.style.boxSizing = 'border-box';
      textarea.style.resize = 'vertical';

      const statusMsg = document.createElement('div');
      statusMsg.style.fontSize = '0.8em';

      const saveBtn = document.createElement('button');
      saveBtn.className = 'stardewHabit--Button';
      saveBtn.textContent = '✔ 应用阶段配置';
      saveBtn.addEventListener('click', () => {
        try {
          const parsed: CropStage[] = JSON.parse(textarea.value);
          // 简单结构校验
          if (!Array.isArray(parsed) || parsed.length === 0) {
            throw new Error('必须是非空数组');
          }
          for (const s of parsed) {
            if (typeof s.col !== 'number' || typeof s.row !== 'number') {
              throw new Error('每个阶段必须含有 col 和 row（数字类型）');
            }
          }
          updateHabitsOption(props, index, 'customStages', parsed);
          statusMsg.style.color = '#2a8a2a';
          statusMsg.textContent = `✔ 已保存 ${parsed.length} 个阶段配置`;
        } catch (e: any) {
          statusMsg.style.color = '#b03020';
          statusMsg.textContent = `✗ JSON 格式错误: ${e.message}`;
        }
      });

      row2.appendChild(textarea);
      row2.appendChild(saveBtn);
      row2.appendChild(statusMsg);
      itemDiv.appendChild(row2);
    }

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
}

function updateHabitsOption(
  props: ViewSettingsProps,
  index: number,
  key: string,
  val: any
) {
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
