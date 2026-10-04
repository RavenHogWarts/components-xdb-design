// tools.ts —— tools.png（336×384，21 列 16px 网格）解析
// SpriteIndex / MenuSpriteIndex 均为 16×16 图标索引（连通域验证）：
// 优先 MenuSpriteIndex；为 -1（无独立菜单图标）时回退 SpriteIndex。
// 命名链：Tools.json.DisplayName 占位符 → Tools.zh-CN.json[Key]（官方中文）。

import { SheetSpec, SpriteEntry } from './types';
import TOOLS_RAW from '../assets/data/Tools.json';
import TOOLS_ZH from '../assets/data/Tools.zh-CN.json';
import TOOLS_PNG from '../assets/sprites/tools.png';

interface ToolEntry {
  DisplayName?: string;
  Description?: string;
  Texture?: string;
  SpriteIndex?: number;
  MenuSpriteIndex?: number;
}

/** 21 列网格列数（336 / 16） */
const COLS = 21;

const PLACEHOLDER = /\[LocalizedText Strings\\+Tools:(.+?)\]/;

let _entries: SpriteEntry[] | null = null;

function deriveEntries(): SpriteEntry[] {
  if (_entries) return _entries;
  const zh = TOOLS_ZH as Record<string, string>;
  const result: SpriteEntry[] = [];

  for (const [id, tool] of Object.entries(TOOLS_RAW as Record<string, ToolEntry>)) {
    // 仅处理 tools.png 贴图的工具
    if (tool.Texture && !tool.Texture.toLowerCase().includes('tools')) continue;
    const m = PLACEHOLDER.exec(tool.DisplayName ?? '');
    const key = m ? m[1] : `${id}_Name`;
    const name = zh[key] ?? `工具 ${id}`;
    const descKey = key.replace(/_Name$/, '_Description');
    const desc = zh[descKey];

    const menuIdx = tool.MenuSpriteIndex ?? -1;
    const idx = menuIdx >= 0 ? menuIdx : (tool.SpriteIndex ?? 0);
    result.push({
      key: `tool-${id}`,
      name,
      sub: desc,
      sheet: 'tools',
      rect: {
        x: (idx % COLS) * 16,
        y: Math.floor(idx / COLS) * 16,
        w: 16,
        h: 16,
      },
    });
  }
  result.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
  _entries = result;
  return result;
}

export const toolsSheet: SheetSpec = {
  id: 'tools',
  label: '工具',
  category: 'TileSheets',
  png: TOOLS_PNG,
  imgW: 336,
  imgH: 384,
  entries: deriveEntries,
};
