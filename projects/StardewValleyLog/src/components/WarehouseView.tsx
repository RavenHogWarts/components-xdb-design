/** @jsxImportSource react */
import { useState } from 'react';
import { CSS_PREFIX, DatabaseViewProps } from '../types';
import FARMER_INDEX from '../assets/data/farmer-index.json';
import {
  PlayerProfile,
  readActiveProfile,
  saveSlotProfile,
} from '../checkin/profile';
import { MATERIAL_META } from '../checkin/game';
import { HarvestIcon, ObjectIcon } from './ObjectIcon';

interface GameIdx {
  crops: Record<string, { n: string; price: number; i: number; sheet: string }>;
  animals: { id: string; n: string }[];
}
const IDX = FARMER_INDEX as unknown as GameIdx;

const MATERIAL_IDS = new Set(Object.keys(MATERIAL_META));
const animalName = (id: string) => (IDX.animals ?? []).find((a) => a.id === id)?.n ?? id;

/** 收获物卖价 = 仓库记账时的作物价（crops 表按种子 id 存价） */
const cropMeta = (id: string) => (IDX.crops ?? {})[id];

/**
 * 仓库页（farm-systems-design §4）：子分类 = 收获物 / 材料 / 动物（图鉴式 chip 切换）。
 * 收获物与材料可按原版卖价出售换金币；动物列表只读（产出入库为后续迭代）。
 */
export function WarehouseView({
  viewProps,
  profile,
  onProfileChanged,
}: {
  viewProps: DatabaseViewProps;
  profile: PlayerProfile;
  onProfileChanged: (p: PlayerProfile) => void;
}) {
  const [section, setSection] = useState<'crop' | 'material' | 'animal'>('crop');

  const persist = async () => {
    const active = readActiveProfile(viewProps.viewDefinition);
    if (active) await saveSlotProfile(viewProps, active.slot, profile);
    onProfileChanged(profile);
  };

  const sell = (id: string, count: number) => {
    const have = profile.warehouse?.[id] ?? 0;
    const n = Math.min(count, have);
    if (n <= 0) return;
    const unit = MATERIAL_IDS.has(id) ? (MATERIAL_META[id]?.price ?? 0) : (cropMeta(id)?.price ?? 0);
    profile.warehouse[id] = have - n;
    profile.gold = (profile.gold ?? 0) + unit * n;
    void persist();
  };

  const wh = profile.warehouse ?? {};
  const entries = Object.entries(wh).filter(([, n]) => (n ?? 0) > 0);
  const crops = entries.filter(([id]) => !MATERIAL_IDS.has(id) && cropMeta(id));
  const mats = entries.filter(([id]) => MATERIAL_IDS.has(id));
  const animals = profile.animals ?? [];

  const sections = (
    <div className={`${CSS_PREFIX}chipRow`} role="tablist">
      {(
        [
          ['crop', `收获物（${crops.length}）`],
          ['material', `材料（${mats.length}）`],
          ['animal', `动物（${animals.length}）`],
        ] as const
      ).map(([id, label]) => (
        <button
          key={id}
          role="tab"
          aria-selected={section === id}
          className={`${CSS_PREFIX}chip ${section === id ? CSS_PREFIX + 'chipActive' : ''}`}
          onClick={() => setSection(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );

  return (
    <div className={`${CSS_PREFIX}warehouse`}>
      <div className={`${CSS_PREFIX}sectionTitle`}>📦 仓库</div>

      {sections}

      {section === 'crop' && (
        <div className={`${CSS_PREFIX}shopSection`}>
          <div className={`${CSS_PREFIX}shopSectionTitle`}>收获物（出售换金币）</div>
          {crops.length === 0 ? (
            <div className={`${CSS_PREFIX}farmEmpty`}>
              还没有收获物。打卡收获的作物会存放在这里。
            </div>
          ) : (
            <div className={`${CSS_PREFIX}shopGrid`}>
              {crops.map(([id, n]) => {
                const meta = cropMeta(id);
                return (
                  <div key={id} className={`${CSS_PREFIX}shopCard`}>
                    <div className={`${CSS_PREFIX}shopCardHead`}>
                      <HarvestIcon seedId={id} scale={2} className={`${CSS_PREFIX}shopIcon`} />
                      <div className={`${CSS_PREFIX}shopCardName`}>{meta?.n ?? id}</div>
                    </div>
                    <div className={`${CSS_PREFIX}shopCardMeta`}>
                      库存 {n} · 卖价 {meta?.price ?? 0}g
                    </div>
                    <div className={`${CSS_PREFIX}shopActions2`}>
                      <button className={`${CSS_PREFIX}shopBuy`} onClick={() => sell(id, 1)}>
                        卖 1
                      </button>
                      <button className={`${CSS_PREFIX}shopBuy`} onClick={() => sell(id, n)}>
                        全卖
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {section === 'material' && (
        <div className={`${CSS_PREFIX}shopSection`}>
          <div className={`${CSS_PREFIX}shopSectionTitle`}>材料（建造建筑消耗）</div>
          {mats.length === 0 ? (
            <div className={`${CSS_PREFIX}farmEmpty`}>
              还没有材料。采矿/采集/耕种/钓鱼/战斗打卡会产出木材、石头等建造材料。
            </div>
          ) : (
            <div className={`${CSS_PREFIX}shopGrid`}>
              {mats.map(([id, n]) => {
                const meta = MATERIAL_META[id];
                return (
                  <div key={id} className={`${CSS_PREFIX}shopCard`}>
                    <div className={`${CSS_PREFIX}shopCardHead`}>
                      <ObjectIcon i={meta?.i ?? 0} scale={2} className={`${CSS_PREFIX}shopIcon`} />
                      <div className={`${CSS_PREFIX}shopCardName`}>{meta?.n ?? id}</div>
                    </div>
                    <div className={`${CSS_PREFIX}shopCardMeta`}>
                      库存 {n} · 卖价 {meta?.price ?? 0}g
                    </div>
                    <button className={`${CSS_PREFIX}shopBuy`} onClick={() => sell(id, 1)}>
                      卖 1
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {section === 'animal' && (
        <div className={`${CSS_PREFIX}shopSection`}>
          <div className={`${CSS_PREFIX}shopSectionTitle`}>动物</div>
          {animals.length === 0 ? (
            <div className={`${CSS_PREFIX}farmEmpty`}>
              还没有动物。在商店购买（需先拥有鸡舍/畜棚）后会显示在这里。
            </div>
          ) : (
            <div className={`${CSS_PREFIX}shopGrid`}>
              {animals.map((a, i) => (
                <div key={i} className={`${CSS_PREFIX}shopCard`}>
                  <div className={`${CSS_PREFIX}shopCardName`}>{animalName(a.id)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
