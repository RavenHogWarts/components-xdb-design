// 课程目录 / 学习档案评估 / 智能推荐 / 练习推进（移植自 go-coach curriculum.py
// 与 server.py 的 practice_progress）。推荐策略：近 30 条有效作答动态调整，
// 连错巩固、连对降频、同类轮换，不推断段位。

import authoredRaw from '../data/authored.json';
import basicsRaw from '../data/builtin-basics.json';
import originalLessonsRaw from '../data/original-lessons.json';
import originalMoreRaw from '../data/original-more.json';
import { validateLesson } from './validate';
import type { Attempt, Lesson, LessonSkill } from './types';

export const SKILLS: Record<LessonSkill | string, string> = {
  escape: '救棋与数气',
  capture: '打吃与提子',
  connect: '连接棋块',
  cut: '阻断直接连接',
  tsumego: '死活与手筋',
};

export const CONCEPT_NAMES: Record<string, string> = {
  double_atari: '双打吃',
  ladder: '征吃',
  snapback: '倒扑',
  connection_trap: '接不归',
  edge_chase: '边线追吃',
  capture_race: '对杀',
  atari: '打吃',
  net: '枷吃',
  gate: '门吃',
  hug: '抱吃',
  wedge: '挖吃',
};

const CONCEPT_SEQUENCE: Record<string, number> = {
  double_atari: 10,
  ladder: 20,
  net: 30,
  gate: 40,
  edge_chase: 50,
  snapback: 60,
  connection_trap: 70,
  hug: 80,
  wedge: 90,
  atari: 100,
};

const LICENSED_CHAPTERS: Record<number, string> = { 3: '基础', 4: '进阶', 5: '挑战' };

export interface Catalog {
  lessons: Lesson[];
  byId: Map<string, Lesson>;
}

function asLessons(raw: unknown): Lesson[] {
  return raw as Lesson[];
}

/** 组装目录：入门课程（64）→ 原创手筋（18 + 100，过校验、按难度排序）→ 已启用的导入题库 */
export function buildCatalog(imported: Lesson[] = [], includeBuiltin = true): Catalog {
  const basics = includeBuiltin
    ? asLessons(basicsRaw).map((l) => ({
        ...l,
        size: 9 as const,
        source: { kind: 'original' as const },
        tree: { children: [] },
      }))
    : [];
  const sequenceRaw = includeBuiltin
    ? [
        ...asLessons(authoredRaw),
        ...asLessons(originalLessonsRaw),
        ...asLessons(originalMoreRaw),
      ]
    : [];
  const sequence: Lesson[] = [];
  for (const raw of sequenceRaw) {
    try {
      sequence.push(validateLesson(raw));
    } catch (err) {
      console.warn('[xdb-plugin] go-coach: 内置题校验未通过，已剔除', (raw as Lesson)?.id, err);
    }
  }
  sequence.sort((a, b) => a.difficulty - b.difficulty);
  const lessons = [...basics, ...sequence, ...imported];
  return { lessons, byId: new Map(lessons.map((l) => [l.id, l])) };
}

/** 基础题只开放部分变式（难度 1 → 前 3 个，难度 2 → 前 5 个） */
export function availableLesson(lesson: Lesson): boolean {
  if (lesson.legacy) return false;
  if (lesson.id === 'escape' || lesson.id === 'capture' || lesson.id === 'connect') return false;
  if (lesson.sequence) return true;
  const m = /^(escape|capture|connect|cut)-([12])-([1-8])$/.exec(lesson.id);
  if (!m) return true;
  return Number(m[3]) <= (m[2] === '1' ? 3 : 5);
}

/** 顺序练习的「书」：licensed / book 来源聚合；null 表示课程池 */
export function sequentialCollection(lesson: Lesson): [string, string] | null {
  const source = lesson.source ?? { kind: 'manual' };
  if ((source.kind === 'book' || source.kind === 'licensed') && typeof source.title === 'string') {
    return [source.kind as string, source.title];
  }
  return null;
}

export function sequentialChapter(lesson: Lesson): string | null {
  if (lesson.concept) return lesson.concept;
  const source = lesson.source ?? { kind: 'manual' };
  if (source.kind === 'licensed') return LICENSED_CHAPTERS[lesson.difficulty] ?? '练习';
  return null;
}

export function sequentialProblemNumber(lesson: Lesson): number {
  const digitsSource = String((lesson.source as Record<string, unknown>)?.problem ?? '').match(/\d+/g);
  const digitsId = lesson.id.match(/\d+/g);
  const numbers = digitsSource ?? digitsId;
  return numbers ? Number(numbers[numbers.length - 1]) : Number.POSITIVE_INFINITY;
}

function stripTrailingNumber(id: string): string {
  return id.replace(/\d+$/, '');
}

function sequentialRank(lesson: Lesson, groupStart: Map<string, number>): number[] {
  const identity = lesson.id;
  const prefix = stripTrailingNumber(identity);
  const m = /\d+$/.exec(identity);
  const number = m ? Number(m[0]) : 0;
  const group = groupStart.get(prefix) ?? 0;
  if (!lesson.concept) return [0, group, number];
  return [1, CONCEPT_SEQUENCE[lesson.concept] ?? 99, lesson.difficulty ?? 99, group, number];
}

// ─────────────────────────────────────────────────────────────
// 学习档案评估（learning）：按「首次独立作答」统计，重试不翻案
// ─────────────────────────────────────────────────────────────

export interface SkillStat {
  id: string;
  name: string;
  stage: string;
  independentAttempts: number;
  correct: number;
  accuracy: number | null;
  nextDifficulty: number;
}

export interface RecommendationLesson extends Lesson {
  reason: string;
  adjustment: { kind: string; skill: string; group: string; streak: number };
}

export interface Learning {
  stage: string;
  attemptsCount: number;
  independentCorrect: number;
  independentAttempts: number;
  skills: SkillStat[];
  recommendation: RecommendationLesson | null;
}

function evidenceAttempts(attempts: Attempt[], byId: Map<string, Lesson>): Attempt[] {
  const seen = new Set<string>();
  const independent: Attempt[] = [];
  for (const attempt of attempts) {
    if (!byId.has(attempt.lessonId) || seen.has(attempt.lessonId)) continue;
    seen.add(attempt.lessonId);
    if (!attempt.assisted && attempt.attemptNo === 1) independent.push(attempt);
  }
  return independent;
}

function groupKeyOf(lesson: Lesson): string {
  return lesson.concept
    ? `concept:${lesson.skill}:${lesson.concept}`
    : `skill:${lesson.skill}`;
}

/** 智能推荐核心（移植 _recommend：确定性，无随机） */
function recommendFrom(
  attempts: Attempt[],
  skills: SkillStat[],
  catalog: Catalog,
  currentId: string | null
): RecommendationLesson | null {
  const { lessons, byId } = catalog;
  const valid = [...attempts]
    .reverse()
    .filter((a) => byId.has(a.lessonId) && typeof a.correct === 'boolean')
    .slice(0, 30);
  const seen = new Set(attempts.map((a) => a.lessonId));

  interface Group {
    id: string;
    skill: string;
    name: string;
    lessons: Lesson[];
    records: Attempt[];
    wins: number;
    losses: number;
    count: number;
  }
  const groups = new Map<string, Group>();
  for (const lesson of lessons) {
    if (!availableLesson(lesson)) continue;
    const id = groupKeyOf(lesson);
    let g = groups.get(id);
    if (!g) {
      g = {
        id,
        skill: lesson.skill,
        name: CONCEPT_NAMES[lesson.concept ?? ''] ?? lesson.concept ?? SKILLS[lesson.skill],
        lessons: [],
        records: [],
        wins: 0,
        losses: 0,
        count: 0,
      };
      groups.set(id, g);
    }
    g.lessons.push(lesson);
  }
  for (const g of groups.values()) {
    g.records = valid.filter((a) => groupKeyOf(byId.get(a.lessonId)!) === g.id);
    const won = new Set<string>();
    for (const a of g.records) {
      if (a.correct !== true || a.assisted) break;
      if (!won.has(a.lessonId)) {
        won.add(a.lessonId);
        g.wins += 1;
      }
    }
    const lost = new Set<string>();
    for (const a of g.records) {
      if (a.correct !== false) break;
      if (!lost.has(a.lessonId)) {
        lost.add(a.lessonId);
        g.losses += 1;
      }
    }
    g.count = new Set(
      attempts.filter((a) => byId.has(a.lessonId) && groupKeyOf(byId.get(a.lessonId)!) === g.id).map((a) => a.lessonId)
    ).size;
  }

  const latest = valid[0] ?? null;
  const lastGroup = latest ? groupKeyOf(byId.get(latest.lessonId)!) : null;
  let run = 0;
  for (const a of valid) {
    if (groupKeyOf(byId.get(a.lessonId)!) !== lastGroup) break;
    run += 1;
  }
  const pool = [...groups.values()].filter(
    (g) => !(run >= 3 && g.id === lastGroup && groups.size > 1)
  );
  if (!pool.length) return null;

  const urgent = pool
    .filter((g) => g.losses >= 2)
    .sort((a, b) => valid.indexOf(a.records[0]) - valid.indexOf(b.records[0]));
  let chosen: Group | null = urgent[0] ?? null;
  let kind = chosen ? 'reinforce' : '';
  if (!chosen && latest && latest.correct === false && run === 1) {
    chosen = pool.find((g) => g.id === lastGroup) ?? null;
    kind = 'retry_skill';
  }
  if (!chosen) {
    const score = (g: Group) => {
      const stat = skills.find((s) => s.id === g.skill);
      const minDifficulty = Math.min(...g.lessons.map((l) => l.difficulty));
      return (
        g.count +
        2 * g.records.length +
        (g.wins >= 3 ? 12 : 0) +
        (stat && minDifficulty > stat.nextDifficulty ? 100 : 0)
      );
    };
    let best: Group | null = null;
    let bestScore = Infinity;
    for (const g of pool) {
      const s = score(g);
      if (s < bestScore) {
        best = g;
        bestScore = s;
      }
    }
    chosen = best;
    kind = [...groups.values()].some((g) => g.wins >= 3)
      ? 'reduce_frequency'
      : run >= 3
        ? 'rotate'
        : 'balanced';
  }
  if (!chosen) return null;

  const stat = skills.find((s) => s.id === chosen!.skill);
  const levels = [...new Set(chosen.lessons.map((l) => l.difficulty))].sort((a, b) => a - b);
  let desired = stat?.nextDifficulty ?? 1;
  if (kind === 'reinforce' && chosen.records[0]) {
    desired = Math.min(desired, Math.max(1, (byId.get(chosen.records[0].lessonId)?.difficulty ?? 1) - 1));
  }
  const difficulty =
    [...levels].reverse().find((d) => d <= desired) ?? levels[0];
  const candidates = chosen.lessons.filter((l) => l.difficulty === difficulty);
  const excluded = currentId ?? (latest ? latest.lessonId : null);
  const eligible = candidates.filter((l) => l.id !== excluded);
  const pool2 = eligible.length ? eligible : candidates;
  const recentIds = new Set(valid.slice(0, 3).map((a) => a.lessonId));
  const rested = pool2.filter((l) => !recentIds.has(l.id));
  const fresh = (rested.length ? rested : pool2).filter((l) => !seen.has(l.id));
  const lastIndex = new Map<string, number>();
  valid.forEach((a, i) => {
    if (!lastIndex.has(a.lessonId)) lastIndex.set(a.lessonId, i);
  });
  const ordered = fresh.length
    ? fresh
    : rested.length
      ? rested
      : [...pool2].sort((a, b) => (lastIndex.get(b.id) ?? 1000000) - (lastIndex.get(a.id) ?? 1000000));
  const lesson = ordered[0];
  if (!lesson) return null;

  const cooled = [...groups.values()].find((g) => g.wins >= 3 && g.id !== chosen!.id) ?? null;
  if (kind === 'reduce_frequency' && !cooled) kind = 'balanced';

  let reason: string;
  if (kind === 'reinforce') {
    reason = `${chosen.name}最近连续${chosen.losses}道不同题答错，优先换题巩固。`;
  } else if (kind === 'retry_skill') {
    reason = `刚才的${chosen.name}还没掌握，换一道题再练一次。`;
  } else if (kind === 'rotate') {
    reason = `刚连续练了同一类题，先换成${chosen.name}；需要巩固的内容之后还会安排。`;
  } else if (kind === 'reduce_frequency') {
    reason = `${cooled!.name}近期连续做对${cooled!.wins}道不同题，暂时少安排一些，换练${chosen.name}。`;
  } else {
    reason = `根据近期练习和首次作答记录，换练${chosen.name}。`;
  }
  return {
    ...structuredClone(lesson),
    reason,
    adjustment: {
      kind,
      skill: chosen.skill,
      group: chosen.name,
      streak: kind === 'reinforce' ? chosen.losses : kind === 'reduce_frequency' ? cooled!.wins : 0,
    },
  };
}

export function learning(attempts: Attempt[], catalog: Catalog): Learning {
  const { lessons, byId } = catalog;
  const evidence = evidenceAttempts(attempts, byId);
  const skills: SkillStat[] = [];
  for (const skill of Object.keys(SKILLS)) {
    const records = evidence.filter((a) => byId.get(a.lessonId)?.skill === skill);
    const correct = records.filter((a) => a.correct === true).length;
    const total = records.length;
    let nextDifficulty = 1;
    let stage: string;
    if (skill === 'capture' || skill === 'tsumego') {
      const levels = [...new Set(lessons.filter((l) => l.skill === skill).map((l) => l.difficulty))].sort((a, b) => a - b);
      nextDifficulty = levels[0] ?? 1;
      for (let i = 0; i < levels.length - 1; i++) {
        const current = levels[i];
        const levelRecords = records.filter((a) => byId.get(a.lessonId)?.difficulty === current);
        const available = lessons.filter((l) => l.skill === skill && l.difficulty === current).length;
        const threshold = Math.min(3, available);
        const ready =
          threshold > 0 &&
          levelRecords.length >= threshold &&
          levelRecords.filter((a) => a.correct === true).length / levelRecords.length >= 0.75;
        if (!ready) break;
        nextDifficulty = levels[i + 1];
      }
      const recentFailed = records.slice(-2);
      if (
        recentFailed.length === 2 &&
        recentFailed.every((a) => a.correct !== true) &&
        new Set(recentFailed.map((a) => byId.get(a.lessonId)?.difficulty)).size === 1
      ) {
        const failedLevel = byId.get(recentFailed[0].lessonId)?.difficulty ?? 1;
        if (failedLevel > 1) nextDifficulty = Math.min(nextDifficulty, failedLevel - 1);
      }
      stage =
        total < 3
          ? '待评估'
          : nextDifficulty === 1
            ? '继续巩固基础'
            : `可练习难度 ${nextDifficulty}（按独立作答记录）`;
    } else {
      const basics = records.filter((a) => (byId.get(a.lessonId)?.difficulty ?? 1) === 1);
      const ready = basics.length >= 3 && basics.filter((a) => a.correct === true).length / basics.length >= 0.75;
      const advanced = records.filter((a) => (byId.get(a.lessonId)?.difficulty ?? 1) === 2);
      const advancedReady =
        advanced.length >= 3 && advanced.filter((a) => a.correct === true).length / advanced.length >= 0.75;
      const stepBack =
        records.length >= 2 &&
        records.slice(-2).every((a) => (byId.get(a.lessonId)?.difficulty ?? 1) === 2 && a.correct !== true);
      if (stepBack) {
        stage = total < 3 ? '待评估' : '继续巩固基础';
      } else {
        stage =
          total < 3 ? '待评估' : advancedReady ? '进阶题较稳' : ready ? '基础较稳，可尝试进阶' : '继续巩固基础';
      }
      nextDifficulty = ready ? 2 : 1;
    }
    skills.push({
      id: skill,
      name: SKILLS[skill],
      stage,
      independentAttempts: total,
      correct,
      accuracy: total ? Math.round((correct / total) * 1000) / 1000 : null,
      nextDifficulty,
    });
  }
  const recommendation = recommendFrom(attempts, skills, catalog, null);
  return {
    stage: evidence.length < 3 ? '待评估' : '按技能逐项练习（不对应段位）',
    attemptsCount: attempts.length,
    independentCorrect: evidence.filter((a) => a.correct === true).length,
    independentAttempts: evidence.length,
    skills,
    recommendation,
  };
}

export function recommend(
  attempts: Attempt[],
  catalog: Catalog,
  currentId: string | null = null
): RecommendationLesson | null {
  return recommendFrom(attempts, learning(attempts, catalog).skills, catalog, currentId);
}

// ─────────────────────────────────────────────────────────────
// 练习推进（顺序 / 错题复习；推荐模式走 recommend）
// ─────────────────────────────────────────────────────────────

export type PracticeMode = 'recommended' | 'sequential' | 'review';

export interface SequentialScope {
  /** course = 入门课程 + 原创手筋（按概念推进） */
  kind: 'course' | 'licensed' | 'book';
  title?: string;
  difficulty?: number;
}

export function sequentialOptions(catalog: Catalog): Array<{ value: string; label: string; scope: SequentialScope }> {
  const out: Array<{ value: string; label: string; scope: SequentialScope }> = [
    { value: 'course', label: '入门课程与手筋', scope: { kind: 'course' } },
  ];
  const licensed = new Map<string, Set<number>>();
  const books = new Set<string>();
  for (const lesson of catalog.lessons) {
    if (!availableLesson(lesson)) continue;
    const collection = sequentialCollection(lesson);
    if (!collection) continue;
    const [kind, title] = collection;
    if (kind === 'licensed') {
      let levels = licensed.get(title);
      if (!levels) licensed.set(title, (levels = new Set()));
      levels.add(lesson.difficulty);
    } else if (kind === 'book') {
      books.add(title);
    }
  }
  for (const [title, levels] of licensed) {
    for (const difficulty of [...levels].sort((a, b) => a - b)) {
      const chapter = LICENSED_CHAPTERS[difficulty] ?? '练习';
      out.push({
        value: `licensed:${difficulty}`,
        label: `${title} · ${chapter}`,
        scope: { kind: 'licensed', title, difficulty },
      });
    }
  }
  for (const title of books) {
    out.push({ value: `book:${title}`, label: title, scope: { kind: 'book', title } });
  }
  return out;
}

function scopeMatches(lesson: Lesson, scope: SequentialScope): boolean {
  const collection = sequentialCollection(lesson);
  if (scope.kind === 'course') return collection === null;
  if (!collection) return false;
  if (scope.kind === 'licensed') {
    return collection[0] === 'licensed' && collection[1] === scope.title && lesson.difficulty === scope.difficulty;
  }
  return collection[0] === 'book' && collection[1] === scope.title;
}

/** 题集的全部可练题目（按题集规则排序）；练习推进与选题面板共用 */
export function sequentialLessons(catalog: Catalog, scope: SequentialScope): Lesson[] {
  const { lessons } = catalog;
  const pool = lessons.filter((l) => availableLesson(l) && scopeMatches(l, scope));
  if (scope.kind === 'course') {
    const groupStart = new Map<string, number>();
    lessons.forEach((l, i) => {
      const prefix = stripTrailingNumber(l.id);
      if (!groupStart.has(prefix)) groupStart.set(prefix, i);
    });
    pool.sort((a, b) => {
      const ra = sequentialRank(a, groupStart);
      const rb = sequentialRank(b, groupStart);
      for (let i = 0; i < Math.max(ra.length, rb.length); i++) {
        const d = (ra[i] ?? 0) - (rb[i] ?? 0);
        if (d !== 0) return d;
      }
      return 0;
    });
  } else {
    pool.sort((a, b) => {
      const da = sequentialProblemNumber(a);
      const db = sequentialProblemNumber(b);
      return da !== db ? da - db : a.id.localeCompare(b.id);
    });
  }
  return pool;
}

export interface ProgressInfo {
  total: number;
  completed: number;
  remaining: number;
  reviewCount: number;
  nextId: string | null;
  /** 顺序模式下当前题在池中的序号（1 起） */
  currentIndex: number | null;
}

/** 计算下一题（移植 practice_progress：完成 = 曾答对；复习池 = 帮过 + 答错） */
export function practiceProgress(
  catalog: Catalog,
  attempts: Attempt[],
  helped: string[],
  mode: PracticeMode,
  currentId: string | null,
  scope?: SequentialScope
): ProgressInfo {
  const pool =
    mode === 'sequential' && scope
      ? sequentialLessons(catalog, scope)
      : catalog.lessons.filter((l) => availableLesson(l));

  const orderedIds = pool.map((l) => l.id);
  const completed = new Set(attempts.filter((a) => a.correct === true).map((a) => a.lessonId));
  const review = new Set([...helped, ...attempts.filter((a) => a.correct === false).map((a) => a.lessonId)]);
  const ids = new Set(orderedIds);
  const anchor = currentId && orderedIds.includes(currentId) ? orderedIds.indexOf(currentId) : -1;
  const candidates = orderedIds.filter(
    (id) => !completed.has(id) && (mode !== 'review' || review.has(id))
  );
  let nextId: string | null = null;
  if (candidates.length) {
    nextId = candidates.find((id) => orderedIds.indexOf(id) > anchor) ?? candidates[0];
  }
  return {
    total: orderedIds.length,
    completed: [...ids].filter((id) => completed.has(id)).length,
    remaining: [...ids].filter((id) => !completed.has(id)).length,
    reviewCount: [...ids].filter((id) => review.has(id) && !completed.has(id)).length,
    nextId,
    currentIndex:
      currentId && orderedIds.includes(currentId) ? orderedIds.indexOf(currentId) + 1 : null,
  };
}
