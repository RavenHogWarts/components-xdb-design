// 做题会话状态机（移植自 go-coach server.py 的 move / sequence_play 与
// curriculum.grade）。会话是不可变数据：操作函数复制后修改再返回。
//
// 判分口径与 go-coach 一致：
// - 序盘题沿收录答案树前进，对手按收录变化自动应手；
//   走出收录之外且实际提掉目标 → solved；走出收录且未完成 → 「待复核」不判错；
// - 基础题（escape/capture/connect/cut）单手即时判分；
// - 「完成收录变化」表示达到作者标记的解答，不是程序独立判定死活。

import { boardFromStones, boardKey, cloneBoard, coordLabel, group, play } from './rules';
import type { Assessment, Board, Lesson, Mark, Point } from './types';

interface Snapshot {
  board: Board;
  toPlay: 1 | 2;
  lastMove: Point | null;
  captures: { black: number; white: number };
  moveCount: number;
}

export interface LessonSession {
  lesson: Lesson;
  initialBoard: Board;
  initialPlayer: 1 | 2;
  board: Board;
  toPlay: 1 | 2;
  lastMove: Point | null;
  captures: { black: number; white: number };
  /** 每手落子前的快照（history[0] 即初始局面） */
  history: Snapshot[];
  moves: Array<{ color: 1 | 2; x: number; y: number }>;
  message: string;
  /** 使用过提示 / 看答案 / 撤回 */
  assisted: boolean;
  /** 本轮已产生作答结果 */
  attempted: boolean;
  /** 已结算（solved / unlisted / 基础题已判），默认锁盘 */
  resolved: boolean;
  assessment: Assessment | null;
  /** 对手应手的确定性轮转种子（重试也保持稳定） */
  branchSeed: number;
  /** 走出收录变化或答错后的自由探索（不判分、不锁盘） */
  playout: boolean;
  /** 看答案演示中（锁盘） */
  demo: boolean;
  /** 本次作答已写入学习档案（防止重复记录） */
  recorded: boolean;
}

export function createSession(lesson: Lesson, branchSeed = 0): LessonSession {
  const board = boardFromStones(lesson.size, lesson.stones);
  return {
    lesson,
    initialBoard: cloneBoard(board),
    initialPlayer: lesson.to_play,
    board,
    toPlay: lesson.to_play,
    lastMove: null,
    captures: { black: 0, white: 0 },
    history: [],
    moves: [],
    // 题面已由 promptBox 单独展示，这里只给操作状态（不与题面重复）
    message: `${lesson.to_play === 1 ? '黑' : '白'}先行。点击棋盘落子作答；点击棋子可随时查气。`,
    assisted: false,
    attempted: false,
    resolved: false,
    assessment: null,
    branchSeed,
    playout: false,
    demo: false,
    recorded: false,
  };
}

function snapshotOf(s: LessonSession): Snapshot {
  return {
    board: cloneBoard(s.board),
    toPlay: s.toPlay,
    lastMove: s.lastMove,
    captures: { ...s.captures },
    moveCount: s.moves.length,
  };
}

function seenKeys(s: LessonSession): string[] {
  return [boardKey(s.board), ...s.history.map((h) => boardKey(h.board))];
}

/** 落子并推进基础状态（消息含落点与气数，与 go-coach 口径一致） */
function applyMove(s: LessonSession, x: number, y: number): number {
  const color = s.toPlay;
  const result = play(s.board, x, y, color, seenKeys(s));
  s.history.push(snapshotOf(s));
  s.board = result.board;
  s.toPlay = (3 - color) as 1 | 2;
  s.lastMove = { x, y };
  s.moves.push({ color, x, y });
  s.captures[color === 1 ? 'black' : 'white'] += result.captured;
  const libs = group(s.board, x, y).liberties.length;
  const coord = coordLabel(x, y, s.lesson.size);
  s.message =
    `${color === 1 ? '黑' : '白'}棋落在 ${coord}，这块棋有 ${libs} 口气。` +
    (result.captured ? `本手提走 ${result.captured} 颗棋子。` : '');
  return result.captured;
}

/** 沿已下棋谱在答案树中定位当前节点；脱离收录返回 null */
function sequenceNode(s: LessonSession) {
  let node = s.lesson.tree;
  for (const m of s.moves) {
    const next = node.children.find((c) => c.move?.[0] === m.x && c.move?.[1] === m.y);
    if (!next) return null;
    node = next;
  }
  return node;
}

/** 目标棋子是否已在某个时刻被提离棋盘（按实际历史核对，不与参考答案比对） */
export function captureGoalComplete(s: LessonSession): boolean {
  const { targets, kind } = s.lesson.objective;
  if (!targets?.length || kind === 'authored_solution') return false;
  const defender = (3 - s.initialPlayer) as 1 | 2;
  const boards = [s.board, ...s.history.map((h) => h.board)];
  const gone = targets.map(([x, y]) => boards.some((b) => b[y][x] !== defender));
  return kind === 'capture' ? gone.every(Boolean) : gone.some(Boolean);
}

/**
 * 落子入口：非法抛 Error（中文消息）；返回推进后的新会话。
 * 序盘题 / 基础题 / 自由探索三条路径分别判分。
 */
export function playStone(session: LessonSession, x: number, y: number): LessonSession {
  const s: LessonSession = structuredClone(session);
  if (s.demo) throw new Error('正在演示答案，请先返回原局面。');
  if (s.resolved && !s.playout) throw new Error('本轮练习已结束，请重试或选择下一题。');

  if (s.playout) {
    applyMove(s, x, y);
    s.attempted = true;
    s.assessment = {
      correct: null,
      status: 'exploring',
      summary: '自由探索中。',
      explanation: '已走出参考变化，这里只按规则落子，不再判分。',
    };
    return s;
  }

  if (s.lesson.sequence) {
    const node = sequenceNode(s);
    if (!node) throw new Error('当前变化未收录，请重试这道题。');
    const child = node.children.find((c) => c.move?.[0] === x && c.move?.[1] === y);
    applyMove(s, x, y);

    if (captureGoalComplete(s)) {
      s.attempted = true;
      s.resolved = true;
      s.assessment = {
        correct: true,
        status: 'solved',
        summary: '目标已提掉，这手完成了题目。',
        explanation: '已按棋盘规则核对实际提子结果，不要求落子与参考答案完全相同。',
      };
      return s;
    }

    if (!child) {
      s.attempted = true;
      s.resolved = true;
      s.playout = true;
      s.assisted = true;
      s.assessment = {
        correct: null,
        status: 'unlisted',
        summary: '这手走出了参考变化，等待复核。',
        explanation: '走出收录变化后仍可继续自由探索；未收录走法暂不判错。',
      };
      return s;
    }

    let explanation = child.explanation ?? '';
    const originals: string[] = child.original_explanation ? [child.original_explanation] : [];
    let current = child;
    if (child.children.length) {
      // 对手按收录变化应手；多条应手按种子轮转，重试内保持稳定
      const reply =
        child.children[(s.branchSeed + Math.floor(s.moves.length / 2)) % child.children.length];
      applyMove(s, reply.move![0], reply.move![1]);
      explanation += ' ' + (reply.explanation ?? '');
      if (reply.original_explanation) originals.push(reply.original_explanation);
      current = reply;
    }
    const solved = current.children.length === 0;
    s.attempted = solved;
    s.resolved = solved;
    const originalExplanation = originals.join(' ').trim();
    s.assessment = solved
      ? {
          correct: true,
          status: 'solved',
          summary:
            s.lesson.objective.kind === 'authored_solution'
              ? '已完成作者收录的正确变化。'
              : '这条吃子变化完成，目标已提掉。',
          explanation: explanation.trim(),
          ...(originalExplanation ? { originalExplanation } : {}),
        }
      : {
          correct: null,
          status: 'playing',
          summary: '对手已应手，请继续计算下一手。',
          explanation: explanation.trim(),
          ...(originalExplanation ? { originalExplanation } : {}),
        };
    return s;
  }

  // 基础题：单手即时判分
  const before = s.board;
  const captured = applyMove(s, x, y);
  const assessment = gradeBasic(s.lesson, before, s.board, { x, y }, captured);
  s.attempted = true;
  s.resolved = true;
  s.assessment = assessment;
  if (assessment.correct !== true) s.playout = true;
  return s;
}

/**
 * 悔棋：序盘题成对撤回到先行方回合。
 * 撤回后若回到收录变化上（或基础题），恢复作答模式——对手继续按收录变化
 * 自动应手（对齐 go-coach 撤回时用落子前快照整体还原的语义）；
 * 仍在收录之外时保持自由探索。
 */
export function undoMove(session: LessonSession): LessonSession {
  const s: LessonSession = structuredClone(session);
  if (s.demo) throw new Error('正在演示答案，请先返回原局面。');
  if (!s.history.length) throw new Error('还没有可以撤回的落子。');
  const paired = !!s.lesson.sequence || s.playout;
  let old = s.history.pop()!;
  if (paired) {
    while (s.history.length && old.toPlay !== s.initialPlayer) old = s.history.pop()!;
  }
  s.board = cloneBoard(old.board);
  s.toPlay = old.toPlay;
  s.lastMove = old.lastMove;
  s.captures = { ...old.captures };
  s.moves.length = old.moveCount;

  if (s.lesson.sequence) s.assisted = true;

  const onLine = !s.lesson.sequence || sequenceNode(s) !== null;
  if (s.toPlay === s.initialPlayer && onLine) {
    // 回到作答模式：本轮按新一次作答重新判分记录
    s.playout = false;
    s.resolved = false;
    s.attempted = false;
    s.assessment = null;
    s.recorded = false;
    s.message = '已撤回，回到作答模式；对手会按收录变化应手。';
  } else {
    s.message = '已撤回上一步，仍可继续自由探索。';
  }
  return s;
}

/** 重置本题（保留对手应手轮转种子） */
export function retrySession(session: LessonSession): LessonSession {
  const next = createSession(session.lesson, session.branchSeed);
  next.message = session.lesson.sequence
    ? '已重置本题，再试一条收录变化。'
    : '已重置本题，再试一次。';
  return next;
}

/** 查看提示（提示后完成的作答记为 assisted） */
export function applyHint(session: LessonSession): LessonSession {
  const s: LessonSession = structuredClone(session);
  if (!s.attempted) s.assisted = true;
  s.message = s.lesson.hint;
  return s;
}

/** 查气：返回棋块与气（供棋盘高亮）；空点返回 null */
export function inspectGroup(session: LessonSession, x: number, y: number) {
  return inspectOnBoard(session.board, session.lesson.size, x, y);
}

/** 任意局面查气（打谱模式复用） */
export function inspectOnBoard(board: Board, size: number, x: number, y: number) {
  const { stones, liberties } = group(board, x, y);
  if (!stones.length) return null;
  return {
    stones: new Set(stones.map((p) => p.y * size + p.x)),
    liberties: new Set(liberties.map((p) => p.y * size + p.x)),
    count: stones.length,
    libs: liberties.length,
  };
}

/** 基础题判分（移植 curriculum.grade：escape / capture / connect / cut） */
export function gradeBasic(
  lesson: Lesson,
  before: Board,
  after: Board,
  move: Point,
  captured: number
): Assessment {
  const targets = (lesson.objective.targets ?? []).map(([x, y]) => ({ x, y }));
  const a = targets[0];
  const n = lesson.size;
  const coord = (p: Point) => coordLabel(p.x, p.y, n);
  let correct = false;
  let summary = '';
  let explanation = '';
  let marks: Mark[] = [];

  if (lesson.skill === 'escape') {
    const { liberties: libs } = group(after, a.x, a.y);
    correct = after[a.y][a.x] === 1 && libs.length >= 2;
    const beforeLibs = group(before, a.x, a.y).liberties.length;
    summary = correct ? '救棋成功，已解除打吃。' : '这块黑棋仍被打吃，再数一数整块棋的气。';
    explanation =
      `目标黑棋原有 ${beforeLibs} 口气，现在有 ${libs.length} 口气。相连黑棋共享气，重复的空点只算一次。` +
      (correct ? '至少两口气只表示当前没有被打吃，不代表已经做活。' : '本题需要下一手让目标棋块至少有两口气。');
    marks = libs.map((p) => ({ x: p.x, y: p.y, label: '气' }));
  } else if (lesson.skill === 'capture') {
    const remaining = targets.filter((t) => after[t.y][t.x] === 2).length;
    correct = remaining === 0 && captured >= targets.length;
    summary = correct ? '提子成功，目标白棋已全部提掉。' : '还没有提掉目标白棋。';
    explanation = `本题目标共有 ${targets.length} 颗白棋，落子后还剩 ${remaining} 颗。只有占掉整块棋最后一口气，才会提掉这块棋。`;
    marks = targets.map((t) => ({ x: t.x, y: t.y, label: '目标' }));
  } else if (lesson.skill === 'connect') {
    const { stones } = group(after, a.x, a.y);
    const stoneSet = new Set(stones.map((p) => p.y * n + p.x));
    correct = targets.every((t) => after[t.y][t.x] === 1 && stoneSet.has(t.y * n + t.x));
    summary = correct ? '连接成功，目标黑棋属于同一块棋。' : '目标黑棋还没有连成一块。';
    explanation =
      '沿黑棋上下左右走，' +
      (correct
        ? '现在可以从一个目标走到另一个目标，中途不用经过空点。'
        : '目前仍不能从一个目标走到另一个目标。找能同时挨着两块棋的空点。') +
      '斜着相邻不算连接。';
    marks = targets.map((t, i) => ({ x: t.x, y: t.y, label: String(i + 1) }));
  } else {
    const [px, py] = lesson.objective.point ?? [-1, -1];
    correct =
      before[py][px] === 0 && after[py][px] === 1 && move.x === px && move.y === py;
    summary = correct ? '占住连接点，阻止了白棋在这里直接连上。' : '白棋的直接连接点还没有被黑棋占住。';
    explanation =
      `${coord(targets[0])} 与 ${coord(targets[1])} 所在白棋块原本可以在 ${coord({ x: px, y: py })} 直接连接。` +
      (correct ? '黑棋现在占住了这个点。' : '本题要求黑棋占住这个共同相邻的空点。') +
      '这只核对局部直接连接；白棋以后能否绕路连接或做活，尚未判断。';
    marks = [{ x: px, y: py, label: '连接点' }];
  }

  return {
    correct,
    status: correct ? 'solved' : 'wrong',
    summary,
    explanation,
    marks,
  };
}

/**
 * 基础题「看答案」：枚举所有空点的合法落子并用判分函数筛选正确点。
 * 基础题不存答案树，答案由规则推导（题盘 ≤81 点，开销可忽略）。
 */
export function solveBasic(session: LessonSession): Array<{ x: number; y: number }> {
  const { lesson, board } = session;
  const size = lesson.size;
  const seen = [boardKey(board)];
  const answers: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (board[y][x]) continue;
      try {
        const { board: after, captured } = play(board, x, y, session.toPlay, seen);
        if (gradeBasic(lesson, board, after, { x, y }, captured).correct === true) {
          answers.push({ x, y });
        }
      } catch {
        // 非法点跳过
      }
    }
  }
  return answers;
}

/** 序盘题主线（看答案演示用）：从当前树位置沿首孩子链取后续棋谱 */
export function mainlineFrom(session: LessonSession): Array<{ x: number; y: number }> {
  const node = sequenceNode(session);
  const moves: Array<{ x: number; y: number }> = [];
  let current = node;
  while (current && current.children.length) {
    const next = current.children[0];
    if (!next.move) break;
    moves.push({ x: next.move[0], y: next.move[1] });
    current = next;
  }
  return moves;
}

/**
 * 复核参考手（M5.2c+，对齐原版 lesson_review.review_position）：
 * 给定前 k 手（去掉被复核的最后一手），若仍在收录变化上，返回该处参考答案的首手；
 * 不在收录变化上（不可能发生：复核只在 unlisted 状态出现）返回 null。
 */
export function referenceMoveAt(
  session: LessonSession,
  upto: number
): { x: number; y: number } | null {
  if (!session.lesson.sequence) return null;
  let node = session.lesson.tree;
  for (let i = 0; i < upto; i++) {
    const m = session.moves[i];
    if (!m) return null;
    const next = node.children.find((c) => c.move?.[0] === m.x && c.move?.[1] === m.y);
    if (!next) return null;
    node = next;
  }
  const first = node.children[0];
  if (!first?.move) return null;
  return { x: first.move[0], y: first.move[1] };
}

/** 看答案演示：单步落子（不走判分逻辑，双方棋谱由主线驱动） */
export function demoMove(session: LessonSession, x: number, y: number): LessonSession {
  const s: LessonSession = structuredClone(session);
  applyMove(s, x, y);
  s.demo = true;
  s.attempted = true;
  s.resolved = true;
  s.message = '答案演示中…';
  return s;
}

/** 演示结束：解锁重试/下一题 */
export function endDemo(session: LessonSession): LessonSession {
  const s: LessonSession = structuredClone(session);
  s.demo = false;
  s.message = '演示结束。可以重试本题，或选择下一题。';
  return s;
}
