/** @jsxImportSource react */
import { useEffect, useState } from 'react';
import { CSS_PREFIX, DatabaseViewProps } from '../types';
import {
  PlayerProfile,
  SLOT_IDS,
  activateSlot,
  deleteSlot,
  levelFromXp,
  newProfile,
  readSlotIndex,
  saveSlotProfile,
  setDefaultSlot,
} from '../checkin/profile';
import { composeAvatar } from '../checkin/farmerRenderer';
import { FarmerCreator } from './FarmerCreator';

/**
 * 存档选择界面（进入游戏的第一个界面，参照原版"存档栏"）：
 * 3 个槽位——空槽新建农夫（进入捏人），已有档显示头像/名/等级/金币并可进入；
 * 可设默认槽（下次打开直接进入）。此阶段不显示图鉴/农场标签页。
 */
export function SaveSlotSelect({
  viewProps,
  onActivated,
}: {
  viewProps: DatabaseViewProps;
  onActivated: (slotId: string) => void;
}) {
  const [index, setIndex] = useState(() => readSlotIndex(viewProps.viewDefinition));
  const [creatingSlot, setCreatingSlot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 宿主 onUpdate（定义写回会触发）后重读索引
  useEffect(() => {
    setIndex(readSlotIndex(viewProps.viewDefinition));
  }, [viewProps.viewDefinition]);

  // 新建中：只渲染捏人界面（隐藏槽列表）
  if (creatingSlot) {
    return (
      <div className={`${CSS_PREFIX}slotSelect`}>
        <FarmerCreator
          onComplete={async (look, name, farmName, pet) => {
            if (busy) return;
            setBusy(true);
            try {
              const today = viewProps.moment().format('YYYY-MM-DD');
              await saveSlotProfile(viewProps, creatingSlot, newProfile(look, name, farmName, pet, today));
              onActivated(creatingSlot);
            } finally {
              setBusy(false);
            }
          }}
        />
      </div>
    );
  }

  return (
    <div className={`${CSS_PREFIX}slotSelect`}>
      <div className={`${CSS_PREFIX}slotTitle`}>🌾 星露谷打卡 · 选择存档</div>
      <div className={`${CSS_PREFIX}slotHint`}>
        选择一个存档进入农场；标 ★ 的存档将在下次打开时自动进入。
      </div>
      <div className={`${CSS_PREFIX}slotList`}>
        {SLOT_IDS.map((slotId) => (
          <SlotCard
            key={slotId}
            viewProps={viewProps}
            slotId={slotId}
            profile={index.saves[slotId] ?? null}
            isDefault={index.defaultSlot === slotId}
            busy={busy}
            onEnter={async () => {
              if (busy) return;
              setBusy(true);
              try {
                await activateSlot(viewProps, slotId);
                onActivated(slotId);
              } finally {
                setBusy(false);
              }
            }}
            onSetDefault={async () => {
              if (busy) return;
              setBusy(true);
              try {
                await setDefaultSlot(viewProps, slotId);
                setIndex(readSlotIndex(viewProps.viewDefinition));
              } finally {
                setBusy(false);
              }
            }}
            onDelete={async () => {
              if (busy || !confirm(`确定删除「${index.saves[slotId]?.name ?? slotId}」的存档？不可恢复。`)) return;
              setBusy(true);
              try {
                await deleteSlot(viewProps, slotId);
                setIndex(readSlotIndex(viewProps.viewDefinition));
              } finally {
                setBusy(false);
              }
            }}
            onNew={() => setCreatingSlot(slotId)}
          />
        ))}
      </div>
    </div>
  );
}

// ── 槽位卡片 ──

function SlotCard({
  viewProps,
  slotId,
  profile,
  isDefault,
  busy,
  onEnter,
  onSetDefault,
  onDelete,
  onNew,
}: {
  viewProps: DatabaseViewProps;
  slotId: string;
  profile: PlayerProfile | null;
  isDefault: boolean;
  busy: boolean;
  onEnter: () => void;
  onSetDefault: () => void;
  onDelete: () => void;
  onNew: () => void;
}) {
  const [avatar, setAvatar] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) {
      setAvatar(null);
      return;
    }
    let alive = true;
    composeAvatar(profile.look)
      .then((url) => alive && setAvatar(url))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [profile]);

  if (!profile) {
    return (
      <div className={`${CSS_PREFIX}slotCard ${CSS_PREFIX}slotEmpty`}>
        <span className={`${CSS_PREFIX}slotName`}>
          {slotId === 'slot-1' ? '存档 1' : slotId === 'slot-2' ? '存档 2' : '存档 3'} · 空
        </span>
        <button className={`${CSS_PREFIX}slotEnter`} disabled={busy} onClick={onNew}>
          ＋ 新建农夫
        </button>
      </div>
    );
  }

  return (
    <div className={`${CSS_PREFIX}slotCard`}>
      <span
        className={`${CSS_PREFIX}slotStar ${isDefault ? CSS_PREFIX + 'slotStarOn' : ''}`}
        title={isDefault ? '默认存档（点击取消）' : '设为默认进入'}
        onClick={onSetDefault}
      >
        {isDefault ? '★' : '☆'}
      </span>
      {avatar ? (
        <img className={`${CSS_PREFIX}slotAvatar`} src={avatar} alt={profile.name} />
      ) : (
        <span className={`${CSS_PREFIX}slotAvatar ${CSS_PREFIX}playerAvatarLoad`}>…</span>
      )}
      <div className={`${CSS_PREFIX}slotInfo`}>
        <div className={`${CSS_PREFIX}slotName`}>
          {profile.name} <em>· {profile.farmName}农场{isDefault ? ' ★默认' : ''}</em>
        </div>
        <div className={`${CSS_PREFIX}slotMeta`}>
          总等级 Lv.{levelTotal(profile)} · 💰 {profile.gold ?? 0} · {profile.createdAt}
        </div>
      </div>
      <div className={`${CSS_PREFIX}slotActions`}>
        <button className={`${CSS_PREFIX}slotEnter`} disabled={busy} onClick={onEnter}>
          进入
        </button>
        <button className={`${CSS_PREFIX}slotDelete`} disabled={busy} onClick={onDelete} title="删除存档">
          🗑
        </button>
      </div>
    </div>
  );
}

function levelTotal(p: PlayerProfile): number {
  return Object.values(p.skills ?? {}).reduce(
    (m: number, xp) => m + levelFromXp(Number(xp) || 0),
    0
  );
}
