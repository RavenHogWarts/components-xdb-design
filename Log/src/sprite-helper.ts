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
