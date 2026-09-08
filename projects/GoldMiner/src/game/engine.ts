// 黄金矿工 Canvas 游戏引擎（纯 2D 矢量绘制，无外部资源）
// 状态机：menu → intro → playing → result → shop → intro… / gameover → menu
// 生命周期契约：start() 启动 RAF，destroy() 释放全部监听与观察器；
// applySettings() 可重复调用，音效即时生效，难度/时间等在下一局生效。

import { Sfx } from './audio';
import type { Difficulty, GameOptions, GameOverStats, GameStatsRecord } from '../types';

type Phase = 'menu' | 'intro' | 'playing' | 'result' | 'shop' | 'gameover';

type ItemKind =
  | 'goldS'
  | 'goldM'
  | 'goldL'
  | 'rockS'
  | 'rockB'
  | 'diamond'
  | 'bag'
  | 'bone'
  | 'skull'
  | 'tnt'
  | 'mole';

interface Item {
  kind: ItemKind;
  /** 相对坐标（0~1），resize 时换算回像素，保证布局稳定 */
  fx: number;
  fy: number;
  x: number;
  y: number;
  r: number;
  value: number;
  weight: number;
  alive: boolean;
  /** 被钩子抓住（跟随钩尖，不再参与碰撞） */
  carried: boolean;
  /** 鼹鼠横移参数 */
  move?: { amp: number; speed: number; base: number; t: number };
  /** 出生闪烁动画（0→1） */
  spawnT: number;
}

interface Floater {
  x: number;
  y: number;
  text: string;
  life: number;
  color: string;
}

interface ShopCard {
  id: 'dynamite' | 'engine' | 'clover' | 'book';
  label: string;
  desc: string;
  price: number;
  sold: boolean;
}

const DIFFICULTY: Record<Difficulty, { goal: number; swing: number; label: string }> = {
  easy: { goal: 0.78, swing: 1.12, label: '轻松' },
  normal: { goal: 1, swing: 1.5, label: '标准' },
  hard: { goal: 1.3, swing: 1.92, label: '困难' },
};

const SWING_OMEGA: Record<Exclude<GameOptions['swingSpeed'], 'auto'>, number> = {
  slow: 1.1,
  normal: 1.5,
  fast: 1.95,
};

const ITEM_DEFS: Record<
  ItemKind,
  { r: number; value: number; weight: number; label: string }
> = {
  goldS: { r: 13, value: 100, weight: 1, label: '小金块' },
  goldM: { r: 20, value: 250, weight: 2.2, label: '金块' },
  goldL: { r: 30, value: 500, weight: 4.2, label: '大金块' },
  rockS: { r: 14, value: 20, weight: 2.6, label: '小石头' },
  rockB: { r: 23, value: 60, weight: 5.4, label: '大石头' },
  diamond: { r: 10, value: 600, weight: 0.5, label: '钻石' },
  bag: { r: 16, value: 0, weight: 1.7, label: '神秘袋' },
  bone: { r: 14, value: 40, weight: 1.4, label: '骨头' },
  skull: { r: 15, value: 90, weight: 2.4, label: '骷髅' },
  tnt: { r: 16, value: 0, weight: 0, label: 'TNT' },
  mole: { r: 15, value: 660, weight: 1.6, label: '钻石鼹鼠' },
};

const SHOP_BASE_PRICE: Record<ShopCard['id'], number> = {
  dynamite: 200,
  engine: 300,
  clover: 180,
  book: 240,
};

export interface EngineCallbacks {
  /** 一局自然结束（达标失败或中途清场后手动结束）时回调一次 */
  onGameOver?: (stats: GameOverStats) => void;
}

export class GoldMinerEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private sfx = new Sfx();
  private cb: EngineCallbacks;

  private pending: GameOptions; // 当前生效设置（applySettings 更新，下一局完全采用）
  private best: GameStatsRecord | null = null;

  private raf = 0;
  private lastTime = 0;
  private destroyed = false;
  private resizeObserver: ResizeObserver | null = null;

  // 画布逻辑尺寸（CSS px）
  private W = 0;
  private H = 0;
  private scale = 1;

  // 状态机
  private phase: Phase = 'menu';
  private phaseTimer = 0;

  // 关卡状态
  private level = 1;
  private bank = 0; // 已结算关卡的累计金额
  private levelMoney = 0;
  private goal = 0;
  private timeLeft = 60;
  private lastTickSec = -1;
  private items: Item[] = [];
  private speckles: Array<{ fx: number; fy: number; r: number; dark: boolean }> = [];

  // 钩子
  private hookPhase = 0; // 摆动相位
  private hookAngle = 0;
  private hookLen = 30;
  private hookState: 'swing' | 'extend' | 'retract' = 'swing';
  private carried: Item | null = null;

  // 道具（跨关卡）
  private dynamiteStock = 0;
  private engineNext = false;
  private cloverNext = false;
  private bookNext = false;

  // 特效
  private floaters: Floater[] = [];
  private shake = 0;
  private flash = 0;
  private explosions: Array<{ x: number; y: number; t: number; r: number }> = [];

  // 商店 UI（draw 与命中检测共享布局）
  private shopCards: ShopCard[] = [];
  private shopRects: Array<{ card: ShopCard; x: number; y: number; w: number; h: number }> = [];
  private shopNextRect = { x: 0, y: 0, w: 0, h: 0 };

  // 主题
  private dark = false;
  private fontStack = 'sans-serif';
  private resultCleared = false;
  private reported = false;

  constructor(
    canvas: HTMLCanvasElement,
    options: GameOptions,
    callbacks: EngineCallbacks = {}
  ) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d context unavailable');
    this.ctx = ctx;
    this.pending = { ...options };
    this.cb = callbacks;
    this.sfx.enabled = options.sound;

    this.measure();
    this.spawnLevel(1);
    this.timeLeft = this.pending.timeLimit;

    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    globalThis.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(() => this.measure());
      this.resizeObserver.observe(canvas.parentElement ?? canvas);
    }
    this.refreshTheme();
  }

  start() {
    if (this.destroyed) return;
    this.lastTime = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    globalThis.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.sfx.destroy();
  }

  /** 设置热更新：音效立即生效；难度/时间/摆速记入 pending，下一局生效 */
  applySettings(options: GameOptions, best: GameStatsRecord | null) {
    this.pending = { ...options };
    this.sfx.enabled = options.sound;
    this.best = best;
  }

  // ── 布局与主题 ─────────────────────────────────────────────

  private measure() {
    const parent = this.canvas.parentElement;
    const w = Math.max(320, Math.floor(parent?.clientWidth ?? this.canvas.clientWidth));
    const h = Math.max(360, Math.floor(parent?.clientHeight ?? this.canvas.clientHeight));
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    this.W = w;
    this.H = h;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.scale = Math.min(w / 900, h / 640);
    this.scale = Math.min(1.5, Math.max(0.65, this.scale));
    // 相对坐标换算回像素
    for (const item of this.items) {
      item.x = item.fx * w;
      item.y = this.groundY() + item.fy * (h - this.groundY() - 14);
      item.r = ITEM_DEFS[item.kind].r * this.scale;
      if (item.move) item.move.base = item.fx * w;
    }
  }

  private roundRect(x: number, y: number, w: number, h: number, r: number) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  private refreshTheme() {
    this.dark = document.body.classList.contains('dark');
    const style = getComputedStyle(this.canvas);
    const family = style.fontFamily;
    if (family && family !== '') this.fontStack = family;
  }

  private hudH() {
    return 46;
  }

  private pivot() {
    return { x: this.W / 2, y: this.hudH() + 44 * this.scale };
  }

  private groundY() {
    return this.hudH() + 86 * this.scale;
  }

  // ── 关卡生成 ───────────────────────────────────────────────

  private blueprint(level: number): Array<[ItemKind, number]> {
    const L = level;
    const entries: Array<[ItemKind, number]> = [
      ['goldS', 4 + Math.floor((L - 1) / 2)],
      ['goldM', 2 + Math.floor((L - 1) / 3)],
      ['goldL', L >= 2 ? Math.min(1 + Math.floor((L - 1) / 3), 4) : 1],
      ['rockS', 3 + Math.floor(L / 2)],
      ['rockB', 2 + Math.floor((L - 1) / 3)],
      ['diamond', L >= 2 ? Math.min(1 + Math.floor((L - 1) / 3), 3) : 0],
      ['bag', 1 + (L >= 3 ? 1 : 0) + (L >= 6 ? 1 : 0)],
      ['bone', 2 + (L >= 5 ? 1 : 0)],
      ['skull', L >= 4 ? 1 + Math.floor((L - 4) / 3) : 0],
      ['tnt', L >= 3 ? Math.min(1 + Math.floor((L - 3) / 2), 3) : 0],
      ['mole', L >= 3 ? 1 + (L >= 6 ? 1 : 0) : 0],
    ];
    return entries.filter(([, n]) => n > 0);
  }

  private spawnLevel(level: number) {
    this.level = level;
    this.items = [];
    this.carried = null;
    this.hookState = 'swing';
    this.hookLen = 30;
    this.hookPhase = 0;
    this.levelMoney = 0;
    this.floaters = [];
    this.explosions = [];
    const diff = DIFFICULTY[this.pending.difficulty];
    this.goal = Math.round((650 * Math.pow(1.32, level - 1) * diff.goal) / 10) * 10;

    for (const [kind, count] of this.blueprint(level)) {
      for (let i = 0; i < count; i++) this.tryPlace(kind);
    }
    this.speckles = [];
    for (let i = 0; i < 42; i++) {
      this.speckles.push({
        fx: Math.random(),
        fy: Math.random(),
        r: 1.2 + Math.random() * 2.6,
        dark: Math.random() > 0.5,
      });
    }
    // 应用一次性道具增益
    this.engineActive = this.engineNext;
    this.cloverActive = this.cloverNext;
    this.bookActive = this.bookNext;
    this.engineNext = false;
    this.cloverNext = false;
    this.bookNext = false;
  }

  // 一次性道具的“本关生效”标记（spawnLevel 里从 *Next 结转）
  private engineActive = false;
  private cloverActive = false;
  private bookActive = false;

  private tryPlace(kind: ItemKind) {
    const def = ITEM_DEFS[kind];
    const r = def.r * this.scale;
    const top = this.groundY() + r + 14;
    const bottom = this.H - r - 10;
    if (bottom <= top) return;
    for (let attempt = 0; attempt < 70; attempt++) {
      const x = r + 10 + Math.random() * (this.W - 2 * r - 20);
      const y = top + Math.random() * (bottom - top);
      let ok = true;
      for (const other of this.items) {
        const dx = other.x - x;
        const dy = other.y - y;
        const min = other.r + r + 8;
        if (dx * dx + dy * dy < min * min) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      const fx = x / this.W;
      const fy = (y - this.groundY()) / Math.max(1, this.H - this.groundY() - 14);
      const item: Item = {
        kind,
        fx,
        fy,
        x,
        y,
        r,
        value: def.value,
        weight: def.weight,
        alive: true,
        carried: false,
        spawnT: 0,
      };
      if (kind === 'mole') {
        const amp = Math.min(70 * this.scale, x - r - 12, this.W - x - r - 12);
        item.move = { amp: Math.max(24, amp), speed: 0.9 + Math.random() * 0.8, base: x, t: Math.random() * Math.PI * 2 };
      }
      this.items.push(item);
      return;
    }
  }

  // ── 主循环 ─────────────────────────────────────────────────

  private loop = (now: number) => {
    if (this.destroyed) return;
    const dt = Math.min(0.05, Math.max(0, (now - this.lastTime) / 1000));
    this.lastTime = now;
    if (!document.hidden) {
      this.update(dt);
      this.draw();
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  private update(dt: number) {
    this.refreshThemeCheap();
    this.shake = Math.max(0, this.shake - dt * 26);
    this.flash = Math.max(0, this.flash - dt * 2.4);
    for (const e of this.explosions) e.t += dt;
    this.explosions = this.explosions.filter((e) => e.t < 0.5);
    for (const f of this.floaters) {
      f.life -= dt;
      f.y -= dt * 44;
    }
    this.floaters = this.floaters.filter((f) => f.life > 0);
    for (const item of this.items) item.spawnT = Math.min(1, item.spawnT + dt * 3);

    switch (this.phase) {
      case 'menu':
        break;
      case 'intro':
        this.phaseTimer -= dt;
        if (this.phaseTimer <= 0) {
          this.phase = 'playing';
          this.timeLeft = this.pending.timeLimit;
          this.lastTickSec = Math.ceil(this.pending.timeLimit);
        }
        break;
      case 'playing':
        this.updatePlaying(dt);
        break;
      case 'result':
        this.phaseTimer -= dt;
        if (this.phaseTimer <= 0) {
          if (this.resultCleared) this.enterShop();
          else this.enterGameOver();
        }
        break;
      case 'shop':
      case 'gameover':
        break;
    }
    // 非游玩阶段也让摆锤保持摆动，画面不僵住
    if (this.phase !== 'playing' && this.hookState === 'swing') {
      this.hookPhase += dt * this.swingOmega();
      this.hookAngle = (Math.PI * 72 / 180) * Math.sin(this.hookPhase);
    }
  }

  private themeCheck = 0;
  private refreshThemeCheap() {
    this.themeCheck += 1;
    if (this.themeCheck > 30) {
      this.themeCheck = 0;
      this.refreshTheme();
    }
  }

  private updatePlaying(dt: number) {
    // 鼹鼠移动（被抓住的除外）
    for (const item of this.items) {
      if (item.move && !item.carried && item.alive) {
        item.move.t += dt * item.move.speed;
        item.x = item.move.base + Math.sin(item.move.t) * item.move.amp;
        item.fx = item.x / this.W;
      }
    }

    // 计时
    this.timeLeft -= dt;
    const sec = Math.ceil(this.timeLeft);
    if (sec <= 10 && sec >= 1 && sec !== this.lastTickSec) {
      this.lastTickSec = sec;
      this.sfx.play('tick');
    }
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.finishLevel();
      return;
    }

    // 钩子状态机
    const pivot = this.pivot();
    const omega = this.swingOmega();
    if (this.hookState === 'swing') {
      this.hookPhase += dt * omega;
      this.hookAngle = (Math.PI * 72 / 180) * Math.sin(this.hookPhase);
    } else if (this.hookState === 'extend') {
      this.hookLen += 470 * this.scale * dt;
      const tip = this.tipPos();
      if (tip.x < 6 || tip.x > this.W - 6 || tip.y > this.H - 6) {
        this.hookState = 'retract';
      } else {
        this.checkGrab(tip);
      }
    } else {
      // retract
      let v = 470 * this.scale;
      if (this.carried) {
        const strength = this.engineActive ? 1.5 : 1;
        v = (500 * this.scale * strength) / (1 + this.carried.weight);
      }
      this.hookLen -= v * dt;
      if (this.hookLen <= 30) {
        this.hookLen = 30;
        if (this.carried) this.collect(this.carried);
        this.hookState = 'swing';
      }
    }
  }

  private swingOmega() {
    const { swingSpeed, difficulty } = this.pending;
    if (swingSpeed === 'auto') return DIFFICULTY[difficulty].swing;
    return SWING_OMEGA[swingSpeed];
  }

  private tipPos() {
    const p = this.pivot();
    return {
      x: p.x + Math.sin(this.hookAngle) * this.hookLen,
      y: p.y + Math.cos(this.hookAngle) * this.hookLen,
    };
  }

  private checkGrab(tip: { x: number; y: number }) {
    for (const item of this.items) {
      if (!item.alive || item.carried) continue;
      const dx = tip.x - item.x;
      const dy = tip.y - item.y;
      const reach = item.r + 7 * this.scale;
      if (dx * dx + dy * dy <= reach * reach) {
        if (item.kind === 'tnt') {
          this.explode(item);
          this.hookState = 'retract';
          this.carried = null;
        } else {
          item.carried = true;
          this.carried = item;
          this.hookState = 'retract';
          this.sfx.play('grab');
        }
        return;
      }
    }
  }

  /** 引爆炸药桶（或被玩家用炸药销毁的物品）：波及邻近物品，TNT 逐个连锁 */
  private explode(origin: Item) {
    const blast = 62 * this.scale;
    this.sfx.play('boom');
    this.shake = 13;
    this.flash = 1;
    origin.alive = false;
    this.explosions.push({ x: origin.x, y: origin.y, t: 0, r: blast });
    const queue: Item[] = [origin];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const item of this.items) {
        if (!item.alive || item.carried) continue;
        const dx = item.x - cur.x;
        const dy = item.y - cur.y;
        if (dx * dx + dy * dy <= blast * blast) {
          item.alive = false;
          this.explosions.push({ x: item.x, y: item.y, t: 0, r: blast * 0.7 });
          if (item.kind === 'tnt') queue.push(item);
        }
      }
    }
    this.items = this.items.filter((i) => i.alive || i.carried);
  }

  private collect(item: Item) {
    item.alive = false;
    item.carried = false;
    this.carried = null;
    let value = item.value;
    switch (item.kind) {
      case 'bag': {
        const lucky = this.cloverActive;
        value = lucky
          ? 150 + Math.round(Math.random() * 550)
          : 20 + Math.round(Math.random() * 330);
        break;
      }
      case 'rockS':
      case 'rockB':
        if (this.bookActive) value *= 3;
        break;
      default:
        break;
    }
    this.levelMoney += value;
    const tip = this.tipPos();
    this.floaters.push({
      x: tip.x,
      y: tip.y - 10,
      text: `+$${value}`,
      life: 1.1,
      color: value >= 250 ? '#ffd54a' : this.dark ? '#e8e2d5' : '#5b4a2f',
    });
    const isJunk = item.kind === 'rockS' || item.kind === 'rockB' || item.kind === 'bone' || item.kind === 'skull';
    this.sfx.play(isJunk && value < 100 ? 'rock' : 'coin');
  }

  private finishLevel() {
    this.resultCleared = this.levelMoney >= this.goal;
    this.phase = 'result';
    this.phaseTimer = 1.5;
    if (this.resultCleared) {
      this.bank += this.levelMoney;
      this.sfx.play('levelup');
    } else {
      this.sfx.play('fail');
    }
  }

  private enterShop() {
    this.phase = 'shop';
    const priceScale = 1 + 0.18 * (this.level - 1);
    const round10 = (n: number) => Math.round(n / 10) * 10;
    this.shopCards = [
      { id: 'dynamite', label: '炸药', desc: '回收途中按 X 引爆抓到的物品（+1）', price: round10(SHOP_BASE_PRICE.dynamite * priceScale), sold: false },
      { id: 'engine', label: '强力马达', desc: '下一关收钩速度 +50%', price: round10(SHOP_BASE_PRICE.engine * priceScale), sold: false },
      { id: 'clover', label: '幸运四叶草', desc: '下一关神秘袋价值大幅提升', price: round10(SHOP_BASE_PRICE.clover * priceScale), sold: false },
      { id: 'book', label: '岩石图鉴', desc: '下一关石头价值 ×3', price: round10(SHOP_BASE_PRICE.book * priceScale), sold: false },
    ];
  }

  private enterGameOver() {
    this.phase = 'gameover';
    if (!this.reported) {
      this.reported = true;
      this.cb.onGameOver?.({
        score: this.bank + this.levelMoney,
        level: this.level,
        difficulty: this.pending.difficulty,
        date: new Date().toISOString(),
      });
    }
  }

  // ── 输入 ───────────────────────────────────────────────────

  private onPointerDown = (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    this.sfx.unlock();
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    this.handleAction(x, y);
  };

  private onKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
    ) {
      return;
    }
    if (e.code === 'Space' || e.key === ' ') {
      e.preventDefault();
      this.sfx.unlock();
      this.handleAction(-1, -1);
    } else if (e.key === 'x' || e.key === 'X') {
      this.useDynamite();
    } else if (e.key === 'r' || e.key === 'R') {
      this.restart();
    }
  };

  private onVisibilityChange = () => {
    if (!document.hidden) this.lastTime = performance.now();
  };

  /** 统一动作入口；x/y 为画布内坐标（键盘触发时传 -1 表示“确认”） */
  private handleAction(x: number, y: number) {
    switch (this.phase) {
      case 'menu':
        this.newGame();
        break;
      case 'intro':
        this.phaseTimer = 0;
        break;
      case 'playing':
        if (this.hookState === 'swing') {
          this.hookState = 'extend';
          this.sfx.play('fire');
        }
        break;
      case 'result':
        this.phaseTimer = 0;
        break;
      case 'shop':
        // 键盘确认（x<0）视作点击“下一关”按钮
        if (x < 0) {
          this.shopClick(this.shopNextRect.x + 1, this.shopNextRect.y + 1);
        } else {
          this.shopClick(x, y);
        }
        break;
      case 'gameover':
        this.restart();
        break;
    }
  }

  private useDynamite() {
    if (this.phase !== 'playing') return;
    if (this.dynamiteStock <= 0 || !this.carried || this.hookState !== 'retract') return;
    this.dynamiteStock -= 1;
    const item = this.carried;
    this.carried = null;
    item.carried = false;
    this.explode(item);
  }

  private restart() {
    this.sfx.unlock();
    this.bank = 0;
    this.dynamiteStock = 0;
    this.engineNext = false;
    this.cloverNext = false;
    this.bookNext = false;
    this.reported = false;
    this.newGame();
  }

  private newGame() {
    // 完全采用 pending 设置（可能已被 applySettings 更新）
    this.spawnLevel(1);
    this.bank = 0;
    this.dynamiteStock = 0;
    this.phase = 'intro';
    this.phaseTimer = 1.5;
    this.timeLeft = this.pending.timeLimit;
    this.lastTickSec = Math.ceil(this.pending.timeLimit);
  }

  private shopClick(x: number, y: number) {
    for (const rect of this.shopRects) {
      if (x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h) {
        const card = rect.card;
        if (!card.sold && this.bank >= card.price) {
          this.bank -= card.price;
          card.sold = true;
          this.sfx.play('buy');
          switch (card.id) {
            case 'dynamite':
              this.dynamiteStock += 1;
              break;
            case 'engine':
              this.engineNext = true;
              break;
            case 'clover':
              this.cloverNext = true;
              break;
            case 'book':
              this.bookNext = true;
              break;
          }
        }
        return;
      }
    }
    const n = this.shopNextRect;
    if (x >= n.x && x <= n.x + n.w && y >= n.y && y <= n.y + n.h) {
      this.spawnLevel(this.level + 1);
      this.phase = 'intro';
      this.phaseTimer = 1.5;
      this.timeLeft = this.pending.timeLimit;
      this.lastTickSec = Math.ceil(this.pending.timeLimit);
    }
  }

  // ── 渲染 ───────────────────────────────────────────────────

  private draw() {
    const { ctx, W, H } = this;
    ctx.save();
    if (this.shake > 0) {
      ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
    }

    // 背景与土层
    const sky = ctx.createLinearGradient(0, 0, 0, this.groundY());
    if (this.dark) {
      sky.addColorStop(0, '#243247');
      sky.addColorStop(1, '#2d3f57');
    } else {
      sky.addColorStop(0, '#a9dcf5');
      sky.addColorStop(1, '#dff1fd');
    }
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, this.groundY());

    const soil = ctx.createLinearGradient(0, this.groundY(), 0, H);
    if (this.dark) {
      soil.addColorStop(0, '#4c3520');
      soil.addColorStop(1, '#2f2011');
    } else {
      soil.addColorStop(0, '#a8743f');
      soil.addColorStop(1, '#75491f');
    }
    ctx.fillStyle = soil;
    ctx.fillRect(0, this.groundY(), W, H - this.groundY());

    // 泥土颗粒
    for (const s of this.speckles) {
      ctx.fillStyle = s.dark
        ? 'rgba(0,0,0,0.14)'
        : this.dark
          ? 'rgba(255,220,160,0.08)'
          : 'rgba(255,235,190,0.16)';
      ctx.beginPath();
      ctx.arc(s.fx * W, this.groundY() + s.fy * (H - this.groundY()), s.r * this.scale, 0, Math.PI * 2);
      ctx.fill();
    }

    // 草地条
    ctx.fillStyle = this.dark ? '#3f6b34' : '#6ab04c';
    ctx.fillRect(0, this.groundY() - 6 * this.scale, W, 6 * this.scale);

    // 物品
    for (const item of this.items) {
      if (item.carried || !item.alive) continue;
      this.drawItem(item, item.x, item.y, 1);
    }

    // 爆炸特效
    for (const e of this.explosions) {
      const k = e.t / 0.5;
      ctx.globalAlpha = 1 - k;
      const grad = ctx.createRadialGradient(e.x, e.y, 2, e.x, e.y, e.r * (0.6 + k * 0.8));
      grad.addColorStop(0, '#fff3b0');
      grad.addColorStop(0.5, '#ff9e3d');
      grad.addColorStop(1, 'rgba(255,80,40,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r * (0.6 + k * 0.8), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // 矿工 + 绳索 + 钩子
    if (this.phase !== 'menu' && this.phase !== 'shop') {
      this.drawMiner();
      this.drawRope();
    }

    // 浮动金额
    for (const f of this.floaters) {
      ctx.globalAlpha = Math.max(0, Math.min(1, f.life));
      ctx.fillStyle = f.color;
      ctx.font = `bold ${Math.round(15 * this.scale + 3)}px ${this.fontStack}`;
      ctx.textAlign = 'center';
      ctx.fillText(f.text, f.x, f.y);
      ctx.globalAlpha = 1;
    }

    // HUD
    this.drawHud();

    // 阶段覆盖层
    switch (this.phase) {
      case 'menu':
        this.drawMenuOverlay();
        break;
      case 'intro':
        this.drawIntroOverlay();
        break;
      case 'result':
        this.drawResultOverlay();
        break;
      case 'shop':
        this.drawShopOverlay();
        break;
      case 'gameover':
        this.drawGameOverOverlay();
        break;
    }

    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,240,200,${this.flash * 0.35})`;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }

  private drawItem(item: Item, x: number, y: number, alpha: number) {
    const { ctx } = this;
    const r = item.r;
    ctx.save();
    ctx.globalAlpha = alpha * (0.4 + 0.6 * item.spawnT);
    switch (item.kind) {
      case 'goldS':
      case 'goldM':
      case 'goldL': {
        const grad = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.15, x, y, r);
        grad.addColorStop(0, '#ffe98a');
        grad.addColorStop(0.55, '#f5c542');
        grad.addColorStop(1, '#c8930d');
        ctx.fillStyle = grad;
        ctx.beginPath();
        // 略不规则的金块轮廓
        const pts = 7;
        for (let i = 0; i <= pts; i++) {
          const a = (i / pts) * Math.PI * 2;
          const wob = 1 + 0.08 * Math.sin(i * 2.7);
          const px = x + Math.cos(a) * r * wob;
          const py = y + Math.sin(a) * r * wob;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(120,80,0,0.55)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.beginPath();
        ctx.ellipse(x - r * 0.3, y - r * 0.4, r * 0.22, r * 0.12, -0.6, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'rockS':
      case 'rockB': {
        ctx.fillStyle = this.dark ? '#8a8f96' : '#9aa1a8';
        ctx.beginPath();
        ctx.moveTo(x - r, y + r * 0.35);
        ctx.lineTo(x - r * 0.6, y - r * 0.7);
        ctx.lineTo(x + r * 0.2, y - r);
        ctx.lineTo(x + r, y - r * 0.25);
        ctx.lineTo(x + r * 0.75, y + r * 0.75);
        ctx.lineTo(x - r * 0.4, y + r * 0.85);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = this.dark ? '#5c6066' : '#6b7076';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.28)';
        ctx.beginPath();
        ctx.moveTo(x - r * 0.5, y - r * 0.5);
        ctx.lineTo(x + r * 0.15, y - r * 0.72);
        ctx.lineTo(x - r * 0.1, y - r * 0.2);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'diamond': {
        ctx.fillStyle = '#7fe3f2';
        ctx.strokeStyle = '#2ba8c4';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(x, y - r * 1.15);
        ctx.lineTo(x + r * 0.95, y - r * 0.25);
        ctx.lineTo(x + r * 0.6, y + r);
        ctx.lineTo(x - r * 0.6, y + r);
        ctx.lineTo(x - r * 0.95, y - r * 0.25);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.beginPath();
        ctx.moveTo(x - r * 0.95, y - r * 0.25);
        ctx.lineTo(x + r * 0.95, y - r * 0.25);
        ctx.moveTo(x - r * 0.5, y - r * 0.25);
        ctx.lineTo(x - r * 0.15, y + r);
        ctx.moveTo(x + r * 0.5, y - r * 0.25);
        ctx.lineTo(x + r * 0.15, y + r);
        ctx.stroke();
        break;
      }
      case 'bag': {
        ctx.fillStyle = '#8d6742';
        ctx.beginPath();
        ctx.moveTo(x - r * 0.45, y - r * 0.7);
        ctx.quadraticCurveTo(x - r, y - r * 0.1, x - r * 0.75, y + r * 0.5);
        ctx.quadraticCurveTo(x - r * 0.4, y + r, x, y + r);
        ctx.quadraticCurveTo(x + r * 0.4, y + r, x + r * 0.75, y + r * 0.5);
        ctx.quadraticCurveTo(x + r, y - r * 0.1, x + r * 0.45, y - r * 0.7);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#5e4426';
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.strokeStyle = '#5e4426';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x - r * 0.4, y - r * 0.75);
        ctx.quadraticCurveTo(x, y - r * 1.15, x + r * 0.4, y - r * 0.75);
        ctx.stroke();
        ctx.fillStyle = '#ffd54a';
        ctx.font = `bold ${Math.round(r * 0.85)}px ${this.fontStack}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('?', x, y + r * 0.25);
        ctx.textBaseline = 'alphabetic';
        break;
      }
      case 'bone': {
        ctx.strokeStyle = '#efe6d4';
        ctx.lineWidth = Math.max(3, r * 0.42);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x - r * 0.8, y);
        ctx.lineTo(x + r * 0.8, y);
        ctx.stroke();
        ctx.fillStyle = '#efe6d4';
        for (const sx of [-1, 1]) {
          ctx.beginPath();
          ctx.arc(x + sx * r * 0.85, y - r * 0.28, r * 0.32, 0, Math.PI * 2);
          ctx.arc(x + sx * r * 0.85, y + r * 0.28, r * 0.32, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.lineCap = 'butt';
        break;
      }
      case 'skull': {
        ctx.fillStyle = '#e9e2d3';
        ctx.beginPath();
        ctx.arc(x, y - r * 0.15, r * 0.85, Math.PI, 0);
        ctx.quadraticCurveTo(x + r * 0.85, y + r * 0.5, x + r * 0.45, y + r * 0.55);
        ctx.lineTo(x - r * 0.45, y + r * 0.55);
        ctx.quadraticCurveTo(x - r * 0.85, y + r * 0.5, x - r * 0.85, y - r * 0.15);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = this.dark ? '#241c10' : '#3a2f1d';
        ctx.beginPath();
        ctx.arc(x - r * 0.32, y - r * 0.15, r * 0.2, 0, Math.PI * 2);
        ctx.arc(x + r * 0.32, y - r * 0.15, r * 0.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(x - r * 0.08, y + r * 0.1, r * 0.16, r * 0.22);
        ctx.beginPath();
        ctx.moveTo(x - r * 0.5, y + r * 0.55);
        ctx.lineTo(x - r * 0.5, y + r * 0.8);
        ctx.moveTo(x, y + r * 0.55);
        ctx.lineTo(x, y + r * 0.82);
        ctx.moveTo(x + r * 0.5, y + r * 0.55);
        ctx.lineTo(x + r * 0.5, y + r * 0.8);
        ctx.strokeStyle = '#c9bfa8';
        ctx.lineWidth = 2;
        ctx.stroke();
        break;
      }
      case 'tnt': {
        ctx.fillStyle = '#c0392b';
        const w = r * 1.5;
        const h = r * 1.8;
        ctx.fillRect(x - w / 2, y - h / 2, w, h);
        ctx.strokeStyle = '#7d2018';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x - w / 2, y - h / 2, w, h);
        ctx.fillStyle = '#f8f4e8';
        ctx.font = `bold ${Math.round(r * 0.62)}px ${this.fontStack}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('TNT', x, y);
        ctx.textBaseline = 'alphabetic';
        // 引线
        ctx.strokeStyle = '#d9c27a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, y - h / 2);
        ctx.quadraticCurveTo(x + r * 0.5, y - h / 2 - r * 0.5, x + r * 0.2, y - h / 2 - r * 0.75);
        ctx.stroke();
        break;
      }
      case 'mole': {
        // 身体
        ctx.fillStyle = '#7a5236';
        ctx.beginPath();
        ctx.ellipse(x, y + r * 0.2, r, r * 0.72, 0, 0, Math.PI * 2);
        ctx.fill();
        // 头
        ctx.beginPath();
        ctx.arc(x + r * 0.55, y - r * 0.15, r * 0.5, 0, Math.PI * 2);
        ctx.fill();
        // 眼睛
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(x + r * 0.68, y - r * 0.3, r * 0.14, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#222';
        ctx.beginPath();
        ctx.arc(x + r * 0.72, y - r * 0.3, r * 0.07, 0, Math.PI * 2);
        ctx.fill();
        // 背上的钻石
        ctx.fillStyle = '#7fe3f2';
        ctx.strokeStyle = '#2ba8c4';
        ctx.lineWidth = 1;
        const dx = x - r * 0.25;
        const dy = y - r * 0.35;
        const dr = r * 0.42;
        ctx.beginPath();
        ctx.moveTo(dx, dy - dr);
        ctx.lineTo(dx + dr * 0.8, dy);
        ctx.lineTo(dx, dy + dr * 0.8);
        ctx.lineTo(dx - dr * 0.8, dy);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;
      }
    }
    ctx.restore();
  }

  private drawMiner() {
    const { ctx } = this;
    const p = this.pivot();
    const s = this.scale;
    const ground = this.groundY() - 4 * s;
    // 支撑架（卷扬机平台）
    ctx.fillStyle = this.dark ? '#5a4630' : '#7c5a36';
    ctx.fillRect(p.x - 26 * s, ground - 14 * s, 52 * s, 10 * s);
    ctx.fillStyle = this.dark ? '#3c2e1d' : '#5b432a';
    ctx.fillRect(p.x - 20 * s, ground - 4 * s, 6 * s, 4 * s);
    ctx.fillRect(p.x + 14 * s, ground - 4 * s, 6 * s, 4 * s);
    // 矿工身体
    const bx = p.x + 34 * s;
    const by = ground - 14 * s;
    ctx.fillStyle = '#3f6fb5';
    ctx.fillRect(bx - 9 * s, by - 22 * s, 18 * s, 22 * s); // 工装
    ctx.fillStyle = '#e0b48c';
    ctx.fillRect(bx - 7 * s, by - 34 * s, 14 * s, 13 * s); // 头
    ctx.fillStyle = '#f4c531';
    ctx.beginPath();
    ctx.arc(bx, by - 33 * s, 8.5 * s, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(bx - 10 * s, by - 34 * s, 20 * s, 3 * s); // 安全帽
    ctx.fillStyle = '#2c2c2c';
    ctx.fillRect(bx - 4 * s, by - 29 * s, 2.5 * s, 2.5 * s);
    ctx.fillRect(bx + 2 * s, by - 29 * s, 2.5 * s, 2.5 * s);
    // 手臂指向滑轮
    ctx.strokeStyle = '#e0b48c';
    ctx.lineWidth = 4 * s;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(bx - 6 * s, by - 16 * s);
    ctx.lineTo(p.x + 2 * s, p.y - 2 * s);
    ctx.stroke();
    ctx.lineCap = 'butt';
    // 滑轮
    ctx.fillStyle = '#4a4a4a';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5 * s, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawRope() {
    const { ctx } = this;
    const p = this.pivot();
    const tip = this.tipPos();
    ctx.strokeStyle = this.dark ? '#cdb894' : '#6b5233';
    ctx.lineWidth = Math.max(1.5, 2 * this.scale);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();
    // 钩爪
    const angle = Math.atan2(tip.y - p.y, tip.x - p.x);
    ctx.save();
    ctx.translate(tip.x, tip.y);
    ctx.rotate(angle - Math.PI / 2);
    const s = this.scale;
    ctx.strokeStyle = '#8f9499';
    ctx.lineWidth = Math.max(2.5, 3.4 * s);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 8 * s);
    // 左爪
    ctx.moveTo(0, 8 * s);
    ctx.quadraticCurveTo(-9 * s, 12 * s, -7 * s, 20 * s);
    // 右爪
    ctx.moveTo(0, 8 * s);
    ctx.quadraticCurveTo(9 * s, 12 * s, 7 * s, 20 * s);
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.restore();
    // 被抓物品挂在钩尖
    if (this.carried) {
      this.drawItem(this.carried, tip.x, tip.y + this.carried.r * 0.55, 1);
    }
  }

  private drawHud() {
    const { ctx } = this;
    const h = this.hudH();
    ctx.fillStyle = this.dark ? 'rgba(18,22,30,0.92)' : 'rgba(28,24,16,0.88)';
    ctx.fillRect(0, 0, this.W, h);
    ctx.strokeStyle = this.dark ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h - 0.5);
    ctx.lineTo(this.W, h - 0.5);
    ctx.stroke();

    const gold = '#ffd54a';
    const normal = this.dark ? '#e8e2d5' : '#f4efdf';
    const danger = '#ff7b6b';
    const fs = Math.max(11, Math.round(13 * this.scale + 1));
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${fs}px ${this.fontStack}`;

    const total = this.bank + this.levelMoney;
    const parts: Array<{ text: string; color: string; align: CanvasTextAlign }> = [
      { text: `第 ${this.level} 关`, color: normal, align: 'left' },
      { text: `目标 $${this.goal}`, color: gold, align: 'left' },
      { text: `本关 $${this.levelMoney}`, color: this.levelMoney >= this.goal ? '#8be08b' : normal, align: 'left' },
      { text: `总分 $${total}`, color: gold, align: 'left' },
      { text: `⌛ ${Math.ceil(this.timeLeft)}s`, color: this.timeLeft <= 10 ? danger : normal, align: 'right' },
    ];
    if (this.dynamiteStock > 0) {
      parts.splice(4, 0, { text: `💣×${this.dynamiteStock}(X)`, color: '#ff9e6b', align: 'right' });
    }
    if (this.best && this.best.bestScore > 0) {
      parts.splice(4, 0, { text: `最高 $${this.best.bestScore}`, color: normal, align: 'right' });
    }

    const pad = 12;
    // 左侧组
    let x = pad;
    for (let i = 0; i < 3; i++) {
      const p = parts[i];
      ctx.textAlign = 'left';
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, x, h / 2 + 1);
      x += ctx.measureText(p.text).width + 18;
    }
    // 右侧组（从右往左）
    let rx = this.W - pad;
    for (let i = parts.length - 1; i >= 3; i--) {
      const p = parts[i];
      ctx.textAlign = 'right';
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, rx, h / 2 + 1);
      rx -= ctx.measureText(p.text).width + 18;
    }
    ctx.textBaseline = 'alphabetic';
  }

  private overlayPanel(x: number, y: number, w: number, h: number) {
    const { ctx } = this;
    ctx.fillStyle = this.dark ? 'rgba(16,20,28,0.86)' : 'rgba(30,26,18,0.82)';
    this.roundRect(x, y, w, h, 12);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,213,74,0.5)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  private centerText(text: string, y: number, size: number, color: string, bold = true) {
    const { ctx } = this;
    ctx.font = `${bold ? 'bold ' : ''}${size}px ${this.fontStack}`;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.fillText(text, this.W / 2, y);
  }

  private drawMenuOverlay() {
    const { W, H } = this;
    const pw = Math.min(460, W - 40);
    const ph = 300;
    this.overlayPanel((W - pw) / 2, (H - ph) / 2, pw, ph);
    const cx = W / 2;
    let y = (H - ph) / 2 + 56;
    this.centerText('黄金矿工', y, Math.min(40, 34 * this.scale + 8), '#ffd54a');
    y += 44;
    this.centerText('点击画面或按空格开始挖矿', y, 15, this.dark ? '#e8e2d5' : '#f4efdf');
    y += 30;
    this.centerText('点击/空格：放出钩爪', y, 13, this.dark ? '#b9b3a5' : '#d8d2c0', false);
    y += 22;
    this.centerText('X：使用炸药销毁抓到的物品', y, 13, this.dark ? '#b9b3a5' : '#d8d2c0', false);
    y += 22;
    this.centerText('限时达到目标金额即可进入商店并挑战下一关', y, 13, this.dark ? '#b9b3a5' : '#d8d2c0', false);
    y += 22;
    const diff = DIFFICULTY[this.pending.difficulty].label;
    this.centerText(
      `当前难度：${diff} · 每关 ${this.pending.timeLimit}s`,
      y,
      13,
      '#ffd54a',
      false
    );
  }

  private drawIntroOverlay() {
    const { W, H } = this;
    const pw = Math.min(360, W - 40);
    const ph = 120;
    this.overlayPanel((W - pw) / 2, H * 0.3, pw, ph);
    this.centerText(`第 ${this.level} 关`, H * 0.3 + 46, 24, '#ffd54a');
    this.centerText(`目标 $${this.goal}`, H * 0.3 + 82, 18, this.dark ? '#e8e2d5' : '#f4efdf');
  }

  private drawResultOverlay() {
    const { W, H } = this;
    const pw = Math.min(400, W - 40);
    const ph = 130;
    this.overlayPanel((W - pw) / 2, H * 0.28, pw, ph);
    if (this.resultCleared) {
      this.centerText('关卡达成！', H * 0.28 + 48, 26, '#8be08b');
      this.centerText(
        `本关 $${this.levelMoney} / 目标 $${this.goal}`,
        H * 0.28 + 86,
        16,
        this.dark ? '#e8e2d5' : '#f4efdf'
      );
    } else {
      this.centerText('时间到…', H * 0.28 + 48, 26, '#ff7b6b');
      this.centerText(
        `本关 $${this.levelMoney}，未达到目标 $${this.goal}`,
        H * 0.28 + 86,
        16,
        this.dark ? '#e8e2d5' : '#f4efdf'
      );
    }
  }

  private drawGameOverOverlay() {
    const { W, H } = this;
    const pw = Math.min(420, W - 40);
    const ph = 190;
    this.overlayPanel((W - pw) / 2, (H - ph) / 2, pw, ph);
    let y = (H - ph) / 2 + 46;
    this.centerText('游戏结束', y, 28, '#ff7b6b');
    y += 44;
    const score = this.bank + this.levelMoney;
    this.centerText(`总分 $${score}`, y, 20, '#ffd54a');
    y += 32;
    const isBest = this.best ? score > this.best.bestScore : score > 0;
    this.centerText(
      isBest ? '新纪录！点击再来一局' : `最高纪录 $${this.best?.bestScore ?? 0} · 点击再来一局`,
      y,
      14,
      this.dark ? '#e8e2d5' : '#f4efdf',
      false
    );
  }

  private drawShopOverlay() {
    const { ctx, W, H } = this;
    ctx.fillStyle = this.dark ? 'rgba(10,13,19,0.9)' : 'rgba(24,20,13,0.86)';
    ctx.fillRect(0, 0, W, H);

    this.centerText('矿工商店', 52, 26, '#ffd54a');
    this.centerText(`当前资金 $${this.bank}`, 80, 15, this.dark ? '#e8e2d5' : '#f4efdf', false);

    // 卡片区
    const cards = this.shopCards;
    const gap = 14;
    const cardW = Math.min(170, (W - 40 - gap * (cards.length - 1)) / cards.length);
    const cardH = 168;
    const totalW = cards.length * cardW + (cards.length - 1) * gap;
    const startX = (W - totalW) / 2;
    const startY = (H - cardH) / 2 - 24;
    this.shopRects = [];
    cards.forEach((card, i) => {
      const x = startX + i * (cardW + gap);
      const y = startY;
      this.shopRects.push({ card, x, y, w: cardW, h: cardH });
      const affordable = this.bank >= card.price && !card.sold;
      ctx.fillStyle = this.dark ? 'rgba(40,48,64,0.95)' : 'rgba(250,246,236,0.96)';
      this.roundRect(x, y, cardW, cardH, 10);
      ctx.fill();
      ctx.strokeStyle = card.sold
        ? 'rgba(120,200,120,0.8)'
        : affordable
          ? 'rgba(255,213,74,0.9)'
          : this.dark
            ? 'rgba(255,255,255,0.15)'
            : 'rgba(0,0,0,0.15)';
      ctx.lineWidth = card.sold || affordable ? 2 : 1;
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.fillStyle = this.dark ? '#20242c' : '#2f2920';
      ctx.font = `bold 16px ${this.fontStack}`;
      ctx.fillText(card.label, x + cardW / 2, y + 30);
      ctx.font = `12px ${this.fontStack}`;
      ctx.fillStyle = this.dark ? '#5a6272' : '#6a6252';
      // 简单按宽度折行
      this.wrapText(card.desc, x + cardW / 2, y + 56, cardW - 18, 16);
      ctx.font = `bold 15px ${this.fontStack}`;
      ctx.fillStyle = card.sold ? '#5cb85c' : affordable ? '#d4a017' : this.dark ? '#8a8f99' : '#b3aa97';
      ctx.fillText(card.sold ? '已购买' : `$${card.price}`, x + cardW / 2, y + cardH - 18);
    });

    // 下一关按钮
    const bw = 190;
    const bh = 44;
    const bx = (W - bw) / 2;
    const by = startY + cardH + 30;
    this.shopNextRect = { x: bx, y: by, w: bw, h: bh };
    ctx.fillStyle = '#d4a017';
    this.roundRect(bx, by, bw, bh, 22);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#241c05';
    ctx.font = `bold 16px ${this.fontStack}`;
    ctx.fillText(`开始第 ${this.level + 1} 关`, bx + bw / 2, by + bh / 2 + 6);
  }

  private wrapText(text: string, cx: number, topY: number, maxW: number, lineH: number) {
    const { ctx } = this;
    let line = '';
    let y = topY;
    ctx.textAlign = 'center';
    for (const ch of text) {
      if (ctx.measureText(line + ch).width > maxW) {
        ctx.fillText(line, cx, y);
        line = ch;
        y += lineH;
      } else {
        line += ch;
      }
    }
    if (line) ctx.fillText(line, cx, y);
  }
}
