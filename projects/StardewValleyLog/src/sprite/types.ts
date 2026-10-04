// ─────────────────────────────────────────────────────────────
// 图鉴数据模型：每张贴图声明一个 SheetSpec，运行时派生 SpriteEntry 列表。
// 坐标一律是贴图原始像素（16px 网格事实见 docs/assets-and-parsing.md）。
// ─────────────────────────────────────────────────────────────

export type SheetId =
  | 'crops'
  | 'fruitTrees'
  | 'objects'
  | 'tools'
  | 'weapons'
  | 'craftables'
  | 'nature'
  | 'buildings'
  | 'farmer';

/** 贴图上的一个切片矩形（原始像素） */
export interface SpriteRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 胶片条的一格：rect 指向所属贴图；src 存在时为独立合成图（如着色花冠） */
export interface StripCell {
  rect: SpriteRect;
  src?: string;
  /** 该格实际切片的贴图；省略时用所属 SheetSpec 的 png/imgW/imgH */
  source?: SheetRef;
  /** 格子说明（建筑组成区块等），渲染为悬停提示 */
  label?: string;
}

/** 一个条目实际引用的贴图（物种页签内聚合多张文件时，条目各指向自己的文件） */
export interface SheetRef {
  /** import 得到的 dataURL */
  png: string;
  imgW: number;
  imgH: number;
}

/** 图鉴的一个条目（卡片） */
export interface SpriteEntry {
  /** 唯一键，也是后续"解锁进度"的持久化键 */
  key: string;
  /** 中文名（官方译名，缺失时占位） */
  name: string;
  /** 副文本：季节 / 分类 / 描述等 */
  sub?: string;
  /** 分组小标题（物品页按分类分组），不分组则省略 */
  group?: string;
  sheet: SheetId;
  /** 卡面主切片 */
  rect: SpriteRect;
  /** 卡面为独立合成图（如完整的花）时提供，优先于 sheet+rect 切片 */
  src?: string;
  /** 卡面实际切片的贴图；省略时用所属 SheetSpec 的 png/imgW/imgH */
  source?: SheetRef;
  /** 卡面缩放倍率（默认 2；建筑等大图用 1） */
  scale?: number;
  /** 卡内胶片条：全部生长阶段 / 形态 / 帧 */
  strip?: StripCell[];
}

/** 一张贴图的解析声明（子分类标签的数据源） */
export interface SheetSpec {
  id: SheetId;
  /** 子分类标签名 */
  label: string;
  /** 所属大类 = Content (unpacked) 中的文件夹名（TileSheets/Maps/TerrainFeatures/Buildings） */
  category: string;
  /** import 得到的 dataURL */
  png: string;
  imgW: number;
  imgH: number;
  /** 条目派生（模块级缓存，多次调用无额外开销） */
  entries: () => SpriteEntry[];
}
