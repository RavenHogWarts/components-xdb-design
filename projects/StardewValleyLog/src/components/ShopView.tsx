/** @jsxImportSource react */
import { useEffect, useState } from 'react';
import { CSS_PREFIX, DatabaseViewProps } from '../types';
import FARMER_INDEX from '../assets/data/farmer-index.json';
import {
  PlayerProfile,
  levelFromXp,
  readActiveProfile,
  saveSlotProfile,
} from '../checkin/profile';
import {
  BUILDING_CATALOG,
  BUYABLE_ANIMALS,
  MATERIAL_META,
  buildingMaterialShortage,
  buildingMaterials,
  buySeed,
  cropsUnlockedFor,
  payBuildingMaterials,
  seedStock,
} from '../checkin/game';
import { farmBuildingsSheet } from '../sprite/buildings';
import { SeedIcon } from './ObjectIcon';

/** 全量作物（含未解锁的灰卡展示），按种子买价升序 */
const CROPS_ALL = Object.entries((FARMER_INDEX as any).crops ?? {})
  .map(([seedId, c]: [string, any]) => ({ seedId, ...c }))
  .sort((a: any, b: any) => a.seedBuy - b.seedBuy || a.seedId.localeCompare(b.seedId));

/** 动物所需建筑的家族判定：Coop 系（含大/高级）/ Barn 系任一即满足（原版升级替换语义） */
function hasHouseKind(owned: string[], house: string): boolean {
  const kinds: Record<string, string[]> = {
    Coop: ['Coop', 'Big Coop', 'Deluxe Coop'],
    Barn: ['Barn', 'Big Barn', 'Deluxe Barn'],
  };
  return (kinds[house] ?? [house]).some((t) => owned.includes(t));
}

function houseLabel(house: string): string {
  return house === 'Coop' ? '鸡舍' : '畜棚';
}

/**
 * 商店页（farm-systems-design §2）：种子（耕种等级自动解锁货架，买种子）/ 建筑（金币+材料）/
 * 动物（需对应建筑系已购）。购买即时扣金币并持久化到存档。
 */
export function ShopView({
  viewProps,
  profile,
  onProfileChanged,
}: {
  viewProps: DatabaseViewProps;
  profile: PlayerProfile;
  onProfileChanged: (p: PlayerProfile) => void;
}) {
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);
  const [section, setSection] = useState<'seed' | 'building' | 'animal'>('seed');
  const farmingLevel = levelFromXp(profile.skills?.farming ?? 0);
  const unlockedSeeds = cropsUnlockedFor(farmingLevel);
  const unlockedIds = new Set(unlockedSeeds.map((c) => c.seedId));

  // 已解锁/已拥有在前，其余按价格升序（farm-systems-design §2 排序约定）
  const sortedSeeds = [...CROPS_ALL].sort((a, b) => {
    const ua = unlockedIds.has(a.seedId) ? 0 : 1;
    const ub = unlockedIds.has(b.seedId) ? 0 : 1;
    return ua - ub || a.seedBuy - b.seedBuy || a.seedId.localeCompare(b.seedId);
  });
  const sortedBuildings = [...BUILDING_CATALOG].sort((a, b) => {
    const oa = (profile.unlocked?.buildings?.includes(a.type) ? 0 : 1) - (profile.unlocked?.buildings?.includes(b.type) ? 0 : 1);
    return oa || a.price - b.price;
  });
  const sortedAnimals = [...BUYABLE_ANIMALS].sort((a, b) => {
    const ra = (profile.animals ?? []).filter((x) => x.id === a.id).length > 0 ? 0 : 1;
    const rb = (profile.animals ?? []).filter((x) => x.id === b.id).length > 0 ? 0 : 1;
    const ha = (hasHouseKind(profile.unlocked?.buildings ?? [], a.house) ? 0 : 1) - (hasHouseKind(profile.unlocked?.buildings ?? [], b.house) ? 0 : 1);
    return ra - ha - rb || a.price - b.price;
  });

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const persist = async () => {
    const active = readActiveProfile(viewProps.viewDefinition);
    if (active) await saveSlotProfile(viewProps, active.slot, profile);
    onProfileChanged(profile);
  };

  return (
    <div className={`${CSS_PREFIX}shop`}>
      <div className={`${CSS_PREFIX}sectionTitle`}>🛒 皮埃尔杂货店</div>
      {toast && (
        <div className={`${CSS_PREFIX}farmToast ${toast.ok ? CSS_PREFIX + 'farmToastOk' : ''}`}>
          {toast.text}
        </div>
      )}

      {/* ── 子分类（图鉴式 chip 行） ── */}
      <div className={`${CSS_PREFIX}chipRow`} role="tablist">
        {(
          [
            ['seed', `种子（${unlockedSeeds.length}/${CROPS_ALL.length}）`],
            ['building', `建筑（${profile.unlocked?.buildings?.length ?? 0}/${BUILDING_CATALOG.length}）`],
            ['animal', `动物（${(profile.animals ?? []).length}/${BUYABLE_ANIMALS.length}）`],
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

      {/* ── 种子 ── */}
      {section === 'seed' && (
      <div className={`${CSS_PREFIX}shopSection`}>
        <div className={`${CSS_PREFIX}shopSectionTitle`}>
          种子（耕种 Lv.2/4/6/8/10 依次解锁货架）
        </div>
        <div className={`${CSS_PREFIX}shopGrid`}>
          {sortedSeeds.map((c: any) => {
            const isUnlocked = unlockedIds.has(c.seedId);
            const stock = seedStock(profile, c.seedId);
            const canBuy = isUnlocked && (profile.gold ?? 0) >= (c.seedBuy ?? 0);
            return (
              <div
                key={c.seedId}
                className={`${CSS_PREFIX}shopCard ${isUnlocked ? '' : CSS_PREFIX + 'shopCardLocked'}`}
              >
                <div className={`${CSS_PREFIX}shopCardHead`}>
                  <SeedIcon seedId={c.seedId} scale={2} className={`${CSS_PREFIX}shopIcon`} />
                  <div className={`${CSS_PREFIX}shopCardName`}>{c.n}</div>
                </div>
                <div className={`${CSS_PREFIX}shopCardMeta`}>
                  种子 {c.seedBuy ?? 0}g · 收获 {c.price}g{c.seasons ? ` · ${c.seasons}` : ''}
                </div>
                {isUnlocked ? (
                  <button
                    className={`${CSS_PREFIX}shopBuy`}
                    disabled={!canBuy}
                    onClick={() => {
                      if (buySeed(profile, c.seedId, c.seedBuy ?? 0)) {
                        setToast({ text: `购入 ${c.n} 种子 ×1`, ok: true });
                        void persist();
                      }
                    }}
                  >
                    购买种子（库存 {stock}）
                  </button>
                ) : (
                  <div className={`${CSS_PREFIX}shopLock`}>🔒 随耕种等级解锁</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      )}

      {/* ── 建筑 ── */}
      {section === 'building' && (
      <div className={`${CSS_PREFIX}shopSection`}>
        <div className={`${CSS_PREFIX}shopSectionTitle`}>建筑（金币 + 材料，材料由打卡产出）</div>
        <div className={`${CSS_PREFIX}shopGrid`}>
          {sortedBuildings.map((b) => {
            const owned = profile.unlocked?.buildings?.includes(b.type) ?? false;
            const entry = farmBuildingsSheet.entries().find((e) => e.key === `building-${b.type}`);
            const src = entry?.source?.png ?? entry?.src;
            const name = entry?.name ?? b.name;
            const shortage = buildingMaterialShortage(profile, b.type);
            const canBuy = !owned && (profile.gold ?? 0) >= b.price && shortage.length === 0;
            return (
              <div
                key={b.type}
                className={`${CSS_PREFIX}shopCard ${owned ? CSS_PREFIX + 'shopCardOwned' : CSS_PREFIX + 'shopCardLocked'}`}
              >
                <div className={`${CSS_PREFIX}shopCardHead`}>
                  {src && <img className={`${CSS_PREFIX}shopCardImg`} src={src} alt={name} />}
                  <div className={`${CSS_PREFIX}shopCardName`}>{name}</div>
                </div>
                <div className={`${CSS_PREFIX}shopCardMeta`}>💰 {b.price}g</div>
                {buildingMaterials(b.type).length > 0 && (
                  <div className={`${CSS_PREFIX}shopCardMeta`}>
                    材料：
                    {buildingMaterials(b.type).map(([id, need]) => (
                      <span
                        key={id}
                        className={`${CSS_PREFIX}shopMat ${(profile.warehouse?.[id] ?? 0) >= need ? CSS_PREFIX + 'shopMatOk' : ''}`}
                      >
                        {MATERIAL_META[id]?.n ?? id} {profile.warehouse?.[id] ?? 0}/{need}
                      </span>
                    ))}
                  </div>
                )}
                {owned ? (
                  <div className={`${CSS_PREFIX}shopLock`}>已拥有</div>
                ) : (
                  <button
                    className={`${CSS_PREFIX}shopBuy`}
                    disabled={!canBuy}
                    onClick={() => {
                      profile.gold = (profile.gold ?? 0) - b.price;
                      payBuildingMaterials(profile, b.type);
                      profile.unlocked ??= { crops: [], buildings: [] };
                      profile.unlocked.buildings.push(b.type);
                      setToast({ text: `🏗 「${name}」已购入`, ok: true });
                      void persist();
                    }}
                  >
                    购买
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
      )}

      {/* ── 动物 ── */}
      {section === 'animal' && (
      <div className={`${CSS_PREFIX}shopSection`}>
        <div className={`${CSS_PREFIX}shopSectionTitle`}>动物（需先拥有对应建筑）</div>
        <div className={`${CSS_PREFIX}shopGrid`}>
          {sortedAnimals.map((a) => {
            const owned = (profile.animals ?? []).filter((x) => x.id === a.id).length;
            const hasHouse = hasHouseKind(profile.unlocked?.buildings ?? [], a.house);
            const canBuy = hasHouse && (profile.gold ?? 0) >= a.price;
            return (
              <div
                key={a.id}
                className={`${CSS_PREFIX}shopCard ${hasHouse ? '' : CSS_PREFIX + 'shopCardLocked'}`}
              >
                <div className={`${CSS_PREFIX}shopCardHead`}>
                  <img className={`${CSS_PREFIX}shopAnimalIcon`} src={a.icon} alt={a.n} />
                  <div className={`${CSS_PREFIX}shopCardName`}>{a.n}</div>
                </div>
                <div className={`${CSS_PREFIX}shopCardMeta`}>
                  💰 {a.price}g · 需{houseLabel(a.house)}
                </div>
                {hasHouse ? (
                  <button
                    className={`${CSS_PREFIX}shopBuy`}
                    disabled={!canBuy}
                    onClick={() => {
                      profile.gold = (profile.gold ?? 0) - a.price;
                      profile.animals = [...(profile.animals ?? []), { id: a.id }];
                      setToast({ text: `${a.n} 已入住${houseLabel(a.house)}`, ok: true });
                      void persist();
                    }}
                  >
                    购买（已有 {owned}）
                  </button>
                ) : (
                  <div className={`${CSS_PREFIX}shopLock`}>🔒 需{houseLabel(a.house)}</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      )}
    </div>
  );
}
