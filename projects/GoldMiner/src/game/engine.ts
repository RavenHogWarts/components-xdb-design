// 黄金矿工 Canvas 游戏引擎（纯 2D 矢量绘制，无外部资源）
// 状态机：menu → intro → playing → result → shop → intro… / gameover → menu
// playing 阶段按 P 暂停；进度通过 onSave 自动存档，重进后菜单可「继续游戏」。
// 生命周期契约：start() 启动 RAF，destroy() 释放全部监听与观察器（退出前落一次存档）；
// applySettings() 可重复调用，音效即时生效，难度/时间等在下一局生效。

import { Sfx } from './audio';
import { getSprite, type SpriteKey } from './assets';
import type {
  Difficulty,
  GameOptions,
  GameOverStats,
  GameSaveSlot,
  GameStatsRecord,
} from '../types';

type Phase = 'menu' | 'intro' | 'playing' | 'result' | 'shop' | 'gameover';

type ItemKind =
  | 'goldS'
  | 'goldM'
  | 'goldL'
  | 'goldXL'
  | 'rockS'
  | 'rockB'
  | 'diamond'
  | 'bag'
  | 'bone'
  | 'skull'
  | 'tnt'
  | 'mole';

/** 物品 → 原版素材 key（鼹鼠按帧取 mole0~mole3） */
const ITEM_SPRITE: Record<ItemKind, SpriteKey> = {
  goldS: 'goldS',
  goldM: 'goldM',
  goldL: 'goldL',
  goldXL: 'goldXL',
  rockS: 'rockS',
  rockB: 'rockB',
  diamond: 'diamond',
  bag: 'bag',
  bone: 'bone',
  skull: 'skull',
  tnt: 'tnt',
  mole: 'mole0',
};

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
  /** 鼹鼠行走动画计时 */
  frameT: number;
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
  { r: number; spriteW: number; value: number; weight: number; label: string }
> = {
  // r：碰撞半径基准；spriteW：素材显示宽度基准（px @ scale=1，按原图比例缩放）
  goldS: { r: 15, spriteW: 34, value: 100, weight: 1, label: '小金块' },
  goldM: { r: 26, spriteW: 60, value: 250, weight: 2.2, label: '金块' },
  goldL: { r: 44, spriteW: 102, value: 500, weight: 4.2, label: '大金块' },
  goldXL: { r: 54, spriteW: 126, value: 800, weight: 6.5, label: '巨型金块' },
  rockS: { r: 18, spriteW: 42, value: 20, weight: 2.6, label: '小石头' },
  rockB: { r: 32, spriteW: 74, value: 60, weight: 5.4, label: '大石头' },
  diamond: { r: 11, spriteW: 26, value: 600, weight: 0.5, label: '钻石' },
  bag: { r: 19, spriteW: 44, value: 0, weight: 1.7, label: '神秘袋' },
  bone: { r: 20, spriteW: 50, value: 40, weight: 1.4, label: '骨头' },
  skull: { r: 20, spriteW: 46, value: 90, weight: 2.4, label: '骷髅' },
  tnt: { r: 20, spriteW: 44, value: 0, weight: 0, label: 'TNT' },
  mole: { r: 24, spriteW: 56, value: 660, weight: 1.6, label: '钻石鼹鼠' },
};

const SHOP_BASE_PRICE: Record<ShopCard['id'], number> = {
  dynamite: 200,
  engine: 300,
  clover: 180,
  book: 240,
};

/**
 * 井口摇柄关键帧（相对绞盘中心，scon y-up）。
 * 基准取自原版 miner.scon：roll(-9.8,-12.4) / handle(24,-24.3)（相对矿工原点 (651,188)），
 * 即摇柄中心 = 绞盘中心 + (33.8, 11.9)，轴心端（素材左下）约在绞盘中心 + (21.8, -1.1)。
 * 原版三个动画里摇柄本身不动（只有手臂在动），这里的 throw/roll 摆动是本作加的演出。
 */
type WellAction = 'idle' | 'throw' | 'roll';

const WELL_HANDLE_POSES: Record<
  WellAction,
  { k0: [number, number, number]; k1: [number, number, number] }
> = {
  idle: { k0: [33.8, 11.9, 0], k1: [33.8, 10.9, -2.8] },
  throw: { k0: [33.8, 11.9, 5], k1: [33.8, 11.9, 5] },
  roll: { k0: [33.8, 11.9, 0], k1: [33.8, 11.9, 22] },
};

export interface EngineCallbacks {
  /** 一局自然结束（达标失败或中途清场后手动结束）时回调一次 */
  onGameOver?: (stats: GameOverStats) => void;
  /** 进度存档变化（null = 游戏结束清除存档），由宿主层持久化 */
  onSave?: (data: GameSaveSlot | null) => void;
  /** 进入时携带的上次存档（菜单据此显示「继续游戏」入口） */
  initialSave?: GameSaveSlot | null;
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
  private hudHValue = 44;
  // 井口摇柄动作（跟随钩爪状态：extend→throw、retract→roll，其余 idle）
  private wellAction: WellAction = 'idle';
  private wellT = 0;

  // 状态机
  private phase: Phase = 'menu';
  private phaseTimer = 0;
  /** playing 阶段暂停（P 键切换；切走视图自动暂停） */
  private paused = false;

  // 进度存档：saveSlot 同时驱动菜单「继续游戏」入口
  private saveSlot: GameSaveSlot | null = null;
  private lastSaveAt = 0;
  /** 继续游戏时带入的剩余时间（intro 结束进 playing 时消费，null = 用满额时间） */
  private pendingTimeLeft: number | null = null;

  // 关卡状态
  private level = 1;
  private bank = 0; // 已结算关卡的累计金额
  private levelMoney = 0;
  private goal = 0;
  private timeLeft = 60;
  private lastTickSec = -1;
  private items: Item[] = [];
  private dirtPattern: CanvasPattern | null = null;

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

  // 菜单按钮命中区域（drawMenuOverlay 每帧写入）
  private menuContinueRect: { x: number; y: number; w: number; h: number } | null = null;
  private menuNewRect: { x: number; y: number; w: number; h: number } = { x: 0, y: 0, w: 0, h: 0 };

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
    this.saveSlot = callbacks.initialSave ?? null;

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
    // 退出视图前把进行中的一局落一次存档（menu/result/gameover 无可存内容）
    this.autoSave(true);
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
    // 全屏填充舞台：尺寸完全跟随容器（无固定宽高比），纵向布局按 k() 映射原版比例
    const w = Math.max(320, Math.floor(parent?.clientWidth || this.canvas.clientWidth || 640));
    const h = Math.max(220, Math.floor(parent?.clientHeight || this.canvas.clientHeight || 400));
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    this.W = w;
    this.H = h;
    this.hudHValue = Math.round(Math.min(64, Math.max(30, h * 0.095)));
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';
    // 物品尺寸随画布分辨率放大（纵向按原版比例，最高 2.2 倍；横向过窄时额外收窄防止拥挤）
    this.scale = Math.min(2.2, Math.max(0.5, Math.min(this.k() * 1.25, w / 780)));
    // 相对坐标换算回像素
    for (const item of this.items) {
      item.x = item.fx * w;
      item.y = this.dirtTop() + item.fy * (h - this.dirtTop() - 10);
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
    return this.hudHValue;
  }

  /**
   * 原版参照缩放：原版画布 1280x720，顶部 hudH 区域让位给 HUD 后，
   * 剩余高度按 674 映射（原版地表 y=175、绳枢轴 y=169、矿工实体原点 (651,188)）
   */
  private k() {
    return (this.H - this.hudHValue) / 674;
  }

  /** 井口中心（原版 ropehide 双绳中心 641，摆绳从双绳之间穿出） */
  private wellCenterX() {
    return this.W / 2 + this.k();
  }

  /** 绳枢轴（原版 ropepin (640,169)，与井口双绳中心对齐） */
  private pivot() {
    return { x: this.wellCenterX(), y: this.hudHValue + 123 * this.k() };
  }

  /** 地表顶边（原版 groundtile 顶 y=175） */
  private groundY() {
    return this.hudHValue + 129 * this.k();
  }

  /** 地表条（groundtile）高度（原版 40px） */
  private stripH() {
    return 40 * this.k();
  }

  /** 钩爪静止绳长（原版钩爪挂点位于枢轴下方 44px，挂点在爪高 12.9% 热点处） */
  private minLen() {
    return 44 * this.k();
  }

  /** 地下可放置区域顶边 */
  private dirtTop() {
    return this.groundY() + this.stripH();
  }

  // ── 关卡生成 ───────────────────────────────────────────────

  private blueprint(level: number): Array<[ItemKind, number]> {
    const L = level;
    const entries: Array<[ItemKind, number]> = [
      ['goldS', 4 + Math.floor((L - 1) / 2)],
      ['goldM', 2 + Math.floor((L - 1) / 3)],
      ['goldL', L >= 2 ? Math.min(1 + Math.floor((L - 1) / 4), 3) : 1],
      ['goldXL', L >= 4 ? 1 : 0],
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
    this.hookLen = this.minLen();
    this.hookPhase = 0;
    this.levelMoney = 0;
    this.floaters = [];
    this.explosions = [];
    const diff = DIFFICULTY[this.pending.difficulty];
    this.goal = Math.round((650 * Math.pow(1.32, level - 1) * diff.goal) / 10) * 10;

    for (const [kind, count] of this.blueprint(level)) {
      for (let i = 0; i < count; i++) this.tryPlace(kind);
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
    const top = this.dirtTop() + r + 8;
    const bottom = this.H - r - 10;
    if (bottom <= top) return;
    for (let attempt = 0; attempt < 70; attempt++) {
      const x = r + 10 + Math.random() * (this.W - 2 * r - 20);
      const y = top + Math.random() * (bottom - top);
      let ok = true;
      for (const other of this.items) {
        const dx = other.x - x;
        const dy = other.y - y;
        const min = other.r + r + 6;
        if (dx * dx + dy * dy < min * min) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      const fx = x / this.W;
      const fy = (y - this.dirtTop()) / Math.max(1, this.H - this.dirtTop() - 10);
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
        frameT: 0,
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
    if (this.paused) return;
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
          // 继续游戏时沿用存档剩余时间；新关卡用满额时间
          this.timeLeft = this.pendingTimeLeft ?? this.pending.timeLimit;
          this.pendingTimeLeft = null;
          this.lastTickSec = Math.ceil(this.timeLeft);
          this.autoSave(true);
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
    // 井口摇柄动作：放钩 → throw，收绳 → roll，其余 idle
    if (this.phase === 'playing') {
      this.wellAction =
        this.hookState === 'extend' ? 'throw' : this.hookState === 'retract' ? 'roll' : 'idle';
    } else {
      this.wellAction = 'idle';
    }
    this.wellT += dt / 0.5;

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
    // 鼹鼠移动（被抓住的除外）+ 行走动画计时
    for (const item of this.items) {
      item.frameT += dt;
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
      if (this.hookLen <= this.minLen()) {
        this.hookLen = this.minLen();
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
    this.autoSave();
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
    this.autoSave(true);
  }

  private enterGameOver() {
    this.phase = 'gameover';
    // 一局终结：清除存档，菜单不再提供「继续游戏」
    this.saveSlot = null;
    this.cb.onSave?.(null);
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
    } else if (e.key === 'p' || e.key === 'P') {
      this.togglePause();
    } else if (e.key === 'r' || e.key === 'R') {
      this.restart();
    }
  }

  /** P 键暂停切换；仅 playing 阶段有效，暂停瞬间落一次存档 */
  private togglePause() {
    if (this.phase !== 'playing') return;
    this.paused = !this.paused;
    if (this.paused) this.autoSave(true);
  }

  private onVisibilityChange = () => {
    if (!document.hidden) {
      this.lastTime = performance.now();
    } else if (this.phase === 'playing' && !this.paused) {
      // 切走视图：冻结计时并保存，回来后从暂停面板继续
      this.paused = true;
      this.autoSave(true);
    }
  };

  /** 统一动作入口；x/y 为画布内坐标（键盘触发时传 -1 表示“确认”） */
  private handleAction(x: number, y: number) {
    switch (this.phase) {
      case 'menu': {
        // 有存档时菜单是双按钮：点击只认按钮，键盘确认默认继续上次进度
        if (this.menuContinueRect) {
          if (x < 0) {
            this.continueGame();
          } else if (this.inRect(x, y, this.menuContinueRect)) {
            this.continueGame();
          } else if (this.inRect(x, y, this.menuNewRect)) {
            this.newGame();
          }
          break;
        }
        this.newGame();
        break;
      }
      case 'intro':
        this.phaseTimer = 0;
        break;
      case 'playing':
        if (this.paused) {
          this.paused = false;
          break;
        }
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
    if (this.phase !== 'playing' || this.paused) return;
    if (this.dynamiteStock <= 0 || !this.carried || this.hookState !== 'retract') return;
    this.dynamiteStock -= 1;
    const item = this.carried;
    this.carried = null;
    item.carried = false;
    this.explode(item);
    this.autoSave(true);
  }

  private restart() {
    this.sfx.unlock();
    this.paused = false;
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
    this.pendingTimeLeft = null;
    this.timeLeft = this.pending.timeLimit;
    this.lastTickSec = Math.ceil(this.pending.timeLimit);
    this.autoSave(true);
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
          this.autoSave(true);
        }
        return;
      }
    }
    const n = this.shopNextRect;
    if (x >= n.x && x <= n.x + n.w && y >= n.y && y <= n.y + n.h) {
      this.spawnLevel(this.level + 1);
      this.phase = 'intro';
      this.phaseTimer = 1.5;
      this.pendingTimeLeft = null;
      this.timeLeft = this.pending.timeLimit;
      this.lastTickSec = Math.ceil(this.pending.timeLimit);
      this.autoSave(true);
    }
  }

  // ── 进度存档 ───────────────────────────────────────────────

  /** 当前可存档阶段快照（menu/result/gameover 返回 null） */
  private snapshot(): GameSaveSlot | null {
    if (this.phase !== 'intro' && this.phase !== 'playing' && this.phase !== 'shop') return null;
    return {
      v: 1,
      phase: this.phase,
      level: this.level,
      bank: this.bank,
      levelMoney: this.levelMoney,
      goal: this.goal,
      timeLeft: this.timeLeft,
      lenMul: this.hookLen / Math.max(1, this.minLen()),
      hookPhase: this.hookPhase,
      hookState: this.hookState,
      dynamiteStock: this.dynamiteStock,
      buffs: {
        engineActive: this.engineActive,
        engineNext: this.engineNext,
        cloverActive: this.cloverActive,
        cloverNext: this.cloverNext,
        bookActive: this.bookActive,
        bookNext: this.bookNext,
      },
      items: this.items.map((i) => ({
        kind: i.kind,
        fx: i.fx,
        fy: i.fy,
        alive: i.alive,
        carried: i.carried,
        move: i.move ? { amp: i.move.amp, speed: i.move.speed, t: i.move.t } : undefined,
      })),
      savedAt: new Date().toISOString(),
    };
  }

  /** 自动存档：关卡边界/购买/暂停等强制落档，playing 中高频事件（收集）按 2.5s 节流 */
  private autoSave(force = false) {
    const snap = this.snapshot();
    if (!snap) return;
    const now = performance.now();
    if (!force && now - this.lastSaveAt < 2500) return;
    this.lastSaveAt = now;
    this.saveSlot = snap;
    this.cb.onSave?.(snap);
  }

  /** 从存档恢复：shop 存档回到商店，intro/playing 存档回到关卡介绍页（沿用剩余时间） */
  private continueGame() {
    const s = this.saveSlot;
    if (!s) {
      this.newGame();
      return;
    }
    this.sfx.unlock();
    this.reported = false;
    this.paused = false;
    this.bank = s.bank;
    this.levelMoney = s.levelMoney;
    this.goal = s.goal;
    this.level = s.level;
    this.dynamiteStock = s.dynamiteStock;
    this.engineActive = s.buffs.engineActive;
    this.engineNext = s.buffs.engineNext;
    this.cloverActive = s.buffs.cloverActive;
    this.cloverNext = s.buffs.cloverNext;
    this.bookActive = s.buffs.bookActive;
    this.bookNext = s.buffs.bookNext;
    this.floaters = [];
    this.explosions = [];
    this.shake = 0;
    this.flash = 0;

    if (s.phase === 'shop') {
      this.items = [];
      this.carried = null;
      this.hookState = 'swing';
      this.hookLen = this.minLen();
      this.hookPhase = 0;
      this.enterShop();
      return;
    }

    // 按相对坐标重建物品布局（与 measure() 的换算一致）
    this.items = [];
    for (const it of s.items) {
      const def = ITEM_DEFS[it.kind as ItemKind];
      if (!def) continue;
      const r = def.r * this.scale;
      const x = it.fx * this.W;
      const y = this.dirtTop() + it.fy * Math.max(1, this.H - this.dirtTop() - 10);
      const item: Item = {
        kind: it.kind as ItemKind,
        fx: it.fx,
        fy: it.fy,
        x,
        y,
        r,
        value: def.value,
        weight: def.weight,
        alive: it.alive,
        carried: it.carried,
        frameT: 0,
        spawnT: 1,
      };
      if (it.kind === 'mole') {
        const amp = it.move
          ? Math.min(it.move.amp, 70 * this.scale, x - r - 12, this.W - x - r - 12)
          : Math.min(70 * this.scale, x - r - 12, this.W - x - r - 12);
        item.move = {
          amp: Math.max(8, amp),
          speed: it.move?.speed || 1.2,
          base: x,
          t: it.move?.t ?? 0,
        };
      }
      this.items.push(item);
    }
    this.carried = this.items.find((i) => i.carried) ?? null;
    this.hookState = s.hookState === 'extend' || s.hookState === 'retract' ? s.hookState : 'swing';
    if (!this.carried && this.hookState === 'retract') this.hookState = 'swing';
    this.hookPhase = s.hookPhase;
    this.hookAngle = (Math.PI * 72 / 180) * Math.sin(this.hookPhase);
    this.hookLen = Math.max(this.minLen(), s.lenMul * this.minLen());
    this.phase = 'intro';
    this.phaseTimer = 1.5;
    this.pendingTimeLeft = s.phase === 'playing' ? s.timeLeft : null;
    this.timeLeft = this.pendingTimeLeft ?? this.pending.timeLimit;
    this.lastTickSec = Math.ceil(this.timeLeft);
    this.autoSave(true);
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

    // 地下：原版泥土贴图平铺（素材未就绪时降级为渐变）
    const groundY = this.groundY();
    const dirt = getSprite('dirt');
    if (dirt) {
      if (!this.dirtPattern) this.dirtPattern = ctx.createPattern(dirt.img, 'repeat');
      if (this.dirtPattern) {
        ctx.fillStyle = this.dirtPattern;
        ctx.fillRect(0, groundY, W, H - groundY);
      }
      // 深度渐暗增强层次
      const depth = ctx.createLinearGradient(0, groundY, 0, H);
      depth.addColorStop(0, 'rgba(0,0,0,0)');
      depth.addColorStop(1, this.dark ? 'rgba(0,0,0,0.45)' : 'rgba(30,10,0,0.3)');
      ctx.fillStyle = depth;
      ctx.fillRect(0, groundY, W, H - groundY);
    } else {
      const soil = ctx.createLinearGradient(0, groundY, 0, H);
      if (this.dark) {
        soil.addColorStop(0, '#4c3520');
        soil.addColorStop(1, '#2f2011');
      } else {
        soil.addColorStop(0, '#a8743f');
        soil.addColorStop(1, '#75491f');
      }
      ctx.fillStyle = soil;
      ctx.fillRect(0, groundY, W, H - groundY);
    }

    // 地表条（原版 groundtile 水平平铺，1px 重叠避免接缝）
    const ground = getSprite('ground');
    if (ground) {
      const gh = this.stripH() + 4 * this.scale;
      const gw = (gh / ground.rect[3]) * ground.rect[2];
      for (let gx = 0; gx < W + gw; gx += gw - 1) {
        ctx.drawImage(
          ground.img, ground.rect[0], ground.rect[1], ground.rect[2], ground.rect[3],
          gx, groundY, gw, gh
        );
      }
    } else {
      ctx.fillStyle = this.dark ? '#3f6b34' : '#6ab04c';
      ctx.fillRect(0, groundY - 6 * this.scale, W, 6 * this.scale);
    }

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

    // 井口装置 + 绳索 + 钩爪（层叠：绞盘摇柄紧贴绳根，绳/钩在上，双绳最后盖绳根）
    if (this.phase !== 'menu' && this.phase !== 'shop') {
      this.drawWellHead();
      this.drawRope();
      this.drawRopeHide();
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

    // 暂停面板（最上层，盖住游戏画面但不盖 HUD 文字信息）
    if (this.paused && this.phase === 'playing') {
      this.drawPauseOverlay();
    }

    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,240,200,${this.flash * 0.35})`;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }

  /** 按目标宽度等比绘制素材（中心对齐）；未就绪返回 false */
  private drawSprite(
    key: SpriteKey,
    x: number,
    y: number,
    w: number,
    alpha = 1
  ): boolean {
    const sprite = getSprite(key);
    if (!sprite) return false;
    const h = (w * sprite.rect[3]) / sprite.rect[2];
    const prev = this.ctx.globalAlpha;
    this.ctx.globalAlpha = prev * alpha;
    this.ctx.drawImage(
      sprite.img,
      sprite.rect[0],
      sprite.rect[1],
      sprite.rect[2],
      sprite.rect[3],
      x - w / 2,
      y - h / 2,
      w,
      h
    );
    this.ctx.globalAlpha = prev;
    return true;
  }

  private drawItem(item: Item, x: number, y: number, alpha: number) {
    const { ctx } = this;
    const r = item.r;
    ctx.save();
    ctx.globalAlpha = alpha * (0.4 + 0.6 * item.spawnT);
    // 原版素材路径：鼹鼠按行走动画取帧，翻转跟随移动方向
    let spriteKey: SpriteKey | null = ITEM_SPRITE[item.kind];
    if (item.kind === 'mole') {
      const frame = Math.floor(item.frameT / 0.14) % 4;
      spriteKey = (['mole0', 'mole1', 'mole2', 'mole3'] as SpriteKey[])[frame];
    }
    if (spriteKey) {
      const def = ITEM_DEFS[item.kind];
      const w = def.spriteW * this.scale;
      const sprite = getSprite(spriteKey);
      if (sprite) {
        const h = (w * sprite.rect[3]) / sprite.rect[2];
        const movingRight =
          item.move === undefined ||
          Math.cos(item.move.t) >= 0 ||
          item.carried ||
          !item.alive;
        if (movingRight) {
          ctx.drawImage(
            sprite.img, sprite.rect[0], sprite.rect[1], sprite.rect[2], sprite.rect[3],
            x - w / 2, y - h / 2, w, h
          );
        } else {
          ctx.save();
          ctx.translate(x, y);
          ctx.scale(-1, 1);
          ctx.drawImage(
            sprite.img, sprite.rect[0], sprite.rect[1], sprite.rect[2], sprite.rect[3],
            -w / 2, -h / 2, w, h
          );
          ctx.restore();
        }
        ctx.restore();
        return;
      }
    }
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

  private drawRope() {
    const { ctx } = this;
    const p = this.pivot();
    const tip = this.tipPos();
    // 原版绳索：ropetile 灰色纹理（6x4）沿绳方向平铺（放大 2.3 倍保证可见度）；
    // 素材未就绪时降级为灰色线
    const tile = getSprite('ropeTile');
    if (tile) {
      const len = Math.hypot(tip.x - p.x, tip.y - p.y);
      const angle = Math.atan2(tip.y - p.y, tip.x - p.x);
      const tw = 14 * this.k();
      const th = 9 * this.k();
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(angle);
      for (let d = 0; d < len; d += tw - 1) {
        ctx.drawImage(
          tile.img, tile.rect[0], tile.rect[1], tile.rect[2], tile.rect[3],
          d, -th / 2, tw, th
        );
      }
      ctx.restore();
    } else {
      ctx.strokeStyle = '#9a9a9a';
      ctx.lineWidth = Math.max(3, 8 * this.k());
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.stroke();
    }
    // 红色销钉（原版 ropepin，绳枢轴标记；同比例放大）
    const pin = getSprite('ropePin');
    if (pin) {
      const w = 10 * this.k();
      const h = 13 * this.k();
      ctx.drawImage(
        pin.img, pin.rect[0], pin.rect[1], pin.rect[2], pin.rect[3],
        p.x - w / 2, p.y - h / 2, w, h
      );
    }
    // 钩爪（原版裸爪素材，铰链在上、爪尖朝下；挂点为素材高度 12.9% 处的热点，
    // scon y-up，画布旋转角取反使其与绳同向）
    const claw = getSprite('claw');
    if (claw) {
      const cw = 50 * this.k();
      const chh = (cw * claw.rect[3]) / claw.rect[2];
      ctx.save();
      ctx.translate(tip.x, tip.y);
      ctx.rotate(-this.hookAngle);
      ctx.drawImage(
        claw.img, claw.rect[0], claw.rect[1], claw.rect[2], claw.rect[3],
        -cw / 2, -0.13 * chh, cw, chh
      );
      ctx.restore();
      if (this.carried) {
        this.drawItem(this.carried, tip.x, tip.y + chh * 0.6 + this.carried.r * 0.35, 1);
      }
      return;
    }
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

  /**
   * 井口装置：绞盘 + 摇柄。按原版 miner.scon 布局，绞盘（roll，73x68）中心在
   * 矿工原点 (651,188) + (-9.8,-12.4) = (641.2,175.6)，即绳枢轴 (640,169) 正下方
   * 偏右 (1.2, 6.6)：绞盘坐在井口正中（约一半没入地表条带），摆绳从双绳与绞盘之间穿出。
   */
  private drawWellHead() {
    const winch = getSprite('winch');
    if (!winch) return;
    const { ctx } = this;
    const k = this.k();
    const p = this.pivot();
    const wx = p.x + 1.2 * k;
    const wy = p.y + 6.6 * k;
    const ww = 73 * k;
    const wh = 68 * k;
    ctx.drawImage(
      winch.img, winch.rect[0], winch.rect[1], winch.rect[2], winch.rect[3],
      wx - ww / 2, wy - wh / 2, ww, wh
    );
    const handle = getSprite('minerHandle');
    if (handle) {
      const pose = WELL_HANDLE_POSES[this.wellAction];
      const t = this.wellAction === 'throw' ? 0 : this.wellT % 1;
      const ox = pose.k0[0] + (pose.k1[0] - pose.k0[0]) * t;
      const oy = pose.k0[1] + (pose.k1[1] - pose.k0[1]) * t;
      const oa = pose.k0[2] + (pose.k1[2] - pose.k0[2]) * t;
      const hw = handle.rect[2] * k;
      const hh = handle.rect[3] * k;
      // 摇柄轴心端在素材左下角（24x26 中约 (1,25)），绕轴心旋转才是曲柄的真实运动
      const ax = -hw / 2 + 1 * k;
      const ay = hh / 2 - 1 * k;
      ctx.save();
      ctx.translate(wx + ox * k + ax, wy - oy * k + ay);
      ctx.rotate((-oa * Math.PI) / 180);
      ctx.drawImage(
        handle.img, handle.rect[0], handle.rect[1], handle.rect[2], handle.rect[3],
        -ax - hw / 2, -ay - hh / 2, hw, hh
      );
      ctx.restore();
    }
  }

  /**
   * 井口两根绳（原版 ropehide 31x34 @ 锚点 (641,172)、热点 (0.516,0.647)）：
   * 静态双绳环盖在摆动绳根上，摆动的绳从两根静绳之间穿出（ropehide 中心与绳枢轴同点对齐），
   * 构成井口。按原版实测，双绳中心在枢轴 (640,169) + (0.5,-2)。
   */
  private drawRopeHide() {
    const sprite = getSprite('ropeHide');
    if (!sprite) return;
    const k = this.k();
    const w = 31 * k;
    const h = 34 * k;
    const p = this.pivot();
    this.ctx.drawImage(
      sprite.img, sprite.rect[0], sprite.rect[1], sprite.rect[2], sprite.rect[3],
      p.x + 0.5 * k - w / 2,
      p.y - 2 * k - h / 2,
      w, h
    );
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
    const parts: Array<{ text: string; color: string; align: CanvasTextAlign; icon?: SpriteKey }> = [
      { text: `第 ${this.level} 关`, color: normal, align: 'left' },
      { text: `目标 $${this.goal}`, color: gold, align: 'left' },
      { text: `本关 $${this.levelMoney}`, color: this.levelMoney >= this.goal ? '#8be08b' : normal, align: 'left' },
      { text: `总分 $${total}`, color: gold, align: 'left' },
      { text: `⌛ ${Math.ceil(this.timeLeft)}s`, color: this.timeLeft <= 10 ? danger : normal, align: 'right' },
    ];
    if (this.dynamiteStock > 0) {
      parts.splice(4, 0, { text: `×${this.dynamiteStock} (X)`, color: '#ff9e6b', align: 'right', icon: 'bomb' });
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
    // 右侧组（从右往左；带 icon 的部分图标在文本左侧）
    let rx = this.W - pad;
    for (let i = parts.length - 1; i >= 3; i--) {
      const p = parts[i];
      const tw = ctx.measureText(p.text).width;
      ctx.fillStyle = p.color;
      if (p.icon) {
        const iconSize = Math.min(20, 13 * this.scale + 5);
        const total = iconSize + 4 + tw;
        this.drawSprite(p.icon, rx - total + iconSize / 2, h / 2 + 1, iconSize);
        ctx.textAlign = 'left';
        ctx.fillText(p.text, rx - total + iconSize + 4, h / 2 + 1);
        rx -= total + 16;
      } else {
        ctx.textAlign = 'right';
        ctx.fillText(p.text, rx, h / 2 + 1);
        rx -= tw + 18;
      }
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

  private inRect(x: number, y: number, r: { x: number; y: number; w: number; h: number }) {
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  /** 菜单/面板通用按钮：primary 金底实心，secondary 描边 */
  private drawButton(
    rect: { x: number; y: number; w: number; h: number },
    label: string,
    primary: boolean
  ) {
    const { ctx } = this;
    if (primary) {
      ctx.fillStyle = '#d4a017';
      this.roundRect(rect.x, rect.y, rect.w, rect.h, rect.h / 2);
      ctx.fill();
      ctx.fillStyle = '#241c05';
    } else {
      ctx.strokeStyle = this.dark ? 'rgba(232,226,213,0.55)' : 'rgba(244,239,223,0.6)';
      ctx.lineWidth = 1.5;
      this.roundRect(rect.x, rect.y, rect.w, rect.h, rect.h / 2);
      ctx.stroke();
      ctx.fillStyle = this.dark ? '#e8e2d5' : '#f4efdf';
    }
    ctx.font = `bold 15px ${this.fontStack}`;
    ctx.textAlign = 'center';
    ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2 + 5);
  }

  private drawPauseOverlay() {
    const { W, H } = this;
    this.ctx.fillStyle = 'rgba(8,10,14,0.5)';
    this.ctx.fillRect(0, 0, W, H);
    const pw = Math.min(320, W - 40);
    const ph = 120;
    this.overlayPanel((W - pw) / 2, (H - ph) / 2, pw, ph);
    this.centerText('已暂停', (H - ph) / 2 + 46, 24, '#ffd54a');
    this.centerText(
      '按 P 或点击画面继续',
      (H - ph) / 2 + 82,
      14,
      this.dark ? '#e8e2d5' : '#f4efdf',
      false
    );
  }

  private drawMenuOverlay() {
    const { W, H } = this;
    const save = this.saveSlot;
    const ph = save ? 372 : 322;
    const pw = Math.min(460, W - 40);
    this.overlayPanel((W - pw) / 2, (H - ph) / 2, pw, ph);
    const cx = W / 2;
    let y = (H - ph) / 2 + 54;
    // 标题两侧点缀原版金块素材
    const decoW = 30 * this.scale + 10;
    this.drawSprite('goldM', cx - 96, y - 10, decoW);
    this.drawSprite('goldS', cx + 96, y - 8, decoW * 0.66);
    this.centerText('黄金矿工', y, Math.min(40, 34 * this.scale + 8), '#ffd54a');
    y += 40;
    const muted = this.dark ? '#b9b3a5' : '#d8d2c0';
    if (save) {
      this.centerText('检测到未完成的一局', y, 14, muted, false);
      y += 16;
      // 双按钮：继续上次进度 / 从头开始（命中区域每帧写入，供 handleAction 使用）
      const bw = Math.min(260, pw - 56);
      this.menuContinueRect = { x: cx - bw / 2, y, w: bw, h: 42 };
      const label =
        save.phase === 'shop'
          ? `继续游戏 · 商店采购（$${save.bank}）`
          : `继续游戏 · 第 ${save.level} 关（$${save.bank}）`;
      this.drawButton(this.menuContinueRect, label, true);
      y += 54;
      this.menuNewRect = { x: cx - bw / 2, y, w: bw, h: 42 };
      this.drawButton(this.menuNewRect, '开始新游戏', false);
      y += 74;
    } else {
      this.menuContinueRect = null;
      this.centerText('点击画面或按空格开始挖矿', y, 15, this.dark ? '#e8e2d5' : '#f4efdf');
      y += 34;
    }
    this.centerText('点击/空格：放出钩爪 · P：暂停 · R：重开', y, 13, muted, false);
    y += 22;
    this.centerText('X：使用炸药销毁抓到的物品', y, 13, muted, false);
    y += 22;
    this.centerText('限时达到目标金额即可进入商店并挑战下一关', y, 13, muted, false);
    y += 22;
    const diff = DIFFICULTY[this.pending.difficulty].label;
    this.centerText(
      `当前难度：${diff} · 每关 ${this.pending.timeLimit}s · 进度自动保存`,
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
