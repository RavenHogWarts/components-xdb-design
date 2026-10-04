/** @jsxImportSource react */
import { type CSSProperties } from 'react';
import { CSS_PREFIX } from '../types';
import { SheetRef, SheetSpec, SpriteRect } from '../sprite/types';

export interface SpriteCellProps {
  /** 所属贴图（条目级 source 省略时必填） */
  spec?: SheetSpec;
  rect: SpriteRect;
  /** 放大倍率（16px 原始网格的整数倍最清晰） */
  scale?: number;
  className?: string;
  /** 独立图像（构建期合成图等）；提供时忽略 spec.png + rect 偏移 */
  src?: string;
  /** 条目实际切片的贴图（物种页签内多文件）；省略时用 spec.png */
  source?: SheetRef;
}

/**
 * 精灵切片：background-image(dataURL) + 负偏移 background-position，
 * image-rendering: pixelated 保证整数倍缩放清晰。
 */
export function SpriteCell({ spec, rect, scale = 2, className, src, source }: SpriteCellProps) {
  const png = source?.png ?? spec?.png ?? '';
  const imgW = source?.imgW ?? spec?.imgW ?? rect.w;
  const imgH = source?.imgH ?? spec?.imgH ?? rect.h;
  const style: CSSProperties = src
    ? {
        backgroundImage: `url(${src})`,
        backgroundSize: `${rect.w * scale}px ${rect.h * scale}px`,
        width: rect.w * scale,
        height: rect.h * scale,
        imageRendering: 'pixelated',
      }
    : {
        backgroundImage: `url(${png})`,
        backgroundSize: `${imgW * scale}px ${imgH * scale}px`,
        backgroundPosition: `-${rect.x * scale}px -${rect.y * scale}px`,
        width: rect.w * scale,
        height: rect.h * scale,
        imageRendering: 'pixelated',
      };
  return <span className={`${CSS_PREFIX}sprite ${className ?? ''}`} style={style} />;
}
