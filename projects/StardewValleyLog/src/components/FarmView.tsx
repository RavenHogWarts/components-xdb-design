/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CSS_PREFIX, DatabaseViewProps } from '../types';
import { SpriteCell } from './SpriteCell';
import { SpriteRect } from '../sprite/types';
import { cropsSheet } from '../sprite/crops';
import { farmBuildingsSheet } from '../sprite/buildings';
import {
  CheckinConfig,
  HabitData,
  NewHabitInput,
  SKILLS,
  checkIn,
  createHabit,
  isDoneToday,
  isReadonlySource,
  loadHabits,
  openHabitNote,
  readCheckinConfig,
  stageIndex,
  todayIso,
} from '../checkin/habit';
import { PlayerProfile, levelFromXp, saveSlotProfile, readActiveProfile } from '../checkin/profile';
import { applyCheckInRewards, addPendingMaterials, materialsForCheckIn, consumeSeed, seedStock, cropsUnlockedFor } from '../checkin/game';

// ── 作物阶段表（复用图鉴 crops 解析：strip 里不带 src 的格子即各生长阶段）──

interface CropStages {
  name: string;
  rects: SpriteRect[];
}

const CROP_STAGES = new Map<string, CropStages>();
for (const e of cropsSheet.entries()) {
  const seedId = e.key.slice('crop-'.length);
  CROP_STAGES.set(seedId, {
    name: e.name,
    rects: (e.strip ?? []).filter((c) => !c.src).map((c) => c.rect),
  });
}

const CROP_OPTIONS = [...CROP_STAGES.entries()]
  .map(([seedId, c]) => ({ seedId, name: c.name }))
  .sort((a, b) => a.name.localeCompare(b.name, 'zh'));

// 建筑赠送线的连击阈值（筒仓 7 / 温室 30 / 祝尼魔屋 100，与 game.ts GIFT_DAYS 对应）
const MILESTONES = [7, 30, 100];

/**
 * 农场（打卡）页：习惯作物卡网格，点击卡片打卡。
 * 数据层与打卡链路见 src/checkin/habit.ts；设计见 docs/checkin-design.md。
 * profile 由 MainTabs 传入（存档选择界面激活后才有）；玩家栏可退出回存档选择。
 */
export function FarmView({
  viewProps,
  profile,
  onProfileChanged,
}: {
  viewProps: DatabaseViewProps;
  profile: PlayerProfile;
  onProfileChanged: (p: PlayerProfile) => void;
}) {
  const [habits, setHabits] = useState<HabitData[] | null>(null);
  const [busy, setBusy] = useState<string[]>([]);
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const genRef = useRef(0);

  const cfg: CheckinConfig = useMemo(
    () => readCheckinConfig(viewProps.viewDefinition),
    [viewProps.viewDefinition]
  );
  const today = todayIso(viewProps);
  const readonly = useMemo(() => isReadonlySource(viewProps), [viewProps]);

  const reload = useCallback(async () => {
    const gen = ++genRef.current;
    try {
      const list = await loadHabits(viewProps);
      if (gen === genRef.current) setHabits(list);
    } catch {
      if (gen === genRef.current) setHabits([]);
    }
  }, [viewProps]);

  // 宿主每次 onUpdate（数据/定义变化都会触发）都重查一次习惯清单
  useEffect(() => {
    void reload();
  }, [reload]);

  // toast 自动消失
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const onCheckIn = async (habit: HabitData) => {
    if (readonly || busy.includes(habit.rowId) || isDoneToday(habit, today)) return;
    setBusy((b) => [...b, habit.rowId]);
    try {
      const res = await checkIn(viewProps, habit, cfg);
      if (!res.ok) {
        setToast({ text: res.message, ok: false });
        return;
      }
      // 游戏结算（G2/G3）：XP + 出货金币 + 升级/赠送事件 → 入账存档并持久化
      const rewards = applyCheckInRewards(
        profile,
        { ...habit, streak: res.streak, best: res.best },
        today
      );
      // 材料产出（S1）：按技能入仓库并计入结算报告
      const mats = materialsForCheckIn(habit.skill);
      const matNamed = addPendingMaterials(profile, mats);
      const matText = matNamed.length
        ? ` 材料：${matNamed.map((m) => `${m.n}×${m.c}`).join(' ')}`
        : '';
      const lvText = rewards.levelUps.length ? ` ${rewards.levelUps.join(' ')}` : '';
      setToast({
        text: `${res.message} +${rewards.xp}经验 +${rewards.gold}g${matText}${lvText}`,
        ok: true,
      });
      const slot = readActiveProfile(viewProps.viewDefinition)?.slot;
      if (slot) await saveSlotProfile(viewProps, slot, profile);
      onProfileChanged(profile); // 通知 PlayerBar 等立即刷新（金币/技能）
      await reload();
    } finally {
      setBusy((b) => b.filter((id) => id !== habit.rowId));
    }
  };

  const onCreate = async (input: NewHabitInput) => {
    if (!consumeSeed(profile, input.crop)) {
      setToast({ text: '种子库存不足，请到商店购买', ok: false });
      return;
    }
    const res = await createHabit(viewProps, input);
    setToast({ text: res.message, ok: res.ok });
    if (res.ok) {
      setFormOpen(false);
      await reload();
    }
  };

  /** 睡觉结算（G3）：待展示报告存在且非今日 → 显示"上次结算"卡；确认后清除 */
  const [reportOpen, setReportOpen] = useState(false);
  useEffect(() => {
    if (profile?.pending && profile.pending.date !== today) setReportOpen(true);
    else setReportOpen(false);
  }, [profile, today]);
  const dismissReport = async () => {
    profile.pending = undefined;
    profile.lastSettle = today;
    const slot = readActiveProfile(viewProps.viewDefinition)?.slot;
    if (slot) await saveSlotProfile(viewProps, slot, profile);
    onProfileChanged(profile);
    setReportOpen(false);
  };

  const list = habits ?? [];
  const done = list.filter((h) => isDoneToday(h, today)).length;
  const activeStreak = list.filter((h) => h.streak > 0).length;
  const bestStreak = list.reduce((m, h) => Math.max(m, h.best), 0);

  return (
    <div className={`${CSS_PREFIX}farm`}>
      {/* 睡觉结算（G3）：上次结算报告 */}
      {reportOpen && profile.pending && (
        <div className={`${CSS_PREFIX}settleCard`}>
          <div className={`${CSS_PREFIX}settleTitle`}>🛏 上次结算 · {profile.pending.date}</div>
          <div className={`${CSS_PREFIX}settleLine`}>
            出货：
            {profile.pending.items.length
              ? profile.pending.items.map((it, i) => (
                  <span key={i} className={`${CSS_PREFIX}settleItem`}>
                    {it.n} +{it.p}g
                  </span>
                ))
              : '（无）'}
          </div>
          <div className={`${CSS_PREFIX}settleLine`}>
            经验：
            {Object.entries(profile.pending.xp).map(([skill, xp]) => (
              <span key={skill} className={`${CSS_PREFIX}settleItem`}>
                {SKILLS.find((s) => s.id === skill)?.label ?? skill} +{xp as number}
              </span>
            ))}
          </div>
          {profile.pending.events.length > 0 && (
            <div className={`${CSS_PREFIX}settleLine ${CSS_PREFIX}settleEvents`}>
              {profile.pending.events.join(' ')}
            </div>
          )}
          <button className={`${CSS_PREFIX}settleOk`} onClick={() => void dismissReport()}>
            知道了
          </button>
        </div>
      )}

      <div className={`${CSS_PREFIX}farmHeader`}>
        <div className={`${CSS_PREFIX}farmTitle`}>🌱 今日农场</div>
        <div className={`${CSS_PREFIX}farmStats`}>
          <span className={`${CSS_PREFIX}farmStat`}>
            今日 <b>{done}</b>/{list.length}
          </span>
          <span className={`${CSS_PREFIX}farmStat`}>
            连续中 <b>{activeStreak}</b>
          </span>
          <span className={`${CSS_PREFIX}farmStat`}>
            最长 <b>{bestStreak}</b> 天
          </span>
        </div>
        {!readonly && (
          <button
            className={`${CSS_PREFIX}farmNewBtn`}
            onClick={() => setFormOpen((v) => !v)}
          >
            {formOpen ? '收起' : '＋ 新习惯'}
          </button>
        )}
      </div>

      {readonly && (
        <div className={`${CSS_PREFIX}farmBanner`}>
          当前数据库是任务（task）数据源，不支持习惯管理。请在文件（file）数据源的数据库中使用农场打卡。
        </div>
      )}

      {toast && (
        <div className={`${CSS_PREFIX}farmToast ${toast.ok ? CSS_PREFIX + 'farmToastOk' : ''}`}>
          {toast.text}
        </div>
      )}

      {formOpen && !readonly && (
        <HabitForm
          onSubmit={onCreate}
          unlocked={cropsUnlockedFor(levelFromXp(profile.skills?.farming ?? 0)).map((c) => ({
            ...c,
            stock: seedStock(profile, c.seedId),
          }))}
        />
      )}

      {habits === null ? (
        <div className={`${CSS_PREFIX}farmEmpty`}>正在读取习惯…</div>
      ) : list.length === 0 ? (
        <div className={`${CSS_PREFIX}farmEmpty`}>
          还没有习惯。点击「＋ 新习惯」创建第一个，或在表格视图给文件 frontmatter 加
          <code>type: habit</code>
          字段。
        </div>
      ) : (
        <div className={`${CSS_PREFIX}farmGrid`}>
          {list.map((h) => (
            <HabitCard
              key={h.rowId}
              habit={h}
              today={today}
              busy={busy.includes(h.rowId)}
              readonly={readonly}
              onCheckIn={onCheckIn}
              onOpen={() => openHabitNote(viewProps, h)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── 习惯卡片：卡面 = 作物生长阶段，点击打卡 ──

function HabitCard({
  habit,
  today,
  busy,
  readonly,
  onCheckIn,
  onOpen,
}: {
  habit: HabitData;
  today: string;
  busy: boolean;
  readonly: boolean;
  onCheckIn: (h: HabitData) => void;
  onOpen: () => void;
}) {
  const crop = CROP_STAGES.get(habit.crop) ?? CROP_STAGES.get('472');
  const stages = crop?.rects ?? [];
  const stage = stageIndex(habit.streak, habit.goal, Math.max(stages.length, 1));
  const done = isDoneToday(habit, today);
  const skill = SKILLS.find((s) => s.id === habit.skill) ?? SKILLS[0];
  const progress = Math.min(100, Math.round((habit.streak / Math.max(habit.goal, 1)) * 100));

  return (
    <div
      className={[
        `${CSS_PREFIX}habitCard`,
        done ? CSS_PREFIX + 'habitDone' : '',
        busy ? CSS_PREFIX + 'habitBusy' : '',
        !done && !busy && !readonly ? CSS_PREFIX + 'habitReady' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={() => onCheckIn(habit)}
      role="button"
      aria-label={`打卡 ${habit.name}`}
    >
      <div className={`${CSS_PREFIX}habitSprite`}>
        {stages.length > 0 && (
          <SpriteCell
            spec={cropsSheet}
            rect={stages[Math.min(stage, stages.length - 1)]}
            scale={3}
          />
        )}
        {done && <span className={`${CSS_PREFIX}habitCheck`}>✓</span>}
        {busy && <span className={`${CSS_PREFIX}habitSpinner`}>…</span>}
      </div>
      <div className={`${CSS_PREFIX}habitInfo`}>
        <button className={`${CSS_PREFIX}habitName`} onClick={(e) => { e.stopPropagation(); onOpen(); }} title="打开习惯文件">
          {habit.name}
        </button>
        <span className={`${CSS_PREFIX}habitSkill`} style={{ borderColor: skill.color, color: skill.color }}>
          {skill.label}
        </span>
        <div className={`${CSS_PREFIX}habitStreak`}>
          <Heart />
          <b>{habit.streak}</b>
          <span className={`${CSS_PREFIX}habitGoal`}>/ {habit.goal} 天</span>
          {habit.best > habit.streak && (
            <span className={`${CSS_PREFIX}habitBest`}>最长 {habit.best}</span>
          )}
        </div>
        <div className={`${CSS_PREFIX}habitBar`}>
          <div className={`${CSS_PREFIX}habitBarFill`} style={{ width: `${progress}%` }} />
        </div>
        <div className={`${CSS_PREFIX}habitStage`}>
          生长阶段 {Math.min(stage + 1, stages.length)}/{stages.length}
          {habit.streak >= habit.goal ? ' · 已成熟 🌾' : ''}
        </div>
      </div>
    </div>
  );
}

function Heart() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden>
      <path
        d="M12 21s-7.5-4.9-10-9.3C.4 8.9 2 5 5.5 5 7.7 5 9.3 6.3 12 9c2.7-2.7 4.3-4 6.5-4C22 5 23.6 8.9 22 11.7 19.5 16.1 12 21 12 21z"
        fill="#c02730"
      />
    </svg>
  );
}

// ── 新建习惯表单 ──

function HabitForm({
  onSubmit,
  unlocked,
}: {
  onSubmit: (input: NewHabitInput) => Promise<void>;
  /** 已解锁作物 + 当前种子库存（商店购买，随耕种等级扩展货架） */
  unlocked: {
    seedId: string;
    name: string;
    seedBuy: number;
    seasons?: string;
    price: number;
    stock: number;
  }[];
}) {
  const [name, setName] = useState('');
  const [skill, setSkill] = useState('farming');
  const [crop, setCrop] = useState(unlocked[0]?.seedId ?? '472');
  const [goal, setGoal] = useState(30);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onSubmit({ name, skill: skill as NewHabitInput['skill'], crop, goal });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`${CSS_PREFIX}farmForm`}>
      <div className={`${CSS_PREFIX}formRow`}>
        <label>
          习惯名
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="如：晨跑 / 阅读 30 分钟"
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </label>
        <label>
          技能
          <select value={skill} onChange={(e) => setSkill(e.target.value)}>
            {SKILLS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          作物（种子店）
          <select value={crop} onChange={(e) => setCrop(e.target.value)}>
            {unlocked.map((o) => (
              <option key={o.seedId} value={o.seedId}>
                {o.name} · 种子{o.seedBuy}g · 库存{o.stock}
                {o.seasons ? ` (${o.seasons})` : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          目标天数
          <input
            type="number"
            min={1}
            max={999}
            value={goal}
            onChange={(e) => setGoal(Number(e.target.value))}
          />
        </label>
        <button className={`${CSS_PREFIX}formSubmit`} disabled={saving || !name.trim()} onClick={submit}>
          {saving ? '创建中…' : '种下种子'}
        </button>
      </div>
      <div className={`${CSS_PREFIX}formHint`}>
        创建一个带约定 frontmatter 的文件（type: habit 等），打卡会写回连续天数、结算经验与金币，
        并留痕到当日日记。耕种升级解锁更多作物。
      </div>
    </div>
  );
}
