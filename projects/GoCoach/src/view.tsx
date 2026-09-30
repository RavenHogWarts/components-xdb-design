/** @jsxImportSource react */
// GoCoach 主视图：做题练习（M1/M2）+ 打谱复盘（M3）双模式。
// 做题：落子即时判分（答案树回放 / 单手规则判分），提示 / 看答案演示 /
//   撤回 / 重试 / 下一题；智能推荐、顺序练习、错题复习（变式防背位置）。
// 打谱：载入 SGF（文件 / 粘贴 / vault 路径），逐手回放、变化分支导航、
//   注释与标记随行显示、试下开分支、导出 SGF。

import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { GoBoard, sgfMarkToMark, type BoardInspect } from './components/Board';
import {
  applyHint,
  createSession,
  demoMove,
  endDemo,
  inspectGroup,
  inspectOnBoard,
  mainlineFrom,
  playStone,
  referenceMoveAt,
  retrySession,
  solveBasic,
  undoMove,
  type LessonSession,
} from './go/grade';
import {
  availableLesson,
  buildCatalog,
  learning,
  practiceProgress,
  recommend,
  sequentialCollection,
  sequentialLessons,
  sequentialOptions,
  SKILLS,
  type SequentialScope,
} from './go/curriculum';
import {
  addTrialChild,
  buildGame,
  mainline,
  parseSgf,
  pathOf,
  removeTrialChildren,
  SAMPLE_SGF,
  serializeGame,
  type GameNode,
  type LoadedGame,
} from './go/sgf';
import { applyVariant } from './go/variation';
import { coordLabel, boardKey } from './go/rules';
import type { Lesson } from './go/types';
import {
  appendAttempt,
  EVENT_ENGINE_CHANGED,
  EVENT_ENGINE_STATUS,
  EVENT_LIBRARY_CHANGED,
  EVENT_LLM_CHANGED,
  EVENT_PROFILE_CHANGED,
  EVENT_SGF_CHANGED,
  loadEngineConfig,
  loadLibraries,
  loadLlmConfig,
  loadProfile,
  loadSgfConfig,
  llmConfigured,
  markHelped,
  type LlmConfig,
  type LibraryEntry,
  type Profile,
} from './storage';
import { listSgfFiles, readLocalText, joinPath } from './localfs';
import {
  engineStatus,
  ensureEngine,
  gameToAnalyzeInput,
  kataPoint,
  replayPv,
  sessionToAnalyzeInput,
  type AnalyzeInput,
  type EngineStatus,
  type NormalizedAnalysis,
  type ReviewResult,
} from './engine';
import { buildLessonMessages, buildLessonPromptText, chatCompletion, copyText } from './llm';
import { CSS_PREFIX, PLUGIN_ID, parsePrefs, type DatabaseViewProps } from './types';

const TOAST_MS = 3600;
const DEMO_STEP_MS = 650;
const AUTOPLAY_MS = 1400;

type Mode = 'practice' | 'sgf';
type PracticeModeUi = 'recommended' | 'sequential' | 'review';

const PRACTICE_MODE_LABELS: Record<PracticeModeUi, string> = {
  recommended: '智能推荐',
  sequential: '顺序练习',
  review: '错题复习',
};

/** 推荐策略的中文说明（M4：智能推荐可视化） */
const RECO_KIND_LABELS: Record<string, string> = {
  reinforce: '连错巩固',
  retry_skill: '换题再练',
  rotate: '同类轮换',
  reduce_frequency: '连对降温',
  balanced: '均衡推进',
};

/** 相对时间：今天 HH:mm / 昨天 / M-d */
function fmtRelTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return '昨天';
  return `${d.getMonth() + 1}-${d.getDate()}`;
}

/** 学习档案展开态：模块级保存，React 树重挂载后不丢（原生 details 态会随重挂载复位） */
const learnBoxState = { open: false };

/** 作者原文展开态：同样模块级保存 */
const origBoxState = { open: false };

// ─────────────────────────────────────────────────────────────
// 对外渲染器：管理 React Root 生命周期
// ─────────────────────────────────────────────────────────────
export function createViewRenderer() {
  let root: Root | null = null;
  let lastContainer: HTMLElement | null = null;

  return {
    update(props: DatabaseViewProps) {
      if (!root || lastContainer !== props.container) {
        if (root) root.unmount();
        props.container.replaceChildren();
        root = createRoot(props.container);
        lastContainer = props.container;
      }
      root.render(<GoCoachApp props={props} />);
    },
    destroy() {
      if (root) {
        root.unmount();
        root = null;
        lastContainer = null;
      }
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

// ─────────────────────────────────────────────────────────────
// 主应用
// ─────────────────────────────────────────────────────────────
function GoCoachApp({ props }: { props: DatabaseViewProps }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const pluginOptions = asRecord(props.viewDefinition?.options?.[PLUGIN_ID]);
  const prefs = parsePrefs(pluginOptions);

  // 学习档案与导入题库（跨实例经事件同步）
  const [profile, setProfile] = useState<Profile>(() => loadProfile());
  /** 学习档案展开重渲染 tick（展开态本体在模块级 learnBoxState） */
  const [learnTick, setLearnTick] = useState(0);
  /** 作者原文展开重渲染 tick（展开态本体在模块级 origBoxState） */
  const [origTick, setOrigTick] = useState(0);
  const [libraries, setLibraries] = useState<LibraryEntry[]>([]);
  const [libraryReady, setLibraryReady] = useState(false);
  const catalog = useMemo(
    () =>
      buildCatalog(
        libraries.filter((l) => l.enabled).flatMap((l) => l.lessons),
        prefs.builtinEnabled
      ),
    [libraries, prefs.builtinEnabled]
  );

  const [mode, setMode] = useState<Mode>('practice');

  // 做题状态
  const [practiceMode, setPracticeMode] = useState<PracticeModeUi>('recommended');
  const [seqValue, setSeqValue] = useState('course');
  /**
   * 题集选项：由「全量目录」（含已停用题库）生成，保证停用的题库仍可见；
   * 再按启用状态标记 disabled（原生置灰不可选），附 title / aria 提示原因。
   */
  const seqOptions: Array<{
    value: string;
    label: string;
    scope: SequentialScope;
    disabled?: boolean;
    reason?: string;
  }> = useMemo(() => {
    const allCatalog = buildCatalog(libraries.flatMap((l) => l.lessons), true);
    const enabledKeys = new Set<string>();
    for (const lib of libraries) {
      if (!lib.enabled) continue;
      for (const lesson of lib.lessons) {
        const c = sequentialCollection(lesson);
        if (c) enabledKeys.add(`${c[0]}:${c[1]}`);
      }
    }
    return sequentialOptions(allCatalog).map((o) => {
      if (o.scope.kind === 'course') {
        return prefs.builtinEnabled
          ? { ...o }
          : {
              ...o,
              disabled: true,
              reason: '内置题库已在设置 → 题库管理中停用，开启后可选',
            };
      }
      const key = `${o.scope.kind}:${o.scope.title}`;
      if (!enabledKeys.has(key)) {
        return {
          ...o,
          disabled: true,
          reason: `「${o.scope.title}」已在设置 → 题库管理中停用，开启后可选`,
        };
      }
      return { ...o };
    });
  }, [libraries, prefs.builtinEnabled]);

  // 当前选中的题集被停用时，自动切到第一个可用题集
  useEffect(() => {
    const current = seqOptions.find((o) => o.value === seqValue);
    if (current?.disabled) {
      const firstEnabled = seqOptions.find((o) => !o.disabled);
      if (firstEnabled) {
        setSeqValue(firstEnabled.value);
        setSession(null);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seqOptions]);
  const [session, setSession] = useState<LessonSession | null>(null);
  const [inspect, setInspect] = useState<BoardInspect | null>(null);
  const [inspectMode, setInspectMode] = useState(false);
  const [answers, setAnswers] = useState<Set<number> | null>(null);
  /** 顺序练习：题集选题面板开合 */
  const [showPicker, setShowPicker] = useState(false);
  /** AI 讲解（M5.1）：配置 / 进行中 / 结果 */
  const [llmCfg, setLlmCfg] = useState<LlmConfig>(() => loadLlmConfig());
  const [llmBusy, setLlmBusy] = useState(false);
  const [llmProgress, setLlmProgress] = useState<{ thinkingChars: number; contentChars: number } | null>(null);
  const [llmResult, setLlmResult] = useState<{ ok: boolean; text: string } | null>(null);
  const llmAbortRef = useRef<AbortController | null>(null);

  // AI 讲解文本渲染：使用宿主 Obsidian MarkdownRenderer（原生样式、wikilink、公式）。
  // 签名（Obsidian 1.5+）：render(app, markdown, el, sourcePath, component)——
  // app 在首位；el 必须为真实 DOM；component 传宿主 PluginComponent 防内存泄漏。
  // 宿主不可用时降级纯文本（textContent，安全无注入面）。
  const llmTextRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = llmTextRef.current;
    if (!el || !llmResult) return;
    const host = props as unknown as {
      app?: unknown;
      obsidian?: { MarkdownRenderer?: { render?: (...args: unknown[]) => Promise<void> } };
      PluginComponent?: unknown;
    };
    const renderer = host.obsidian?.MarkdownRenderer;
    const { app } = host;
    const component = host.PluginComponent;
    if (typeof renderer?.render === 'function' && app && component) {
      el.replaceChildren();
      void renderer.render
        .call(renderer, app, llmResult.text, el, props.viewId ?? '/', component)
        .catch(() => {
          el.textContent = llmResult.text;
        });
    } else {
      el.textContent = llmResult.text;
    }
  }, [llmResult, props]);

  const abortLlm = () => {
    if (llmAbortRef.current) {
      llmAbortRef.current.abort();
      llmAbortRef.current = null;
    }
    setLlmBusy(false);
    setLlmProgress(null);
  };
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const demoTimer = useRef<number | null>(null);
  const profileRef = useRef(profile);
  profileRef.current = profile;
  /** 最新做题会话（引擎异步返回后用，防止旧闭包快照覆盖用户期间的操作） */
  const sessionRef = useRef(session);
  sessionRef.current = session;

  // 人机对局（M6）：对局设置行 / 自动应手 / 引擎执子（手动应手时接管）
  const [matchSetup, setMatchSetup] = useState(false);
  const [autoReply, setAutoReply] = useState(false);
  const [engineColor, setEngineColor] = useState<1 | 2>(2);

  // 引擎状态灯（M5.2a）：engine.ts 派发事件，视图只读展示
  const [engineStat, setEngineStat] = useState<EngineStatus>(() => engineStatus());
  const [engineCfg, setEngineCfg] = useState(() => loadEngineConfig());

  // KataGo 局面分析（M5.2b 打谱）：结果按局面缓存，切回已分析节点直接显示
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [analysisErr, setAnalysisErr] = useState<string | null>(null);
  /** 仅作触发 re-render 的载体；展示统一读 analysisCache */
  const [analysisTick, setAnalysisTick] = useState(0);
  const [pvIndex, setPvIndex] = useState<number | null>(null);
  const analysisCache = useRef(new Map<string, NormalizedAnalysis>());
  void analysisTick;

  /** 引擎应手（M5.2c）：自由探索中让 KataGo 替对手落子 */
  const [engineReplyBusy, setEngineReplyBusy] = useState(false);

  /** 引擎复核（对齐原版 review）：unlisted 后把你的手与参考手做根约束对比；moveIdx 防串题 */
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewData, setReviewData] = useState<{ moveIdx: number; result: ReviewResult } | null>(null);

  // 打谱状态
  const [game, setGame] = useState<LoadedGame | null>(null);
  const [current, setCurrent] = useState<GameNode | null>(null);
  const [trialMode, setTrialMode] = useState(false);
  /** 最新打谱节点（引擎应手异步返回后用，防止旧闭包快照覆盖用户期间的操作） */
  const currentRef = useRef(current);
  currentRef.current = current;
  // SGF 文件夹（localfs 列目录；浏览器预览无 require 时列表恒为空、显示未设置态）
  const [sgfDir, setSgfDir] = useState(() => loadSgfConfig().dir);
  const [sgfFiles, setSgfFiles] = useState<string[]>([]);
  const [autoPlay, setAutoPlay] = useState(false);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [vaultPath, setVaultPath] = useState('');
  const sgfFileRef = useRef<HTMLInputElement | null>(null);

  const showToast = (message: string) => {
    setToast(message);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS);
  };

  const clearDemo = () => {
    if (demoTimer.current !== null) {
      window.clearTimeout(demoTimer.current);
      demoTimer.current = null;
    }
  };

  // 载入导入题库 + 监听设置页变更
  useEffect(() => {
    let alive = true;
    void loadLibraries().then((libs) => {
      if (alive) {
        setLibraries(libs);
        setLibraryReady(true);
      }
    });
    const onProfile = () => setProfile(loadProfile());
    const onLibrary = () => {
      void loadLibraries().then((libs) => setLibraries(libs));
    };
    const onLlm = () => setLlmCfg(loadLlmConfig());
    const onEngineStatus = (e: Event) => {
      setEngineStat((e as CustomEvent<EngineStatus>).detail ?? engineStatus());
    };
    const onEngineChanged = () => {
      setEngineCfg(loadEngineConfig());
      setEngineStat(engineStatus());
    };
    const onSgfDir = () => {
      const dir = loadSgfConfig().dir;
      setSgfDir(dir);
      setSgfFiles(dir ? listSgfFiles(dir) : []);
    };
    window.addEventListener(EVENT_PROFILE_CHANGED, onProfile);
    window.addEventListener(EVENT_LIBRARY_CHANGED, onLibrary);
    window.addEventListener(EVENT_LLM_CHANGED, onLlm);
    window.addEventListener(EVENT_ENGINE_STATUS, onEngineStatus);
    window.addEventListener(EVENT_ENGINE_CHANGED, onEngineChanged);
    window.addEventListener(EVENT_SGF_CHANGED, onSgfDir);
    onSgfDir();
    return () => {
      alive = false;
      window.removeEventListener(EVENT_PROFILE_CHANGED, onProfile);
      window.removeEventListener(EVENT_LIBRARY_CHANGED, onLibrary);
      window.removeEventListener(EVENT_LLM_CHANGED, onLlm);
      window.removeEventListener(EVENT_ENGINE_STATUS, onEngineStatus);
      window.removeEventListener(EVENT_ENGINE_CHANGED, onEngineChanged);
      window.removeEventListener(EVENT_SGF_CHANGED, onSgfDir);
      clearDemo();
      abortLlm();
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    };
  }, []);

  // ── 做题：题目选择 ────────────────────────────────────────

  const startLesson = (lesson: Lesson, variant = 0) => {
    clearDemo();
    abortLlm();
    setSession(createSession(applyVariant(lesson, variant), 0));
    setInspect(null);
    setAnswers(null);
    setLlmResult(null);
    rootRef.current?.focus({ preventScroll: true });
  };

  const pickNextId = (advanceFrom: string | null): string | null => {
    if (practiceMode === 'recommended') {
      return recommend(profileRef.current.attempts, catalog, advanceFrom)?.id ?? null;
    }
    if (practiceMode === 'sequential') {
      const scope = seqOptions.find((o) => o.value === seqValue)?.scope;
      return practiceProgress(
        catalog,
        profileRef.current.attempts,
        profileRef.current.helped,
        'sequential',
        advanceFrom,
        scope
      ).nextId;
    }
    return practiceProgress(
      catalog,
      profileRef.current.attempts,
      profileRef.current.helped,
      'review',
      advanceFrom
    ).nextId;
  };

  // 目录就绪 / 切换练习模式后自动开题
  useEffect(() => {
    if (!libraryReady || session || mode !== 'practice') return;
    const id = pickNextId(null);
    const lesson = id ? catalog.byId.get(id) : null;
    if (lesson) startLesson(lesson);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryReady, catalog, session, mode, practiceMode, seqValue]);

  const goNext = () => {
    if (session && session.moves.length && !session.attempted) markHelped(session.lesson.id);
    clearDemo();
    const id = pickNextId(session?.lesson.id ?? null);
    const lesson = id ? catalog.byId.get(id) : null;
    if (!lesson) {
      showToast(
        practiceMode === 'review'
          ? '复习池已是空的：先做题攒一些错题吧。'
          : '暂无可练题目，可换个模式或导入 Go Game Guru 题库（设置页）。'
      );
      return;
    }
    // 错题复习用随机对称变式，避免背位置；进度仍记原题 id
    const variant = practiceMode === 'review' ? Math.floor(Math.random() * 8) : 0;
    startLesson(lesson, variant);
  };

  const pushAttempt = (s: LessonSession, correct: boolean | null, summary: string) => {
    const lesson = s.lesson;
    const attemptNo =
      profileRef.current.attempts.filter((a) => a.lessonId === lesson.id).length + 1;
    appendAttempt({
      createdAt: new Date().toISOString(),
      lessonId: lesson.id,
      title: lesson.title,
      skill: lesson.skill,
      difficulty: lesson.difficulty,
      correct,
      assisted: s.assisted,
      attemptNo,
      summary,
    });
  };

  // ── 做题：盘面交互 ────────────────────────────────────────

  const onPracticePlay = (x: number, y: number) => {
    if (!session) return;
    // 点击棋子：随时查气（规则事实展示，不影响判分，也不记为提示后作答）
    if (session.board[y][x] !== 0) {
      const found = inspectGroup(session, x, y);
      setInspect(found);
      if (found) {
        showToast(
          `这块棋共 ${found.count} 颗棋子、${found.libs} 口气。斜对角不算气，相同空点只数一次。`
        );
      }
      return;
    }
    if (inspectMode) return; // 查气专注模式：空点也不落子，方便纯读棋
    let next: LessonSession;
    try {
      next = playStone(session, x, y);
    } catch (err) {
      showToast((err as Error).message);
      return;
    }
    setInspect(null);
    const a = next.assessment;
    if (
      !next.recorded &&
      a &&
      (a.status === 'solved' || a.status === 'unlisted' || a.status === 'wrong')
    ) {
      next = { ...next, recorded: true };
      pushAttempt(next, a.correct, a.summary);
    }
    setSession(next);
  };

  const handleUndo = () => {
    if (!session || !session.history.length) return;
    clearDemo();
    try {
      setSession(undoMove(session));
      setInspect(null);
    } catch (err) {
      showToast((err as Error).message);
    }
  };

  const handleRetry = () => {
    if (!session) return;
    if (session.moves.length && !session.attempted) markHelped(session.lesson.id);
    clearDemo();
    setSession(retrySession(session));
    setInspect(null);
    setAnswers(null);
  };

  const handleHint = () => {
    if (!session) return;
    setSession(applyHint(session));
    setInspect(null);
  };

  /** 引擎应手（M5.2c）：自由探索中让 KataGo 替对手落子（走 playout 分支，不判分） */
  const handleEngineReply = async () => {
    if (!session || engineReplyBusy) return;
    setEngineReplyBusy(true);
    try {
      const engine = await ensureEngine();
      if (!engine) {
        showToast('引擎未启用：请到设置 → KataGo 引擎配置并启动。');
        return;
      }
      const result = await engine.analyze(sessionToAnalyzeInput(session));
      const best = result.moves[0];
      if (!best) throw new Error('引擎没有返回候选着法。');
      const p = kataPoint(best.move, session.lesson.size);
      if (!p) {
        showToast('引擎建议停一手（pass），可继续按自己的想法落子。');
        return;
      }
      // 引擎思考期间用户可能已改变局面：闭包里的 session 是旧快照，
      // 直接落子会用旧盘面覆盖用户新下的手（表现为"棋子没上盘"）——基于最新局面落。
      const latest = sessionRef.current;
      const base = latest ?? session;
      if (base.board[p.y]?.[p.x]) {
        showToast(`引擎应手 ${best.move} 时局面已变化，请再点一次引擎应手。`);
        return;
      }
      setSession(playStone(base, p.x, p.y));
      setInspect(null);
      showToast(`引擎应手 ${best.move}（黑 ${(best.blackWinrate * 100).toFixed(0)}%）。`);
    } catch (err) {
      showToast(`引擎应手失败：${(err as Error).message}`);
    } finally {
      setEngineReplyBusy(false);
    }
  };

  /** 引擎复核：对走出收录变化的最后一手，与参考首手各做一次根约束查询（证据对比，不判生死） */
  const handleReview = async () => {
    if (!session || reviewBusy) return;
    if (session.assessment?.status !== 'unlisted' || !session.moves.length) return;
    const candidate = session.moves[session.moves.length - 1];
    const ref = referenceMoveAt(session, session.moves.length - 1);
    if (!ref) {
      showToast('这手没有可对照的参考变化，请直接看答案。');
      return;
    }
    setReviewBusy(true);
    try {
      const engine = await ensureEngine();
      if (!engine) {
        showToast('引擎未启用：请到设置 → KataGo 引擎配置并启动。');
        return;
      }
      const size = session.lesson.size;
      const input: AnalyzeInput = {
        ...sessionToAnalyzeInput(session),
        moves: session.moves.slice(0, -1), // 落子前局面
        toPlay: candidate.color, // 被复核一方的行棋权
      };
      const result = await engine.review(
        input,
        coordLabel(candidate.x, candidate.y, size),
        coordLabel(ref.x, ref.y, size)
      );
      setReviewData({ moveIdx: session.moves.length - 1, result });
    } catch (err) {
      showToast(`复核失败：${(err as Error).message}`);
    } finally {
      setReviewBusy(false);
    }
  };

  /** 复制当前局面的 AI 提示词（可粘贴到任意聊天模型） */
  const handleCopyPrompt = () => {
    if (!session) return;
    void copyText(buildLessonPromptText(session))
      .then(() => showToast('提示词已复制，可粘贴到任意 AI 对话。'))
      .catch(() => showToast('复制失败：浏览器未授权剪贴板。'));
  };

  /** AI 讲解当前局面（M5.1：OpenAI 兼容端点，流式 + 思考进度） */
  const handleLlmExplain = () => {
    if (!session || llmBusy) return;
    if (!llmConfigured(llmCfg)) {
      showToast('尚未配置 AI 讲解：设置 → AI 讲解（OpenAI 兼容）填写 Base URL 与模型名。');
      return;
    }
    abortLlm();
    const controller = new AbortController();
    llmAbortRef.current = controller;
    setLlmBusy(true);
    setLlmProgress(null);
    setLlmResult(null);
    void chatCompletion(llmCfg, buildLessonMessages(session), {
      signal: controller.signal,
      onProgress: (p) => {
        setLlmProgress(p);
        // 正文开始输出后渐进上屏
        if (p.content) setLlmResult({ ok: true, text: p.content });
      },
    })
      .then((text) => {
        setLlmResult({ ok: true, text });
      })
      .catch((err: Error) => {
        if (controller.signal.aborted && !err.message.includes('中断') && !err.message.includes('无响应')) return;
        setLlmResult({ ok: false, text: err.message });
      })
      .finally(() => {
        if (llmAbortRef.current === controller) llmAbortRef.current = null;
        setLlmBusy(false);
      });
  };

  /** 看答案：基础题推导答案点；序盘题逐步演示主线 */
  const handleAnswer = () => {
    if (!session || session.demo) return;
    clearDemo();
    let s = session;
    if (!s.recorded && !s.attempted) {
      s = { ...s, assisted: true, recorded: true, attempted: true, resolved: true };
      pushAttempt(s, false, '查看了答案。');
    } else {
      s = { ...s, assisted: true };
    }
    setAnswers(null);
    setInspect(null);
    if (!s.lesson.sequence) {
      const pts = solveBasic(s);
      setSession({ ...s, message: '答案已标出（绿色圆环）。可以重试本题巩固。' });
      setAnswers(new Set(pts.map((p) => p.y * s.lesson.size + p.x)));
      return;
    }
    const line = mainlineFrom(s);
    if (!line.length) {
      setSession({ ...s, message: '当前位置没有可演示的收录变化。' });
      return;
    }
    let step = 0;
    let demoState = demoMove(s, line[0].x, line[0].y);
    setSession(demoState);
    const tick = () => {
      step += 1;
      if (step >= line.length) {
        demoTimer.current = window.setTimeout(() => {
          demoTimer.current = null;
          setSession((cur) => (cur ? endDemo(cur) : cur));
        }, DEMO_STEP_MS);
        return;
      }
      demoState = demoMove(demoState, line[step].x, line[step].y);
      setSession(demoState);
      demoTimer.current = window.setTimeout(tick, DEMO_STEP_MS);
    };
    demoTimer.current = window.setTimeout(tick, DEMO_STEP_MS);
  };

  // ── 打谱：载入 / 导航 / 试下 / 导出 ───────────────────────

  /** 从 SGF 文件夹加载一盘棋（localfs 读取；选中即载入） */
  const loadSgfFromDir = (name: string) => {
    const dir = loadSgfConfig().dir;
    if (!dir || !name) return;
    try {
      loadSgfText(readLocalText(joinPath(dir, name)), name);
      rootRef.current?.focus({ preventScroll: true });
    } catch (err) {
      showToast(`读取 ${name} 失败：${(err as Error).message}`);
    }
  };

  const rescanSgfDir = () => {
    const dir = loadSgfConfig().dir;
    setSgfDir(dir);
    setSgfFiles(dir ? listSgfFiles(dir) : []);
  };

  const loadSgfText = (text: string, fileName: string | null) => {
    try {
      const parsed = parseSgf(text);
      const loaded = buildGame(parsed, fileName);
      setGame(loaded);
      setCurrent(loaded.root);
      setTrialMode(false);
      setAutoPlay(false);
      if (loaded.warnings.length) {
        showToast(`已载入（${loaded.warnings.length} 处着法无法回放，已标记）。`);
      }    } catch (err) {
      showToast(`载入失败：${(err as Error).message}`);
    }
  };

  const handleSgfFile = (file: File | null) => {
    if (!file) return;
    void file.text().then((text) => loadSgfText(text, file.name));
  };

  const handleVaultRead = async () => {
    const vault = (props as { app?: { vault?: any } }).app?.vault;
    if (
      !vault ||
      typeof vault.getAbstractFileByPath !== 'function' ||
      typeof vault.cachedRead !== 'function'
    ) {
      showToast('当前宿主不支持读取 vault 文件，请用「打开文件」或粘贴。');
      return;
    }
    const file = vault.getAbstractFileByPath(vaultPath.trim());
    if (!file || typeof file.stat !== 'object') {
      showToast('vault 中找不到该文件。');
      return;
    }
    try {
      const text = await vault.cachedRead(file);
      loadSgfText(text, file.name);
    } catch (err) {
      showToast(`读取失败：${(err as Error).message}`);
    }
  };

  const handleExport = () => {
    if (!game) return;
    const text = serializeGame(game);
    const blob = new Blob([text], { type: 'application/x-go-sgf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (game.info.fileName ?? 'go-coach-game').replace(/\.sgf$/i, '') + '.sgf';
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  const gotoNode = (node: GameNode) => {
    setCurrent(node);
    if (!node.children.length) setAutoPlay(false);
  };

  const stepNext = () => {
    if (!current) return;
    const child = current.children[0];
    if (child) gotoNode(child);
  };

  const stepPrev = () => {
    if (current?.parent) gotoNode(current.parent);
  };

  const goStart = () => game && gotoNode(game.root);

  const goEnd = () => {
    if (!game) return;
    const line = mainline(game.root);
    gotoNode(line[line.length - 1]);
  };

  const onSgfPlay = (x: number, y: number) => {
    if (!current || !game) return;
    // 点击棋子同样可查气
    if (current.board[y][x] !== 0) {
      const found = inspectOnBoard(current.board, game.info.size, x, y);
      setInspect(found);
      if (found) {
        showToast(
          `这块棋共 ${found.count} 颗棋子、${found.libs} 口气。斜对角不算气，相同空点只数一次。`
        );
      }
      return;
    }
    if (!trialMode) {
      showToast('先打开「试下」开关，再在当前局面落子推演。');
      return;
    }
    const node = addTrialChild(current, x, y);
    if (!node) {
      showToast('这一步不能下（占用 / 自杀 / 全局同形禁着）。');
      return;
    }
    setInspect(null);
    gotoNode(node);
  };

  // ── 人机对局（M6）：试下分支 + 引擎应手 ────────────────────

  /** 打谱引擎应手：在当前局面开试下分支替引擎落子。
   *  manual=true（手动按钮）：替当前轮次下并让引擎接管该颜色（开局点一次=引擎执黑）；
   *  manual=false（自动应手）：只在轮到引擎时下。 */
  const handleSgfEngineReply = async (manual: boolean) => {
    if (!game || !current || engineReplyBusy || !trialMode) return;
    setEngineReplyBusy(true);
    try {
      const engine = await ensureEngine();
      if (!engine) {
        showToast('引擎未启用：请到设置 → KataGo 引擎配置并启动。');
        return;
      }
      const latest = currentRef.current ?? current;
      const result = await engine.analyze(gameToAnalyzeInput(game, pathOf(latest), latest));
      const best = result.moves[0];
      if (!best) throw new Error('引擎没有返回候选着法。');
      const p = kataPoint(best.move, game.info.size);
      if (!p) {
        showToast('引擎建议停一手（pass），可继续落子或结束对局。');
        return;
      }
      const target = currentRef.current ?? current;
      const child = addTrialChild(target, p.x, p.y);
      if (!child) {
        showToast('引擎选择的点当前无法落子，可再点一次应手。');
        return;
      }
      setInspect(null);
      gotoNode(child);
      if (manual) {
        setEngineColor(latest.toPlay);
        showToast(`引擎落子 ${best.move}（黑 ${(best.blackWinrate * 100).toFixed(0)}%），已接管${latest.toPlay === 1 ? '黑' : '白'}棋。`);
      }
    } catch (err) {
      showToast(`引擎应手失败：${(err as Error).message}`);
    } finally {
      setEngineReplyBusy(false);
    }
  };

  // 自动应手：轮到引擎且当前节点无分支时自动落子（延迟片刻避免与用户点击竞态）
  useEffect(() => {
    if (mode !== 'sgf' || !trialMode || !autoReply || engineReplyBusy) return;
    if (!game || !current) return;
    if (current.toPlay !== engineColor) return;
    if (current.children.length) return;
    const timer = window.setTimeout(() => void handleSgfEngineReply(false), 400);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, trialMode, autoReply, current, game, engineReplyBusy, engineColor]);

  const startMatch = (size: 9 | 13 | 19) => {
    loadSgfText(
      `(;GM[1]FF[4]SZ[${size}]CA[UTF-8]PB[我]PW[KataGo])`,
      `人机对局-${size}路.sgf`
    );
    setTrialMode(true);
    setAutoReply(true);
    setEngineColor(2);
    setMatchSetup(false);
    showToast(`新对局：${size} 路，你执黑先行，引擎自动应手已开启。想让引擎执黑：开局先点一次「⚡ 引擎应手」。`);
  };

  const undoTrial = () => {
    if (current?.parent) gotoNode(current.parent);
  };

  const clearTrial = () => {
    if (!current || !game) return;
    const path = pathOf(current);
    const anchor = [...path].reverse().find((n) => !n.isTrial) ?? game.root;
    removeTrialChildren(anchor);
    gotoNode(anchor);
    showToast('已清除试下分支。');
  };

  // ── KataGo 局面分析（M5.2b）──────────────────────────────

  /** 当前节点的分析缓存键：盘面 + 轮次（同局面同轮次结果可复用，与路径无关） */
  const analysisKeyOf = (node: GameNode) => `${boardKey(node.board)}|${node.toPlay}`;

  const runAnalysis = async () => {
    if (!game || !current || analysisBusy) return;
    const key = analysisKeyOf(current);
    if (analysisCache.current.has(key)) {
      setPvIndex(null);
      setAnalysisTick((t) => t + 1);
      return;
    }
    setAnalysisBusy(true);
    setAnalysisErr(null);
    try {
      const engine = await ensureEngine();
      if (!engine) throw new Error('引擎未启用：请到设置 → KataGo 引擎配置并启动（或选远程端点）。');
      const data = await engine.analyze(gameToAnalyzeInput(game, sgfPath, current));
      const cache = analysisCache.current;
      if (cache.size >= 40) {
        const oldest = cache.keys().next().value;
        if (typeof oldest === 'string') cache.delete(oldest);
      }
      cache.set(analysisKeyOf(current), data);
      setPvIndex(null);
      setAnalysisTick((t) => t + 1);
    } catch (err) {
      setAnalysisErr((err as Error).message);
    } finally {
      setAnalysisBusy(false);
    }
  };

  /** 当前节点命中的分析结果（ref 读取，analysisTick 触发刷新） */
  const shownAnalysis = current ? analysisCache.current.get(analysisKeyOf(current)) ?? null : null;
  const shownPvMove =
    shownAnalysis && pvIndex !== null ? shownAnalysis.moves[pvIndex] ?? null : null;
  const pvPreview =
    shownPvMove && current && game
      ? replayPv(current.board, game.info.size, shownPvMove.pv, current.toPlay)
      : null;
  /** 候选点字母标记（A B C…按 order；预览中隐藏，避免与手数叠字） */
  const candidateMarks =
    shownAnalysis && !pvPreview && game
      ? shownAnalysis.moves.slice(0, 6).flatMap((m, i) => {
          const p = kataPoint(m.move, game.info.size);
          return p ? [{ x: p.x, y: p.y, label: String.fromCharCode(65 + i) }] : [];
        })
      : [];

  // 自动播放
  useEffect(() => {
    if (mode !== 'sgf' || !autoPlay || !current) return;
    if (!current.children.length) {
      setAutoPlay(false);
      return;
    }
    const timer = window.setTimeout(() => gotoNode(current.children[0]), AUTOPLAY_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlay, current, mode]);

  // ── 键盘 ──────────────────────────────────────────────────

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
    ) {
      return;
    }
    if (e.key === 'Escape') {
      setInspect(null);
      setShowPicker(false);
      return;
    }
    if (mode === 'sgf') {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        stepPrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        stepNext();
      } else if (e.key === 'Home') {
        e.preventDefault();
        goStart();
      } else if (e.key === 'End') {
        e.preventDefault();
        goEnd();
      } else if (e.key === ' ') {
        e.preventDefault();
        setAutoPlay((v) => !v);
      }
      return;
    }
    if (e.key === 'z' || e.key === 'Z') {
      e.preventDefault();
      handleUndo();
    } else if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      goNext();
    } else if (e.key === 'h' || e.key === 'H') {
      e.preventDefault();
      handleHint();
    } else if (e.key === 'x' || e.key === 'X') {
      // 查气专注模式：开启后空点也不落子，纯读棋（Esc 清除显示）
      e.preventDefault();
      setInspectMode((v) => !v);
      setInspect(null);
    }
  };

  // ── 派生渲染数据 ──────────────────────────────────────────

  const learningInfo = useMemo(
    () => (mode === 'practice' ? learning(profile.attempts, catalog) : null),
    [profile, catalog, mode]
  );
  /** 学习档案面板派生数据：正确率 / 复习池 / 近期作答 */
  const learnStats = useMemo(() => {
    if (!learningInfo) return null;
    const accuracy =
      learningInfo.independentAttempts > 0
        ? Math.round((learningInfo.independentCorrect / learningInfo.independentAttempts) * 100)
        : null;
    const reviewCount = practiceProgress(
      catalog,
      profile.attempts,
      profile.helped,
      'review',
      null
    ).reviewCount;
    const recent = [...profile.attempts].slice(-10).reverse();
    return { accuracy, reviewCount, recent };
  }, [learningInfo, profile, catalog]);

  const progressInfo = useMemo(() => {
    if (mode !== 'practice') return null;
    if (practiceMode === 'recommended') {
      const pool = catalog.lessons.filter(availableLesson);
      const completed = new Set(
        profile.attempts.filter((a) => a.correct === true).map((a) => a.lessonId)
      );
      return {
        label: '智能推荐',
        detail: `${pool.filter((l) => completed.has(l.id)).length}/${pool.length} 题已答对`,
      };
    }
    const scope = seqOptions.find((o) => o.value === seqValue)?.scope;
    const info = practiceProgress(
      catalog,
      profile.attempts,
      profile.helped,
      practiceMode,
      session?.lesson.id ?? null,
      scope
    );
    return {
      label:
        practiceMode === 'review'
          ? `复习池剩 ${info.reviewCount} 题`
          : `第 ${Math.max(1, info.currentIndex ?? 1)}/${info.total} 题 · 剩 ${info.remaining}`,
      detail: `已答对 ${info.completed}/${info.total}`,
    };
  }, [mode, practiceMode, catalog, profile, seqValue, seqOptions, session]);

  // 顺序练习选题面板：当前题集的全部题目与完成状态
  const pickerScope = seqOptions.find((o) => o.value === seqValue)?.scope;
  const pickerPool = useMemo(
    () =>
      practiceMode === 'sequential' && showPicker && pickerScope
        ? sequentialLessons(catalog, pickerScope)
        : [],
    [practiceMode, showPicker, pickerScope, catalog]
  );
  const completedIds = useMemo(
    () => new Set(profile.attempts.filter((a) => a.correct === true).map((a) => a.lessonId)),
    [profile]
  );
  const wrongIds = useMemo(
    () =>
      new Set([
        ...profile.helped,
        ...profile.attempts.filter((a) => a.correct === false).map((a) => a.lessonId),
      ]),
    [profile]
  );

  const practiceMarks = (() => {
    if (!session) return [];
    const a = session.assessment;
    if (a?.marks?.length) return a.marks;
    // 题目标记只标仍在盘上的点（提掉的不再标）
    return session.lesson.marks.filter((m) => session.board[m.y][m.x] !== 0);
  })();

  const boardState =
    session?.assessment?.status === 'solved'
      ? ('solved' as const)
      : session?.assessment?.status === 'wrong'
        ? ('wrong' as const)
        : ('default' as const);

  /** 空点是否可落子（棋子点击查气不受此限制，始终可用） */
  const canPlay = (() => {
    if (!session) return false;
    if (session.demo) return false;
    if (inspectMode) return false;
    if (session.resolved && !session.playout) return false;
    return true;
  })();

  const statusSummary = session?.assessment?.summary ?? session?.message ?? '';
  const statusDetail = session?.assessment?.explanation ?? '';

  const sgfPath = useMemo(() => (current ? pathOf(current) : []), [current]);
  const sgfMoveNumbers = useMemo(() => {
    const map = new Map<number, number>();
    if (!prefs.showMoveNumbers || !current || !game) return map;
    for (const node of sgfPath) {
      if (node.move && !node.move.pass) {
        map.set(node.move.y * game.info.size + node.move.x, node.moveNo);
      }
    }
    return map;
  }, [current, game, prefs.showMoveNumbers, sgfPath]);

  const sgfTrialSet = useMemo(() => {
    const set = new Set<number>();
    if (!current || !game) return set;
    for (const node of sgfPath) {
      if (node.isTrial && node.move && !node.move.pass) {
        set.add(node.move.y * game.info.size + node.move.x);
      }
    }
    return set;
  }, [current, game, sgfPath]);

  const mainlineIndex = (() => {
    if (!game || !current) return 0;
    const line = mainline(game.root);
    const idx = line.indexOf(current);
    if (idx >= 0) return idx;
    const anchor = [...sgfPath].reverse().find((n) => line.includes(n)) ?? game.root;
    return line.indexOf(anchor);
  })();

  const mainlineTotal = game ? mainline(game.root).length - 1 : 0;

  // ── 渲染 ──────────────────────────────────────────────────

  return (
    <div
      ref={rootRef}
      className={CSS_PREFIX + 'root'}
      tabIndex={0}
      role="application"
      aria-label="围棋练习室"
      onKeyDown={handleKeyDown}
    >
      {/* 顶栏 */}
      <div className={CSS_PREFIX + 'topbar'}>
        <div className={CSS_PREFIX + 'brand'}>
          <div className={CSS_PREFIX + 'logo'}>围棋练习室</div>
          <div className={CSS_PREFIX + 'mode'}>
            {(() => {
              const importedCount = libraries
                .filter((l) => l.enabled)
                .reduce((n, l) => n + l.lessons.length, 0);
              return importedCount
                ? `内置${prefs.builtinEnabled ? '+导入' : ''} ${catalog.lessons.length} 题在册`
                : '内置题库 · 完整离线';
            })()}
          </div>
        </div>
        <div className={CSS_PREFIX + 'segGroup'}>
          <div className={CSS_PREFIX + 'segmented'}>
            <button
              type="button"
              className={`${CSS_PREFIX}segBtn${mode === 'practice' ? ` ${CSS_PREFIX}segBtn--on` : ''}`}
              aria-pressed={mode === 'practice'}
              onClick={() => setMode('practice')}
            >
              做题练习
            </button>
            <button
              type="button"
              className={`${CSS_PREFIX}segBtn${mode === 'sgf' ? ` ${CSS_PREFIX}segBtn--on` : ''}`}
              aria-pressed={mode === 'sgf'}
              onClick={() => setMode('sgf')}
            >
              打谱复盘
            </button>
          </div>
        </div>
        {mode === 'practice' && learningInfo && (
          <div className={CSS_PREFIX + 'statsChip'} title="学习档案：独立作答统计">
            独立作答 {learningInfo.independentAttempts} · 答对 {learningInfo.independentCorrect}
          </div>
        )}
        {engineCfg.mode === 'off' ? (
          <span
            className={`${CSS_PREFIX}engineDot ${CSS_PREFIX}engineDot--off`}
            title="KataGo 引擎未启用（设置 → KataGo 引擎可开启）"
          />
        ) : (
          <div
            className={`${CSS_PREFIX}engineChip ${CSS_PREFIX}engineChip--${engineStat.state}`}
            role="status"
            title={
              engineCfg.mode === 'remote' && engineStat.state === 'off'
                ? '远程端点：分析时按需请求（设置中可测试连接）'
                : engineStat.message
            }
          >
            <span className={`${CSS_PREFIX}engineDot ${CSS_PREFIX}engineDot--${engineStat.state}`} />
            {engineStat.state === 'ready'
              ? '引擎就绪'
              : engineStat.state === 'starting'
                ? '引擎启动中…'
                : engineStat.state === 'error'
                  ? '引擎错误'
                  : engineCfg.mode === 'remote'
                    ? '远程端点'
                    : '引擎已停止'}
          </div>
        )}
      </div>

      {mode === 'practice' ? (
        <div className={CSS_PREFIX + 'practiceWrap'}>
          {/* 选择器行 */}
          <div className={CSS_PREFIX + 'selectorRow'}>
            <div className={CSS_PREFIX + 'segGroup'}>
              <span className={CSS_PREFIX + 'segLabel'}>练习</span>
              <div className={CSS_PREFIX + 'segmented'}>
                {(Object.keys(PRACTICE_MODE_LABELS) as PracticeModeUi[]).map((m) => (
                  <button
                    type="button"
                    key={m}
                    className={`${CSS_PREFIX}segBtn${practiceMode === m ? ` ${CSS_PREFIX}segBtn--on` : ''}`}
                    aria-pressed={practiceMode === m}
                    onClick={() => {
                      setPracticeMode(m);
                      setSession(null);
                      setShowPicker(false);
                    }}
                    disabled={m === 'review' && profile.attempts.length === 0}
                    title={PRACTICE_MODE_LABELS[m]}
                  >
                    {PRACTICE_MODE_LABELS[m]}
                  </button>
                ))}
              </div>
            </div>
            {practiceMode === 'sequential' && (
              <>
                <label className={CSS_PREFIX + 'selectWrap'}>
                  <span>题集</span>
                  <select
                    value={seqValue}
                    aria-label="顺序练习题集选择（停用的题库置灰不可选）"
                    onChange={(e) => {
                      setSeqValue(e.target.value);
                      setSession(null);
                    }}
                  >
                    {seqOptions.map((o) => (
                      <option
                        key={o.value}
                        value={o.value}
                        disabled={o.disabled}
                        title={o.reason}
                        aria-label={o.disabled ? `${o.label}（${o.reason}）` : o.label}
                      >
                        {o.label}
                        {o.disabled ? '（已停用）' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className={`${CSS_PREFIX}btn${showPicker ? ` ${CSS_PREFIX}btn--on` : ''}`}
                  aria-pressed={showPicker}
                  onClick={() => setShowPicker((v) => !v)}
                  title="选题：浏览当前题集的全部题目与完成状态，点击任意题直达"
                >
                  ☰ 选题
                </button>
              </>
            )}
            {progressInfo && (
              <div className={CSS_PREFIX + 'progressChip'}>
                <strong>{progressInfo.label}</strong>
                <span>{progressInfo.detail}</span>
              </div>
            )}
            {practiceMode === 'review' && (
              <span className={CSS_PREFIX + 'note'}>复习题为随机方位变式，进度记原题</span>
            )}
          </div>

          {/* 学习档案（M4：掌握度评估 + 推荐可视化 + 近期作答）
              展开态用模块级变量 + 按钮条件渲染：宿主频繁重渲染或整树重挂载均不影响 */}
          {learningInfo && learnStats && (
            <div className={CSS_PREFIX + 'learningBox'}>
              <button
                type="button"
                className={CSS_PREFIX + 'learningToggle'}
                aria-expanded={learnBoxState.open}
                onClick={() => {
                  learnBoxState.open = !learnBoxState.open;
                  setLearnTick((t) => t + 1);
                }}
              >
                <span className={CSS_PREFIX + 'learningArrow'} aria-hidden="true">
                  {learnBoxState.open ? '▾' : '▸'}
                </span>
                学习档案 · {learningInfo.stage} · 独立作答 {learningInfo.independentAttempts} · 答对{' '}
                {learningInfo.independentCorrect}
                {learnStats.accuracy !== null ? `（${learnStats.accuracy}%）` : ''}
              </button>
              {learnTick >= 0 && learnBoxState.open && (
              <div className={CSS_PREFIX + 'learnPanel'}>
                {/* 概览 */}
                <div className={CSS_PREFIX + 'learnStats'}>
                  <div>
                    <strong>{learningInfo.independentCorrect}</strong>
                    <span>独立答对</span>
                  </div>
                  <div>
                    <strong>{learningInfo.independentAttempts}</strong>
                    <span>独立作答</span>
                  </div>
                  <div>
                    <strong>{learnStats.accuracy ?? '—'}</strong>
                    <span>正确率{learnStats.accuracy !== null ? '%' : ''}</span>
                  </div>
                  <div>
                    <strong>{learnStats.reviewCount}</strong>
                    <span>复习池</span>
                  </div>
                  <div>
                    <strong>{profile.attempts.length}</strong>
                    <span>总作答</span>
                  </div>
                </div>

                {/* 知识点掌握度 */}
                <div className={CSS_PREFIX + 'learnSection'}>知识点掌握度</div>
                <div className={CSS_PREFIX + 'skillGrid'}>
                  {learningInfo.skills.map((s) => {
                    const pct =
                      s.independentAttempts > 0
                        ? Math.round((s.correct / s.independentAttempts) * 100)
                        : 0;
                    return (
                      <div key={s.id} className={CSS_PREFIX + 'skillRow'}>
                        <div className={CSS_PREFIX + 'skillRowHead'}>
                          <strong>{s.name}</strong>
                          <span>{s.stage}</span>
                        </div>
                        <div
                          className={CSS_PREFIX + 'skillBar'}
                          role="img"
                          aria-label={`${s.name} 独立作答正确率 ${s.independentAttempts ? pct : '—'}%`}
                        >
                          <span style={{ width: `${s.independentAttempts ? pct : 0}%` }} />
                        </div>
                        <small>
                          {s.independentAttempts
                            ? `独立 ${s.independentAttempts} 次 · 答对 ${s.correct} · ${pct}%`
                            : '独立作答样本不足，继续练习看看'}
                          {` · 建议难度 ${s.nextDifficulty}`}
                        </small>
                      </div>
                    );
                  })}
                </div>

                {/* 智能推荐 */}
                {learningInfo.recommendation && (
                  <>
                    <div className={CSS_PREFIX + 'learnSection'}>下一题推荐</div>
                    <div className={CSS_PREFIX + 'recoCard'}>
                      <div className={CSS_PREFIX + 'recoHead'}>
                        <span className={CSS_PREFIX + 'chip'}>
                          {RECO_KIND_LABELS[learningInfo.recommendation.adjustment.kind] ?? '推荐'}
                        </span>
                        <strong>{learningInfo.recommendation.title}</strong>
                        <span className={CSS_PREFIX + 'recoMeta'}>
                          {SKILLS[learningInfo.recommendation.skill] ?? learningInfo.recommendation.skill}
                          {' · '}
                          难度 {learningInfo.recommendation.difficulty}
                        </span>
                      </div>
                      <div className={CSS_PREFIX + 'recoReason'}>
                        {learningInfo.recommendation.reason}
                      </div>
                    </div>
                  </>
                )}

                {/* 近期作答 */}
                <div className={CSS_PREFIX + 'learnSection'}>近期作答</div>
                {learnStats.recent.length ? (
                  <div className={CSS_PREFIX + 'historyList'}>
                    {learnStats.recent.map((a, i) => (
                      <div key={i} className={CSS_PREFIX + 'historyRow'}>
                        <span
                          className={`${CSS_PREFIX}historyMark ${CSS_PREFIX}historyMark--${
                            a.correct === true ? 'ok' : a.correct === false ? 'bad' : 'wait'
                          }`}
                          title={
                            a.correct === true ? '答对' : a.correct === false ? '答错' : '走出收录变化（待复核）'
                          }
                        >
                          {a.correct === true ? '✓' : a.correct === false ? '✗' : '～'}
                        </span>
                        <span className={CSS_PREFIX + 'historyTitle'} title={a.title}>
                          {a.title}
                        </span>
                        <small>
                          难度 {a.difficulty}
                          {a.assisted ? ' · 提示后' : ''}
                          {a.attemptNo > 1 ? ` · 第 ${a.attemptNo} 次` : ''}
                        </small>
                        <small className={CSS_PREFIX + 'historyTime'}>{fmtRelTime(a.createdAt)}</small>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={CSS_PREFIX + 'historyEmpty'}>第一道题完成后，记录会出现在这里。</div>
                )}
              </div>
              )}
            </div>
          )}

          {/* 主体三栏：选题栏（可选）+ 棋盘 + 信息面板 */}
          <div
            className={`${CSS_PREFIX}mainRow${
              session?.lesson.size === 19 ? ` ${CSS_PREFIX}mainRow--wide` : ''
            }`}
          >
            {/* 顺序练习选题栏：棋盘左侧竖栏，与棋盘等高、内部滚动，点击直达 */}
            {practiceMode === 'sequential' && showPicker && pickerScope && pickerPool.length > 0 && (
              <div className={CSS_PREFIX + 'pickerCol'} aria-label="题集选题列表">
                <div className={CSS_PREFIX + 'pickerHead'}>
                  <span className={CSS_PREFIX + 'pickerTitle'} title={seqOptions.find((o) => o.value === seqValue)?.label}>
                    {seqOptions.find((o) => o.value === seqValue)?.label}
                  </span>
                  <button
                    type="button"
                    className={CSS_PREFIX + 'pickerClose'}
                    onClick={() => setShowPicker(false)}
                    title="关闭（Esc）"
                  >
                    ✕
                  </button>
                </div>
                <div className={CSS_PREFIX + 'pickerMeta'}>
                  共 {pickerPool.length} 题 · 已答对 {pickerPool.filter((l) => completedIds.has(l.id)).length}
                </div>
                <div className={CSS_PREFIX + 'pickerGrid'}>
                  {pickerPool.map((l, i) => {
                    const done = completedIds.has(l.id);
                    const wrong = !done && wrongIds.has(l.id);
                    const isCurrent = session?.lesson.id === l.id;
                    return (
                      <button
                        type="button"
                        key={l.id}
                        className={
                          `${CSS_PREFIX}pickerCell` +
                          (done ? ` ${CSS_PREFIX}pickerCell--done` : '') +
                          (wrong ? ` ${CSS_PREFIX}pickerCell--wrong` : '') +
                          (isCurrent ? ` ${CSS_PREFIX}pickerCell--current` : '')
                        }
                        title={`第 ${i + 1} 题 · ${l.title}${done ? '（已答对）' : wrong ? '（待复习）' : ''}`}
                        onClick={() => {
                          startLesson(l);
                          setShowPicker(false);
                        }}
                      >
                        {done ? '✓' : wrong ? '✗' : i + 1}
                      </button>
                    );
                  })}
                </div>
                <div className={CSS_PREFIX + 'pickerLegend'}>✓ 已答对 · ✗ 待复习</div>
              </div>
            )}
            <div
              className={`${CSS_PREFIX}boardCol${
                session?.lesson.size === 19 ? ` ${CSS_PREFIX}boardCol--wide` : ''
              }`}
            >
              {session ? (
                <GoBoard
                  size={session.lesson.size}
                  board={session.board}
                  marks={practiceMarks}
                  lastMove={session.lastMove}
                  showCoords={prefs.showCoords}
                  inspect={inspect}
                  answerPoints={answers}
                  ghostColor={canPlay ? session.toPlay : null}
                  onPlay={onPracticePlay}
                  boardState={boardState}
                />
              ) : (
                <div className={CSS_PREFIX + 'emptyBoard'}>正在选题…</div>
              )}
              {toast && (
                <div className={CSS_PREFIX + 'toast'} role="status">
                  {toast}
                </div>
              )}
            </div>

            <div className={CSS_PREFIX + 'panelCol'}>
              {session ? (
                <>
                  <div className={CSS_PREFIX + 'lessonHead'}>
                    <div className={CSS_PREFIX + 'lessonTitle'}>{session.lesson.title}</div>
                    <div className={CSS_PREFIX + 'lessonMeta'}>
                      <span className={CSS_PREFIX + 'chip'}>
                        {SKILLS[session.lesson.skill] ?? session.lesson.skill}
                      </span>
                      <span className={CSS_PREFIX + 'chip'}>难度 {session.lesson.difficulty}</span>
                      <span className={CSS_PREFIX + 'chip'}>
                        {session.lesson.to_play === 1 ? '黑先' : '白先'}
                      </span>
                      {session.lesson.variantTag ? (
                        <span className={CSS_PREFIX + 'chip'}>变式 {session.lesson.variantTag}</span>
                      ) : null}
                      {session.lesson.source?.kind === 'licensed' && (
                        <span
                          className={CSS_PREFIX + 'chip'}
                          title={String(session.lesson.source.attribution ?? '')}
                        >
                          Go Game Guru
                        </span>
                      )}
                    </div>
                  </div>

                  <div className={CSS_PREFIX + 'promptBox'}>{session.lesson.prompt}</div>

                  <div
                    className={`${CSS_PREFIX}statusCard ${CSS_PREFIX}statusCard--${
                      session.assessment?.status ?? 'idle'
                    }`}
                  >
                    <div className={CSS_PREFIX + 'statusMain'}>{statusSummary}</div>
                    {statusDetail && <div className={CSS_PREFIX + 'statusSub'}>{statusDetail}</div>}
                    {reviewData && reviewData.moveIdx === session.moves.length - 1 && (() => {
                      const r = reviewData.result;
                      const fmtWr = (v: number) => `${(v * 100).toFixed(1)}%`;
                      const fmtSc = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;
                      const delta = r.scoreDelta;
                      return (
                        <div className={CSS_PREFIX + 'reviewBox'}>
                          <div className={CSS_PREFIX + 'reviewHead'}>⚖ 引擎复核（visits 128 · 证据对比，不做生死判定）</div>
                          <div className={CSS_PREFIX + 'reviewRow'}>
                            <span className={CSS_PREFIX + 'reviewTag'}>你的</span>
                            <span className={CSS_PREFIX + 'reviewMove'}>{r.candidate.move || '—'}</span>
                            <span className={CSS_PREFIX + 'reviewNums'}>
                              黑 {fmtWr(r.candidate.blackWinrate)} · {fmtSc(r.candidate.blackScoreLead)} 目
                            </span>
                          </div>
                          <div className={CSS_PREFIX + 'reviewRow'}>
                            <span className={CSS_PREFIX + 'reviewTag'}>参考</span>
                            <span className={CSS_PREFIX + 'reviewMove'}>{r.reference.move || '—'}</span>
                            <span className={CSS_PREFIX + 'reviewNums'}>
                              黑 {fmtWr(r.reference.blackWinrate)} · {fmtSc(r.reference.blackScoreLead)} 目
                            </span>
                          </div>
                          <div className={CSS_PREFIX + 'reviewVerdict'}>
                            {Math.abs(delta) < 0.5
                              ? '两点目差几乎相同，这手可以接受。'
                              : delta < 0
                                ? `这手比参考亏约 ${Math.abs(delta).toFixed(1)} 目（胜率 ${((r.winrateDelta * 100)).toFixed(1)} 个百分点）。`
                                : `这手甚至比参考好约 ${delta.toFixed(1)} 目（引擎视角，供参考）。`}
                          </div>
                          {(r.candidate.pv.length > 1 || r.reference.pv.length > 1) && (
                            <div className={CSS_PREFIX + 'reviewPv'}>
                              {r.candidate.pv.length > 1 && (
                                <div title={r.candidate.pv.join(' → ')}>你的之后：{r.candidate.pv.slice(0, 6).join(' ')}</div>
                              )}
                              {r.reference.pv.length > 1 && (
                                <div title={r.reference.pv.join(' → ')}>参考之后：{r.reference.pv.slice(0, 6).join(' ')}</div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    {session.assessment?.originalExplanation && (
                      <div className={CSS_PREFIX + 'origBox'}>
                        <button
                          type="button"
                          className={CSS_PREFIX + 'origToggle'}
                          aria-expanded={origBoxState.open}
                          onClick={() => {
                            origBoxState.open = !origBoxState.open;
                            setOrigTick((t) => t + 1);
                          }}
                        >
                          <span className={CSS_PREFIX + 'learningArrow'} aria-hidden="true">
                            {origBoxState.open ? '▾' : '▸'}
                          </span>
                          作者原文
                        </button>
                        {origTick >= 0 && origBoxState.open && (
                          <div className={CSS_PREFIX + 'origText'}>
                            {session.assessment.originalExplanation}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* AI 讲解结果（M5.1） */}
                  {llmResult && (
                    <div className={`${CSS_PREFIX}llmCard ${CSS_PREFIX}llmCard--${llmResult.ok ? 'ok' : 'err'}`}>
                      <div className={CSS_PREFIX + 'llmHead'}>
                        <strong>{llmResult.ok ? 'AI 讲解' : 'AI 讲解失败'}</strong>
                        <span className={CSS_PREFIX + 'llmModel'}>{llmCfg.model}</span>
                        <button
                          type="button"
                          className={CSS_PREFIX + 'libDel'}
                          title="关闭"
                          onClick={() => setLlmResult(null)}
                        >
                          ✕
                        </button>
                      </div>
                      <div className={CSS_PREFIX + 'llmText'} ref={llmTextRef} />
                    </div>
                  )}

                  <div className={CSS_PREFIX + 'actionGrid'}>
                    <button
                      type="button"
                      className={CSS_PREFIX + 'btn'}
                      onClick={handleHint}
                      title="查看提示（H）：提示后完成的作答记为辅助"
                    >
                      💡 提示
                    </button>
                    <button
                      type="button"
                      className={`${CSS_PREFIX}btn${inspectMode ? ` ${CSS_PREFIX}btn--on` : ''}`}
                      aria-pressed={inspectMode}
                      onClick={() => {
                        setInspectMode((v) => !v);
                        setInspect(null);
                      }}
                      title="查气专注模式（X）：开启后空点也不落子，纯读棋。任意时刻点棋子即可查看整块棋与气；Esc 清除显示"
                    >
                      ◔ 查气
                    </button>
                    <button
                      type="button"
                      className={CSS_PREFIX + 'btn'}
                      onClick={handleUndo}
                      disabled={
                        !session.history.length ||
                        session.demo ||
                        (session.resolved && !session.playout)
                      }
                      title="撤回（Z）：成对撤回到先行方回合；回到收录变化内会恢复作答与对手应手"
                    >
                      ↩ 撤回
                    </button>
                    <button
                      type="button"
                      className={CSS_PREFIX + 'btn'}
                      onClick={handleRetry}
                      disabled={session.demo}
                      title="重置本题再试一次"
                    >
                      ⟳ 重试
                    </button>
                    <button
                      type="button"
                      className={CSS_PREFIX + 'btn'}
                      onClick={handleAnswer}
                      disabled={session.demo}
                      title="看答案：演示主线（计入复习池）"
                    >
                      👁 看答案
                    </button>
                    {session.playout && (
                      <button
                        type="button"
                        className={CSS_PREFIX + 'btn'}
                        onClick={() => void handleEngineReply()}
                        disabled={session.demo || engineReplyBusy}
                        title="引擎应手：KataGo 替对手落一手（自由探索，不判分）"
                      >
                        {engineReplyBusy ? '⏳ 引擎思考…' : '⚡ 引擎应手'}
                      </button>
                    )}
                    {session.assessment?.status === 'unlisted' && !!session.moves.length && (
                      <button
                        type="button"
                        className={CSS_PREFIX + 'btn'}
                        onClick={() => void handleReview()}
                        disabled={session.demo || reviewBusy}
                        title="引擎复核：把你刚才那手与参考答案各算一遍（visits 128），给出目差/胜率证据对比，不做生死判定"
                      >
                        {reviewBusy ? '⏳ 复核中…' : '⚖ 引擎复核'}
                      </button>
                    )}
                    <button
                      type="button"
                      className={CSS_PREFIX + 'btn'}
                      onClick={handleLlmExplain}
                      disabled={llmBusy}
                      title="AI 讲解：把题目、当前局面与作答状态发给已配置的 OpenAI 兼容模型，生成中文讲解"
                    >
                      {llmBusy
                        ? llmProgress && llmProgress.thinkingChars > 0 && llmProgress.contentChars === 0
                          ? `⏳ 思考 ${llmProgress.thinkingChars} 字…`
                          : '⏳ 讲解中…'
                        : '🤖 AI 讲解'}
                    </button>
                    <button
                      type="button"
                      className={CSS_PREFIX + 'btn'}
                      onClick={handleCopyPrompt}
                      title="复制提示词：把题目、当前局面与作答状态整理成文本，可粘贴到任意 AI 对话"
                    >
                      📋 提示词
                    </button>
                    <button
                      type="button"
                      className={`${CSS_PREFIX}btn ${CSS_PREFIX}btn--primary`}
                      onClick={goNext}
                      title="下一题（N）"
                    >
                      下一题 →
                    </button>
                  </div>

                  <div className={CSS_PREFIX + 'kbdHint'}>
                    <span>
                      <kbd>Z</kbd> 撤回
                    </span>
                    <span>
                      <kbd>N</kbd> 下一题
                    </span>
                    <span>
                      <kbd>H</kbd> 提示
                    </span>
                    <span title="点击任意棋子随时查气；X 开启专注模式，Esc 清除显示">
                      <kbd>X</kbd> 查气
                    </span>
                  </div>
                </>
              ) : (
                <div className={CSS_PREFIX + 'emptyBoard'}>目录装载中…</div>
              )}
            </div>
          </div>
        </div>
      ) : (
        // ── 打谱模式 ──
        <div className={CSS_PREFIX + 'sgfWrap'}>
          <div className={CSS_PREFIX + 'toolbar'}>
            <input
              ref={sgfFileRef}
              type="file"
              accept=".sgf,.txt"
              className={CSS_PREFIX + 'hiddenFile'}
              onChange={(e) => {
                handleSgfFile(e.target.files?.[0] ?? null);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              className={CSS_PREFIX + 'btn'}
              onClick={() => sgfFileRef.current?.click()}
            >
              📂 打开 SGF
            </button>
            <button
              type="button"
              className={`${CSS_PREFIX}btn${showPaste ? ` ${CSS_PREFIX}btn--on` : ''}`}
              onClick={() => setShowPaste((v) => !v)}
            >
              📋 粘贴棋谱
            </button>
            <div className={CSS_PREFIX + 'sgfDirWrap'}>
              <select
                className={CSS_PREFIX + 'sgfDirSelect'}
                value=""
                onChange={(e) => {
                  const name = e.target.value;
                  if (name) loadSgfFromDir(name);
                }}
                disabled={!sgfDir || !sgfFiles.length}
                title={
                  sgfDir
                    ? `${sgfDir}（${sgfFiles.length} 个棋谱）`
                    : '未设置 SGF 文件夹：设置 → 打谱 → SGF 文件夹'
                }
              >
                <option value="">
                  {sgfDir
                    ? sgfFiles.length
                      ? `📁 文件夹棋谱（${sgfFiles.length}）`
                      : '📁 文件夹没有 .sgf'
                    : '📁 未设置文件夹'}
                </option>
                {sgfFiles.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              {sgfDir && (
                <button
                  type="button"
                  className={CSS_PREFIX + 'btn'}
                  onClick={rescanSgfDir}
                  title="重新扫描 SGF 文件夹"
                >
                  ⟳
                </button>
              )}
            </div>
            <button
              type="button"
              className={CSS_PREFIX + 'btn'}
              onClick={() => loadSgfText(SAMPLE_SGF, '示例.sgf')}
            >
              ✦ 示例
            </button>
            <button
              type="button"
              className={`${CSS_PREFIX}btn${matchSetup ? ` ${CSS_PREFIX}btn--on` : ''}`}
              onClick={() => setMatchSetup((v) => !v)}
              title="人机对局：开一盘空棋盘，你落子、KataGo 自动应手（需引擎已启动）"
            >
              ✚ 对局
            </button>
            <button
              type="button"
              className={`${CSS_PREFIX}btn${trialMode ? ` ${CSS_PREFIX}btn--on` : ''}`}
              aria-pressed={trialMode}
              onClick={() => setTrialMode((v) => !v)}
              disabled={!game}
              title="试下：在当前局面落子开分支推演，可导出"
            >
              ✎ 试下
            </button>
            {trialMode && (
              <>
                <button
                  type="button"
                  className={`${CSS_PREFIX}btn${autoReply ? ` ${CSS_PREFIX}btn--on` : ''}`}
                  aria-pressed={autoReply}
                  onClick={() => setAutoReply((v) => !v)}
                  title={`自动应手：轮到引擎（${engineColor === 1 ? '黑' : '白'}）时自动落子`}
                >
                  {autoReply ? '🤖 自动应手中' : '🤖 自动应手'}
                </button>
                <button
                  type="button"
                  className={CSS_PREFIX + 'btn'}
                  onClick={() => void handleSgfEngineReply(true)}
                  disabled={engineReplyBusy}
                  title="让引擎替当前轮次落一手，并从此接管这个颜色（开局点一次＝引擎执黑）"
                >
                  {engineReplyBusy ? '⏳ 思考…' : '⚡ 引擎应手'}
                </button>
                <button
                  type="button"
                  className={CSS_PREFIX + 'btn'}
                  onClick={undoTrial}
                  disabled={!current?.parent}
                >
                  ↩ 退一手
                </button>
                <button type="button" className={CSS_PREFIX + 'btn'} onClick={clearTrial}>
                  ✕ 清除试下
                </button>
              </>
            )}
            <div className={CSS_PREFIX + 'toolbarSpacer'} />
            <button
              type="button"
              className={CSS_PREFIX + 'btn'}
              onClick={() => void runAnalysis()}
              disabled={!game || analysisBusy}
              title="KataGo 分析当前局面：胜率 / 候选点 / 主变化预览（引擎需先在设置中启动）"
            >
              {analysisBusy ? '⏳ 分析中…' : '⚡ 分析'}
            </button>
            <button
              type="button"
              className={`${CSS_PREFIX}btn${autoPlay ? ` ${CSS_PREFIX}btn--on` : ''}`}
              aria-pressed={autoPlay}
              onClick={() => setAutoPlay((v) => !v)}
              disabled={!game}
              title="自动播放（空格）"
            >
              {autoPlay ? '⏸ 暂停' : '▶ 播放'}
            </button>
            <button
              type="button"
              className={CSS_PREFIX + 'btn'}
              onClick={handleExport}
              disabled={!game}
            >
              ⬇ 导出 SGF
            </button>
          </div>

          {matchSetup && (
            <div className={CSS_PREFIX + 'matchSetup'}>
              <span className={CSS_PREFIX + 'segLabel'}>新对局</span>
              {[9, 13, 19].map((size) => (
                <button
                  type="button"
                  key={size}
                  className={CSS_PREFIX + 'btn'}
                  onClick={() => startMatch(size as 9 | 13 | 19)}
                >
                  {size} 路
                </button>
              ))}
              <span className={CSS_PREFIX + 'libHint'}>
                你执黑先行，引擎执白自动应手；想让引擎执黑，开局先点一次「⚡ 引擎应手」。终局后可「⬇ 导出 SGF」保存整盘。
              </span>
            </div>
          )}

          {showPaste && (
            <div className={CSS_PREFIX + 'pasteBox'}>
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder="粘贴 SGF 文本，如 (;GM[1]FF[4]SZ[19] …)"
                rows={4}
              />
              <div className={CSS_PREFIX + 'pasteRow'}>
                <button
                  type="button"
                  className={`${CSS_PREFIX}btn ${CSS_PREFIX}btn--primary`}
                  onClick={() => {
                    if (pasteText.trim()) loadSgfText(pasteText.trim(), '粘贴棋谱.sgf');
                  }}
                >
                  载入
                </button>
                <span className={CSS_PREFIX + 'vaultRow'}>
                  <input
                    value={vaultPath}
                    onChange={(e) => setVaultPath(e.target.value)}
                    placeholder="vault 内 .sgf 路径"
                  />
                  <button
                    type="button"
                    className={CSS_PREFIX + 'btn'}
                    onClick={() => void handleVaultRead()}
                  >
                    从 vault 读取
                  </button>
                </span>
              </div>
            </div>
          )}

          <div
            className={`${CSS_PREFIX}mainRow${
              game && game.info.size >= 13 ? ` ${CSS_PREFIX}mainRow--wide` : ''
            }`}
          >
            <div
              className={`${CSS_PREFIX}boardCol${
                game && game.info.size >= 13 ? ` ${CSS_PREFIX}boardCol--wide` : ''
              }`}
            >
              {game && current ? (
                <GoBoard
                  size={game.info.size}
                  board={pvPreview ? pvPreview.board : current.board}
                  marks={
                    pvPreview
                      ? []
                      : [...candidateMarks, ...sgfMarkToMark(current.marks)]
                  }
                  lastMove={
                    current.move && !current.move.pass
                      ? { x: current.move.x, y: current.move.y }
                      : null
                  }
                  moveNumbers={pvPreview ? pvPreview.moveNumbers : sgfMoveNumbers}
                  showCoords={prefs.showCoords}
                  trialSet={sgfTrialSet}
                  ghostColor={trialMode && !pvPreview ? current.toPlay : null}
                  onPlay={pvPreview ? () => setPvIndex(null) : onSgfPlay}
                />
              ) : (
                <div className={CSS_PREFIX + 'emptyBoard'}>
                  还没有棋谱。打开 SGF 文件、粘贴棋谱，或点「示例」体验。
                </div>
              )}
              {toast && (
                <div className={CSS_PREFIX + 'toast'} role="status">
                  {toast}
                </div>
              )}
            </div>

            <div className={CSS_PREFIX + 'panelCol'}>
              {game && current ? (
                <>
                  <div className={CSS_PREFIX + 'lessonHead'}>
                    <div className={CSS_PREFIX + 'lessonTitle'}>
                      {game.info.blackName} ⬤ vs ⬥ {game.info.whiteName}
                    </div>
                    <div className={CSS_PREFIX + 'lessonMeta'}>
                      <span className={CSS_PREFIX + 'chip'}>第 {current.moveNo} 手</span>
                      <span className={CSS_PREFIX + 'chip'}>
                        提子 黑{current.captures.black}/白{current.captures.white}
                      </span>
                      <span className={CSS_PREFIX + 'chip'}>
                        {current.toPlay === 1 ? '轮黑' : '轮白'}
                      </span>
                      {game.info.result && (
                        <span className={CSS_PREFIX + 'chip'}>{game.info.result}</span>
                      )}
                    </div>
                  </div>

                  {/* 导航 */}
                  <div className={CSS_PREFIX + 'navRow'}>
                    <button
                      type="button"
                      className={CSS_PREFIX + 'navBtn'}
                      onClick={goStart}
                      title="开局（Home）"
                    >
                      ⏮
                    </button>
                    <button
                      type="button"
                      className={CSS_PREFIX + 'navBtn'}
                      onClick={stepPrev}
                      disabled={!current.parent}
                      title="上一手（←）"
                    >
                      ◀
                    </button>
                    <input
                      type="range"
                      className={CSS_PREFIX + 'slider'}
                      min={0}
                      max={Math.max(mainlineTotal, 1)}
                      value={Math.max(0, mainlineIndex)}
                      onChange={(e) => {
                        const target = Number(e.target.value);
                        const line = mainline(game.root);
                        gotoNode(line[Math.min(target, line.length - 1)]);
                      }}
                    />
                    <button
                      type="button"
                      className={CSS_PREFIX + 'navBtn'}
                      onClick={stepNext}
                      disabled={!current.children.length}
                      title="下一手（→）"
                    >
                      ▶
                    </button>
                    <button
                      type="button"
                      className={CSS_PREFIX + 'navBtn'}
                      onClick={goEnd}
                      title="终局（End）"
                    >
                      ⏭
                    </button>
                  </div>

                  {/* 变化分支 */}
                  {current.children.length > 1 && (
                    <div className={CSS_PREFIX + 'branchRow'}>
                      <span className={CSS_PREFIX + 'segLabel'}>变化</span>
                      {current.children.map((child, i) => {
                        const first = child.move
                          ? child.move.pass
                            ? '停一手'
                            : coordLabel(child.move.x, child.move.y, game.info.size)
                          : '注释';
                        const active = sgfPath.includes(child);
                        return (
                          <button
                            type="button"
                            key={i}
                            className={`${CSS_PREFIX}branchBtn${active ? ` ${CSS_PREFIX}branchBtn--on` : ''}`}
                            onClick={() => gotoNode(child)}
                            title={child.isTrial ? '试下分支' : (child.comment?.slice(0, 80) ?? '')}
                          >
                            {child.isTrial ? '✎ ' : ''}
                            {first}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* KataGo 局面分析（M5.2b） */}
                  {(shownAnalysis || analysisBusy || analysisErr) && (
                    <div className={CSS_PREFIX + 'analysisBox'}>
                      {analysisBusy && !shownAnalysis && (
                        <div className={CSS_PREFIX + 'analysisMeta'}>引擎计算中…（visits{' '}
                          {loadEngineConfig().visits}，随引擎性能几秒到几十秒）</div>
                      )}
                      {analysisErr && (
                        <div className={`${CSS_PREFIX}analysisMeta ${CSS_PREFIX}analysisMeta--err`}>
                          ⚠ {analysisErr}
                        </div>
                      )}
                      {shownAnalysis && (
                        <>
                          <div className={CSS_PREFIX + 'wrRow'} title="KataGo 评估（黑方视角）">
                            <span className={CSS_PREFIX + 'wrLabel'}>
                              黑 {(shownAnalysis.blackWinrate * 100).toFixed(1)}%
                            </span>
                            <div className={CSS_PREFIX + 'wrBar'}>
                              <div
                                className={CSS_PREFIX + 'wrFill'}
                                style={{ width: `${(shownAnalysis.blackWinrate * 100).toFixed(1)}%` }}
                              />
                            </div>
                            <span className={CSS_PREFIX + 'wrLabel'}>
                              白 {((1 - shownAnalysis.blackWinrate) * 100).toFixed(1)}%
                            </span>
                          </div>
                          <div className={CSS_PREFIX + 'analysisMeta'}>
                            黑目差{' '}
                            {shownAnalysis.blackScoreLead >= 0 ? '+' : ''}
                            {shownAnalysis.blackScoreLead.toFixed(1)} · visits {shownAnalysis.visits}
                            {pvPreview && (
                              <>
                                {' · '}
                                <button
                                  type="button"
                                  className={CSS_PREFIX + 'pvExit'}
                                  onClick={() => setPvIndex(null)}
                                >
                                  ✕ 退出预览
                                </button>
                              </>
                            )}
                          </div>
                          <div className={CSS_PREFIX + 'candList'}>
                            {shownAnalysis.moves.slice(0, 6).map((m, i) => (
                              <button
                                type="button"
                                key={i}
                                className={`${CSS_PREFIX}candRow${pvIndex === i ? ` ${CSS_PREFIX}candRow--on` : ''}`}
                                onClick={() => setPvIndex(pvIndex === i ? null : i)}
                                title={`主变化：${m.pv.join(' → ')}`}
                              >
                                <span className={CSS_PREFIX + 'candTag'}>
                                  {String.fromCharCode(65 + i)}
                                </span>
                                <span className={CSS_PREFIX + 'candMove'}>
                                  {m.move === 'pass' ? '停一手' : m.move}
                                </span>
                                <span className={CSS_PREFIX + 'candWr'}>
                                  {(m.blackWinrate * 100).toFixed(1)}%
                                </span>
                                <span className={CSS_PREFIX + 'candScore'}>
                                  {m.blackScoreLead >= 0 ? '+' : ''}
                                  {m.blackScoreLead.toFixed(1)}
                                </span>
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  <div className={CSS_PREFIX + 'commentBox'}>
                    {current.illegal && (
                      <div className={CSS_PREFIX + 'warnLine'}>
                        ⚠ 第 {current.moveNo} 手无法回放：{current.illegal}
                      </div>
                    )}
                    {current.comment ? (
                      <div className={CSS_PREFIX + 'commentText'}>{current.comment}</div>
                    ) : (
                      <div className={CSS_PREFIX + 'commentEmpty'}>（本手没有注释）</div>
                    )}
                  </div>

                  <div className={CSS_PREFIX + 'kbdHint'}>
                    <span>
                      <kbd>←</kbd>
                      <kbd>→</kbd> 逐手
                    </span>
                    <span>
                      <kbd>Home</kbd>/<kbd>End</kbd> 首末
                    </span>
                    <span>
                      <kbd>空格</kbd> 播放
                    </span>
                  </div>
                </>
              ) : (
                <div className={CSS_PREFIX + 'panelIntro'}>
                  <p>打谱复盘：把 SGF 棋谱加载进来逐步研究。</p>
                  <ul>
                    <li>逐手前进 / 后退，多分支变化可切换；</li>
                    <li>打开「试下」可在任意局面自由计算，分支可导出；</li>
                    <li>注释（C）、标记（LB/CR/TR）随当前节点显示。</li>
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
