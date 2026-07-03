import type { TFile } from 'obsidian';
import { normalizePath } from './sprite-helper';
import { getCropConfigs } from './crop-loader';
import {
  DEFAULT_HABIT_FOLDER,
  WITHER_DAYS_THRESHOLD,
  HabitTask,
  HabitFileData
} from './types';

// ── 简易本地 YAML 编解码器（实现自给自足，避免 require('obsidian') 失败） ──
export function parseYaml(yaml: string): any {
  const lines = yaml.split('\n');
  const result: any = {
    current_crop: null,
    crop_history: []
  };

  let inHistory = false;
  let currentHistoryItem: any = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (trimmed.startsWith('current_crop:')) {
      inHistory = false;
      const val = trimmed.substring(13).trim();
      if (val === 'null') {
        result.current_crop = null;
      } else {
        result.current_crop = {};
      }
      continue;
    }

    if (trimmed.startsWith('crop_history:')) {
      inHistory = true;
      result.crop_history = [];
      continue;
    }

    if (line.startsWith('  ') && !line.startsWith('    -') && !line.startsWith('  -')) {
      if (result.current_crop) {
        const parts = trimmed.split(':');
        if (parts.length >= 2) {
          const key = parts[0].trim();
          let valStr = parts.slice(1).join(':').trim();
          if (valStr.includes('#')) {
            valStr = valStr.split('#')[0].trim();
          }
          if ((valStr.startsWith('"') && valStr.endsWith('"')) || (valStr.startsWith("'") && valStr.endsWith("'"))) {
            valStr = valStr.substring(1, valStr.length - 1);
          }
          let value: any = valStr;
          if (valStr === 'null') value = null;
          else if (valStr === 'true') value = true;
          else if (valStr === 'false') value = false;
          else if (!isNaN(Number(valStr)) && valStr !== '') value = Number(valStr);

          result.current_crop[key] = value;
        }
      }
    }

    if (inHistory && (trimmed.startsWith('-') || line.startsWith('  -'))) {
      currentHistoryItem = {};
      result.crop_history.push(currentHistoryItem);
      const cleanLine = trimmed.replace(/^-\s*/, '');
      const parts = cleanLine.split(':');
      if (parts.length >= 2) {
        const key = parts[0].trim();
        let valStr = parts.slice(1).join(':').trim();
        if (valStr.includes('#')) valStr = valStr.split('#')[0].trim();
        if ((valStr.startsWith('"') && valStr.endsWith('"')) || (valStr.startsWith("'") && valStr.endsWith("'"))) {
          valStr = valStr.substring(1, valStr.length - 1);
        }
        let value: any = valStr;
        if (valStr === 'null') value = null;
        else if (valStr === 'true') value = true;
        else if (valStr === 'false') value = false;
        else if (!isNaN(Number(valStr)) && valStr !== '') value = Number(valStr);

        currentHistoryItem[key] = value;
      }
    } else if (inHistory && currentHistoryItem && line.startsWith('    ')) {
      const parts = trimmed.split(':');
      if (parts.length >= 2) {
        const key = parts[0].trim();
        let valStr = parts.slice(1).join(':').trim();
        if (valStr.includes('#')) valStr = valStr.split('#')[0].trim();
        if ((valStr.startsWith('"') && valStr.endsWith('"')) || (valStr.startsWith("'") && valStr.endsWith("'"))) {
          valStr = valStr.substring(1, valStr.length - 1);
        }
        let value: any = valStr;
        if (valStr === 'null') value = null;
        else if (valStr === 'true') value = true;
        else if (valStr === 'false') value = false;
        else if (!isNaN(Number(valStr)) && valStr !== '') value = Number(valStr);

        currentHistoryItem[key] = value;
      }
    }
  }

  return result;
}

export function stringifyYaml(obj: any): string {
  let yaml = '';
  if (obj.current_crop) {
    yaml += 'current_crop:\n';
    for (const [k, v] of Object.entries(obj.current_crop)) {
      const valStr = v === null ? 'null' : (typeof v === 'string' ? `"${v}"` : String(v));
      yaml += `  ${k}: ${valStr}\n`;
    }
  } else {
    yaml += 'current_crop: null\n';
  }

  yaml += 'crop_history:\n';
  if (Array.isArray(obj.crop_history)) {
    for (const item of obj.crop_history) {
      let first = true;
      for (const [k, v] of Object.entries(item)) {
        const valStr = v === null ? 'null' : (typeof v === 'string' ? `"${v}"` : String(v));
        if (first) {
          yaml += `  - ${k}: ${valStr}\n`;
          first = false;
        } else {
          yaml += `    ${k}: ${valStr}\n`;
        }
      }
    }
  }

  return yaml;
}

export function getHabitFilePath(options: Record<string, any>, habitField: string): string {
  const folder = (options?.habitFolder as string | undefined)?.trim();
  const normalized = folder ? normalizePath(folder) : normalizePath(DEFAULT_HABIT_FOLDER);
  return `${normalized}/${habitField}.md`;
}

export async function getOrCreateHabitFile(
  app: any,
  options: Record<string, any>,
  field: string,
  cropId: string = '24'
): Promise<TFile | null> {
  const folder = (options?.habitFolder as string | undefined)?.trim();
  const normalizedFolder = normalizePath(folder || DEFAULT_HABIT_FOLDER);

  const folderExists = app.vault.getAbstractFileByPath(normalizedFolder);
  if (!folderExists) {
    try {
      await app.vault.createFolder(normalizedFolder);
    } catch (e) {
      console.warn(`[Stardew Habit] 创建打卡文件夹失败:`, e);
    }
  }

  const filePath = `${normalizedFolder}/${field}.md`;
  let file = app.vault.getAbstractFileByPath(filePath);
  if (!file) {
    const todayStr = window.moment().format('YYYY-MM-DD');
    const initialContent = `# 打卡\n\n# 种植记录\n\n\`\`\`stardew-habit\ncurrent_crop:\n  id: "${cropId}"\n  start_date: "${todayStr}"\n  stage: 0\n  watered_days: 0\n  last_watered_date: null\ncrop_history: []\n\`\`\`\n`;
    try {
      file = await app.vault.create(filePath, initialContent);
    } catch (e) {
      console.error(`[Stardew Habit] 创建习惯文件失败:`, e);
      return null;
    }
  }
  return file as TFile;
}

export function parseHabitFile(content: string, dateFormat: string): HabitFileData {
  let metadata: any = {
    current_crop: null,
    crop_history: []
  };

  const yamlMatch = content.match(/```stardew-habit\n([\s\S]*?)```/);
  if (yamlMatch) {
    try {
      const parsed = parseYaml(yamlMatch[1]);
      if (parsed) {
        metadata = {
          current_crop: parsed.current_crop ?? null,
          crop_history: parsed.crop_history ?? []
        };
      }
    } catch (e) {
      console.warn('[Stardew Habit] YAML 解析失败，使用默认值:', e);
    }
  }

  const tasks: HabitTask[] = [];
  const lines = content.split('\n');
  const taskRegex = /^\s*-\s*\[([ xX])\]\s*\[\[([^\]]+)\]\](?:\s+(\d{2}:\d{2}:\d{2}))?(.*)$/;

  for (const line of lines) {
    const match = line.match(taskRegex);
    if (match) {
      const isDone = match[1].toLowerCase() === 'x';
      const originalLink = match[2].trim();
      const parsedDate = window.moment(originalLink, dateFormat, true);
      const dateStr = parsedDate.isValid() ? parsedDate.format('YYYY-MM-DD') : originalLink;

      const timeStr = match[3] ? match[3].trim() : undefined;
      const note = match[4] ? match[4].trim() : undefined;

      tasks.push({
        isDone,
        dateStr,
        originalLink,
        timeStr,
        note
      });
    }
  }

  return { metadata, tasks };
}

export function stringifyHabitFile(
  basename: string,
  content: string,
  metadata: any,
  tasks: HabitTask[]
): string {
  const newYaml = stringifyYaml(metadata);
  const sortedTasks = [...tasks].sort((a, b) => b.dateStr.localeCompare(a.dateStr));

  const taskLines = sortedTasks.map(t => {
    const status = t.isDone ? 'x' : ' ';
    const timePart = t.timeStr ? ` ${t.timeStr}` : '';
    const notePart = t.note ? ` ${t.note}` : '';
    return `- [${status}] [[${t.originalLink}]]${timePart}${notePart}`;
  });

  return `# 打卡\n\n${taskLines.join('\n')}\n\n# 种植记录\n\n\`\`\`stardew-habit\n${newYaml}\`\`\`\n`;
}

export function getCropGrowthDays(cropConfig: any): number {
  return cropConfig.growthDays ?? 4;
}

export function getCropStageIndex(wateredDays: number, daysInPhase: number[]): number {
  let accumulated = 0;
  for (let i = 0; i < daysInPhase.length; i++) {
    if (wateredDays < accumulated + daysInPhase[i]) {
      return i;
    }
    accumulated += daysInPhase[i];
  }
  return daysInPhase.length;
}

// 双向对账同步逻辑
export async function syncAndLoadHabitFile(
  app: any,
  file: TFile,
  dailyNotesData: Array<{ dateStr: string; isDone: boolean }>,
  dateFormat: string,
  selectedDateStr: string
): Promise<HabitFileData> {
  let fileContent = await app.vault.read(file);
  let { metadata, tasks } = parseHabitFile(fileContent, dateFormat);
  let changed = false;

  for (const note of dailyNotesData) {
    const taskIndex = tasks.findIndex(t => t.dateStr === note.dateStr);

    if (note.isDone) {
      if (taskIndex === -1) {
        const originalLink = window.moment(note.dateStr, 'YYYY-MM-DD').format(dateFormat);
        tasks.unshift({
          isDone: true,
          dateStr: note.dateStr,
          originalLink,
          timeStr: window.moment().format('HH:mm:ss'),
          note: '自动同步'
        });
        changed = true;
      } else if (!tasks[taskIndex].isDone) {
        tasks[taskIndex].isDone = true;
        tasks[taskIndex].timeStr = window.moment().format('HH:mm:ss');
        if (!tasks[taskIndex].note) {
          tasks[taskIndex].note = '自动同步';
        }
        changed = true;
      }
    } else {
      if (taskIndex >= 0 && tasks[taskIndex].isDone) {
        tasks[taskIndex].isDone = false;
        delete tasks[taskIndex].timeStr;
        changed = true;
      }
    }
  }

  if (metadata.current_crop) {
    const cropConfig = getCropConfigs().find(c => c.id === metadata.current_crop.id);
    const totalDays = cropConfig ? getCropGrowthDays(cropConfig) : 4;

    const cropStart = metadata.current_crop.start_date;
    const oldWateredDays = metadata.current_crop.watered_days;

    const newWateredDays = tasks.filter(
      t => t.isDone && t.dateStr >= cropStart
    ).length;

    if (newWateredDays !== oldWateredDays) {
      metadata.current_crop.watered_days = newWateredDays;
      changed = true;
    }

    const validDoneTasks = tasks
      .filter(t => t.isDone && t.dateStr >= cropStart)
      .sort((a, b) => b.dateStr.localeCompare(a.dateStr));
    const newLastWateredDate = validDoneTasks.length > 0 ? validDoneTasks[0].dateStr : null;

    if (metadata.current_crop.last_watered_date !== newLastWateredDate) {
      metadata.current_crop.last_watered_date = newLastWateredDate;
      changed = true;
    }

    // 枯萎判定：若 selectedDateStr (或今天) - last_watered_date (或 start_date) >= WITHER_DAYS_THRESHOLD 天且作物正在生长期
    if (metadata.current_crop.status !== 'withered' && metadata.current_crop.watered_days < totalDays) {
      const lastWateredOrStart = metadata.current_crop.last_watered_date || metadata.current_crop.start_date;
      if (lastWateredOrStart) {
        const daysDiff = window.moment(selectedDateStr, 'YYYY-MM-DD').diff(window.moment(lastWateredOrStart, 'YYYY-MM-DD'), 'days');
        if (daysDiff >= WITHER_DAYS_THRESHOLD) {
          metadata.current_crop.status = 'withered';
          changed = true;
        }
      }
    }
  }

  if (changed) {
    fileContent = stringifyHabitFile(file.basename, fileContent, metadata, tasks);
    await app.vault.modify(file, fileContent);
  }

  return { metadata, tasks };
}

// 种植作物
export async function plantCrop(
  app: any,
  file: TFile,
  cropId: string,
  dateStr: string,
  dateFormat: string
) {
  await app.vault.process(file, (content: string) => {
    let { metadata, tasks } = parseHabitFile(content, dateFormat);
    metadata.current_crop = {
      id: cropId,
      start_date: dateStr,
      watered_days: 0,
      last_watered_date: null
    };
    return stringifyHabitFile(file.basename, content, metadata, tasks);
  });
}

// 收获作物
export async function harvestCrop(
  app: any,
  file: TFile,
  dateStr: string,
  dateFormat: string
) {
  await app.vault.process(file, (content: string) => {
    let { metadata, tasks } = parseHabitFile(content, dateFormat);
    if (metadata.current_crop) {
      metadata.crop_history = metadata.crop_history || [];
      metadata.crop_history.push({
        id: metadata.current_crop.id,
        start_date: metadata.current_crop.start_date,
        end_date: dateStr,
        status: 'harvested',
        watered_days: metadata.current_crop.watered_days
      });
      metadata.current_crop = null;
    }
    return stringifyHabitFile(file.basename, content, metadata, tasks);
  });
}

// 清理枯萎作物
export async function clearWitheredCrop(
  app: any,
  file: TFile,
  dateStr: string,
  dateFormat: string
) {
  await app.vault.process(file, (content: string) => {
    let { metadata, tasks } = parseHabitFile(content, dateFormat);
    if (metadata.current_crop) {
      metadata.crop_history = metadata.crop_history || [];
      metadata.crop_history.push({
        id: metadata.current_crop.id,
        start_date: metadata.current_crop.start_date,
        end_date: dateStr,
        status: 'withered',
        watered_days: metadata.current_crop.watered_days
      });
      metadata.current_crop = null;
    }
    return stringifyHabitFile(file.basename, content, metadata, tasks);
  });
}

// 直接打卡更新单文件数据
export async function updateHabitFileRecord(
  app: any,
  file: TFile,
  dateStr: string,
  isDone: boolean,
  dateFormat: string,
  note?: string
) {
  await app.vault.process(file, (content: string) => {
    let { metadata, tasks } = parseHabitFile(content, dateFormat);
    const taskIndex = tasks.findIndex(t => t.dateStr === dateStr);

    if (isDone) {
      if (taskIndex === -1) {
        const originalLink = window.moment(dateStr, 'YYYY-MM-DD').format(dateFormat);
        tasks.unshift({
          isDone: true,
          dateStr,
          originalLink,
          timeStr: window.moment().format('HH:mm:ss'),
          note: note || '看板打卡'
        });
      } else {
        tasks[taskIndex].isDone = true;
        tasks[taskIndex].timeStr = window.moment().format('HH:mm:ss');
        if (note) tasks[taskIndex].note = note;
      }
    } else {
      if (taskIndex >= 0) {
        tasks[taskIndex].isDone = false;
        delete tasks[taskIndex].timeStr;
      }
    }

    if (metadata.current_crop) {
      const cropConfig = getCropConfigs().find(c => c.id === metadata.current_crop.id);
      const totalDays = cropConfig ? getCropGrowthDays(cropConfig) : 4;

      const cropStart = metadata.current_crop.start_date;
      metadata.current_crop.watered_days = tasks.filter(
        t => t.isDone && t.dateStr >= cropStart
      ).length;

      const validDoneTasks = tasks
        .filter(t => t.isDone && t.dateStr >= cropStart)
        .sort((a, b) => b.dateStr.localeCompare(a.dateStr));
      metadata.current_crop.last_watered_date = validDoneTasks.length > 0 ? validDoneTasks[0].dateStr : null;

      // 枯萎判定
      if (metadata.current_crop.status !== 'withered' && metadata.current_crop.watered_days < totalDays) {
        const lastWateredOrStart = metadata.current_crop.last_watered_date || metadata.current_crop.start_date;
        if (lastWateredOrStart) {
          const daysDiff = window.moment().diff(window.moment(lastWateredOrStart, 'YYYY-MM-DD'), 'days');
          if (daysDiff >= WITHER_DAYS_THRESHOLD) {
            metadata.current_crop.status = 'withered';
          }
        }
      }
    }

    return stringifyHabitFile(file.basename, content, metadata, tasks);
  });
}
