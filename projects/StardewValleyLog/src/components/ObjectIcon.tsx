/** @jsxImportSource react */
import { SpriteCell } from './SpriteCell';
import FARMER_INDEX from '../assets/data/farmer-index.json';
import SPRINGOBJECTS from '../assets/sprites/springobjects.png';
import OBJECTS_2 from '../assets/sprites/Objects_2.png';

/** Objects.json 物品图标：springobjects 24 列 / Objects_2 8 列，16×16 格 */
export function ObjectIcon({
  i,
  sheet = 'so',
  scale = 2,
  className,
}: {
  i: number;
  sheet?: 'so' | 'o2';
  scale?: number;
  className?: string;
}) {
  const isO2 = sheet === 'o2';
  const cols = isO2 ? 8 : 24;
  const rect = { x: (i % cols) * 16, y: Math.floor(i / cols) * 16, w: 16, h: 16 };
  return (
    <SpriteCell
      source={{ png: isO2 ? OBJECTS_2 : SPRINGOBJECTS, imgW: isO2 ? 128 : 384, imgH: isO2 ? 320 : 624 }}
      rect={rect}
      scale={scale}
      className={className}
    />
  );
}

interface CropIconMeta {
  n: string;
  price: number;
  i: number;
  sheet: 'so' | 'o2';
  seedBuy?: number;
  seedI?: number;
  seedSheet?: 'so' | 'o2';
  seasons?: string;
  year2?: boolean;
}

const CROPS = (FARMER_INDEX as unknown as { crops: Record<string, CropIconMeta> }).crops ?? {};

/** 种子图标（Objects.json 种子条目的 SpriteIndex，构建期固化在 crops[seedId].seedI/seedSheet） */
export function SeedIcon({
  seedId,
  scale = 2,
  className,
}: {
  seedId: string;
  scale?: number;
  className?: string;
}) {
  const meta = CROPS[seedId];
  if (!meta?.seedI) return null;
  return (
    <ObjectIcon
      i={meta.seedI}
      sheet={meta.seedSheet ?? 'so'}
      scale={scale}
      className={className}
    />
  );
}

/** 收获物图标（crops[seedId].i/sheet = HarvestItemId 的切片） */
export function HarvestIcon({
  seedId,
  scale = 2,
  className,
}: {
  seedId: string;
  scale?: number;
  className?: string;
}) {
  const meta = CROPS[seedId];
  if (!meta) return null;
  return <ObjectIcon i={meta.i} sheet={meta.sheet} scale={scale} className={className} />;
}
