/**
 * 贴图测试页。
 *
 * 自动扫描 stardew-habit/ 目录下所有 PNG（用 Vite 的 import.meta.glob），
 * 对每个文件做三件事：
 *   1. 原始图加载验证 —— <img> 能否成功 load，实际像素尺寸是否与声明一致
 *   2. 与 ASSET_SPECS 的匹配情况 —— 该文件是否已在插件里注册
 *   3. 精灵切片预览 —— 用真实 SpriteSheet 切出每个 sprite，验证坐标公式
 *
 * 这样既能发现"贴图加载失败/尺寸错误"，也能发现"切片坐标算错"。
 */
/** @jsxImportSource react */
import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  ASSET_SPECS,
  SpriteSheet,
  type AssetSpec,
} from '../src/sprite-helper';
import { createMockApp } from './mock-props';

// eager: true 让 Vite 在构建时把所有匹配的 png 解析为 URL 字符串
const PNG_MODULES = import.meta.glob('../stardew-habit/*.png', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

interface PngEntry {
  /** 文件名，如 crops.png */
  filename: string;
  /** Vite 解析出的本地 URL */
  url: string;
  /** 在 ASSET_SPECS 中匹配到的规格；未注册则为 null */
  spec: AssetSpec | null;
}

/** 收集 stardew-habit/ 下所有 png，并尝试匹配 ASSET_SPECS */
function collectPngEntries(): PngEntry[] {
  const entries: PngEntry[] = [];
  for (const [globPath, url] of Object.entries(PNG_MODULES)) {
    const filename = globPath.split('/').pop() ?? globPath;
    const spec = ASSET_SPECS.find(s => s.filename === filename) ?? null;
    entries.push({ filename, url, spec });
  }
  // 已注册的排前面，未注册的排后面
  entries.sort((a, b) => {
    if (a.spec && !b.spec) return -1;
    if (!a.spec && b.spec) return 1;
    return a.filename.localeCompare(b.filename);
  });
  return entries;
}

/** 加载单张图片拿到真实像素尺寸 */
function useImageSize(url: string): { width: number; height: number; status: 'loading' | 'ok' | 'error' } {
  const [state, setState] = useState<{ width: number; height: number; status: 'loading' | 'ok' | 'error' }>({
    width: 0,
    height: 0,
    status: 'loading',
  });
  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelled) {
        setState({ width: img.naturalWidth, height: img.naturalHeight, status: 'ok' });
      }
    };
    img.onerror = () => {
      if (!cancelled) setState(s => ({ ...s, status: 'error' }));
    };
    img.src = url;
    return () => {
      cancelled = true;
    };
  }, [url]);
  return state;
}

// ─────────────────────────────────────────────────────────────
// 单个贴图卡片
// ─────────────────────────────────────────────────────────────
function SpriteCard({ entry }: { entry: PngEntry }) {
  const { filename, url, spec } = entry;
  const img = useImageSize(url);

  // 尺寸校验：实际 vs 声明
  const sizeMismatch =
    spec && img.status === 'ok' &&
    (img.width !== spec.imgWidth || img.height !== spec.imgHeight);

  return (
    <div className="sprite-card">
      <header className="sprite-card__header">
        <span className="sprite-card__name">{filename}</span>
        {spec ? (
          <span className="sprite-badge sprite-badge--ok">已注册</span>
        ) : (
          <span className="sprite-badge sprite-badge--warn">未在 ASSET_SPECS 注册</span>
        )}
      </header>

      {/* 元信息行 */}
      <dl className="sprite-card__meta">
        <div>
          <dt>加载状态</dt>
          <dd>
            {img.status === 'loading' && <span className="tag tag--info">加载中…</span>}
            {img.status === 'ok' && <span className="tag tag--ok">✓ 成功</span>}
            {img.status === 'error' && <span className="tag tag--err">✗ 失败</span>}
          </dd>
        </div>
        <div>
          <dt>实际尺寸</dt>
          <dd>
            {img.status === 'ok' ? `${img.width} × ${img.height} px` : '—'}
          </dd>
        </div>
        {spec && (
          <>
            <div>
              <dt>声明尺寸</dt>
              <dd className={sizeMismatch ? 'is-mismatch' : ''}>
                {spec.imgWidth} × {spec.imgHeight} px
                {sizeMismatch && ' ⚠ 不一致'}
              </dd>
            </div>
            <div>
              <dt>精灵网格</dt>
              <dd>
                {spec.spriteWidth} × {spec.spriteHeight} px →{' '}
                {Math.floor(spec.imgWidth / spec.spriteWidth)} 列 ×{' '}
                {Math.floor(spec.imgHeight / spec.spriteHeight)} 行
              </dd>
            </div>
          </>
        )}
      </dl>

      {/* 原始图预览（棋盘格背景） */}
      <section className="sprite-card__section">
        <h4>原始贴图</h4>
        <div className="checkerboard">
          {url ? (
            <img src={url} alt={filename} className="sprite-raw-img" />
          ) : (
            <span className="sprite-missing">URL 解析失败</span>
          )}
        </div>
      </section>

      {/* 精灵切片预览（仅已注册的文件） */}
      {spec && img.status === 'ok' && !sizeMismatch && (
        <SpriteGrid spec={spec} />
      )}
      {spec && sizeMismatch && (
        <div className="sprite-card__notice">
          实际尺寸与声明不一致，已跳过精灵切片预览。请核对 ASSET_SPECS 或替换贴图。
        </div>
      )}

      {spec && (
        <p className="sprite-card__desc">{spec.description}</p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 精灵网格：用真实 SpriteSheet 切出所有 sprite
// ─────────────────────────────────────────────────────────────
function SpriteGrid({ spec }: { spec: AssetSpec }) {
  const sprite = useMemo(() => {
    // 复用真实 SpriteSheet，顺带验证其坐标公式
    const app = createMockApp();
    const vaultPath = `Log/stardew-habit/${spec.filename}`;
    return new SpriteSheet(
      app,
      vaultPath,
      spec.imgWidth,
      spec.imgHeight,
      spec.spriteWidth,
      spec.spriteHeight
    );
  }, [spec]);

  const cols = Math.floor(spec.imgWidth / spec.spriteWidth);
  const rows = Math.floor(spec.imgHeight / spec.spriteHeight);

  // crops.png 太高（64 行），全展开会很长；默认只展示前 N 行，提供展开按钮
  const [expanded, setExpanded] = useState(false);
  const defaultRows = Math.min(rows, 8);
  const showRows = expanded ? rows : defaultRows;

  const toReactStyle = (obj: Record<string, string>): CSSProperties => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj)) {
      const camel = k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
      out[camel] = v;
    }
    return out as CSSProperties;
  };

  return (
    <section className="sprite-card__section">
      <h4>
        精灵切片（{cols} × {rows} = {cols * rows} 格）
        {rows > defaultRows && (
          <button
            className="sprite-expand-btn"
            onClick={() => setExpanded(e => !e)}
          >
            {expanded ? '收起' : `展开全部 ${rows} 行`}
          </button>
        )}
      </h4>
      <div className="sprite-grid">
        {Array.from({ length: showRows }).map((_, row) =>
          Array.from({ length: cols }).map((_, col) => (
            <div key={`${col}-${row}`} className="sprite-cell" title={`col=${col} row=${row}`}>
              <div
                style={toReactStyle(sprite.getStyleObject(col, row, 2))}
                className="sprite-cell__img"
              />
              <span className="sprite-cell__label">
                {col},{row}
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// 顶部汇总
// ─────────────────────────────────────────────────────────────
function SpriteSummary({ entries }: { entries: PngEntry[] }) {
  const total = entries.length;
  const registered = entries.filter(e => e.spec).length;
  const unregistered = total - registered;

  return (
    <div className="sprite-summary">
      <div className="sprite-summary__item">
        <span className="sprite-summary__num">{total}</span>
        <span className="sprite-summary__label">PNG 文件</span>
      </div>
      <div className="sprite-summary__item">
        <span className="sprite-summary__num sprite-summary__num--ok">{registered}</span>
        <span className="sprite-summary__label">已注册</span>
      </div>
      <div className="sprite-summary__item">
        <span className="sprite-summary__num sprite-summary__num--warn">{unregistered}</span>
        <span className="sprite-summary__label">未注册</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 导出组件
// ─────────────────────────────────────────────────────────────
export function SpriteTestView() {
  const entries = useMemo(collectPngEntries, []);

  // 额外检查：ASSET_SPECS 里声明了但目录里没有的文件
  const missingFiles = ASSET_SPECS.filter(
    spec => !entries.some(e => e.filename === spec.filename)
  );

  return (
    <div className="sprite-test">
      <SpriteSummary entries={entries} />

      {missingFiles.length > 0 && (
        <div className="sprite-missing-notice">
          <strong>⚠ ASSET_SPECS 声明但目录缺失：</strong>
          {missingFiles.map(s => (
            <code key={s.filename}> {s.filename} </code>
          ))}
        </div>
      )}

      <div className="sprite-grid-layout">
        {entries.map(entry => (
          <SpriteCard key={entry.filename} entry={entry} />
        ))}
      </div>
    </div>
  );
}
