/** @jsxImportSource react */
import { useEffect, useState } from 'react';
import { CSS_PREFIX, DatabaseViewProps } from '../types';
import { AlmanacView } from './AlmanacView';
import { FarmView } from './FarmView';
import { ShopView } from './ShopView';
import { WarehouseView } from './WarehouseView';
import { PlayerBar } from './PlayerBar';
import { PlayerProfile, readActiveProfile, readSlotIndex } from '../checkin/profile';

/**
 * 主标签容器：插件视图的顶层结构。
 * 未进入存档（activeSlot 空）时只渲染存档选择界面——不显示游戏标签页；
 * 进入存档后：顶部玩家栏共享，标签 = 打卡(首页)/商店/仓库/图鉴。
 * activeSlot 由存档选择/退出动作本地维护（真实宿主 updateView 后的 onUpdate
 * 会以最新 viewDefinition 再同步一次，两处幂等）。
 */
export function MainTabs({ viewProps }: { viewProps: DatabaseViewProps }) {
  const [active, setActive] = useState<{ slot: string; profile: PlayerProfile } | null>(() => {
    const idx = readSlotIndex(viewProps.viewDefinition);
    const target =
      idx.activeSlot ??
      (idx.defaultSlot && idx.saves[idx.defaultSlot] ? idx.defaultSlot : null);
    return target && idx.saves[target] ? { slot: target, profile: idx.saves[target] } : null;
  });
  const [tab, setTab] = useState<'checkin' | 'shop' | 'warehouse' | 'almanac'>('checkin');

  useEffect(() => {
    setActive(readActiveProfile(viewProps.viewDefinition));
  }, [viewProps.viewDefinition]);

  if (!active) {
    return (
      <div className={`${CSS_PREFIX}main`}>
        <SaveSlotSelect
          viewProps={viewProps}
          onActivated={() => setActive(readActiveProfile(viewProps.viewDefinition))}
        />
      </div>
    );
  }

  const sync = (p: PlayerProfile) => setActive({ slot: active.slot, profile: p });

  return (
    <div className={`${CSS_PREFIX}main`}>
      <PlayerBar profile={active.profile} onExit={() => setActive(null)} />
      <div className={`${CSS_PREFIX}tabBar`} role="tablist">
        {(
          [
            ['checkin', '打卡'],
            ['shop', '商店'],
            ['warehouse', '仓库'],
            ['almanac', '图鉴'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={`${CSS_PREFIX}tab ${tab === id ? CSS_PREFIX + 'tabActive' : ''}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className={`${CSS_PREFIX}tabPanel`}>
        {tab === 'checkin' && (
          <FarmView
            viewProps={viewProps}
            profile={active.profile}
            onProfileChanged={(p) => setActive({ slot: active.slot, profile: p })}
          />
        )}
        {tab === 'shop' && (
          <ShopView viewProps={viewProps} profile={active.profile} onProfileChanged={sync} />
        )}
        {tab === 'warehouse' && (
          <WarehouseView viewProps={viewProps} profile={active.profile} onProfileChanged={sync} />
        )}
        {tab === 'almanac' && <AlmanacView viewProps={viewProps} />}
      </div>
    </div>
  );
}

import { SaveSlotSelect } from './SaveSlotSelect';
