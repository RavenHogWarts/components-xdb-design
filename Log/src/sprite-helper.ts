import { App } from 'obsidian';

export class SpriteSheet {
  private app: App;
  private vaultPath: string;
  private imgWidth: number;
  private imgHeight: number;
  private spriteWidth: number;
  private spriteHeight: number;
  private cachedUrl: string | null = null;

  /**
   * @param app Obsidian App 实例
   * @param vaultPath 素材在 Vault 中的相对路径 (例如 'Log/assets/Content (unpacked)/TileSheets/crops.png')
   * @param imgWidth 整个精灵图大图的原始宽度 (px)
   * @param imgHeight 整个精灵图大图的原始高度 (px)
   * @param spriteWidth 单个切图的原始宽度 (px)
   * @param spriteHeight 单个切图的原始高度 (px)
   */
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

  /**
   * 获取可在浏览器中直接渲染的资源 URL
   */
  public getUrl(): string {
    if (this.cachedUrl) {
      return this.cachedUrl;
    }

    // 尝试直接按路径获取
    let file = this.app.vault.getAbstractFileByPath(this.vaultPath);
    
    // 兼容可能的前导斜杠
    if (!file && this.vaultPath.startsWith('/')) {
      file = this.app.vault.getAbstractFileByPath(this.vaultPath.slice(1));
    }
    
    if (file) {
      this.cachedUrl = this.app.vault.adapter.getResourcePath(file);
      return this.cachedUrl;
    }

    console.warn(`[Stardew Habit] 素材文件未找到: ${this.vaultPath}`);
    // 返回占位符，避免崩溃
    return '';
  }

  /**
   * 获取用于背景图裁剪的内联 CSS 属性键值对对象
   * @param col 列索引 (从 0 开始)
   * @param row 行索引 (从 0 开始)
   * @param scale 缩放倍数
   */
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

  /**
   * 生成直接可用于 DOM element.style.cssText 的字符串
   */
  public getStyleText(col: number, row: number, scale: number = 3): string {
    const obj = this.getStyleObject(col, row, scale);
    return Object.entries(obj)
      .map(([k, v]) => `${k}: ${v};`)
      .join(' ');
  }
}

// 常用作物精灵图行列映射定义
export const CROP_DEFINITIONS = [
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
