import { App } from 'obsidian';

export interface CropStage {
  col: number;
  row: number;
  width?: number;  // 贴图宽度，默认 16px
  height?: number; // 贴图高度，默认 16px；双高成熟态写 32
}

export interface CropConfig {
  id: string;   // 种子物品 ID（对应 Crops.json 的键）
  name: string; // 作物中文名
  stages: CropStage[];
}

export class SpriteSheet {
  private readonly app: App;
  private readonly vaultPath: string;
  private readonly imgWidth: number;
  private readonly imgHeight: number;
  private readonly spriteWidth: number;
  private readonly spriteHeight: number;
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
    if (this.cachedUrl) return this.cachedUrl;
    const normalizedPath = normalizePath(this.vaultPath);
    const file = this.app.vault.getAbstractFileByPath(normalizedPath);
    if (file) {
      this.cachedUrl = this.app.vault.getResourcePath(file as any);
      return this.cachedUrl;
    }
    console.warn(`[Stardew Habit] 素材文件未找到: ${normalizedPath}`);
    return '';
  }

  /**
   * 计算精灵切片的内联 CSS 样式对象。
   *
   * @param col          横向格子序号（0-based，每格 spriteWidth px）
   * @param row          纵向格子序号（0-based，每格 spriteHeight px）
   * @param scale        渲染缩放倍率，默认 3×
   * @param customWidth  覆盖单格宽度（px）
   * @param customHeight 覆盖单格高度（px），双行成熟态传 32
   */
  public getStyleObject(
    col: number,
    row: number,
    scale: number = 3,
    customWidth?: number,
    customHeight?: number
  ): Record<string, string> {
    const url    = this.getUrl();
    const sWidth  = customWidth  ?? this.spriteWidth;
    const sHeight = customHeight ?? this.spriteHeight;

    const width  = sWidth  * scale;
    const height = sHeight * scale;
    const sizeX  = this.imgWidth  * scale;
    const sizeY  = this.imgHeight * scale;

    // 偏移量始终基于基础 16px 网格计算，与 customHeight 无关
    const posX = -(col * this.spriteWidth  * scale);
    const posY = -(row * this.spriteHeight * scale);

    return {
      'display':             'inline-block',
      'width':               `${width}px`,
      'height':              `${height}px`,
      'background-image':    `url("${url}")`,
      'background-repeat':   'no-repeat',
      'background-size':     `${sizeX}px ${sizeY}px`,
      'background-position': `${posX}px ${posY}px`,
      'image-rendering':     'pixelated',
    };
  }

  public getStyleText(
    col: number,
    row: number,
    scale: number = 3,
    customWidth?: number,
    customHeight?: number
  ): string {
    return Object.entries(this.getStyleObject(col, row, scale, customWidth, customHeight))
      .map(([k, v]) => `${k}: ${v};`)
      .join(' ');
  }
}

/**
 * 路径清洗：确保符合 Obsidian 库内相对路径规范（无前导斜杠、无 "./"）。
 */
export function normalizePath(path: string): string {
  let p = path.trim().replace(/\\/g, '/');
  if (p.startsWith('./')) p = p.slice(2);
  while (p.startsWith('/'))  p = p.slice(1);
  while (p.endsWith('/'))    p = p.slice(0, -1);
  return p.replace(/\/+/g, '/');
}

// ─────────────────────────────────────────────────────────────
// 素材包规格 —— view.ts / settings.ts 共用的唯一真源
// 说明：Crops.json 在构建时由 esbuild 内联进 bundle，运行时不在素材包目录中。
// ─────────────────────────────────────────────────────────────

export interface AssetSpec {
  /** 文件名（相对于素材包目录） */
  filename: string;
  /** 整张 PNG 的像素宽 */
  imgWidth: number;
  /** 整张 PNG 的像素高 */
  imgHeight: number;
  /** 单个精灵的网格宽 */
  spriteWidth: number;
  /** 单个精灵的网格高 */
  spriteHeight: number;
  /** 人类可读说明 */
  description: string;
}

/**
 * 素材包必须包含的文件清单。
 * 这是 view.ts 与 settings.ts 共用的唯一真源，避免尺寸/文件名重复定义。
 */
export const ASSET_SPECS: AssetSpec[] = [
  {
    filename: 'crops.png',
    imgWidth: 256, imgHeight: 1024,
    spriteWidth: 16, spriteHeight: 16,
    description: '作物精灵图（两大列布局）：左半 cols 0–7 承载偶数 SpriteIndex，右半 cols 8–15 承载奇数；每株占 2 行（32px）以支持双高成熟态。坐标公式见 crop-loader.ts。',
  },
  {
    filename: 'houses.png',
    imgWidth: 272, imgHeight: 432,
    spriteWidth: 160, spriteHeight: 144,
    description: '农舍精灵图。3 个等级（草棚 / 木屋 / 双层木屋）纵向排列。',
  },
  {
    filename: 'hoeDirt.png',
    imgWidth: 192, imgHeight: 64,
    spriteWidth: 64, spriteHeight: 64,
    description: '耕地泥土。col 0 = 干土，col 1 = 湿土。',
  },
];

/** 用户未配置时使用的默认素材包目录（vault 内相对路径） */
export const DEFAULT_ASSETS_PATH = 'Log/stardew-habit';

/**
 * 解析素材包目录：**以用户设置为准**，仅在为空时回退到默认值。
 * 返回已规范化的 vault 相对路径。
 */
export function resolveAssetsPath(options: Record<string, any> | undefined): string {
  const raw = (options?.assetsPath as string | undefined)?.trim();
  return raw ? normalizePath(raw) : DEFAULT_ASSETS_PATH;
}

/**
 * 逐个检查素材包目录下 ASSET_SPECS 列出的文件是否存在。
 * @param app  Obsidian App 实例；为 null/undefined 时（如设置面板拿不到 app）返回 null，表示「无法校验」。
 * @returns 文件名 → 是否存在的映射；或 null 表示无法校验。
 */
export function checkAssetFiles(
  app: App | null | undefined,
  assetsPath: string
): Record<string, boolean> | null {
  if (!app) return null;
  const result: Record<string, boolean> = {};
  for (const spec of ASSET_SPECS) {
    const full = normalizePath(`${assetsPath}/${spec.filename}`);
    result[spec.filename] = !!app.vault.getAbstractFileByPath(full);
  }
  return result;
}
