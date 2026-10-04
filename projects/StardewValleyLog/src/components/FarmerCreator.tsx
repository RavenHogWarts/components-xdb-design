/** @jsxImportSource react */
import { useEffect, useMemo, useState } from 'react';
import { CSS_PREFIX } from '../types';
import FARMER_INDEX from '../assets/data/farmer-index.json';
import { hsvToRgb } from '../sprite/farmer';
import {
  FarmerDirection,
  PlayerLook,
  composeFarmer,
  skinSwatches,
} from '../checkin/farmerRenderer';

/** 预览框背景（原版 CharacterCustomization 画 Game1.daybg 于 portraitBox 128×192） */
import DAYBG from '../assets/sprites/daybg.png';

// ── 选项数据 ──

interface FarmerIdx {
  skinCount: number;
  hairBase: number;
  hairExtra: { id: number }[];
  shirts: { id: string; n: string; i: number }[];
  pants: { id: string; n: string; i: number; dc: number[] | null }[];
  /** 开局可选宠物（Pets.json CanBeChosenAtStart）：猫 5 + 狗 5 品种，icon = 16×16 头像（构建期自 Cursors 表切片） */
  pets: { type: 'Cat' | 'Dog'; breeds: { id: string; tex: string; icon: string }[] }[];
}
const IDX = FARMER_INDEX as FarmerIdx;

/** 宠物选项 = 类型 × 品种 全展开（原版 GetPetTypesAndBreeds 顺序），头像 = 原版 IconSourceRect 切片 */
const PET_OPTIONS = IDX.pets.flatMap((t) =>
  t.breeds.map((b) => ({
    type: t.type,
    breed: b.id,
    icon: b.icon,
    label: `${t.type === 'Cat' ? '猫' : '狗'} · 品种 ${Number(b.id) + 1}`,
  }))
);

const HAIR_IDS = [
  ...Array.from({ length: IDX.hairBase }, (_, i) => i),
  ...IDX.hairExtra.map((h) => h.id),
];

const ACCESSORY_MIN = -1;
const ACCESSORY_MAX = 29;

const rgbToHex = (rgb: number[]) =>
  '#' + rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');

const hsvHex = (h100: number, s100: number, v100: number) =>
  rgbToHex(hsvToRgb((h100 / 100) * 360, s100 / 100, v100 / 100));

/** ColorPicker.RGBtoHSV 移植 → 0-100 标度（delta=0 时 hue 兜底 0，同源码 IsNaN→0） */
function rgbToHsv100(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const min = Math.min(r, g, b);
  const max = Math.max(r, g, b);
  const delta = max - min;
  if (max === 0 || delta === 0) return [0, Math.round((delta / Math.max(max, 1)) * 100), Math.round((max / 255) * 100)];
  let hue: number;
  if (r === max) hue = (g - b) / delta;
  else if (g === max) hue = 2 + (b - r) / delta;
  else hue = 4 + (r - g) / delta;
  hue *= 60;
  if (hue < 0) hue += 360;
  return [Math.round((hue / 360) * 100), Math.round((delta / max) * 100), Math.round((max / 255) * 100)];
}

export const DEFAULT_LOOK: PlayerLook = {
  gender: 'male',
  skin: 0,
  hair: 0,
  hairColor: '#6e4a25',
  eyeColor: '#4b3621',
  accessory: -1,
  shirt: IDX.shirts[0]?.id ?? '1000',
  shirtColor: '#ffffff',
  pants: IDX.pants[0]?.id ?? '0',
  pantsColor: rgbToHex(IDX.pants[0]?.dc ?? [255, 235, 203]),
};

const DIR_CYCLE: FarmerDirection[] = ['down', 'right', 'up', 'left'];

const rand = (n: number) => Math.floor(Math.random() * n);
/** [min, max) */
const randRange = (min: number, max: number) => min + rand(max - min);
const chance = (p: number) => Math.random() < p;
const choose = <T,>(arr: T[]): T => arr[rand(arr.length)];

/** 原版男装排除集（CharacterCustomization 随机上衣时跳过） */
const MALE_SHIRT_EXCLUDE = new Set([
  '1056', '1057', '1070', '1046', '1040', '1060', '1090', '1051', '1082', '1107',
  '1080', '1083', '1092', '1072', '1076', '1041',
]);
/** 随机裤色按上衣 SpriteIndex 的联动固定配色（源码 switch 表） */
const PANTS_COLOR_BY_SHIRT: Record<number, number[]> = {
  50: [226, 133, 160],
  0: [34, 29, 173], 7: [34, 29, 173], 71: [34, 29, 173],
  68: [119, 215, 130], 88: [119, 215, 130],
  67: [108, 134, 224], 72: [108, 134, 224],
  79: [55, 55, 60], 99: [55, 55, 60], 103: [55, 55, 60],
};
/** Farmer.hasDarkSkin：肤色 4-8 或 14 */
const hasDarkSkin = (skin: number) => (skin >= 4 && skin <= 8) || skin === 14;

/** 随机发色（源码启发式全分支：减半/压通道/暖化/棕色系/Tan 混合/深肤棕黑） */
function randomHairColor(skin: number): string {
  let r = randRange(25, 254), g = randRange(25, 254), b = randRange(25, 254);
  if (chance(0.5)) {
    r = Math.trunc(r / 2);
    g = Math.trunc(g / 2);
    b = Math.trunc(b / 2);
  }
  if (chance(1 / 3)) r = randRange(15, 51);
  if (chance(1 / 3)) g = randRange(15, 51);
  if (chance(1 / 3)) b = randRange(15, 51);
  if (chance(0.5)) {
    if (b > r) b = Math.max(0, b - 50);
    if (b > g) b = Math.max(0, b - 50);
    if (g > r) g = Math.max(0, r - 50);
    r = Math.min(255, r + 50);
    g = Math.min(255, g + 50);
  } else if (chance(1 / 3)) {
    r = randRange(80, 130);
    g = randRange(35, 70);
    b = 0;
  }
  if (r < 100 && g < 100 && b < 100 && chance(0.8)) {
    // Utility.getBlendedColor(color, Color.Tan)：50% 混合
    r = Math.round((r + 210) / 2);
    g = Math.round((g + 180) / 2);
    b = Math.round((b + 140) / 2);
  }
  if (hasDarkSkin(skin) && chance(0.5)) {
    r = randRange(50, 100);
    g = randRange(25, 40);
    b = 0;
  }
  return rgbToHex([r, g, b]);
}

/** 随机眼色（整体减半偏深 + 各 1/3 压通道 + 50% 压蓝绿） */
function randomEyeColor(): string {
  let r = Math.trunc(randRange(25, 254) / 2);
  let g = Math.trunc(randRange(25, 254) / 2);
  let b = Math.trunc(randRange(25, 254) / 2);
  if (chance(0.5)) r = randRange(15, 51);
  if (chance(0.5)) g = randRange(15, 51);
  if (chance(0.5)) b = randRange(15, 51);
  if (chance(0.5)) {
    if (b > r) b = Math.max(0, b - 50);
    if (b > g) b = Math.max(0, b - 50);
    if (g > r) g = Math.max(0, r - 50);
  }
  return rgbToHex([r, g, b]);
}

/** 随机裤色（启发式 + 上衣联动固定色） */
function randomPantsColor(shirtIndex: number): string {
  const fixed = PANTS_COLOR_BY_SHIRT[shirtIndex];
  if (fixed) return rgbToHex(fixed);
  let r = randRange(25, 254), g = randRange(25, 254), b = randRange(25, 254);
  if (chance(0.5)) {
    r = Math.trunc(r / 2);
    g = Math.trunc(g / 2);
    b = Math.trunc(b / 2);
  }
  if (chance(0.5)) r = randRange(15, 51);
  if (chance(0.5)) g = randRange(15, 51);
  if (chance(0.5)) b = randRange(15, 51);
  return rgbToHex([r, g, b]);
}

/** 随机配件（性别分池；男 67% 概率重置为无——源码分支忠实移植） */
function randomAccessory(gender: PlayerLook['gender']): number {
  if (gender === 'male') {
    if (chance(1 / 3)) {
      if (chance(1 / 3)) return chance(0.8) ? rand(7) : randRange(19, 21);
      if (chance(1 / 3)) return choose([25, 14, 17, 10, 9]);
      if (chance(0.1)) return rand(19);
      return -1;
    }
    return -1;
  }
  if (chance(1 / 3)) return randRange(6, 19);
  if (chance(0.5)) return choose([23, 27, 28]);
  return choose([25, 14, 17, 10, 9]);
}

/**
 * 随机外观（骰子，源码 leftClick 随机链忠实移植）：
 * 不改性别、不改裤子款式/名字/宠物；皮肤 85% 前 6 档；发型按性别分段；
 * 配件按性别分池；上衣随机（男装排除集）；裤子款式不动只随机颜色。
 */
function randomLook(current: PlayerLook): PlayerLook {
  const gender = current.gender;
  const skin = chance(0.85) ? rand(6) : rand(IDX.skinCount);
  const hair =
    gender === 'male'
      ? chance(0.5)
        ? rand(16)
        : randRange(108, 118)
      : randRange(16, 41);
  const pool = IDX.shirts.filter((s) => !(gender === 'male' && MALE_SHIRT_EXCLUDE.has(s.id)));
  const shirt = choose(pool);
  return {
    gender,
    skin,
    hair,
    hairColor: randomHairColor(skin),
    eyeColor: randomEyeColor(),
    accessory: randomAccessory(gender),
    shirt: shirt.id,
    shirtColor: '#ffffff',
    pants: current.pants,
    pantsColor: randomPantsColor(shirt.i),
  };
}

/**
 * 人物创建（参照原版 CharacterCustomization 单屏双列布局）：
 * 左 = 预览（‹›转向）+ 性别 + 皮肤/头发/上衣/裤子/配件 循环器；
 * 右 = 名字/农场名字 + 动物偏好（猫狗全品种）+ 眼睛/头发/袖子/裤子颜色 HSV 滑杆；
 * 左上骰子随机（保留性别与裤子款式），右下 OK 确认。
 */
export function FarmerCreator({
  onComplete,
}: {
  onComplete: (
    look: PlayerLook,
    name: string,
    farmName: string,
    pet: { type: 'Cat' | 'Dog'; breed: string }
  ) => Promise<void> | void;
}) {
  const [look, setLook] = useState<PlayerLook>({ ...DEFAULT_LOOK });
  const [name, setName] = useState('');
  const [farmName, setFarmName] = useState('');
  const [petIdx, setPetIdx] = useState(0);
  const [dirIdx, setDirIdx] = useState(0);
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [swatches, setSwatches] = useState<string[][]>([]);

  // 颜色滑杆状态（0-100 HSV；hex 是 look 里的唯一真相，滑杆经 setHsv 回写）
  const [eyeHsv, setEyeHsv] = useState(() => rgbToHsv100(DEFAULT_LOOK.eyeColor));
  const [hairHsv, setHairHsv] = useState(() => rgbToHsv100(DEFAULT_LOOK.hairColor));
  const [pantsHsv, setPantsHsv] = useState(() => rgbToHsv100(DEFAULT_LOOK.pantsColor));

  const patch = (p: Partial<PlayerLook>) => setLook((l) => ({ ...l, ...p }));

  /**
   * 切换性别（源码 selectionClick "Male"/"Female"）：换底图 + 发型重置为
   * 该性别默认款（男 0 / 女 16），其余选项保留——不随机装扮。
   */
  const switchGender = (gender: PlayerLook['gender']) => {
    if (look.gender === gender) return;
    patch({ gender, hair: gender === 'male' ? 0 : 16 });
  };

  useEffect(() => {
    let alive = true;
    skinSwatches()
      .then((s) => alive && setSwatches(s))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    composeFarmer(look, DIR_CYCLE[dirIdx])
      .then((url) => alive && setPreview(url))
      .catch(() => alive && setPreview(null));
    return () => {
      alive = false;
    };
  }, [look, dirIdx]);

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const pet = PET_OPTIONS[petIdx] ?? PET_OPTIONS[0];
      await onComplete(look, name, farmName, { type: pet.type, breed: pet.breed });
    } finally {
      setSaving(false);
    }
  };

  const shirt = IDX.shirts.find((s) => s.id === look.shirt);
  const pants = IDX.pants.find((p) => p.id === look.pants);

  return (
    <div className={`${CSS_PREFIX}creator`}>
      <div className={`${CSS_PREFIX}creatorGrid`}>
        {/* ── 左列：预览 + 外观循环器 ── */}
        <div className={`${CSS_PREFIX}creatorLeft`}>
          <div className={`${CSS_PREFIX}creatorTopRow`}>
            <button
              className={`${CSS_PREFIX}diceBtn`}
              title="随机外观（保留性别与裤子款式）"
              onClick={() => setLook((l) => randomLook(l))}
            >
              🎲
            </button>
            <div className={`${CSS_PREFIX}portraitRow`}>
              <button
                className={`${CSS_PREFIX}dirBtn`}
                aria-label="上一个朝向"
                onClick={() => setDirIdx((i) => (i + DIR_CYCLE.length - 1) % DIR_CYCLE.length)}
              >
                ‹
              </button>
            <div className={`${CSS_PREFIX}portraitBox`}>
              <img className={`${CSS_PREFIX}portraitBg`} src={DAYBG} alt="" />
              {preview ? (
                <img className={`${CSS_PREFIX}portraitFarmer`} src={preview} alt="农夫预览" />
              ) : (
                <div className={`${CSS_PREFIX}creatorLoading`}>…</div>
              )}
            </div>
              <button
                className={`${CSS_PREFIX}dirBtn`}
                aria-label="下一个朝向"
                onClick={() => setDirIdx((i) => (i + 1) % DIR_CYCLE.length)}
              >
                ›
              </button>
            </div>
          </div>

          <div className={`${CSS_PREFIX}genderRow`} role="radiogroup" aria-label="性别">
            <button
              role="radio"
              aria-checked={look.gender === 'male'}
              className={`${CSS_PREFIX}genderBtn ${look.gender === 'male' ? CSS_PREFIX + 'genderActive' : ''}`}
              title="切换为男孩（发型重置为男性默认）"
              onClick={() => switchGender('male')}
            >
              ♂
            </button>
            <button
              role="radio"
              aria-checked={look.gender === 'female'}
              className={`${CSS_PREFIX}genderBtn ${look.gender === 'female' ? CSS_PREFIX + 'genderActive' : ''}`}
              title="切换为女孩（发型重置为女性默认）"
              onClick={() => switchGender('female')}
            >
              ♀
            </button>
          </div>

          <div className={`${CSS_PREFIX}cyclerList`}>
            <Row label="皮肤" count={IDX.skinCount} index={look.skin} text={`皮肤 ${look.skin + 1}`}
              onChange={(i) => patch({ skin: (i + IDX.skinCount) % IDX.skinCount })}>
              {swatches[look.skin]?.length ? (
                <span className={`${CSS_PREFIX}skinSwatch`}>
                  {swatches[look.skin].map((hex, k) => (
                    <i key={k} style={{ background: hex }} />
                  ))}
                </span>
              ) : null}
            </Row>
            <Row label="头发" count={HAIR_IDS.length} index={HAIR_IDS.indexOf(look.hair)}
              text={look.hair >= 100 ? `扩展发型 ${look.hair}` : `发型 ${look.hair + 1}`}
              onChange={(i) => patch({ hair: HAIR_IDS[(i + HAIR_IDS.length) % HAIR_IDS.length] })} />
            <Row label="上衣" count={IDX.shirts.length} index={Math.max(0, IDX.shirts.findIndex((s) => s.id === look.shirt))}
              text={shirt?.n ?? ''}
              onChange={(i) => patch({ shirt: IDX.shirts[(i + IDX.shirts.length) % IDX.shirts.length].id })} />
            <Row label="裤子" count={IDX.pants.length} index={Math.max(0, IDX.pants.findIndex((p) => p.id === look.pants))}
              text={pants?.n ?? ''}
              onChange={(i) => {
                const p = IDX.pants[(i + IDX.pants.length) % IDX.pants.length];
                patch({ pants: p.id });
              }} />
            <Row label="配件" count={ACCESSORY_MAX - ACCESSORY_MIN + 1} index={look.accessory - ACCESSORY_MIN}
              text={look.accessory < 0 ? '无' : look.accessory === 6 || look.accessory === 7 ? `胡子 ${look.accessory - 5}` : `配件 ${look.accessory}`}
              onChange={(i) =>
                patch({
                  accessory:
                    ((i % (ACCESSORY_MAX - ACCESSORY_MIN + 1)) + ACCESSORY_MAX - ACCESSORY_MIN + 1) %
                      (ACCESSORY_MAX - ACCESSORY_MIN + 1) +
                    ACCESSORY_MIN,
                })
              } />
          </div>
        </div>

        {/* ── 右列：文本 + 宠物 + 颜色滑杆 ── */}
        <div className={`${CSS_PREFIX}creatorRight`}>
          <label className={`${CSS_PREFIX}nameRow`}>
            <span>名字</span>
            <input value={name} maxLength={16} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className={`${CSS_PREFIX}nameRow`}>
            <span>农场名字</span>
            <input value={farmName} maxLength={16} onChange={(e) => setFarmName(e.target.value)} />
          </label>

          <Row
            label="动物偏好"
            count={PET_OPTIONS.length}
            index={petIdx}
            text={PET_OPTIONS[petIdx]?.label ?? ''}
            onChange={(i) => setPetIdx(((i % PET_OPTIONS.length) + PET_OPTIONS.length) % PET_OPTIONS.length)}
          >
            {(() => {
              const cur = PET_OPTIONS[petIdx];
              if (!cur) return null;
              // 原版：16×16 头像（IconSourceRect）拉伸显示——此处 2× 呈现
              return <img className={`${CSS_PREFIX}petIcon`} src={cur.icon} alt="" />;
            })()}
          </Row>

          <div className={`${CSS_PREFIX}colorPickers`}>
            <ColorPicker
              label="眼睛颜色"
              hsv={eyeHsv}
              onChange={(hsv) => {
                setEyeHsv(hsv);
                patch({ eyeColor: hsvHex(hsv[0], hsv[1], hsv[2]) });
              }}
            />
            <ColorPicker
              label="头发颜色"
              hsv={hairHsv}
              onChange={(hsv) => {
                setHairHsv(hsv);
                patch({ hairColor: hsvHex(hsv[0], hsv[1], hsv[2]) });
              }}
            />
            <ColorPicker
              label="裤子颜色"
              hsv={pantsHsv}
              onChange={(hsv) => {
                setPantsHsv(hsv);
                patch({ pantsColor: hsvHex(hsv[0], hsv[1], hsv[2]) });
              }}
            />
          </div>
        </div>
      </div>

      <div className={`${CSS_PREFIX}creatorFooter`}>
        <span className={`${CSS_PREFIX}creatorHint`}>
          创建后可在设置中重置存档重新捏人
        </span>
        <button className={`${CSS_PREFIX}okBtn`} disabled={saving || !preview} onClick={submit}>
          {saving ? '创建中…' : 'OK'}
        </button>
      </div>
    </div>
  );
}

// ── 通用循环行：label …… ◀ 值 N/M ▶ ──

function Row({
  label,
  index,
  count,
  text,
  onChange,
  children,
}: {
  label: string;
  index: number;
  count: number;
  text: string;
  onChange: (index: number) => void;
  children?: React.ReactNode;
}) {
  const pos = count > 1 ? `${((index % count) + count) % count + 1}/${count}` : '';
  return (
    <div className={`${CSS_PREFIX}optRow`}>
      <span className={`${CSS_PREFIX}optLabel`}>{label}</span>
      <span className={`${CSS_PREFIX}optValue`}>
        {text}
        {children}
        {pos && <em>{pos}</em>}
      </span>
      <button aria-label={`上一个${label}`} onClick={() => onChange(index - 1)}>
        ◀
      </button>
      <button aria-label={`下一个${label}`} onClick={() => onChange(index + 1)}>
        ▶
      </button>
    </div>
  );
}

// ── 颜色选择组：标签 + 3 条 24 段 HSV 滑杆（色相/饱和/明度，数值 0-100）──

function barGradient(kind: 'hue' | 'sat' | 'val', hsv: [number, number, number]): string {
  const stops: string[] = [];
  for (let i = 0; i < 24; i++) {
    const t0 = ((i / 24) * 100).toFixed(2);
    const t1 = (((i + 1) / 24) * 100).toFixed(2);
    const c =
      kind === 'hue'
        ? rgbToHex(hsvToRgb((i / 24) * 360, 0.9, 0.9))
        : kind === 'sat'
          ? rgbToHex(hsvToRgb((hsv[0] / 100) * 360, i / 24, hsv[2] / 100))
          : rgbToHex(hsvToRgb((hsv[0] / 100) * 360, hsv[1] / 100, i / 24));
    stops.push(`${c} ${t0}% ${t1}%`);
  }
  return `linear-gradient(to right, ${stops.join(',')})`;
}

function ColorPickerBlock({
  label,
  hsv,
  onChange,
}: {
  label: string;
  hsv: [number, number, number];
  onChange: (hsv: [number, number, number]) => void;
}) {
  const set = (i: number, v: number) => {
    const next = [...hsv] as [number, number, number];
    next[i] = v;
    onChange(next);
  };
  const bars: { kind: 'hue' | 'sat' | 'val'; value: number }[] = [
    { kind: 'hue', value: hsv[0] },
    { kind: 'sat', value: hsv[1] },
    { kind: 'val', value: hsv[2] },
  ];
  return (
    <div className={`${CSS_PREFIX}colorGroup`}>
      <div className={`${CSS_PREFIX}colorLabel`}>{label}</div>
      {bars.map((b, i) => (
        <div key={b.kind} className={`${CSS_PREFIX}sliderRow`}>
          <div className={`${CSS_PREFIX}sliderBar`} style={{ background: barGradient(b.kind, hsv) }}>
            <input
              type="range"
              min={0}
              max={100}
              value={b.value}
              aria-label={`${label} ${b.kind}`}
              onChange={(e) => set(i, Number(e.target.value))}
            />
          </div>
          <span className={`${CSS_PREFIX}sliderVal`}>{b.value}</span>
        </div>
      ))}
    </div>
  );
}
const ColorPicker = ColorPickerBlock;
