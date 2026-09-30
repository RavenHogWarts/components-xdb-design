// ═════════════════════════════════════════════════════════════
// 围棋领域类型：题目（Lesson）/ 棋盘 / 作答记录。
// 题目格式与 go-coach 的 Lesson JSON 保持互通（见 题库导入说明.md），
// 坐标左上为原点 [0,0]，颜色 1 黑 2 白，字母列跳过 I。
// ═════════════════════════════════════════════════════════════

/** 棋盘交叉点颜色：0 空、1 黑、2 白 */
export type Color = 0 | 1 | 2;

/** 棋盘：board[y][x]，y 为行（自上而下）、x 为列（自左向右） */
export type Board = Color[][];

export interface Point {
  x: number;
  y: number;
}

export interface Stone extends Point {
  color: 1 | 2;
}

/** 棋盘标记（目标序号 / 气提示 / 连接点等） */
export interface Mark extends Point {
  label: string;
}

export type ObjectiveKind = 'capture' | 'capture_any' | 'authored_solution';

export interface Objective {
  kind: ObjectiveKind;
  /** capture / capture_any：要提掉的初始对方棋子坐标 */
  targets?: number[][];
  /** cut 题：双方直接连接点 */
  point?: number[];
}

/** 答案树节点：根不含落子，双方按先行方交替；同一父节点的多个孩子是可选分支 */
export interface AnswerNode {
  move?: number[];
  explanation?: string;
  /** 汉化前的作者原文（GGG 题库对照用） */
  original_explanation?: string;
  result?: string;
  author_verdict?: string;
  children: AnswerNode[];
}

export type LessonSourceKind = 'original' | 'book' | 'manual' | 'licensed';

export interface LessonSource {
  kind: LessonSourceKind;
  [key: string]: unknown;
}

export type LessonSkill = 'escape' | 'capture' | 'connect' | 'cut' | 'tsumego';

export interface Lesson {
  id: string;
  title: string;
  prompt: string;
  hint: string;
  size: 9 | 19;
  to_play: 1 | 2;
  skill: LessonSkill;
  difficulty: number;
  sequence?: boolean;
  concept?: string;
  variant?: number;
  family_id?: string;
  /** go-coach 历史兼容题（不入可练目录） */
  legacy?: boolean;
  /** 复习变式标记（运行时派生，不持久化；进度仍记原题 id） */
  variantTag?: number;
  stones: Stone[];
  objective: Objective;
  marks: Mark[];
  source: LessonSource;
  tree: AnswerNode;
}

/** 一次作答事件（学习档案的最小记录单位） */
export interface Attempt {
  createdAt: string;
  lessonId: string;
  title: string;
  skill: string;
  difficulty: number;
  /** true 对 / false 错 / null 走出收录变化之外（待复核） */
  correct: boolean | null;
  /** 提示后 / 看答案后 / 撤回后作答 */
  assisted: boolean;
  attemptNo: number;
  summary: string;
}

export type AssessmentStatus =
  | 'solved' // 完成收录变化或目标
  | 'wrong' // 基础题答错
  | 'unlisted' // 走出参考变化，待复核
  | 'playing' // 沿收录变化进行中
  | 'exploring'; // 复盘自由探索（不判分）

export interface Assessment {
  correct: boolean | null;
  status: AssessmentStatus;
  summary: string;
  explanation: string;
  /** 汉化解说的英文原文（仅 GGG 等翻译题库，供对照；无则空） */
  originalExplanation?: string;
  marks?: Mark[];
}
