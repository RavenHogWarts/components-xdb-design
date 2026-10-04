/** @jsxImportSource react */
import { useMemo, useState } from 'react';
import { CSS_PREFIX } from '../types';
import { getAlmanacCategories } from '../sprite/registry';
import { SheetSpec, SpriteEntry } from '../sprite/types';
import { SpriteCell } from './SpriteCell';
import { DatabaseViewProps } from '../types';

/** 胶片条总宽超过该值（原始像素）时降为 1× 缩放，避免撑破行 */
const STRIP_SCALE_BUDGET = 600;

/**
 * 图鉴页：两级分类（大类 = Content (unpacked) 文件夹，子类 = 贴图资源）
 * + 搜索 + 单列行列表（一个物品一行，内容完整显示）。
 * 纯浏览（解锁/收集进度后续以 SpriteEntry.key 持久化）。
 */
export function AlmanacView(_props: { viewProps: DatabaseViewProps }) {
  const categories = useMemo(getAlmanacCategories, []);
  const [catIdx, setCatIdx] = useState(0);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [query, setQuery] = useState('');

  const category = categories[catIdx];
  // 大类切换时子类序号越界保护
  const sheet = category.sheets[Math.min(sheetIdx, category.sheets.length - 1)];

  const entries = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = sheet.entries();
    if (!q) return all;
    return all.filter(
      (e) => e.name.toLowerCase().includes(q) || (e.sub ?? '').toLowerCase().includes(q)
    );
  }, [sheet, query]);

  // 分组小标题（物品按分类、耕地按组）；组序已由解析层排好
  const groups = useMemo(() => {
    if (!entries.some((e) => e.group)) return null;
    const out: { title: string; items: SpriteEntry[] }[] = [];
    for (const e of entries) {
      const last = out[out.length - 1];
      if (last && last.title === e.group) last.items.push(e);
      else out.push({ title: e.group ?? '', items: [e] });
    }
    return out;
  }, [entries]);

  return (
    <div className={`${CSS_PREFIX}almanac`}>
      <div className={`${CSS_PREFIX}catRow`} role="tablist">
        {categories.map((c, i) => (
          <button
            key={c.name}
            role="tab"
            aria-selected={i === catIdx}
            className={`${CSS_PREFIX}tab2 ${i === catIdx ? CSS_PREFIX + 'tab2Active' : ''}`}
            onClick={() => {
              setCatIdx(i);
              setSheetIdx(0);
            }}
          >
            {c.name}
          </button>
        ))}
      </div>
      <div className={`${CSS_PREFIX}almanacToolbar`}>
        <div className={`${CSS_PREFIX}chipRow`} role="tablist">
          {category.sheets.map((s, i) => (
            <button
              key={s.id + s.label}
              role="tab"
              aria-selected={i === sheetIdx}
              className={`${CSS_PREFIX}chip ${i === sheetIdx ? CSS_PREFIX + 'chipActive' : ''}`}
              onClick={() => setSheetIdx(i)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <input
          className={`${CSS_PREFIX}search`}
          type="search"
          placeholder="搜索名称…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className={`${CSS_PREFIX}count`}>
        {category.name} / {sheet.label} · {entries.length} 项
      </div>

      {groups
        ? groups.map((g) => (
            <div key={g.title} className={`${CSS_PREFIX}groupBlock`}>
              <div className={`${CSS_PREFIX}groupTitle`}>{g.title}</div>
              {g.items.map((e) => (
                <Row key={e.key} spec={sheet} entry={e} />
              ))}
            </div>
          ))
        : entries.map((e) => <Row key={e.key} spec={sheet} entry={e} />)}
    </div>
  );
}

function Row({ spec, entry }: { spec: SheetSpec; entry: SpriteEntry }) {
  // 胶片条缩放：小格（≤8px，如上衣 8×8、配色 4×4）从 4× 起，常规 16px 从 2× 起，
  // 按条目总宽预算降档避免撑破行
  const stripScale = (() => {
    if (!entry.strip) return 1;
    const total = entry.strip.reduce((a, c) => a + c.rect.w, 0);
    const maxCell = Math.max(...entry.strip.map((c) => c.rect.w));
    const candidates = maxCell <= 8 ? [4, 2, 1] : [2, 1];
    for (const s of candidates) if (total * s <= STRIP_SCALE_BUDGET) return s;
    return candidates[candidates.length - 1];
  })();

  return (
    <div className={`${CSS_PREFIX}itemRow`}>
      <div className={`${CSS_PREFIX}rowSprite`}>
        <SpriteCell
        spec={spec}
        rect={entry.rect}
        scale={entry.scale ?? 2}
        src={entry.src}
        source={entry.source}
      />
      </div>
      <div className={`${CSS_PREFIX}rowInfo`}>
        <div className={`${CSS_PREFIX}rowName`}>{entry.name}</div>
        {entry.sub && <div className={`${CSS_PREFIX}rowSub`}>{entry.sub}</div>}
      </div>
      {entry.strip && entry.strip.length > 1 && (
        <div className={`${CSS_PREFIX}rowStrip`}>
          {entry.strip.map((cell, i) => (
            <span key={i} title={cell.label} className={`${CSS_PREFIX}stripWrap`}>
              <SpriteCell
                spec={spec}
                rect={cell.rect}
                scale={stripScale}
                src={cell.src}
                source={cell.source}
                className={`${CSS_PREFIX}stripCell`}
              />
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
