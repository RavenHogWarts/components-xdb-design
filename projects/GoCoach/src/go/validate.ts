// 题目校验器（移植自 go-coach tactics.validate_lesson）。
// 不可信导入（Go Game Guru 题库 / 书题 JSON）在入库前整批校验：
// 逐分支用与练习相同的规则引擎回放，证明落子合法、目标确实完成；
// 不证明变化最优或穷尽防守。上限：31 手 / 256 节点 / 每节点 16 分支。

import { boardFromStones, boardKey, group, play } from './rules';
import type { AnswerNode, Board, Lesson, Objective, Stone } from './types';

const MAX_NODES = 256;
const MAX_DEPTH = 31;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

/** 抛出校验错误；never 返回类型让语句位置的提前发散与表达式位置的收窄都生效 */
function fail(message: string): never {
  throw new Error('题目校验失败：' + message);
}

const OBJECTIVE_KINDS: readonly string[] = ['capture', 'capture_any', 'authored_solution'];
const SOURCE_KINDS: readonly string[] = ['original', 'book', 'manual', 'licensed'];

/** 返回净化后的题目；不合法抛 Error（中文消息面向用户） */
export function validateLesson(input: unknown): Lesson {
  const value = isPlainObject(input) ? input : fail('需要 JSON 对象。');

  const text = (raw: unknown, label: string, maximum = 1200, required = true): string => {
    if (typeof raw !== 'string' || raw.length > maximum || (required && !(raw as string).trim())) {
      fail(label + '需要长度合适的文字。');
    }
    for (const ch of raw as string) {
      if (ch.charCodeAt(0) < 32 && ch !== '\n' && ch !== '\t') {
        fail(label + '含不支持的控制字符。');
      }
    }
    return (raw as string).trim();
  };

  const size = value.size ?? 9;
  if (!isInt(size) || (size !== 9 && size !== 19)) fail('棋盘尺寸必须是 9 或 19。');
  const capacity = size * size;

  const point = (raw: unknown, label: string): [number, number] => {
    if (
      !Array.isArray(raw) ||
      raw.length !== 2 ||
      !raw.every((c) => isInt(c) && c >= 0 && c < size)
    ) {
      fail(label + `必须是 0–${size - 1} 的两个整数坐标。`);
    }
    return [raw[0] as number, raw[1] as number];
  };

  const identity = text(value.id, 'id', 80);
  if (!ID_RE.test(identity)) fail('id 只支持英文字母、数字、短横线和下划线。');
  const SEQUENCE_MSG = '当前导入支持连续吃子题或作者解答题（skill=capture/tsumego、sequence=true）。';
  if (value.skill !== 'capture' && value.skill !== 'tsumego') fail(SEQUENCE_MSG);
  if (value.sequence !== true) fail(SEQUENCE_MSG);
  if (!isInt(value.difficulty) || value.difficulty < 1 || value.difficulty > 5) {
    fail('难度必须是 1–5 的整数。');
  }
  if (!isInt(value.to_play) || (value.to_play !== 1 && value.to_play !== 2)) {
    fail('先行方必须是 1（黑）或 2（白）。');
  }

  const out: Lesson = {
    id: identity,
    title: text(value.title, 'title', 160),
    prompt: text(value.prompt, 'prompt', 1200),
    hint: text(value.hint, 'hint', 1200),
    size: size as 9 | 19,
    skill: value.skill,
    sequence: true,
    difficulty: value.difficulty,
    to_play: value.to_play,
    stones: [],
    objective: { kind: 'capture' },
    marks: [],
    source: { kind: 'manual' },
    tree: { children: [] },
  };
  if (value.concept !== undefined) out.concept = text(value.concept, '题型', 80);
  const defender = (3 - out.to_play) as 1 | 2;

  // ── 初始棋子 ──
  const stones = value.stones;
  if (!Array.isArray(stones) || stones.length < 1 || stones.length > capacity) {
    fail(`初始棋子需为 1–${capacity} 项。`);
  }
  const board: Board = (() => {
    try {
      return boardFromStones(out.size, stones as Stone[]);
    } catch (err) {
      return fail((err as Error).message);
    }
  })();
  for (const stone of stones as Stone[]) {
    const p = point([stone?.x, stone?.y], '棋子');
    const color = stone?.color;
    if (!isInt(color) || (color !== 1 && color !== 2)) fail('棋子颜色错误或同一点重复放置。');
    out.stones.push({ x: p[0], y: p[1], color });
  }
  for (const stone of out.stones) {
    if (!group(board, stone.x, stone.y).liberties.length) fail('初始局面存在无气棋块。');
  }

  // ── 目标 ──
  const objective = isPlainObject(value.objective)
    ? value.objective
    : fail('目标类型需为 capture、capture_any 或 authored_solution。');
  const kind = String(objective.kind ?? '');
  if (!OBJECTIVE_KINDS.includes(kind)) {
    fail('目标类型需为 capture、capture_any 或 authored_solution。');
  }
  const authored = kind === 'authored_solution';
  if ((authored && out.skill !== 'tsumego') || (!authored && out.skill !== 'capture')) {
    fail('作者解答使用 tsumego 分类，提子目标使用 capture 分类。');
  }
  let targets: Array<[number, number]> = [];
  if (!authored) {
    const raw = objective.targets;
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > capacity) {
      fail(`需要 1–${capacity} 个目标坐标。`);
    }
    targets = raw.map((p: unknown) => point(p, '目标'));
    const seen = new Set(targets.map(([x, y]) => `${x},${y}`));
    if (seen.size !== targets.length) fail('目标必须是初始对方棋子，且不能重复。');
    for (const [x, y] of targets) {
      if (board[y][x] !== defender) fail('目标必须是初始对方棋子，且不能重复。');
    }
  }
  const targetKeys = new Set(targets.map(([x, y]) => `${x},${y}`));
  out.objective = { kind } as Objective;
  if (!authored) out.objective.targets = targets.map(([x, y]) => [x, y]);

  // ── 标记 ──
  const marks = value.marks ?? [];
  if (!Array.isArray(marks) || marks.length > capacity) fail(`标记最多 ${capacity} 个。`);
  for (const mark of marks) {
    if (!isPlainObject(mark)) fail('标记格式错误。');
    const [x, y] = point([mark.x, mark.y], '标记');
    out.marks.push({ x, y, label: text(mark.label, '标记文字', 16) });
  }

  // ── 来源（作者答案题必须携带署名与许可） ──
  const source = isPlainObject(value.source) ? value.source : { kind: 'manual' };
  if (!SOURCE_KINDS.includes(source.kind as (typeof SOURCE_KINDS)[number])) {
    fail('来源类型需为 original、book、manual 或 licensed。');
  }
  const privateBook =
    source.kind === 'book' && source.usage === 'household_private' && source.answer_verified === true;
  if (authored && !((source.kind === 'licensed' && source.license && source.url) || privateBook)) {
    fail('作者答案题需要授权来源、许可和来源链接，或已核对的家庭私用书题来源。');
  }
  const outSource: Record<string, unknown> = { kind: source.kind };
  if (privateBook) {
    outSource.usage = 'household_private';
    outSource.answer_verified = true;
  }
  let fields = ['title', 'page', 'problem', 'note'];
  if (source.kind === 'licensed') {
    fields = [...fields, 'author', 'license', 'url', 'commit', 'attribution', 'original_prompt'];
  }
  for (const field of fields) {
    if (field in source) {
      let raw = source[field];
      if ((field === 'page' || field === 'problem') && isInt(raw)) raw = String(raw);
      outSource[field] = text(raw, '来源 ' + field, field === 'original_prompt' ? 2000 : 600, false);
    }
  }
  out.source = outSource as Lesson['source'];

  // ── 答案树回放校验 ──
  const counter = { count: 0 };
  const active = new Set<unknown>();

  const visit = (
    nodeInput: unknown,
    before: Board,
    seen: string[],
    removed: Set<string>,
    depth: number
  ): AnswerNode => {
    if (!isPlainObject(nodeInput) || active.has(nodeInput)) fail('答案节点必须是无循环对象。');
    const node = nodeInput;
    if (depth > MAX_DEPTH) fail('答案最多 31 手。');
    counter.count += 1;
    if (counter.count > MAX_NODES) fail('答案树节点过多。');
    active.add(node);

    const clean: AnswerNode = { children: [] };
    let after = before;
    const captured = new Set(removed);
    if (depth > 0) {
      const move = point(node.move, '答案落子');
      const color: 1 | 2 = depth % 2 ? out.to_play : defender;
      let result;
      try {
        result = play(before, move[0], move[1], color, seen);
      } catch (err) {
        return fail(`第 ${depth} 手不合法：${(err as Error).message}`);
      }
      after = result.board;
      for (const key of targetKeys) {
        if (captured.has(key)) continue;
        const [x, y] = key.split(',').map(Number);
        if (before[y][x] === defender && after[y][x] !== defender) captured.add(key);
      }
      seen = seen.concat(boardKey(after));
      clean.move = [move[0], move[1]];
      clean.explanation = text(node.explanation, '每步讲解');
      if (node.original_explanation !== undefined) {
        clean.original_explanation = text(node.original_explanation, '每步原文', 2000, false);
      }
    }

    const childrenRaw = node.children ?? [];
    if (!Array.isArray(childrenRaw) || childrenRaw.length > 16) fail('每个节点最多 16 个分支。');
    const goal = authored
      ? node.correct === true || (node.result === 'success' && node.author_verdict === 'correct')
      : kind === 'capture_any'
        ? [...targetKeys].some((k) => captured.has(k))
        : [...targetKeys].every((k) => captured.has(k));

    if (childrenRaw.length > 0 && goal) fail('目标已完成后仍有多余走法。');
    if (childrenRaw.length === 0) {
      if (depth < 1 || (!authored && depth % 2 !== 1) || !goal) {
        fail(
          authored
            ? '每个终点须有明确作者正确标记。'
            : '每个终点须由先行方实际提掉指定目标。'
        );
      }
      if (authored) {
        clean.result = 'success';
        clean.author_verdict = 'correct';
      }
    }

    const moveKeys = new Set<string>();
    for (const child of childrenRaw) {
      if (!isPlainObject(child)) fail('答案子节点格式错误。');
      const [x, y] = point(child.move, '答案落子');
      const key = `${x},${y}`;
      if (moveKeys.has(key)) fail('同一节点存在重复走法。');
      moveKeys.add(key);
    }
    clean.children = childrenRaw.map((child) => visit(child, after, seen, captured, depth + 1));
    active.delete(node);
    return clean;
  };

  out.tree = visit(value.tree, board, [boardKey(board)], new Set(), 0);
  return structuredClone(out);
}
