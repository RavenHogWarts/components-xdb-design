// 旋转 / 镜像变式（参考 go-coach review-variations 思路，运行时派生）。
// 八种对称是棋盘图的自同构：合法性、提子、superko 全部保持，
// 用于错题复习时改变方位、避免背位置。进度仍记在原题 id 下。

import type { AnswerNode, Lesson } from './types';

/** variant 0–7：≥4 先左右翻转，再按 variant%4 次顺时针旋转 */
export function transformPoint(x: number, y: number, variant: number, size: number): [number, number] {
  if (variant >= 4) x = size - 1 - x;
  for (let i = 0; i < variant % 4; i++) {
    const nx = size - 1 - y;
    const ny = x;
    x = nx;
    y = ny;
  }
  return [x, y];
}

function transformTree(node: AnswerNode, variant: number, size: number): AnswerNode {
  const out: AnswerNode = { children: [] };
  if (node.move) {
    const [x, y] = transformPoint(node.move[0], node.move[1], variant, size);
    out.move = [x, y];
  }
  if (node.explanation) out.explanation = node.explanation;
  if (node.result) out.result = node.result;
  if (node.author_verdict) out.author_verdict = node.author_verdict;
  out.children = node.children.map((c) => transformTree(c, variant, size));
  return out;
}

/** 派生变式（variant 0 原样返回浅拷贝）；id 不变，进度与原题合并 */
export function applyVariant(lesson: Lesson, variant: number): Lesson {
  if (!variant) return structuredClone(lesson);
  const size = lesson.size;
  const point = (p: number[]): [number, number] => transformPoint(p[0], p[1], variant, size);
  const objective = { ...lesson.objective };
  if (objective.targets) objective.targets = objective.targets.map(point);
  if (objective.point) objective.point = point(objective.point);
  return {
    ...structuredClone(lesson),
    stones: lesson.stones.map((s) => {
      const [x, y] = point([s.x, s.y]);
      return { x, y, color: s.color };
    }),
    marks: lesson.marks.map((m) => {
      const [x, y] = point([m.x, m.y]);
      return { x, y, label: m.label };
    }),
    objective,
    tree: transformTree(lesson.tree, variant, size),
    variantTag: variant,
  };
}
