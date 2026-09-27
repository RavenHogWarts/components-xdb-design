// ═════════════════════════════════════════════════════════════
// T-Rex Runner 游戏引擎（移植版）
//
// 来源：Chromium 离线小恐龙游戏（The Chromium Authors，BSD 许可），
// 经 https://github.com/wayou/t-rex-runner（BSD 3-Clause）提取，
// 原始文件：refer/t-rex-runner/index.js。
// 本文件保持原版类结构、常量与逐行逻辑（含英文注释），
// 仅做以下 XDB 宿主适配（每处在行内以【XDB】标注）：
//   1. IIFE + window 单例 → ES module 类导出；同一页面可多实例
//   2. 精灵图/音效来源：页面内嵌 <img>/<template> → assets.ts 的 data URL
//   3. 容器：CSS 选择器 → 构造函数注入挂载元素；class 全部加 trexRunner-- 前缀
//   4. 日夜反转：document.body.classList → 挂载元素 classList（样式收敛在本插件）
//   5. 键盘：保留 document 监听，但仅"激活实例"响应（最近挂载/点击的实例）
//   6. 尺寸自适应：window resize → ResizeObserver（Obsidian 面板拖拽友好）
//   7. 生命周期：新增 destroy()（移除监听/取消 rAF/清理注入 DOM 与音效上下文）
//   8. 音效：AudioContext 创建失败静默降级；新增 setSoundEnabled() 开关
//   9. 最高分：原版仅存内存 → 由宿主经 options.highScore 注入、onGameOver 回调持久化
//  10. 移除离线页专属逻辑：snackbar/企业禁用态/静态 icon/arcade 全屏模式/提示浮层
//  11. 触屏：全屏触控层 → 游戏区域内触控层；新增 pressJump/releaseJump/
//      pressDuck/releaseDuck 供 HUD 按钮复用原版按键逻辑
//  12. 开场动画：style 注入 document.head → 注入挂载元素内（destroy 可清理）
// ═════════════════════════════════════════════════════════════

import {
  SPRITE_1X_URL,
  SPRITE_2X_URL,
  SOUND_PRESS_B64,
  SOUND_HIT_B64,
  SOUND_REACHED_B64,
} from './assets';

/**
 * Default game width.
 * @const
 */
var DEFAULT_WIDTH = 600;

/**
 * Frames per second.
 * @const
 */
var FPS = 60;

/** 【XDB】环境守卫：validator 等无 DOM 环境下 eval 产物时允许模块加载（浏览器内取值与原版一致） */
var HAS_WINDOW = typeof window !== 'undefined';

/** @const */
var IS_HIDPI = HAS_WINDOW && window.devicePixelRatio > 1;

/** @const */
var IS_IOS = HAS_WINDOW && /iPad|iPhone|iPod/.test(window.navigator.platform);

/** @const */
var IS_MOBILE =
  (HAS_WINDOW && /Android/.test(window.navigator.userAgent)) || IS_IOS;

/** @const */
var IS_TOUCH_ENABLED = HAS_WINDOW && 'ontouchstart' in window;

/** 【XDB】插件专属 class 前缀（原版为 runner-container / runner-canvas / inverted / controller） */
var CLASSES = {
  CONTAINER: 'trexRunner--container',
  CANVAS: 'trexRunner--canvas',
  INVERTED: 'trexRunner--inverted',
  TOUCH_CONTROLLER: 'trexRunner--controller',
};

/**
 * 【XDB】宿主注入的初始状态与终局回调（最高分持久化入口）。
 * highScore 为"实际得分"（距离 × 0.025），内部仍按原版以像素距离存储。
 */
export interface RunnerCallbacks {
  onGameOver?: (actualScore: number, isNewRecord: boolean) => void;
}

export interface RunnerOptions {
  highScore?: number;
  soundEnabled?: boolean;
}

/** 【XDB】HUD 状态快照（React 侧轮询展示用） */
export interface RunnerSnapshot {
  started: boolean;
  playing: boolean;
  crashed: boolean;
  paused: boolean;
  score: number;
  highScore: number;
  speed: number;
}

/** 【XDB】精灵图实例（原版挂在 Runner.imageSprite 静态上） */
var imageSprite: HTMLImageElement;

/** 【XDB】键盘响应门控：最近挂载或被点击的实例（原版是 window 单例，天然只有一个） */
var activeRunner: any = null;

/**
 * T-Rex runner.
 * @param {HTMLElement} outerContainerEl 【XDB】宿主挂载元素（原版为选择器字符串）
 * @param {Object} opt_options 【XDB】初始最高分 / 音效开关（原版为 opt_config 调试覆盖）
 * @param {Object} callbacks 【XDB】终局回调
 * @constructor
 * @export
 */
function Runner(
  outerContainerEl: HTMLElement,
  opt_options?: RunnerOptions,
  callbacks?: RunnerCallbacks
) {
  this.outerContainerEl = outerContainerEl;
  this.containerEl = null;
  this.detailsButton = null;

  this.config = Runner.config;

  this.dimensions = Runner.defaultDimensions;

  this.canvas = null;
  this.canvasCtx = null;

  this.tRex = null;

  this.distanceMeter = null;
  this.distanceRan = 0;

  this.highestScore = 0;

  this.time = 0;
  this.runningTime = 0;
  this.msPerFrame = 1000 / FPS;
  this.currentSpeed = this.config.SPEED;

  this.obstacles = [];

  this.activated = false; // Whether the easter egg has been activated.
  this.playing = false; // Whether the game is currently in play state.
  this.crashed = false;
  this.paused = false;
  this.inverted = false;
  this.invertTimer = 0;
  this.resizeTimerId_ = null;

  this.playCount = 0;

  // Sound FX.
  this.audioBuffer = null;
  this.soundFx = {};
  // 【XDB】音效开关（默认随原版开启）
  this.soundEnabled = opt_options ? opt_options.soundEnabled !== false : true;

  // Global web audio context for playing sounds.
  this.audioContext = null;

  // 【XDB】终局回调与清理句柄
  this.callbacks = callbacks || {};
  // 【XDB】历史最高分注入：实际得分 → 原版内部像素距离（× 1/COEFFICIENT）
  this.initingHighScore =
    opt_options && opt_options.highScore
      ? Math.ceil(opt_options.highScore / DistanceMeter.config.COEFFICIENT)
      : 0;
  this.onKeyDownBound = this.onKeyDown.bind(this);
  this.onKeyUpBound = this.onKeyUp.bind(this);
  this.onStagePointerDownBound = this.onStagePointerDown.bind(this);
  this.onWindowPointerUpBound = this.onWindowPointerUp.bind(this);
  this.onVisibilityChangeBound = this.onVisibilityChange.bind(this);
  this.onFocusBound = this.onVisibilityChange.bind(this);
  this.introSheetEl = null;
  this.introBound = null;
  this.destroyed = false;

  this.loadImages();

  // 【XDB】最近挂载的实例获得键盘响应权
  activeRunner = this;
}

/**
 * Default game configuration.
 * @enum {number}
 */
Runner.config = {
  ACCELERATION: 0.001,
  BG_CLOUD_SPEED: 0.2,
  BOTTOM_PAD: 10,
  CLEAR_TIME: 3000,
  CLOUD_FREQUENCY: 0.5,
  GAMEOVER_CLEAR_TIME: 750,
  GAP_COEFFICIENT: 0.6,
  GRAVITY: 0.6,
  INITIAL_JUMP_VELOCITY: 12,
  INVERT_FADE_DURATION: 12000,
  INVERT_DISTANCE: 700,
  MAX_BLINK_COUNT: 3,
  MAX_CLOUDS: 6,
  MAX_OBSTACLE_LENGTH: 3,
  MAX_OBSTACLE_DUPLICATION: 2,
  MAX_SPEED: 13,
  MIN_JUMP_HEIGHT: 35,
  MOBILE_SPEED_COEFFICIENT: 1.2,
  RESOURCE_TEMPLATE_ID: 'audio-resources', // 【XDB】保留字段：音效已内嵌，见 loadSounds
  SPEED: 6,
  SPEED_DROP_COEFFICIENT: 3,
};

/**
 * Default dimensions.
 * @enum {string}
 */
Runner.defaultDimensions = {
  WIDTH: DEFAULT_WIDTH,
  HEIGHT: 150,
};

/**
 * Sprite definition layout of the spritesheet.
 * @enum {Object}
 */
Runner.spriteDefinition = {
  LDPI: {
    CACTUS_LARGE: { x: 332, y: 2 },
    CACTUS_SMALL: { x: 228, y: 2 },
    CLOUD: { x: 86, y: 2 },
    HORIZON: { x: 2, y: 54 },
    MOON: { x: 484, y: 2 },
    PTERODACTYL: { x: 134, y: 2 },
    RESTART: { x: 2, y: 2 },
    TEXT_SPRITE: { x: 655, y: 2 },
    TREX: { x: 848, y: 2 },
    STAR: { x: 645, y: 2 },
  },
  HDPI: {
    CACTUS_LARGE: { x: 652, y: 2 },
    CACTUS_SMALL: { x: 446, y: 2 },
    CLOUD: { x: 166, y: 2 },
    HORIZON: { x: 2, y: 104 },
    MOON: { x: 954, y: 2 },
    PTERODACTYL: { x: 260, y: 2 },
    RESTART: { x: 2, y: 2 },
    TEXT_SPRITE: { x: 1294, y: 2 },
    TREX: { x: 1678, y: 2 },
    STAR: { x: 1276, y: 2 },
  },
};

/**
 * Key code mapping.
 * @enum {Object}
 */
Runner.keycodes = {
  JUMP: { '38': 1, '32': 1 }, // Up, spacebar
  DUCK: { '40': 1 }, // Down
  RESTART: { '13': 1 }, // Enter
};

/**
 * Runner event names.
 * @enum {Object}
 */
Runner.events = {
  ANIM_END: 'webkitAnimationEnd',
  KEYDOWN: 'keydown',
  KEYUP: 'keyup',
  POINTERDOWN: 'pointerdown',
  POINTERUP: 'pointerup',
  RESIZE: 'resize',
  TOUCHEND: 'touchend',
  TOUCHSTART: 'touchstart',
  VISIBILITY: 'visibilitychange',
  BLUR: 'blur',
  FOCUS: 'focus',
  LOAD: 'load',
};

Runner.prototype = {
  /**
   * Cache the appropriate image sprite from the page and get the sprite sheet
   * definition.
   * 【XDB】精灵图来自 assets.ts 的 data URL（原版取自页面内嵌 <img>）。
   */
  loadImages: function () {
    imageSprite = new Image();
    if (IS_HIDPI) {
      imageSprite.src = SPRITE_2X_URL;
      this.spriteDef = Runner.spriteDefinition.HDPI;
    } else {
      imageSprite.src = SPRITE_1X_URL;
      this.spriteDef = Runner.spriteDefinition.LDPI;
    }

    if (imageSprite.complete) {
      this.init();
    } else {
      // If the images are not yet loaded, add a listener.
      imageSprite.addEventListener(
        Runner.events.LOAD,
        this.init.bind(this)
      );
    }
  },

  /**
   * Load and decode base 64 encoded sounds.
   * 【XDB】音效来自 assets.ts（原版取自页面 <template id="audio-resources">）；
   * AudioContext 创建失败时静默降级（无音效不影响游戏）。
   */
  loadSounds: function () {
    if (!IS_IOS && !this.audioContext) {
      try {
        var Ctor: any =
          window.AudioContext || (window as any).webkitAudioContext;
        this.audioContext = new Ctor();

        var sounds: any = {
          BUTTON_PRESS: SOUND_PRESS_B64,
          HIT: SOUND_HIT_B64,
          SCORE: SOUND_REACHED_B64,
        };

        for (var sound in sounds) {
          var buffer = decodeBase64ToArrayBuffer(sounds[sound]);

          // Async, so no guarantee of order in array.
          this.audioContext.decodeAudioData(
            buffer,
            function (index: string, audioData: any) {
              this.soundFx[index] = audioData;
            }.bind(this, sound)
          );
        }
      } catch (e) {
        this.audioContext = null;
      }
    }
  },

  /**
   * 【XDB】音效开关（运行时切换；下一声起生效）。
   */
  setSoundEnabled: function (enabled: boolean) {
    this.soundEnabled = enabled !== false;
  },

  /**
   * Sets the game speed. Adjust the speed accordingly if on a smaller screen.
   * @param {number} opt_speed
   */
  setSpeed: function (opt_speed?: number) {
    var speed = opt_speed || this.currentSpeed;

    // Reduce the speed on smaller mobile screens.
    if (this.dimensions.WIDTH < DEFAULT_WIDTH) {
      var mobileSpeed =
        (speed * this.dimensions.WIDTH) / DEFAULT_WIDTH *
        this.config.MOBILE_SPEED_COEFFICIENT;
      this.currentSpeed = mobileSpeed > speed ? speed : mobileSpeed;
    } else if (opt_speed) {
      this.currentSpeed = opt_speed;
    }
  },

  /**
   * Game initialiser.
   */
  init: function () {
    if (this.destroyed) return;

    this.adjustDimensions();
    this.setSpeed();

    this.containerEl = document.createElement('div');
    this.containerEl.className = CLASSES.CONTAINER;

    // Player canvas container.
    this.canvas = createCanvas(
      this.containerEl,
      this.dimensions.WIDTH,
      this.dimensions.HEIGHT
    );

    this.canvasCtx = this.canvas.getContext('2d');
    this.canvasCtx.fillStyle = '#f7f7f7';
    this.canvasCtx.fill();
    Runner.updateCanvasScaling(this.canvas);

    // Horizon contains clouds, obstacles and the ground.
    this.horizon = new Horizon(
      this.canvas,
      this.spriteDef,
      this.dimensions,
      this.config.GAP_COEFFICIENT
    );

    // Distance meter
    this.distanceMeter = new DistanceMeter(
      this.canvas,
      this.spriteDef.TEXT_SPRITE,
      this.dimensions.WIDTH
    );

    // Draw t-rex
    this.tRex = new Trex(this.canvas, this.spriteDef.TREX);

    this.outerContainerEl.appendChild(this.containerEl);

    // 【XDB】注入历史最高分（原版从 0 开始）
    if (this.initingHighScore) {
      this.highestScore = this.initingHighScore;
      this.distanceMeter.setHighScore(this.highestScore);
    }

    if (IS_MOBILE) {
      this.createTouchController();
    }

    this.startListening();
    this.update();

    // 【XDB】window resize → 挂载元素尺寸监听（Obsidian 面板拖拽友好）
    this.resizeObserver_ = new ResizeObserver(this.debounceResize.bind(this));
    this.resizeObserver_.observe(this.outerContainerEl);
  },

  /**
   * Create the touch controller. A div that covers whole screen.
   * 【XDB】触控层覆盖游戏区域（原版覆盖整个视口）。
   */
  createTouchController: function () {
    this.touchController = document.createElement('div');
    this.touchController.className = CLASSES.TOUCH_CONTROLLER;
    this.outerContainerEl.appendChild(this.touchController);
  },

  /**
   * Debounce the resize event.
   */
  debounceResize: function () {
    if (!this.resizeTimerId_) {
      this.resizeTimerId_ = setInterval(this.adjustDimensions.bind(this), 250);
    }
  },

  /**
   * Adjust game space dimensions on resize.
   */
  adjustDimensions: function () {
    clearInterval(this.resizeTimerId_);
    this.resizeTimerId_ = null;

    var boxStyles = window.getComputedStyle(this.outerContainerEl);
    var padding = Number(boxStyles.paddingLeft.replace(/[^\d.-]/g, '')) || 0;

    this.dimensions.WIDTH =
      this.outerContainerEl.offsetWidth - padding * 2 || DEFAULT_WIDTH;
    this.dimensions.WIDTH = Math.min(DEFAULT_WIDTH, this.dimensions.WIDTH);

    // Redraw the elements back onto the canvas.
    if (this.canvas) {
      this.canvas.width = this.dimensions.WIDTH;
      this.canvas.height = this.dimensions.HEIGHT;

      Runner.updateCanvasScaling(this.canvas);

      this.distanceMeter.calcXPos(this.dimensions.WIDTH);
      this.clearCanvas();
      this.horizon.update(0, 0, true);
      this.tRex.update(0);

      // Outer container and distance meter.
      if (this.playing || this.crashed || this.paused) {
        this.containerEl.style.width = this.dimensions.WIDTH + 'px';
        this.containerEl.style.height = this.dimensions.HEIGHT + 'px';
        this.distanceMeter.update(0, Math.ceil(this.distanceRan));
        this.stop();
      } else {
        this.tRex.draw(0, 0);
      }

      // Game over panel.
      if (this.crashed && this.gameOverPanel) {
        this.gameOverPanel.updateDimensions(this.dimensions.WIDTH);
        this.gameOverPanel.draw();
      }
    }
  },

  /**
   * Play the game intro.
   * Canvas container width expands out to the full width.
   * 【XDB】keyframes 注入挂载元素内而非 document.head（destroy 可一并清理）；
   * 同时监听标准 animationend。
   */
  playIntro: function () {
    if (!this.activated && !this.crashed) {
      this.playingIntro = true;
      this.tRex.playingIntro = true;

      // CSS animation definition.
      var keyframes =
        '@-webkit-keyframes trexRunner--intro { ' +
        'from { width:' +
        Trex.config.WIDTH +
        'px }' +
        'to { width: ' +
        this.dimensions.WIDTH +
        'px }' +
        '}' +
        '@keyframes trexRunner--intro { ' +
        'from { width:' +
        Trex.config.WIDTH +
        'px }' +
        'to { width: ' +
        this.dimensions.WIDTH +
        'px }' +
        '}';

      // create a style sheet to put the keyframe rule in
      // and then place the style sheet in the game container
      var sheet = document.createElement('style');
      sheet.textContent = keyframes;
      this.introSheetEl = sheet;
      this.outerContainerEl.appendChild(sheet);

      this.introBound = this.startGame.bind(this);
      this.containerEl.addEventListener(
        Runner.events.ANIM_END,
        this.introBound
      );
      this.containerEl.addEventListener('animationend', this.introBound);

      this.containerEl.style.webkitAnimation =
        'trexRunner--intro .4s ease-out 1 both';
      this.containerEl.style.animation =
        'trexRunner--intro .4s ease-out 1 both';
      this.containerEl.style.width = this.dimensions.WIDTH + 'px';

      this.playing = true;
      this.activated = true;
    } else if (this.crashed) {
      this.restart();
    }
  },

  /**
   * Update the game status to started.
   */
  startGame: function () {
    this.runningTime = 0;
    this.playingIntro = false;
    this.tRex.playingIntro = false;
    this.containerEl.style.webkitAnimation = '';
    this.containerEl.style.animation = '';
    this.playCount++;

    // 【XDB】宿主切换标签页/窗口失焦时暂停（保留原版行为，监听在 startListening 中随实例绑定）
    document.addEventListener(
      Runner.events.VISIBILITY,
      this.onVisibilityChangeBound
    );
    window.addEventListener(Runner.events.BLUR, this.onVisibilityChangeBound);
    window.addEventListener(Runner.events.FOCUS, this.onFocusBound);
  },

  clearCanvas: function () {
    this.canvasCtx.clearRect(0, 0, this.dimensions.WIDTH, this.dimensions.HEIGHT);
  },

  /**
   * Update the game frame and schedules the next one.
   */
  update: function () {
    this.updatePending = false;

    var now = getTimeStamp();
    var deltaTime = now - (this.time || now);
    this.time = now;

    if (this.playing) {
      this.clearCanvas();

      if (this.tRex.jumping) {
        this.tRex.updateJump(deltaTime);
      }

      this.runningTime += deltaTime;
      var hasObstacles = this.runningTime > this.config.CLEAR_TIME;

      // First jump triggers the intro.
      if (this.tRex.jumpCount == 1 && !this.playingIntro) {
        this.playIntro();
      }

      // The horizon doesn't move until the intro is over.
      if (this.playingIntro) {
        this.horizon.update(0, this.currentSpeed, hasObstacles);
      } else {
        deltaTime = !this.activated ? 0 : deltaTime;
        this.horizon.update(
          deltaTime,
          this.currentSpeed,
          hasObstacles,
          this.inverted
        );
      }

      // Check for collisions.
      var collision =
        hasObstacles && checkForCollision(this.horizon.obstacles[0], this.tRex);

      if (!collision) {
        this.distanceRan += (this.currentSpeed * deltaTime) / this.msPerFrame;

        if (this.currentSpeed < this.config.MAX_SPEED) {
          this.currentSpeed += this.config.ACCELERATION;
        }
      } else {
        this.gameOver();
      }

      var playAchievementSound = this.distanceMeter.update(
        deltaTime,
        Math.ceil(this.distanceRan)
      );

      if (playAchievementSound) {
        this.playSound(this.soundFx.SCORE);
      }

      // Night mode.
      if (this.invertTimer > this.config.INVERT_FADE_DURATION) {
        this.invertTimer = 0;
        this.invertTrigger = false;
        this.invert();
      } else if (this.invertTimer) {
        this.invertTimer += deltaTime;
      } else {
        var actualDistance = this.distanceMeter.getActualDistance(
          Math.ceil(this.distanceRan)
        );

        if (actualDistance > 0) {
          this.invertTrigger = !(actualDistance % this.config.INVERT_DISTANCE);

          if (this.invertTrigger && this.invertTimer === 0) {
            this.invertTimer += deltaTime;
            this.invert();
          }
        }
      }
    }

    if (
      this.playing ||
      (!this.activated && this.tRex.blinkCount < Runner.config.MAX_BLINK_COUNT)
    ) {
      this.tRex.update(deltaTime);
      this.scheduleNextUpdate();
    }
  },

  /**
   * Event handler. 【XDB】沿用原版 handleEvent 分发（触屏事件走这里）。
   */
  handleEvent: function (e: any) {
    return (
      function (evtType: string, events: any) {
        switch (evtType) {
          case events.KEYDOWN:
          case events.TOUCHSTART:
          case events.POINTERDOWN:
            this.onKeyDown(e);
            break;
          case events.KEYUP:
          case events.TOUCHEND:
          case events.POINTERUP:
            this.onKeyUp(e);
            break;
        }
      }.bind(this)
    )(e.type, Runner.events);
  },

  /**
   * Bind relevant key / mouse / touch listeners.
   * 【XDB】键盘仍挂 document 但仅激活实例响应；鼠标改为游戏区域内按下 + 窗口抬起
   * （原版 mousedown/mouseup 挂整个 document）。
   */
  startListening: function () {
    // Keys.
    document.addEventListener(Runner.events.KEYDOWN, this.onKeyDownBound);
    document.addEventListener(Runner.events.KEYUP, this.onKeyUpBound);

    if (IS_MOBILE) {
      // Mobile only touch devices.
      this.touchController.addEventListener(
        Runner.events.TOUCHSTART,
        this,
        { passive: false } as any
      );
      this.touchController.addEventListener(Runner.events.TOUCHEND, this, {
        passive: false,
      } as any);
      this.outerContainerEl.addEventListener(
        Runner.events.TOUCHSTART,
        this,
        { passive: false } as any
      );
    } else {
      // Mouse / touch on the game area.
      this.outerContainerEl.addEventListener(
        Runner.events.POINTERDOWN,
        this.onStagePointerDownBound
      );
      window.addEventListener(
        Runner.events.POINTERUP,
        this.onWindowPointerUpBound
      );
    }
  },

  /**
   * Remove all listeners.
   */
  stopListening: function () {
    document.removeEventListener(Runner.events.KEYDOWN, this.onKeyDownBound);
    document.removeEventListener(Runner.events.KEYUP, this.onKeyUpBound);

    if (IS_MOBILE) {
      this.touchController &&
        this.touchController.removeEventListener(
          Runner.events.TOUCHSTART,
          this
        );
      this.touchController &&
        this.touchController.removeEventListener(Runner.events.TOUCHEND, this);
      this.outerContainerEl.removeEventListener(
        Runner.events.TOUCHSTART,
        this
      );
    } else {
      this.outerContainerEl.removeEventListener(
        Runner.events.POINTERDOWN,
        this.onStagePointerDownBound
      );
      window.removeEventListener(
        Runner.events.POINTERUP,
        this.onWindowPointerUpBound
      );
    }

    document.removeEventListener(
      Runner.events.VISIBILITY,
      this.onVisibilityChangeBound
    );
    window.removeEventListener(Runner.events.BLUR, this.onVisibilityChangeBound);
    window.removeEventListener(Runner.events.FOCUS, this.onFocusBound);
  },

  /**
   * 【XDB】游戏区域内按下：抢占键盘响应权，并按原版 mousedown 逻辑处理。
   */
  onStagePointerDown: function (e: any) {
    activeRunner = this;
    if (e.button != null && e.button >= 2) return; // 仅左键/触摸
    this.onKeyDown({
      type: Runner.events.POINTERDOWN,
      // isLeftClickOnCanvas 判定 e.target === canvas：游戏区内按下视为点击画布
      target: this.canvas,
      preventDefault: function () {},
    });
  },

  /**
   * 【XDB】窗口抬起：对应原版 document mouseup 的 endJump / 重开判定。
   */
  onWindowPointerUp: function (e: any) {
    if (activeRunner !== this) return;
    this.onKeyUp({
      type: Runner.events.POINTERUP,
      target: e.target === this.canvas || this.outerContainerEl.contains(e.target)
        ? this.canvas
        : e.target,
      button: e.button,
      preventDefault: function () {},
    });
  },

  /**
   * Process keydown.
   * @param {Event} e
   */
  onKeyDown: function (e: any) {
    // 【XDB】键盘事件仅激活实例响应；指针事件不受限（点击即抢占）
    if (e.type === Runner.events.KEYDOWN && activeRunner !== this) return;

    // 【XDB】焦点在宿主输入控件（搜索框/重命名等）时不劫持按键；
    // 原版为整页游戏无此场景。另：桌面端也阻止跳跃/下蹲键默认行为，
    // 否则空格会滚动 Obsidian 页面（原版页面本身不可滚动）。
    var target = e.target;
    if (
      target &&
      target.tagName &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable)
    ) {
      return;
    }
    if (
      Runner.keycodes.JUMP[String(e.keyCode)] ||
      Runner.keycodes.DUCK[String(e.keyCode)]
    ) {
      e.preventDefault();
    }

    // Prevent native page scrolling whilst tapping on mobile.
    if (IS_MOBILE && this.playing) {
      e.preventDefault();
    }

    if (e.target != this.detailsButton) {
      if (
        !this.crashed &&
        (Runner.keycodes.JUMP[String(e.keyCode)] ||
          e.type == Runner.events.TOUCHSTART ||
          e.type == Runner.events.POINTERDOWN)
      ) {
        if (!this.playing) {
          this.loadSounds();
          this.playing = true;
          // 【XDB】暂停后用跳跃键恢复时同步清除暂停标志：原版此分支只置
          // playing，paused 残留 true（原版无暂停 UI 不可见），本插件 HUD 会误显示
          this.paused = false;
          this.update();
        }
        //  Play sound effect and jump on starting the game for the first time.
        if (!this.tRex.jumping && !this.tRex.ducking) {
          this.playSound(this.soundFx.BUTTON_PRESS);
          this.tRex.startJump(this.currentSpeed);
        }
      }

      if (
        this.crashed &&
        (e.type == Runner.events.TOUCHSTART ||
          e.type == Runner.events.POINTERDOWN) &&
        e.currentTarget == this.outerContainerEl
      ) {
        this.restart();
      }
    }

    if (
      this.playing &&
      !this.crashed &&
      Runner.keycodes.DUCK[String(e.keyCode)]
    ) {
      e.preventDefault();
      if (this.tRex.jumping) {
        // Speed drop, activated only when jump key is not pressed.
        this.tRex.setSpeedDrop();
      } else if (!this.tRex.jumping && !this.tRex.ducking) {
        // Duck.
        this.tRex.setDuck(true);
      }
    }
  },

  /**
   * Process key up.
   * @param {Event} e
   */
  onKeyUp: function (e: any) {
    if (e.type === Runner.events.KEYUP && activeRunner !== this) return;

    var keyCode = String(e.keyCode);
    var isjumpKey =
      Runner.keycodes.JUMP[keyCode] ||
      e.type == Runner.events.TOUCHEND ||
      e.type == Runner.events.POINTERUP;

    if (this.isRunning() && isjumpKey) {
      this.tRex.endJump();
    } else if (Runner.keycodes.DUCK[keyCode]) {
      this.tRex.speedDrop = false;
      this.tRex.setDuck(false);
    } else if (this.crashed) {
      // Check that enough time has elapsed before allowing jump key to restart.
      var deltaTime = getTimeStamp() - this.time;

      if (
        Runner.keycodes.RESTART[keyCode] ||
        this.isLeftClickOnCanvas(e) ||
        (deltaTime >= this.config.GAMEOVER_CLEAR_TIME &&
          Runner.keycodes.JUMP[keyCode]) ||
        (deltaTime >= this.config.GAMEOVER_CLEAR_TIME &&
          e.type == Runner.events.POINTERUP)
      ) {
        this.restart();
      }
    } else if (this.paused && isjumpKey) {
      // Reset the jump state
      this.tRex.reset();
      this.play();
    }
  },

  /**
   * Returns whether the event was a left click on canvas.
   * On Windows right click is registered as a click.
   * @param {Event} e
   * @return {boolean}
   */
  isLeftClickOnCanvas: function (e: any) {
    return (
      e.button != null &&
      e.button < 2 &&
      (e.type == Runner.events.POINTERUP || e.type == 'mouseup') &&
      e.target == this.canvas
    );
  },

  /**
   * RequestAnimationFrame wrapper.
   */
  scheduleNextUpdate: function () {
    if (!this.updatePending) {
      this.updatePending = true;
      this.raqId = requestAnimationFrame(this.update.bind(this));
    }
  },

  /**
   * Whether the game is running.
   * @return {boolean}
   */
  isRunning: function () {
    return !!this.raqId;
  },

  /**
   * Game over state.
   */
  gameOver: function () {
    this.playSound(this.soundFx.HIT);
    vibrate(200);

    this.stop();
    this.crashed = true;
    this.distanceMeter.acheivement = false;

    this.tRex.update(100, Trex.status.CRASHED);

    // Game over panel.
    if (!this.gameOverPanel) {
      this.gameOverPanel = new GameOverPanel(
        this.canvas,
        this.spriteDef.TEXT_SPRITE,
        this.spriteDef.RESTART,
        this.dimensions
      );
    } else {
      this.gameOverPanel.draw();
    }

    // Update the high score.
    var beforeHighest = this.highestScore;
    if (this.distanceRan > this.highestScore) {
      this.highestScore = Math.ceil(this.distanceRan);
      this.distanceMeter.setHighScore(this.highestScore);
    }

    // 【XDB】终局回调：上报实际得分与是否破纪录（战绩持久化入口）
    if (this.callbacks.onGameOver) {
      var actualScore = Math.round(
        this.distanceRan * DistanceMeter.config.COEFFICIENT
      );
      var isNewRecord =
        beforeHighest > 0 && Math.ceil(this.distanceRan) > beforeHighest;
      this.callbacks.onGameOver(actualScore, isNewRecord);
    }

    // Reset the time clock.
    this.time = getTimeStamp();
  },

  stop: function () {
    this.playing = false;
    this.paused = true;
    cancelAnimationFrame(this.raqId);
    this.raqId = 0;
  },

  play: function () {
    if (!this.crashed) {
      this.playing = true;
      this.paused = false;
      this.tRex.update(0, Trex.status.RUNNING);
      this.time = getTimeStamp();
      this.update();
    }
  },

  restart: function () {
    if (!this.raqId) {
      this.playCount++;
      this.runningTime = 0;
      this.playing = true;
      this.crashed = false;
      // 【XDB】原版 restart 不清除 stop() 置位的 paused（原版无暂停 UI 不可见）；
      // 本插件 HUD 会展示暂停态，这里补清
      this.paused = false;
      this.distanceRan = 0;
      this.setSpeed(this.config.SPEED);
      this.time = getTimeStamp();
      this.clearCanvas();
      this.distanceMeter.reset(this.highestScore);
      this.horizon.reset();
      this.tRex.reset();
      this.playSound(this.soundFx.BUTTON_PRESS);
      this.invert(true);
      this.update();
    }
  },

  /**
   * 【XDB】强制重开（HUD 按钮）：绕过原版 restart 的"仅静止时可重开"门槛。
   */
  forceRestart: function () {
    this.stop();
    this.restart();
  },

  /**
   * Pause the game if the tab is not in focus.
   */
  onVisibilityChange: function (e: any) {
    if (
      document.hidden ||
      (document as any).webkitHidden ||
      e.type == 'blur' ||
      document.visibilityState != 'visible'
    ) {
      this.stop();
    } else if (!this.crashed) {
      this.tRex.reset();
      this.play();
    }
  },

  /**
   * Play a sound.
   * 【XDB】增加音效开关与上下文恢复；其余同原版。
   */
  playSound: function (soundBuffer: any) {
    if (!this.soundEnabled || !soundBuffer || !this.audioContext) return;
    try {
      if (this.audioContext.state === 'suspended') {
        void this.audioContext.resume();
      }
      var sourceNode = this.audioContext.createBufferSource();
      sourceNode.buffer = soundBuffer;
      sourceNode.connect(this.audioContext.destination);
      sourceNode.start(0);
    } catch (e) {
      /* 无音效不影响游戏 */
    }
  },

  /**
   * Inverts the current page / canvas colors.
   * 【XDB】反转 class 加在挂载元素上（原版加在 document.body）。
   * @param {boolean} reset Whether to reset colors.
   */
  invert: function (reset?: boolean) {
    if (reset) {
      this.outerContainerEl.classList.toggle(CLASSES.INVERTED, false);
      this.invertTimer = 0;
      this.inverted = false;
    } else {
      this.inverted = this.outerContainerEl.classList.toggle(
        CLASSES.INVERTED,
        this.invertTrigger
      );
    }
  },

  /**
   * 【XDB】HUD 触控/无障碍按钮：复用原版按键语义。
   */
  pressJump: function () {
    this.onKeyDown({
      type: Runner.events.KEYDOWN,
      keyCode: 32,
      target: null,
      preventDefault: function () {},
    });
  },

  releaseJump: function () {
    this.onKeyUp({
      type: Runner.events.KEYUP,
      keyCode: 32,
      target: null,
      preventDefault: function () {},
    });
  },

  pressDuck: function () {
    this.onKeyDown({
      type: Runner.events.KEYDOWN,
      keyCode: 40,
      target: null,
      preventDefault: function () {},
    });
  },

  releaseDuck: function () {
    this.onKeyUp({
      type: Runner.events.KEYUP,
      keyCode: 40,
      target: null,
      preventDefault: function () {},
    });
  },

  /**
   * 【XDB】本实例当前是否持有键盘响应权（HUD 辅助键判定用）。
   */
  isKeyboardActive: function () {
    return activeRunner === this;
  },

  /**
   * 【XDB】HUD 状态快照（score/highScore 为换算后的实际得分）。
   */
  snapshot: function (): RunnerSnapshot {
    return {
      started: this.activated,
      playing: this.playing,
      crashed: this.crashed,
      paused: this.paused,
      score: Math.round(this.distanceRan * DistanceMeter.config.COEFFICIENT),
      highScore: this.distanceMeter
        ? this.distanceMeter.getActualDistance(this.highestScore)
        : 0,
      speed: Math.round(this.currentSpeed * 100) / 100,
    };
  },

  /**
   * 【XDB】实例销毁：移除监听、取消 rAF、清理注入 DOM 与音效上下文。
   */
  destroy: function () {
    this.destroyed = true;
    this.stop();
    this.stopListening();
    if (this.resizeObserver_) this.resizeObserver_.disconnect();
    clearInterval(this.resizeTimerId_);

    if (this.containerEl && this.introBound) {
      this.containerEl.removeEventListener(
        Runner.events.ANIM_END,
        this.introBound
      );
      this.containerEl.removeEventListener('animationend', this.introBound);
    }
    if (this.introSheetEl && this.introSheetEl.parentNode) {
      this.introSheetEl.parentNode.removeChild(this.introSheetEl);
    }
    if (this.audioContext) {
      try {
        void this.audioContext.close();
      } catch (e) {
        /* 已关闭 */
      }
      this.audioContext = null;
    }
    // 精灵图为模块级共享 Image（多实例同图），不在此释放
    if (activeRunner === this) activeRunner = null;
  },
};

/**
 * Updates the canvas size taking into
 * account the backing store pixel ratio and
 * the device pixel ratio.
 *
 * See article by Paul Lewis:
 * http://www.html5rocks.com/en/tutorials/canvas/hidpi/
 *
 * @param {HTMLCanvasElement} canvas
 * @param {number} opt_width
 * @param {number} opt_height
 * @return {boolean} Whether the canvas was scaled.
 */
Runner.updateCanvasScaling = function (
  canvas: HTMLCanvasElement,
  opt_width?: number,
  opt_height?: number
) {
  var context: any = canvas.getContext('2d');

  // Query the various pixel ratios
  var devicePixelRatio = Math.floor(window.devicePixelRatio) || 1;
  var backingStoreRatio =
    Math.floor(context.webkitBackingStorePixelRatio) || 1;
  var ratio = devicePixelRatio / backingStoreRatio;

  // Upscale the canvas if the two ratios don't match
  if (devicePixelRatio !== backingStoreRatio) {
    var oldWidth = opt_width || canvas.width;
    var oldHeight = opt_height || canvas.height;

    canvas.width = oldWidth * ratio;
    canvas.height = oldHeight * ratio;

    canvas.style.width = oldWidth + 'px';
    canvas.style.height = oldHeight + 'px';

    // Scale the context to counter the fact that we've manually scaled
    // our canvas element.
    context.scale(ratio, ratio);
    return true;
  } else if (devicePixelRatio == 1) {
    // Reset the canvas width / height. Fixes scaling bug when the page is
    // zoomed and the devicePixelRatio changes accordingly.
    canvas.style.width = canvas.width + 'px';
    canvas.style.height = canvas.height + 'px';
  }
  return false;
};

/**
 * Get random number.
 * @param {number} min
 * @param {number} max
 * @param {number}
 */
function getRandomNum(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Vibrate on mobile devices.
 * @param {number} duration Duration of the vibration.
 */
function vibrate(duration: number) {
  if (IS_MOBILE && (window.navigator as any).vibrate) {
    (window.navigator as any).vibrate(duration);
  }
}

/**
 * Create canvas element.
 * @param {HTMLElement} container Element to append canvas to.
 * @param {number} width
 * @param {number} height
 * @return {HTMLCanvasElement}
 */
function createCanvas(
  container: HTMLElement,
  width: number,
  height: number
): HTMLCanvasElement {
  var canvas = document.createElement('canvas');
  canvas.className = CLASSES.CANVAS;
  canvas.width = width;
  canvas.height = height;
  container.appendChild(canvas);

  return canvas;
}

/**
 * Decodes the base 64 audio to ArrayBuffer used by Web Audio.
 * @param {string} base64String
 */
function decodeBase64ToArrayBuffer(base64String: string) {
  var len = (base64String.length / 4) * 3;
  var str = atob(base64String);
  var arrayBuffer = new ArrayBuffer(len);
  var bytes = new Uint8Array(arrayBuffer);

  for (var i = 0; i < len; i++) {
    bytes[i] = str.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Return the current timestamp.
 * @return {number}
 */
function getTimeStamp() {
  return IS_IOS ? new Date().getTime() : performance.now();
}

//******************************************************************************

/**
 * Game over panel.
 * @param {!HTMLCanvasElement} canvas
 * @param {Object} textImgPos
 * @param {Object} restartImgPos
 * @param {!Object} dimensions Canvas dimensions.
 * @constructor
 */
function GameOverPanel(
  canvas: HTMLCanvasElement,
  textImgPos: any,
  restartImgPos: any,
  dimensions: any
) {
  this.canvas = canvas;
  this.canvasCtx = canvas.getContext('2d');
  this.canvasDimensions = dimensions;
  this.textImgPos = textImgPos;
  this.restartImgPos = restartImgPos;
  this.draw();
}

/**
 * Dimensions used in the panel.
 * @enum {number}
 */
GameOverPanel.dimensions = {
  TEXT_X: 0,
  TEXT_Y: 13,
  TEXT_WIDTH: 191,
  TEXT_HEIGHT: 11,
  RESTART_WIDTH: 36,
  RESTART_HEIGHT: 32,
};

GameOverPanel.prototype = {
  /**
   * Update the panel dimensions.
   * @param {number} width New canvas width.
   * @param {number} opt_height Optional new canvas height.
   */
  updateDimensions: function (width: number, opt_height?: number) {
    this.canvasDimensions.WIDTH = width;
    if (opt_height) {
      this.canvasDimensions.HEIGHT = opt_height;
    }
  },

  /**
   * Draw the panel.
   */
  draw: function () {
    var dimensions = GameOverPanel.dimensions;

    var centerX = this.canvasDimensions.WIDTH / 2;

    // Game over text.
    var textSourceX = dimensions.TEXT_X;
    var textSourceY = dimensions.TEXT_Y;
    var textSourceWidth = dimensions.TEXT_WIDTH;
    var textSourceHeight = dimensions.TEXT_HEIGHT;

    var textTargetX = Math.round(centerX - dimensions.TEXT_WIDTH / 2);
    var textTargetY = Math.round((this.canvasDimensions.HEIGHT - 25) / 3);
    var textTargetWidth = dimensions.TEXT_WIDTH;
    var textTargetHeight = dimensions.TEXT_HEIGHT;

    var restartSourceWidth = dimensions.RESTART_WIDTH;
    var restartSourceHeight = dimensions.RESTART_HEIGHT;
    var restartTargetX = centerX - dimensions.RESTART_WIDTH / 2;
    var restartTargetY = this.canvasDimensions.HEIGHT / 2;

    if (IS_HIDPI) {
      textSourceX *= 2;
      textSourceY *= 2;
      textSourceWidth *= 2;
      textSourceHeight *= 2;
      restartSourceWidth *= 2;
      restartSourceHeight *= 2;
    }

    textSourceX += this.textImgPos.x;
    textSourceY += this.textImgPos.y;

    // Game over text from sprite.
    this.canvasCtx.drawImage(
      imageSprite,
      textSourceX,
      textSourceY,
      textSourceWidth,
      textSourceHeight,
      textTargetX,
      textTargetY,
      textTargetWidth,
      textTargetHeight
    );

    // Restart button.
    this.canvasCtx.drawImage(
      imageSprite,
      this.restartImgPos.x,
      this.restartImgPos.y,
      restartSourceWidth,
      restartSourceHeight,
      restartTargetX,
      restartTargetY,
      dimensions.RESTART_WIDTH,
      dimensions.RESTART_HEIGHT
    );
  },
};

//******************************************************************************

/**
 * Check for a collision.
 * @param {!Obstacle} obstacle
 * @param {Trex} tRex T-rex object.
 * @param {HTMLCanvasContext} opt_canvasCtx Optional canvas context for drawing
 *    collision boxes.
 * @return {Array<CollisionBox>}
 */
function checkForCollision(obstacle: any, tRex: any, opt_canvasCtx?: any) {
  if (!obstacle) return false;

  // Adjustments are made to the bounding box as there is a 1 pixel white
  // border around the t-rex and obstacles.
  var tRexBox = new CollisionBox(
    tRex.xPos + 1,
    tRex.yPos + 1,
    Trex.config.WIDTH - 2,
    Trex.config.HEIGHT - 2
  );

  var obstacleBox = new CollisionBox(
    obstacle.xPos + 1,
    obstacle.yPos + 1,
    obstacle.typeConfig.width * obstacle.size - 2,
    obstacle.typeConfig.height - 2
  );

  // Simple outer bounds check.
  if (boxCompare(tRexBox, obstacleBox)) {
    var collisionBoxes = obstacle.collisionBoxes;
    var tRexCollisionBoxes = tRex.ducking
      ? Trex.collisionBoxes.DUCKING
      : Trex.collisionBoxes.RUNNING;

    // Detailed axis aligned box check.
    for (var t = 0; t < tRexCollisionBoxes.length; t++) {
      for (var i = 0; i < collisionBoxes.length; i++) {
        // Adjust the box to actual positions.
        var adjTrexBox = createAdjustedCollisionBox(
          tRexCollisionBoxes[t],
          tRexBox
        );
        var adjObstacleBox = createAdjustedCollisionBox(
          collisionBoxes[i],
          obstacleBox
        );
        var crashed = boxCompare(adjTrexBox, adjObstacleBox);

        if (crashed) {
          return [adjTrexBox, adjObstacleBox];
        }
      }
    }
  }
  return false;
}

/**
 * Adjust the collision box.
 * @param {!CollisionBox} box The original box.
 * @param {CollisionBox} adjustment Adjustment box.
 * @return {CollisionBox} The adjusted collision box object.
 */
function createAdjustedCollisionBox(box: any, adjustment: any) {
  return new CollisionBox(
    box.x + adjustment.x,
    box.y + adjustment.y,
    box.width,
    box.height
  );
}

/**
 * Compare two collision boxes for a collision.
 * @param {CollisionBox} tRexBox
 * @param {CollisionBox} obstacleBox
 * @return {boolean} Whether the boxes intersected.
 */
function boxCompare(tRexBox: any, obstacleBox: any) {
  var crashed = false;
  var tRexBoxX = tRexBox.x;
  var tRexBoxY = tRexBox.y;

  var obstacleBoxX = obstacleBox.x;
  var obstacleBoxY = obstacleBox.y;

  // Axis-Aligned Bounding Box method.
  if (
    tRexBoxX < obstacleBoxX + obstacleBox.width &&
    tRexBoxX + tRexBox.width > obstacleBoxX &&
    tRexBoxY < obstacleBox.y + obstacleBox.height &&
    tRexBox.height + tRexBoxY > obstacleBoxY
  ) {
    crashed = true;
  }

  return crashed;
}

//******************************************************************************

/**
 * Collision box object.
 * @param {number} x X position.
 * @param {number} y Y Position.
 * @param {number} w Width.
 * @param {number} h Height.
 * @constructor
 */
function CollisionBox(this: any, x: number, y: number, w: number, h: number) {
  this.x = x;
  this.y = y;
  this.width = w;
  this.height = h;
}

//******************************************************************************

/**
 * Obstacle.
 * @param {HTMLCanvasCtx} canvasCtx
 * @param {Obstacle.type} type
 * @param {Object} spritePos Obstacle position in sprite.
 * @param {Object} dimensions
 * @param {number} gapCoefficient
 * @param {number} speed
 * @param {number} opt_xOffset
 * @constructor
 */
function Obstacle(
  this: any,
  canvasCtx: any,
  type: any,
  spriteImgPos: any,
  dimensions: any,
  gapCoefficient: number,
  speed: number,
  opt_xOffset?: number
) {
  this.canvasCtx = canvasCtx;
  this.spritePos = spriteImgPos;
  this.typeConfig = type;
  this.gapCoefficient = gapCoefficient;
  this.size = getRandomNum(1, Obstacle.MAX_OBSTACLE_LENGTH);
  this.dimensions = dimensions;
  this.remove = false;
  this.currentFrame = 0;
  this.timer = 0;
  this.followingObstacleCreated = false;

  this.xPos = dimensions.WIDTH + (opt_xOffset || 0);
  this.yPos = 0;
  this.width = 0;
  this.gap = 0;
  this.speedOffset = 0;
  this.collisionBoxes = [];

  this.init(speed);
}

/**
 * Coefficient for calculating the maximum gap.
 * @const
 */
Obstacle.MAX_GAP_COEFFICIENT = 1.5;

/**
 * Maximum obstacle grouping count.
 * @const
 */
Obstacle.MAX_OBSTACLE_LENGTH = 3;

Obstacle.prototype = {
  /**
   * Initialise the DOM for the obstacle.
   * @param {number} speed
   */
  init: function (speed: number) {
    this.cloneCollisionBoxes();

    // Only allow sizing if we're at the right speed.
    if (this.size > 1 && this.typeConfig.multipleSpeed > speed) {
      this.size = 1;
    }

    this.width = this.typeConfig.width * this.size;

    // Check if obstacle can be positioned at various heights.
    if (Array.isArray(this.typeConfig.yPos)) {
      var yPosConfig = IS_MOBILE ? this.typeConfig.yPosMobile : this.typeConfig.yPos;
      this.yPos = yPosConfig[getRandomNum(0, yPosConfig.length - 1)];
    } else {
      this.yPos = this.typeConfig.yPos;
    }

    this.draw();

    // Make collision box adjustments,
    // Central box is adjusted to the size as one box.
    //      ____        ______        ________
    //    _|   |-|    _|     |-|    _|       |-|
    //   | |<->| |   | |<--->| |   | |<----->| |
    //   | | 1 | |   | |  2  | |   | |   3   | |
    //   |_|___|_|   |_|_____|_|   |_|_______|_|
    //
    if (this.size > 1) {
      this.collisionBoxes[1].width =
        this.width - this.collisionBoxes[0].width - this.collisionBoxes[2].width;
      this.collisionBoxes[2].x = this.width - this.collisionBoxes[2].width;
    }

    // For obstacles that go at a different speed from the horizon.
    if (this.typeConfig.speedOffset) {
      this.speedOffset =
        Math.random() > 0.5 ? this.typeConfig.speedOffset : -this.typeConfig.speedOffset;
    }

    this.gap = this.getGap(this.gapCoefficient, speed);
  },

  /**
   * Draw and crop based on size.
   */
  draw: function () {
    var sourceWidth = this.typeConfig.width;
    var sourceHeight = this.typeConfig.height;

    if (IS_HIDPI) {
      sourceWidth = sourceWidth * 2;
      sourceHeight = sourceHeight * 2;
    }

    // X position in sprite.
    var sourceX =
      sourceWidth * this.size * (0.5 * (this.size - 1)) + this.spritePos.x;

    // Animation frames.
    if (this.currentFrame > 0) {
      sourceX += sourceWidth * this.currentFrame;
    }

    this.canvasCtx.drawImage(
      imageSprite,
      sourceX,
      this.spritePos.y,
      sourceWidth * this.size,
      sourceHeight,
      this.xPos,
      this.yPos,
      this.typeConfig.width * this.size,
      this.typeConfig.height
    );
  },

  /**
   * Obstacle frame update.
   * @param {number} deltaTime
   * @param {number} speed
   */
  update: function (deltaTime: number, speed: number) {
    if (!this.remove) {
      if (this.typeConfig.speedOffset) {
        speed += this.speedOffset;
      }
      this.xPos -= Math.floor((speed * FPS) / 1000 * deltaTime);

      // Update frame
      if (this.typeConfig.numFrames) {
        this.timer += deltaTime;
        if (this.timer >= this.typeConfig.frameRate) {
          this.currentFrame =
            this.currentFrame == this.typeConfig.numFrames - 1
              ? 0
              : this.currentFrame + 1;
          this.timer = 0;
        }
      }
      this.draw();

      if (!this.isVisible()) {
        this.remove = true;
      }
    }
  },

  /**
   * Calculate a random gap size.
   * - Minimum gap gets wider as speed increses
   * @param {number} gapCoefficient
   * @param {number} speed
   * @return {number} The gap size.
   */
  getGap: function (gapCoefficient: number, speed: number) {
    var minGap = Math.round(
      this.width * speed + this.typeConfig.minGap * gapCoefficient
    );
    var maxGap = Math.round(minGap * Obstacle.MAX_GAP_COEFFICIENT);
    return getRandomNum(minGap, maxGap);
  },

  /**
   * Check if obstacle is visible.
   * @return {boolean} Whether the obstacle is in the game area.
   */
  isVisible: function () {
    return this.xPos + this.width > 0;
  },

  /**
   * Make a copy of the collision boxes, since these will change based on
   * obstacle type and size.
   */
  cloneCollisionBoxes: function () {
    var collisionBoxes = this.typeConfig.collisionBoxes;

    for (var i = collisionBoxes.length - 1; i >= 0; i--) {
      this.collisionBoxes[i] = new CollisionBox(
        collisionBoxes[i].x,
        collisionBoxes[i].y,
        collisionBoxes[i].width,
        collisionBoxes[i].height
      );
    }
  },
};

/**
 * Obstacle definitions.
 * minGap: minimum pixel space betweeen obstacles.
 * multipleSpeed: Speed at which multiples are allowed.
 * speedOffset: speed faster / slower than the horizon.
 * minSpeed: Minimum speed which the obstacle can make an appearance.
 */
Obstacle.types = [
  {
    type: 'CACTUS_SMALL',
    width: 17,
    height: 35,
    yPos: 105,
    multipleSpeed: 4,
    minGap: 120,
    minSpeed: 0,
    collisionBoxes: [
      new CollisionBox(0, 7, 5, 27),
      new CollisionBox(4, 0, 6, 34),
      new CollisionBox(10, 4, 7, 14),
    ],
  },
  {
    type: 'CACTUS_LARGE',
    width: 25,
    height: 50,
    yPos: 90,
    multipleSpeed: 7,
    minGap: 120,
    minSpeed: 0,
    collisionBoxes: [
      new CollisionBox(0, 12, 7, 38),
      new CollisionBox(8, 0, 7, 49),
      new CollisionBox(13, 10, 10, 38),
    ],
  },
  {
    type: 'PTERODACTYL',
    width: 46,
    height: 40,
    yPos: [100, 75, 50], // Variable height.
    yPosMobile: [100, 50], // Variable height mobile.
    multipleSpeed: 999,
    minSpeed: 8.5,
    minGap: 150,
    collisionBoxes: [
      new CollisionBox(15, 15, 16, 5),
      new CollisionBox(18, 21, 24, 6),
      new CollisionBox(2, 14, 4, 3),
      new CollisionBox(6, 10, 4, 7),
      new CollisionBox(10, 8, 6, 9),
    ],
    numFrames: 2,
    frameRate: 1000 / 6,
    speedOffset: 0.8,
  },
];

//******************************************************************************

/**
 * T-rex game character.
 * @param {HTMLCanvas} canvas
 * @param {Object} spritePos Positioning within image sprite.
 * @constructor
 */
function Trex(this: any, canvas: HTMLCanvasElement, spritePos: any) {
  this.canvas = canvas;
  this.canvasCtx = canvas.getContext('2d');
  this.spritePos = spritePos;
  this.xPos = 0;
  this.yPos = 0;
  // Position when on the ground.
  this.groundYPos = 0;
  this.currentFrame = 0;
  this.currentAnimFrames = [];
  this.blinkDelay = 0;
  this.blinkCount = 0;
  this.animStartTime = 0;
  this.timer = 0;
  this.msPerFrame = 1000 / FPS;
  this.config = Trex.config;
  // Current status.
  this.status = Trex.status.WAITING;

  this.jumping = false;
  this.ducking = false;
  this.jumpVelocity = 0;
  this.reachedMinHeight = false;
  this.speedDrop = false;
  this.jumpCount = 0;
  this.jumpspotX = 0;

  this.init();
}

/**
 * T-rex player config.
 * @enum {number}
 */
Trex.config = {
  DROP_VELOCITY: -5,
  GRAVITY: 0.6,
  HEIGHT: 47,
  HEIGHT_DUCK: 25,
  INIITAL_JUMP_VELOCITY: -10,
  INTRO_DURATION: 1500,
  MAX_JUMP_HEIGHT: 30,
  MIN_JUMP_HEIGHT: 30,
  SPEED_DROP_COEFFICIENT: 3,
  SPRITE_WIDTH: 262,
  START_X_POS: 50,
  WIDTH: 44,
  WIDTH_DUCK: 59,
};

/**
 * Used in collision detection.
 * @type {Array<CollisionBox>}
 */
Trex.collisionBoxes = {
  DUCKING: [new CollisionBox(1, 18, 55, 25)],
  RUNNING: [
    new CollisionBox(22, 0, 17, 16),
    new CollisionBox(1, 18, 30, 9),
    new CollisionBox(10, 35, 14, 8),
    new CollisionBox(1, 24, 29, 5),
    new CollisionBox(5, 30, 21, 4),
    new CollisionBox(9, 34, 15, 4),
  ],
};

/**
 * Animation states.
 * @enum {string}
 */
Trex.status = {
  CRASHED: 'CRASHED',
  DUCKING: 'DUCKING',
  JUMPING: 'JUMPING',
  RUNNING: 'RUNNING',
  WAITING: 'WAITING',
};

/**
 * Blinking coefficient.
 * @const
 */
Trex.BLINK_TIMING = 7000;

/**
 * Animation config for different states.
 * @enum {Object}
 */
Trex.animFrames = {
  WAITING: {
    frames: [44, 0],
    msPerFrame: 1000 / 3,
  },
  RUNNING: {
    frames: [88, 132],
    msPerFrame: 1000 / 12,
  },
  CRASHED: {
    frames: [220],
    msPerFrame: 1000 / 60,
  },
  JUMPING: {
    frames: [0],
    msPerFrame: 1000 / 60,
  },
  DUCKING: {
    frames: [264, 323],
    msPerFrame: 1000 / 8,
  },
};

Trex.prototype = {
  /**
   * T-rex player initaliser.
   * Sets the t-rex to blink at random intervals.
   */
  init: function () {
    this.groundYPos =
      Runner.defaultDimensions.HEIGHT - this.config.HEIGHT - Runner.config.BOTTOM_PAD;
    this.yPos = this.groundYPos;
    this.minJumpHeight = this.groundYPos - this.config.MIN_JUMP_HEIGHT;

    this.draw(0, 0);
    this.update(0, Trex.status.WAITING);
  },

  /**
   * Setter for the jump velocity.
   * The approriate drop velocity is also set.
   */
  setJumpVelocity: function (setting: number) {
    this.config.INIITAL_JUMP_VELOCITY = -setting;
    this.config.DROP_VELOCITY = -setting / 2;
  },

  /**
   * Set the animation status.
   * @param {!number} deltaTime
   * @param {Trex.status} opt_status Optional status to switch to.
   */
  update: function (deltaTime: number, opt_status?: string) {
    this.timer += deltaTime;

    // Update the status.
    if (opt_status) {
      this.status = opt_status;
      this.currentFrame = 0;
      this.msPerFrame = (Trex.animFrames as any)[opt_status].msPerFrame;
      this.currentAnimFrames = (Trex.animFrames as any)[opt_status].frames;

      if (opt_status == Trex.status.WAITING) {
        this.animStartTime = getTimeStamp();
        this.setBlinkDelay();
      }
    }

    // Game intro animation, T-rex moves in from the left.
    if (this.playingIntro && this.xPos < this.config.START_X_POS) {
      this.xPos += Math.round(
        (this.config.START_X_POS / this.config.INTRO_DURATION) * deltaTime
      );
    }

    if (this.status == Trex.status.WAITING) {
      this.blink(getTimeStamp());
    } else {
      this.draw(this.currentAnimFrames[this.currentFrame], 0);
    }

    // Update the frame position.
    if (this.timer >= this.msPerFrame) {
      this.currentFrame =
        this.currentFrame == this.currentAnimFrames.length - 1
          ? 0
          : this.currentFrame + 1;
      this.timer = 0;
    }

    // Speed drop becomes duck if the down key is still being pressed.
    if (this.speedDrop && this.yPos == this.groundYPos) {
      this.speedDrop = false;
      this.setDuck(true);
    }
  },

  /**
   * Draw the t-rex to a particular position.
   * @param {number} x
   * @param {number} y
   */
  draw: function (x: number, y: number) {
    var sourceX = x;
    var sourceY = y;
    var sourceWidth =
      this.ducking && this.status != Trex.status.CRASHED
        ? this.config.WIDTH_DUCK
        : this.config.WIDTH;
    var sourceHeight = this.config.HEIGHT;

    if (IS_HIDPI) {
      sourceX *= 2;
      sourceY *= 2;
      sourceWidth *= 2;
      sourceHeight *= 2;
    }

    // Adjustments for sprite sheet position.
    sourceX += this.spritePos.x;
    sourceY += this.spritePos.y;

    // Ducking.
    if (this.ducking && this.status != Trex.status.CRASHED) {
      this.canvasCtx.drawImage(
        imageSprite,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        this.xPos,
        this.yPos,
        this.config.WIDTH_DUCK,
        this.config.HEIGHT
      );
    } else {
      // Crashed whilst ducking. Trex is standing up so needs adjustment.
      if (this.ducking && this.status == Trex.status.CRASHED) {
        this.xPos++;
      }
      // Standing / running
      this.canvasCtx.drawImage(
        imageSprite,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        this.xPos,
        this.yPos,
        this.config.WIDTH,
        this.config.HEIGHT
      );
    }
  },

  /**
   * Sets a random time for the blink to happen.
   */
  setBlinkDelay: function () {
    this.blinkDelay = Math.ceil(Math.random() * Trex.BLINK_TIMING);
  },

  /**
   * Make t-rex blink at random intervals.
   * @param {number} time Current time in milliseconds.
   */
  blink: function (time: number) {
    var deltaTime = time - this.animStartTime;

    if (deltaTime >= this.blinkDelay) {
      this.draw(this.currentAnimFrames[this.currentFrame], 0);

      if (this.currentFrame == 1) {
        // Set new random delay to blink.
        this.setBlinkDelay();
        this.animStartTime = time;
        this.blinkCount++;
      }
    }
  },

  /**
   * Initialise a jump.
   * @param {number} speed
   */
  startJump: function (speed: number) {
    if (!this.jumping) {
      this.update(0, Trex.status.JUMPING);
      // Tweak the jump velocity based on the speed.
      this.jumpVelocity = this.config.INIITAL_JUMP_VELOCITY - speed / 10;
      this.jumping = true;
      this.reachedMinHeight = false;
      this.speedDrop = false;
    }
  },

  /**
   * Jump is complete, falling down.
   */
  endJump: function () {
    if (this.reachedMinHeight && this.jumpVelocity < this.config.DROP_VELOCITY) {
      this.jumpVelocity = this.config.DROP_VELOCITY;
    }
  },

  /**
   * Update frame for a jump.
   * @param {number} deltaTime
   * @param {number} speed
   */
  updateJump: function (deltaTime: number, speed: number) {
    var msPerFrame = (Trex.animFrames as any)[this.status].msPerFrame;
    var framesElapsed = deltaTime / msPerFrame;

    // Speed drop makes Trex fall faster.
    if (this.speedDrop) {
      this.yPos += Math.round(
        this.jumpVelocity * this.config.SPEED_DROP_COEFFICIENT * framesElapsed
      );
    } else {
      this.yPos += Math.round(this.jumpVelocity * framesElapsed);
    }

    this.jumpVelocity += this.config.GRAVITY * framesElapsed;

    // Minimum height has been reached.
    if (this.yPos < this.minJumpHeight || this.speedDrop) {
      this.reachedMinHeight = true;
    }

    // Reached max height
    if (this.yPos < this.config.MAX_JUMP_HEIGHT || this.speedDrop) {
      this.endJump();
    }

    // Back down at ground level. Jump completed.
    if (this.yPos > this.groundYPos) {
      this.reset();
      this.jumpCount++;
    }

    this.update(deltaTime);
  },

  /**
   * Set the speed drop. Immediately cancels the current jump.
   */
  setSpeedDrop: function () {
    this.speedDrop = true;
    this.jumpVelocity = 1;
  },

  /**
   * @param {boolean} isDucking.
   */
  setDuck: function (isDucking: boolean) {
    if (isDucking && this.status != Trex.status.DUCKING) {
      this.update(0, Trex.status.DUCKING);
      this.ducking = true;
    } else if (this.status == Trex.status.DUCKING) {
      this.update(0, Trex.status.RUNNING);
      this.ducking = false;
    }
  },

  /**
   * Reset the t-rex to running at start of game.
   */
  reset: function () {
    this.yPos = this.groundYPos;
    this.jumpVelocity = 0;
    this.jumping = false;
    this.ducking = false;
    this.update(0, Trex.status.RUNNING);
    this.midair = false;
    this.speedDrop = false;
    this.jumpCount = 0;
  },
};

//******************************************************************************

/**
 * Handles displaying the distance meter.
 * @param {!HTMLCanvasElement} canvas
 * @param {Object} spritePos Image position in sprite.
 * @param {number} canvasWidth
 * @constructor
 */
function DistanceMeter(this: any, canvas: HTMLCanvasElement, spritePos: any, canvasWidth: number) {
  this.canvas = canvas;
  this.canvasCtx = canvas.getContext('2d');
  this.spritePos = spritePos;
  this.x = 0;
  this.y = 5;

  this.currentDistance = 0;
  this.maxScore = 0;
  this.highScore = 0;
  this.container = null;

  this.digits = [];
  this.acheivement = false;
  this.defaultString = '';
  this.flashTimer = 0;
  this.flashIterations = 0;
  this.invertTrigger = false;

  this.config = DistanceMeter.config;
  this.maxScoreUnits = this.config.MAX_DISTANCE_UNITS;
  this.init(canvasWidth);
}

/**
 * @enum {number}
 */
DistanceMeter.dimensions = {
  WIDTH: 10,
  HEIGHT: 13,
  DEST_WIDTH: 11,
};

/**
 * Distance meter config.
 * @enum {number}
 */
DistanceMeter.config = {
  // Number of digits.
  MAX_DISTANCE_UNITS: 5,

  // Distance that causes achievement animation.
  ACHIEVEMENT_DISTANCE: 100,

  // Used for conversion from pixel distance to a scaled unit.
  COEFFICIENT: 0.025,

  // Flash duration in milliseconds.
  FLASH_DURATION: 1000 / 4,

  // Flash iterations for achievement animation.
  FLASH_ITERATIONS: 3,
};

DistanceMeter.prototype = {
  /**
   * Initialise the distance meter to '00000'.
   * @param {number} width Canvas width in px.
   */
  init: function (width: number) {
    var maxDistanceStr = '';

    this.calcXPos(width);
    this.maxScore = this.maxScoreUnits;
    for (var i = 0; i < this.maxScoreUnits; i++) {
      this.draw(i, 0);
      this.defaultString += '0';
      maxDistanceStr += '9';
    }

    this.maxScore = parseInt(maxDistanceStr);
  },

  /**
   * Calculate the xPos in the canvas.
   * @param {number} canvasWidth
   */
  calcXPos: function (canvasWidth: number) {
    this.x =
      canvasWidth -
      DistanceMeter.dimensions.DEST_WIDTH * (this.maxScoreUnits + 1);
  },

  /**
   * Draw a digit to canvas.
   * @param {number} digitPos Position of the digit.
   * @param {number} value Digit value 0-9.
   * @param {boolean} opt_highScore Whether drawing the high score.
   */
  draw: function (digitPos: number, value: number, opt_highScore?: boolean) {
    var sourceWidth = DistanceMeter.dimensions.WIDTH;
    var sourceHeight = DistanceMeter.dimensions.HEIGHT;
    var sourceX = DistanceMeter.dimensions.WIDTH * value;
    var sourceY = 0;

    var targetX = digitPos * DistanceMeter.dimensions.DEST_WIDTH;
    var targetY = this.y;
    var targetWidth = DistanceMeter.dimensions.WIDTH;
    var targetHeight = DistanceMeter.dimensions.HEIGHT;

    // For high DPI we 2x source values.
    if (IS_HIDPI) {
      sourceWidth *= 2;
      sourceHeight *= 2;
      sourceX *= 2;
    }

    sourceX += this.spritePos.x;
    sourceY += this.spritePos.y;

    this.canvasCtx.save();

    if (opt_highScore) {
      // Left of the current score.
      var highScoreX =
        this.x -
        this.maxScoreUnits * 2 * DistanceMeter.dimensions.WIDTH;
      this.canvasCtx.translate(highScoreX, this.y);
    } else {
      this.canvasCtx.translate(this.x, this.y);
    }

    this.canvasCtx.drawImage(
      imageSprite,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      targetX,
      targetY,
      targetWidth,
      targetHeight
    );

    this.canvasCtx.restore();
  },

  /**
   * Covert pixel distance to a 'real' distance.
   * @param {number} distance Pixel distance ran.
   * @return {number} The 'real' distance ran.
   */
  getActualDistance: function (distance: number) {
    return distance ? Math.round(distance * this.config.COEFFICIENT) : 0;
  },

  /**
   * Update the distance meter.
   * @param {number} distance
   * @param {number} deltaTime
   * @return {boolean} Whether the acheivement sound fx should be played.
   */
  update: function (deltaTime: number, distance: number) {
    var paint = true;
    var playSound = false;

    if (!this.acheivement) {
      distance = this.getActualDistance(distance);
      // Score has gone beyond the initial digit count.
      if (
        distance > this.maxScore &&
        this.maxScoreUnits == this.config.MAX_DISTANCE_UNITS
      ) {
        this.maxScoreUnits++;
        this.maxScore = parseInt(this.maxScore + '9');
      } else {
        this.distance = 0;
      }

      if (distance > 0) {
        // Acheivement unlocked
        if (distance % this.config.ACHIEVEMENT_DISTANCE == 0) {
          // Flash score and play sound.
          this.acheivement = true;
          this.flashTimer = 0;
          playSound = true;
        }

        // Create a string representation of the distance with leading 0.
        var distanceStr = (this.defaultString + distance).substr(
          -this.maxScoreUnits
        );
        this.digits = distanceStr.split('');
      } else {
        this.digits = this.defaultString.split('');
      }
    } else {
      // Control flashing of the score on reaching acheivement.
      if (this.flashIterations <= this.config.FLASH_ITERATIONS) {
        this.flashTimer += deltaTime;

        if (this.flashTimer < this.config.FLASH_DURATION) {
          paint = false;
        } else if (this.flashTimer > this.config.FLASH_DURATION * 2) {
          this.flashTimer = 0;
          this.flashIterations++;
        }
      } else {
        this.acheivement = false;
        this.flashIterations = 0;
        this.flashTimer = 0;
      }
    }

    // Draw the digits if not flashing.
    if (paint) {
      for (var i = this.digits.length - 1; i >= 0; i--) {
        this.draw(i, parseInt(this.digits[i]));
      }
    }

    this.drawHighScore();
    return playSound;
  },

  /**
   * Draw the high score.
   */
  drawHighScore: function () {
    this.canvasCtx.save();
    this.canvasCtx.globalAlpha = 0.8;
    for (var i = this.highScore.length - 1; i >= 0; i--) {
      this.draw(i, parseInt(this.highScore[i], 10), true);
    }
    this.canvasCtx.restore();
  },

  /**
   * Set the highscore as a array string.
   * Position of char in the sprite: H - 10, I - 11.
   * @param {number} distance Distance ran in pixels.
   */
  setHighScore: function (distance: number) {
    distance = this.getActualDistance(distance);
    var highScoreStr = (this.defaultString + distance).substr(
      -this.maxScoreUnits
    );

    this.highScore = ['10', '11', ''].concat(highScoreStr.split(''));
  },

  /**
   * Reset the distance meter back to '00000'.
   */
  reset: function () {
    this.update(0);
    this.acheivement = false;
  },
};

//******************************************************************************

/**
 * Cloud background item.
 * Similar to an obstacle object but without collision boxes.
 * @param {HTMLCanvasElement} canvas Canvas element.
 * @param {Object} spritePos Position of image in sprite.
 * @param {number} containerWidth
 * @constructor
 */
function Cloud(this: any, canvas: HTMLCanvasElement, spritePos: any, containerWidth: number) {
  this.canvas = canvas;
  this.canvasCtx = this.canvas.getContext('2d');
  this.spritePos = spritePos;
  this.containerWidth = containerWidth;
  this.xPos = containerWidth;
  this.yPos = 0;
  this.remove = false;
  this.cloudGap = getRandomNum(Cloud.config.MIN_CLOUD_GAP, Cloud.config.MAX_CLOUD_GAP);

  this.init();
}

/**
 * Cloud object config.
 * @enum {number}
 */
Cloud.config = {
  HEIGHT: 14,
  MAX_CLOUD_GAP: 400,
  MAX_SKY_LEVEL: 30,
  MIN_CLOUD_GAP: 100,
  MIN_SKY_LEVEL: 71,
  WIDTH: 46,
};

Cloud.prototype = {
  /**
   * Initialise the cloud. Sets the Cloud height.
   */
  init: function () {
    this.yPos = getRandomNum(Cloud.config.MAX_SKY_LEVEL, Cloud.config.MIN_SKY_LEVEL);
    this.draw();
  },

  /**
   * Draw the cloud.
   */
  draw: function () {
    this.canvasCtx.save();
    var sourceWidth = Cloud.config.WIDTH;
    var sourceHeight = Cloud.config.HEIGHT;

    if (IS_HIDPI) {
      sourceWidth = sourceWidth * 2;
      sourceHeight = sourceHeight * 2;
    }

    this.canvasCtx.drawImage(
      imageSprite,
      this.spritePos.x,
      this.spritePos.y,
      sourceWidth,
      sourceHeight,
      this.xPos,
      this.yPos,
      Cloud.config.WIDTH,
      Cloud.config.HEIGHT
    );

    this.canvasCtx.restore();
  },

  /**
   * Update the cloud position.
   * @param {number} speed
   */
  update: function (speed: number) {
    if (!this.remove) {
      this.xPos -= Math.ceil(speed);
      this.draw();

      // Mark cloud as removeable if no longer in the canvas.
      if (!this.isVisible()) {
        this.remove = true;
      }
    }
  },

  /**
   * Check if the cloud is visible on the stage.
   * @return {boolean}
   */
  isVisible: function () {
    return this.xPos + Cloud.config.WIDTH > 0;
  },
};

//******************************************************************************

/**
 * Nightmode shows a moon and stars on the horizon.
 * @constructor
 */
function NightMode(this: any, canvas: HTMLCanvasElement, spritePos: any, containerWidth: number) {
  this.spritePos = spritePos;
  this.canvas = canvas;
  this.canvasCtx = canvas.getContext('2d');
  this.xPos = containerWidth - 50;
  this.yPos = 30;
  this.currentPhase = 0;
  this.opacity = 0;
  this.containerWidth = containerWidth;
  this.stars = [];
  this.drawStars = false;
  this.placeStars();
}

/**
 * @enum {number}
 */
NightMode.config = {
  FADE_SPEED: 0.035,
  HEIGHT: 40,
  MOON_SPEED: 0.25,
  NUM_STARS: 2,
  STAR_SIZE: 9,
  STAR_SPEED: 0.3,
  STAR_MAX_Y: 70,
  WIDTH: 20,
};

NightMode.phases = [140, 120, 100, 60, 40, 20, 0];

NightMode.prototype = {
  /**
   * Update moving moon, changing phases.
   * @param {boolean} activated Whether night mode is activated.
   * @param {number} delta
   */
  update: function (activated: boolean, delta?: number) {
    // Moon phase.
    if (activated && this.opacity == 0) {
      this.currentPhase++;

      if (this.currentPhase >= NightMode.phases.length) {
        this.currentPhase = 0;
      }
    }

    // Fade in / out.
    if (activated && (this.opacity < 1 || this.opacity == 0)) {
      this.opacity += NightMode.config.FADE_SPEED;
    } else if (this.opacity > 0) {
      this.opacity -= NightMode.config.FADE_SPEED;
    }

    // Set moon positioning.
    if (this.opacity > 0) {
      this.xPos = this.updateXPos(this.xPos, NightMode.config.MOON_SPEED);

      // Update stars.
      if (this.drawStars) {
        for (var i = 0; i < NightMode.config.NUM_STARS; i++) {
          this.stars[i].x = this.updateXPos(
            this.stars[i].x,
            NightMode.config.STAR_SPEED
          );
        }
      }
      this.draw();
    } else {
      this.opacity = 0;
      this.placeStars();
    }
    this.drawStars = true;
  },

  updateXPos: function (currentPos: number, speed: number) {
    if (currentPos < -NightMode.config.WIDTH) {
      currentPos = this.containerWidth;
    } else {
      currentPos -= speed;
    }
    return currentPos;
  },

  draw: function () {
    var moonSourceWidth =
      this.currentPhase == 3 ? NightMode.config.WIDTH * 2 : NightMode.config.WIDTH;
    var moonSourceHeight = NightMode.config.HEIGHT;
    var moonSourceX = this.spritePos.x + NightMode.phases[this.currentPhase];
    var moonOutputWidth = moonSourceWidth;
    var starSize = NightMode.config.STAR_SIZE;
    var starSourceX = Runner.spriteDefinition.LDPI.STAR.x;

    if (IS_HIDPI) {
      moonSourceWidth *= 2;
      moonSourceHeight *= 2;
      moonSourceX = this.spritePos.x + NightMode.phases[this.currentPhase] * 2;
      starSize *= 2;
      starSourceX = Runner.spriteDefinition.HDPI.STAR.x;
    }

    this.canvasCtx.save();
    this.canvasCtx.globalAlpha = this.opacity;

    // Stars.
    if (this.drawStars) {
      for (var i = 0; i < NightMode.config.NUM_STARS; i++) {
        this.canvasCtx.drawImage(
          imageSprite,
          starSourceX,
          this.stars[i].sourceY,
          starSize,
          starSize,
          Math.round(this.stars[i].x),
          this.stars[i].y,
          NightMode.config.STAR_SIZE,
          NightMode.config.STAR_SIZE
        );
      }
    }

    // Moon.
    this.canvasCtx.drawImage(
      imageSprite,
      moonSourceX,
      this.spritePos.y,
      moonSourceWidth,
      moonSourceHeight,
      Math.round(this.xPos),
      this.yPos,
      moonOutputWidth,
      NightMode.config.HEIGHT
    );

    this.canvasCtx.globalAlpha = 1;
    this.canvasCtx.restore();
  },

  // Place star placement.
  placeStars: function () {
    var segmentSize = Math.round(
      this.containerWidth / NightMode.config.NUM_STARS
    );

    for (var i = 0; i < NightMode.config.NUM_STARS; i++) {
      this.stars[i] = {} as any;
      this.stars[i].x = getRandomNum(segmentSize * i, segmentSize * (i + 1));
      this.stars[i].y = getRandomNum(0, NightMode.config.STAR_MAX_Y);

      if (IS_HIDPI) {
        this.stars[i].sourceY =
          Runner.spriteDefinition.HDPI.STAR.y + NightMode.config.STAR_SIZE * 2 * i;
      } else {
        this.stars[i].sourceY =
          Runner.spriteDefinition.LDPI.STAR.y + NightMode.config.STAR_SIZE * i;
      }
    }
  },

  reset: function () {
    this.currentPhase = 0;
    this.opacity = 0;
    this.update(false);
  },
};

//******************************************************************************

/**
 * Horizon Line.
 * Consists of two connecting lines. Randomly assigns a flat / bumpy horizon.
 * @param {HTMLCanvas} canvas
 * @param {Object} spritePos Horizon position in sprite.
 * @constructor
 */
function HorizonLine(this: any, canvas: HTMLCanvasElement, spritePos: any) {
  this.spritePos = spritePos;
  this.canvas = canvas;
  this.canvasCtx = canvas.getContext('2d');
  this.sourceDimensions = {} as any;
  this.dimensions = HorizonLine.dimensions;
  this.sourceXPos = [
    this.spritePos.x,
    this.spritePos.x + this.dimensions.WIDTH,
  ];
  this.xPos = [] as any;
  this.yPos = 0;
  this.bumpThreshold = 0.5;

  this.setSourceDimensions();
  this.draw();
}

/**
 * Horizon line dimensions.
 * @enum {number}
 */
HorizonLine.dimensions = {
  WIDTH: 600,
  HEIGHT: 12,
  YPOS: 127,
};

HorizonLine.prototype = {
  /**
   * Set the source dimensions of the horizon line.
   */
  setSourceDimensions: function () {
    for (var dimension in HorizonLine.dimensions) {
      if (IS_HIDPI) {
        if (dimension != 'YPOS') {
          this.sourceDimensions[dimension] =
            (HorizonLine.dimensions as any)[dimension] * 2;
        }
      } else {
        this.sourceDimensions[dimension] = (HorizonLine.dimensions as any)[dimension];
      }
      this.dimensions[dimension] = (HorizonLine.dimensions as any)[dimension];
    }

    this.xPos = [0, HorizonLine.dimensions.WIDTH];
    this.yPos = HorizonLine.dimensions.YPOS;
  },

  /**
   * Return the crop x position of a type.
   */
  getRandomType: function () {
    return Math.random() > this.bumpThreshold ? this.dimensions.WIDTH : 0;
  },

  /**
   * Draw the horizon line.
   */
  draw: function () {
    this.canvasCtx.drawImage(
      imageSprite,
      this.sourceXPos[0],
      this.spritePos.y,
      this.sourceDimensions.WIDTH,
      this.sourceDimensions.HEIGHT,
      this.xPos[0],
      this.yPos,
      this.dimensions.WIDTH,
      this.dimensions.HEIGHT
    );

    this.canvasCtx.drawImage(
      imageSprite,
      this.sourceXPos[1],
      this.spritePos.y,
      this.sourceDimensions.WIDTH,
      this.sourceDimensions.HEIGHT,
      this.xPos[1],
      this.yPos,
      this.dimensions.WIDTH,
      this.dimensions.HEIGHT
    );
  },

  /**
   * Update the x position of an indivdual piece of the line.
   * @param {number} pos Line position.
   * @param {number} increment
   */
  updateXPos: function (pos: number, increment: number) {
    var line1 = pos;
    var line2 = pos == 0 ? 1 : 0;

    this.xPos[line1] -= increment;
    this.xPos[line2] = this.xPos[line1] + this.dimensions.WIDTH;

    if (this.xPos[line1] <= -this.dimensions.WIDTH) {
      this.xPos[line1] += this.dimensions.WIDTH * 2;
      this.xPos[line2] = this.xPos[line1] - this.dimensions.WIDTH;
      this.sourceXPos[line1] = this.getRandomType() + this.spritePos.x;
    }
  },

  /**
   * Update the horizon line.
   * @param {number} deltaTime
   * @param {number} speed
   */
  update: function (deltaTime: number, speed: number) {
    var increment = Math.floor((speed * (FPS / 1000)) * deltaTime);

    if (this.xPos[0] <= 0) {
      this.updateXPos(0, increment);
    } else {
      this.updateXPos(1, increment);
    }
    this.draw();
  },

  /**
   * Reset horizon to the starting position.
   */
  reset: function () {
    this.xPos[0] = 0;
    this.xPos[1] = HorizonLine.dimensions.WIDTH;
  },
};

//******************************************************************************

/**
 * Horizon background class.
 * @param {HTMLCanvas} canvas
 * @param {Object} spritePos Sprite positioning.
 * @param {Object} dimensions Canvas dimensions.
 * @param {number} gapCoefficient
 * @constructor
 */
function Horizon(this: any, canvas: HTMLCanvasElement, spritePos: any, dimensions: any, gapCoefficient: number) {
  this.canvas = canvas;
  this.canvasCtx = this.canvas.getContext('2d');
  this.config = Horizon.config;
  this.dimensions = dimensions;
  this.gapCoefficient = gapCoefficient;
  this.obstacles = [];
  this.obstacleHistory = [];
  this.horizonOffsets = [0, 0];
  this.cloudFrequency = this.config.CLOUD_FREQUENCY;
  this.spritePos = spritePos;
  this.nightMode = null;

  // Cloud
  this.clouds = [];
  this.cloudSpeed = this.config.BG_CLOUD_SPEED;

  // Horizon
  this.horizonLine = null;
  this.init();
}

/**
 * Horizon config.
 * @enum {number}
 */
Horizon.config = {
  BG_CLOUD_SPEED: 0.2,
  BUMPY_THRESHOLD: 0.3,
  CLOUD_FREQUENCY: 0.5,
  HORIZON_HEIGHT: 16,
  MAX_CLOUDS: 6,
};

Horizon.prototype = {
  /**
   * Initialise the horizon. Just add the line and a cloud. No obstacles.
   */
  init: function () {
    this.addCloud();
    this.horizonLine = new HorizonLine(this.canvas, this.spritePos.HORIZON);
    this.nightMode = new NightMode(
      this.canvas,
      this.spritePos.MOON,
      this.dimensions.WIDTH
    );
  },

  /**
   * @param {number} deltaTime
   * @param {number} currentSpeed
   * @param {boolean} updateObstacles Used as an override to prevent
   *     the obstacles from being updated / added. This happens in the
   *     ease in section.
   * @param {boolean} showNightMode Night mode activated.
   */
  update: function (
    deltaTime: number,
    currentSpeed: number,
    updateObstacles: boolean,
    showNightMode?: boolean
  ) {
    this.runningTime += deltaTime;
    this.horizonLine.update(deltaTime, currentSpeed);
    this.nightMode.update(showNightMode);
    this.updateClouds(deltaTime, currentSpeed);

    if (updateObstacles) {
      this.updateObstacles(deltaTime, currentSpeed);
    }
  },

  /**
   * Update the cloud positions.
   * @param {number} deltaTime
   * @param {number} speed
   */
  updateClouds: function (deltaTime: number, speed: number) {
    var cloudSpeed = (this.cloudSpeed / 1000) * deltaTime * speed;
    var numClouds = this.clouds.length;

    if (numClouds) {
      for (var i = numClouds - 1; i >= 0; i--) {
        this.clouds[i].update(cloudSpeed);
      }

      var lastCloud = this.clouds[numClouds - 1];

      // Check for adding a new cloud.
      if (
        numClouds < this.config.MAX_CLOUDS &&
        this.dimensions.WIDTH - lastCloud.xPos > lastCloud.cloudGap &&
        this.cloudFrequency > Math.random()
      ) {
        this.addCloud();
      }

      // Remove expired clouds.
      this.clouds = this.clouds.filter(function (obj: any) {
        return !obj.remove;
      });
    } else {
      this.addCloud();
    }
  },

  /**
   * Update the obstacle positions.
   * @param {number} deltaTime
   * @param {number} currentSpeed
   */
  updateObstacles: function (deltaTime: number, currentSpeed: number) {
    // Obstacles, move to Horizon layer.
    var updatedObstacles = this.obstacles.slice(0);

    for (var i = 0; i < this.obstacles.length; i++) {
      var obstacle = this.obstacles[i];
      obstacle.update(deltaTime, currentSpeed);

      // Clean up existing obstacles.
      if (obstacle.remove) {
        updatedObstacles.shift();
      }
    }
    this.obstacles = updatedObstacles;

    if (this.obstacles.length > 0) {
      var lastObstacle = this.obstacles[this.obstacles.length - 1];

      if (
        lastObstacle &&
        !lastObstacle.followingObstacleCreated &&
        lastObstacle.isVisible() &&
        lastObstacle.xPos + lastObstacle.width + lastObstacle.gap <
          this.dimensions.WIDTH
      ) {
        this.addNewObstacle(currentSpeed);
        lastObstacle.followingObstacleCreated = true;
      }
    } else {
      // Create new obstacles.
      this.addNewObstacle(currentSpeed);
    }
  },

  removeFirstObstacle: function () {
    this.obstacles.shift();
  },

  /**
   * Add a new obstacle.
   * @param {number} currentSpeed
   */
  addNewObstacle: function (currentSpeed: number) {
    var obstacleTypeIndex = getRandomNum(0, Obstacle.types.length - 1);
    var obstacleType = (Obstacle.types as any)[obstacleTypeIndex];

    // Check for multiples of the same type of obstacle.
    // Also check obstacle is available at current speed.
    if (
      this.duplicateObstacleCheck(obstacleType.type) ||
      currentSpeed < obstacleType.minSpeed
    ) {
      this.addNewObstacle(currentSpeed);
    } else {
      var obstacleSpritePos = this.spritePos[obstacleType.type];

      this.obstacles.push(
        new Obstacle(
          this.canvasCtx,
          obstacleType,
          obstacleSpritePos,
          this.dimensions,
          this.gapCoefficient,
          currentSpeed,
          obstacleType.width
        )
      );

      this.obstacleHistory.unshift(obstacleType.type);

      if (this.obstacleHistory.length > 1) {
        this.obstacleHistory.splice(Runner.config.MAX_OBSTACLE_DUPLICATION);
      }
    }
  },

  /**
   * Returns whether the previous two obstacles are the same as the next one.
   * Maximum duplication is set in config value MAX_OBSTACLE_DUPLICATION.
   * @return {boolean}
   */
  duplicateObstacleCheck: function (nextObstacleType: string) {
    var duplicateCount = 0;

    for (var i = 0; i < this.obstacleHistory.length; i++) {
      duplicateCount =
        this.obstacleHistory[i] == nextObstacleType ? duplicateCount + 1 : 0;
    }
    return duplicateCount >= Runner.config.MAX_OBSTACLE_DUPLICATION;
  },

  /**
   * Reset the horizon layer.
   * Remove existing obstacles and reposition the horizon line.
   */
  reset: function () {
    this.obstacles = [];
    this.horizonLine.reset();
    this.nightMode.reset();
  },

  /**
   * Update the canvas width and scaling.
   * @param {number} width Canvas width.
   * @param {number} height Canvas height.
   */
  resize: function (width: number, height: number) {
    this.canvas.width = width;
    this.canvas.height = height;
  },

  /**
   * Add a new cloud to the horizon.
   */
  addCloud: function () {
    this.clouds.push(
      new Cloud(this.canvas, this.spritePos.CLOUD, this.dimensions.WIDTH)
    );
  },
};

export { Runner, RunnerOptions, RunnerCallbacks, RunnerSnapshot };
export default Runner;
