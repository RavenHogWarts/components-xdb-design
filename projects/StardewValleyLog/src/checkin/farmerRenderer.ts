// farmerRenderer.ts —— 农夫 Canvas 合成（checkin-design.md §3.2 的实现）
// 1.6 反编译源码 FarmerRenderer 的浏览器移植：
//   换色：底图左上调色板标记色（袖 256-258 / 肤 260-262 / 鞋 268-271 / 眼 276-277），
//     按"原色全等匹配"逐像素替换（等价 _GeneratePixelIndices 的像素集合）。
//     应用顺序（后写覆盖）= 眼 → 肤 → 鞋 → 袖，与 executeRecolorActions 一致。
//   合成（16×32 原生分辨率，站立帧，帧偏移 featureX/YOffsetPerFrame[0/6/12]）：
//     底图(换色) → 裤子(×裤色乘法) → 上衣基础层 + 染色层(×衣色) → 配件(0-7 发下层，
//     胡子 6/7 ×发色) → 头发(×发色，男女 y 微调 ±1px)；背面不画配件；左 = 右向水平翻转。
// 坐标换算：游戏位置偏移为 4× 屏幕像素，本管线统一除以 4 回到贴图分辨率。

import FARMER_BASE from '../assets/sprites/farmer_base.png';
import FARMER_GIRL_BASE from '../assets/sprites/farmer_girl_base.png';
import HAIRSTYLES_PNG from '../assets/sprites/hairstyles.png';
import HAIRSTYLES2_PNG from '../assets/sprites/hairstyles2.png';
import SHIRTS_PNG from '../assets/sprites/shirts.png';
import PANTS_PNG from '../assets/sprites/pants.png';
import ACCESSORIES_PNG from '../assets/sprites/accessories.png';
import SKIN_COLORS_PNG from '../assets/sprites/skinColors.png';
import SHOE_COLORS_PNG from '../assets/sprites/shoeColors.png';
import FARMER_INDEX from '../assets/data/farmer-index.json';

export interface PlayerLook {
  gender: 'male' | 'female';
  skin: number;
  hair: number;
  hairColor: string;
  eyeColor: string;
  accessory: number;
  shirt: string;
  /** 袖子颜色 = 上衣染色（GetShirtColor，染染色层 + 有袖袖子）；空串回退 DefaultColor/白 */
  shirtColor: string;
  pants: string;
  pantsColor: string;
}

interface FarmerIndex {
  hairBase: number;
  hairExtra: { id: number; tx: number; ty: number; left: boolean }[];
  shirts: { id: string; i: number; sleeves: boolean; dc: number[] | null }[];
  pants: { id: string; i: number; dc: number[] | null }[];
}
const IDX = FARMER_INDEX as FarmerIndex;

export type FarmerDirection = 'down' | 'right' | 'up' | 'left';

type RGB = [number, number, number];
const hexToRgb = (hex: string): RGB => {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};
const mulColor = (c: RGB, t: RGB): RGB => [
  Math.round((c[0] * t[0]) / 255),
  Math.round((c[1] * t[1]) / 255),
  Math.round((c[2] * t[2]) / 255),
];
/** FarmerRenderer.changeBrightness(c, -75)：B 通道专属系数（负向 ×8/7，C# 截断除法） */
function darkenEye(c: RGB): RGB {
  return [Math.max(0, c[0] - 75), Math.max(0, c[1] - 75), Math.max(0, c[2] - Math.trunc((75 * 8) / 7))];
}

// ── 图片解码缓存 ──

const imgCache = new Map<string, Promise<HTMLImageElement>>();
function loadImage(src: string): Promise<HTMLImageElement> {
  let p = imgCache.get(src);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('贴图加载失败'));
      img.src = src;
    });
    imgCache.set(src, p);
  }
  return p;
}

const pixelCache = new Map<string, ImageData>();
async function pixels(src: string): Promise<ImageData> {
  let d = pixelCache.get(src);
  if (!d) {
    const img = await loadImage(src);
    const cv = document.createElement('canvas');
    cv.width = img.naturalWidth;
    cv.height = img.naturalHeight;
    const ctx = cv.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    d = ctx.getImageData(0, 0, cv.width, cv.height);
    pixelCache.set(src, d);
  }
  return d;
}

const px = (d: ImageData, i: number): RGB => [d.data[i * 4], d.data[i * 4 + 1], d.data[i * 4 + 2]];

// ── 换色：调色板标记色替换（整张贴图）──

function recolorBase(
  base: ImageData,
  look: PlayerLook,
  skinColors: ImageData,
  shoeColors: ImageData,
  shirts: ImageData
): ImageData {
  const out = new ImageData(new Uint8ClampedArray(base.data), base.width, base.height);
  const swaps = new Map<number, RGB>(); // packed 原色 → 新色（后写覆盖 = 应用顺序）

  const put = (flatIndex: number, rgb: RGB) => {
    const o = px(base, flatIndex);
    swaps.set((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | base.data[flatIndex * 4 + 3], rgb);
  };

  // 眼（276 亮 / 277 暗）
  const eye = hexToRgb(look.eyeColor);
  let eyeDark = darkenEye(eye);
  if (eyeDark[0] === eye[0] && eyeDark[1] === eye[1] && eyeDark[2] === eye[2]) {
    eyeDark = [eye[0], eye[1], Math.min(255, eye[2] + 10)];
  }
  put(276, eye);
  put(277, eyeDark);

  // 肤（260 暗 / 261 中 / 262 亮；skinColors 每行 3 阶）
  const skinRow = Math.min(Math.max(look.skin, 0), skinColors.height - 1) * 3;
  const skin: RGB[] = [px(skinColors, skinRow), px(skinColors, skinRow + 1), px(skinColors, skinRow + 2)];
  put(260, skin[0]);
  put(261, skin[1]);
  put(262, skin[2]);

  // 鞋（268-271；创建界面无鞋选项，固定默认行 12）
  const shoeRow = 12 * 4;
  put(268, px(shoeColors, shoeRow));
  put(269, px(shoeColors, shoeRow + 1));
  put(270, px(shoeColors, shoeRow + 2));
  put(271, px(shoeColors, shoeRow + 3));

  // 袖（256-258）：有袖上衣从 shirts 染色层采样 ×衣色（GetShirtColor）；无袖用肤色
  const shirt = IDX.shirts.find((s) => s.id === look.shirt);
  if (shirt && shirt.sleeves) {
    const W = shirts.width;
    const index = Math.trunc((shirt.i * 8) / 128) * 32 * W + ((shirt.i * 8) % 128) + W * 4;
    const dyeIndex = index + 128;
    const t: RGB = look.shirtColor ? hexToRgb(look.shirtColor) : (shirt.dc as RGB) ?? [255, 255, 255];
    for (let k = 0; k < 3; k++) {
      let swatch = px(shirts, dyeIndex - k * W);
      let tint: RGB = t;
      if (shirts.data[(dyeIndex - k * W) * 4 + 3] < 255) {
        swatch = px(shirts, index - k * W);
        tint = [255, 255, 255];
      }
      put(256 + k, mulColor(swatch, tint));
    }
  } else {
    put(256, skin[0]);
    put(257, skin[1]);
    put(258, skin[2]);
  }

  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    const key = (d[i] << 24) | (d[i + 1] << 16) | (d[i + 2] << 8) | d[i + 3];
    const rep = swaps.get(key);
    if (rep) {
      d[i] = rep[0];
      d[i + 1] = rep[1];
      d[i + 2] = rep[2];
    }
  }
  return out;
}

// ── 合成 ──

interface DirSpec {
  baseRow: number; // 底图/裤子行
  shirtRow: number; // 上衣方向行（前0/右8/左16/上24）
  shirtY: number; // 14 + featureYOffsetPerFrame（down/right=1，up=0）
  accRow: number | null; // 配件方向行（前0/侧16；背面 null = 不画）
  accY: number; // 配件 y = 1 + featureYOffsetPerFrame（down/right 均 2）
  hairRow: number; // 发型方向行（下0/右32/上64）
  hairY: number; // down 2，right/up 1（男女 ±1 微调在合成时加）
}

const DIR_SPECS: Record<'down' | 'right' | 'up', DirSpec> = {
  down: { baseRow: 0, shirtRow: 0, shirtY: 15, accRow: 0, accY: 2, hairRow: 0, hairY: 2 },
  right: { baseRow: 32, shirtRow: 8, shirtY: 15, accRow: 16, accY: 2, hairRow: 32, hairY: 1 },
  up: { baseRow: 64, shirtRow: 24, shirtY: 14, accRow: null, accY: 0, hairRow: 64, hairY: 1 },
};

/** 区域取像素并乘法染色（保留 alpha） */
function tintedRegion(sheet: ImageData, x: number, y: number, w: number, h: number, tint: RGB): ImageData | null {
  if (x < 0 || y < 0 || x + w > sheet.width || y + h > sheet.height) return null;
  const out = new ImageData(w, h);
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      const si = ((y + yy) * sheet.width + (x + xx)) * 4;
      const di = (yy * w + xx) * 4;
      out.data[di] = Math.round((sheet.data[si] * tint[0]) / 255);
      out.data[di + 1] = Math.round((sheet.data[si + 1] * tint[1]) / 255);
      out.data[di + 2] = Math.round((sheet.data[si + 2] * tint[2]) / 255);
      out.data[di + 3] = sheet.data[si + 3];
    }
  }
  return out;
}

const tempCanvas = () => document.createElement('canvas');
function paste(ctx: CanvasRenderingContext2D, data: ImageData, dx: number, dy: number) {
  const cv = tempCanvas();
  cv.width = data.width;
  cv.height = data.height;
  cv.getContext('2d')!.putImageData(data, 0, 0);
  ctx.drawImage(cv, dx, dy);
}

const urlCache = new Map<string, string>();

/** 合成完整农夫（16×32 ×4 → 64×128 dataURL）；结果按 look+方向缓存 */
export async function composeFarmer(look: PlayerLook, direction: FarmerDirection): Promise<string> {
  const cacheKey = JSON.stringify(look) + '|' + direction;
  const hit = urlCache.get(cacheKey);
  if (hit) return hit;

  const female = look.gender === 'female';
  const base = await pixels(female ? FARMER_GIRL_BASE : FARMER_BASE);
  const skinColors = await pixels(SKIN_COLORS_PNG);
  const shoeColors = await pixels(SHOE_COLORS_PNG);
  const shirtsSheet = await pixels(SHIRTS_PNG);
  const pantsSheet = await pixels(PANTS_PNG);
  const accSheet = await pixels(ACCESSORIES_PNG);

  const spec = DIR_SPECS[direction === 'left' ? 'right' : direction];
  const recolored = recolorBase(base, look, skinColors, shoeColors, shirtsSheet);

  const cv = tempCanvas();
  cv.width = 16;
  cv.height = 32;
  const ctx = cv.getContext('2d')!;

  // 1) 底图（换色后）
  paste(ctx, tintedRegion(recolored, 0, spec.baseRow, 16, 32, [255, 255, 255])!, 0, 0);

  // 2) 裤子（帧同底图位置，×裤色乘法；女版 X+96）
  const pants = IDX.pants.find((p) => p.id === look.pants) ?? IDX.pants[0];
  const pantsX = (pants.i % 10) * 192 + (female ? 96 : 0);
  const pantsY = Math.trunc(pants.i / 10) * 688 + spec.baseRow;
  const pantsTint = hexToRgb(look.pantsColor);
  const pantsCell = tintedRegion(pantsSheet, pantsX, pantsY, 16, 32, pantsTint);
  if (pantsCell) paste(ctx, pantsCell, 0, 0);

  // 3) 上衣：基础层（白色）+ 染色层（× 袖子颜色/DefaultColor），8×8 @ (4, shirtY)
  const shirt = IDX.shirts.find((s) => s.id === look.shirt) ?? IDX.shirts[0];
  const shirtX = (shirt.i * 8) % 128;
  const shirtYBase = Math.trunc((shirt.i * 8) / 128) * 32;
  const shirtTint: RGB = look.shirtColor
    ? hexToRgb(look.shirtColor)
    : (shirt.dc as RGB) ?? [255, 255, 255];
  const shirtBase = tintedRegion(shirtsSheet, shirtX, shirtYBase + spec.shirtRow, 8, 8, [255, 255, 255]);
  if (shirtBase) paste(ctx, shirtBase, 4, spec.shirtY);
  const shirtDye = tintedRegion(shirtsSheet, shirtX + 128, shirtYBase + spec.shirtRow, 8, 8, shirtTint);
  if (shirtDye) paste(ctx, shirtDye, 4, spec.shirtY);

  // 4) 配件（背面不画；胡子 6/7 ×发色，其余白色）
  if (look.accessory >= 0 && spec.accRow !== null) {
    const acc = look.accessory;
    const accX = (acc * 16) % 128;
    const accY = Math.trunc((acc * 16) / 128) * 32 + spec.accRow;
    const facial = acc === 6 || acc === 7;
    const accCell = tintedRegion(
      accSheet,
      accX,
      accY,
      16,
      16,
      facial ? hexToRgb(look.hairColor) : [255, 255, 255]
    );
    if (accCell) paste(ctx, accCell, 0, spec.accY);
  }

  // 5) 头发（×发色；男女 y 微调：男&发型≥16 →-1，女&发型<16 →+1）
  const hairTint = hexToRgb(look.hairColor);
  let hairX: number, hairYStrip: number, hairSrc: ImageData;
  const extra = IDX.hairExtra.find((h) => h.id === look.hair);
  if (extra) {
    hairSrc = await pixels(HAIRSTYLES2_PNG);
    hairX = extra.tx * 16;
    hairYStrip = extra.ty * 16;
  } else {
    hairSrc = await pixels(HAIRSTYLES_PNG);
    const id = look.hair % IDX.hairBase;
    hairX = (id * 16) % 128;
    hairYStrip = Math.trunc((id * 16) / 128) * 96;
  }
  const genderAdj = (female && look.hair < 16 ? 1 : 0) + (!female && look.hair >= 16 ? -1 : 0);
  const hairCell = tintedRegion(hairSrc, hairX, hairYStrip + spec.hairRow, 16, 32, hairTint);
  if (hairCell) paste(ctx, hairCell, 0, spec.hairY + genderAdj);

  // 6) 手臂层：底图第 6 列（x+96 = 帧 x + armOffset*16，AnimationFrame 默认
  //    armOffset=6；上段袖标记色 256-258、下段手 = 肤标记色），最后画——侧面时手在头发之上
  const armCell = tintedRegion(recolored, 96, spec.baseRow, 16, 32, [255, 255, 255]);
  if (armCell) paste(ctx, armCell, 0, 0);

  // 7) 输出 ×4（左向 = 右向镜像）
  const out = tempCanvas();
  out.width = 64;
  out.height = 128;
  const octx = out.getContext('2d')!;
  octx.imageSmoothingEnabled = false;
  if (direction === 'left') {
    octx.translate(64, 0);
    octx.scale(-1, 1);
  }
  octx.drawImage(cv, 0, 0, 64, 128);
  const url = out.toDataURL();
  urlCache.set(cacheKey, url);
  return url;
}

/** 玩家栏化身（正面 4×） */
export function composeAvatar(look: PlayerLook): Promise<string> {
  return composeFarmer(look, 'down');
}

/** 肤色色板（skinColors 每行 3 阶 → hex；结果缓存），供向导色块显示 */
export async function skinSwatches(): Promise<string[][]> {
  const d = await pixels(SKIN_COLORS_PNG);
  const out: string[][] = [];
  for (let r = 0; r < d.height; r++) {
    out.push(
      [0, 1, 2].map((k) => {
        const i = (r * 3 + k) * 4;
        return (
          '#' +
          [d.data[i], d.data[i + 1], d.data[i + 2]]
            .map((c) => c.toString(16).padStart(2, '0'))
            .join('')
        );
      })
    );
  }
  return out;
}
