// SGF（Smart Game Format）解析 / 回放 / 序列化（M3 打谱复盘核心）。
// 解析器移植自 go-coach scripts/import_gogameguru.py 的自写 Parser
// （未复用第三方库），回放复用本插件规则引擎；不合法着法不静默修正，
// 节点标记 illegal 后仍可浏览。支持 FF[4] 常用属性、压缩坐标、
// tt 式停一手，以及复盘「试下」分支的创建与序列化。

import { boardKey, cloneBoard, emptyBoard, play } from './rules';
import type { Board, Color } from './types';

// ─────────────────────────────────────────────────────────────
// 解析：文本 → SgfNode 树
// ─────────────────────────────────────────────────────────────

export interface SgfNode {
  props: Record<string, string[]>;
  children: SgfNode[];
}

class SgfParseError extends Error {}

class Parser {
  private i = 0;
  private nodes = 0;
  constructor(private readonly source: string) {}

  private space() {
    while (this.i < this.source.length && /\s/.test(this.source[this.i])) this.i++;
  }
  private expect(character: string) {
    this.space();
    if (this.i >= this.source.length || this.source[this.i] !== character) {
      throw new SgfParseError('SGF 记号不符合预期。');
    }
    this.i++;
  }
  private value(): string {
    this.expect('[');
    const out: string[] = [];
    while (this.i < this.source.length) {
      let c = this.source[this.i];
      this.i++;
      if (c === ']') return out.join('');
      if (c === '\\') {
        if (this.i >= this.source.length) throw new SgfParseError('SGF 转义未结束。');
        c = this.source[this.i];
        this.i++;
        if (c === '\r' || c === '\n') {
          // 行 continuation：吞掉换行与可能的另一种换行符
          if (this.i < this.source.length && (this.source[this.i] === '\r' || this.source[this.i] === '\n') && this.source[this.i] !== c) this.i++;
          continue;
        }
      }
      out.push(c);
    }
    throw new SgfParseError('SGF 属性值未闭合。');
  }
  private node(): SgfNode {
    this.expect(';');
    if (++this.nodes > 20000) throw new SgfParseError('SGF 节点过多。');
    const props: Record<string, string[]> = {};
    for (;;) {
      this.space();
      const start = this.i;
      while (this.i < this.source.length && this.source[this.i] >= 'A' && this.source[this.i] <= 'Z') this.i++;
      if (start === this.i) break;
      const name = this.source.slice(start, this.i);
      const values: string[] = [];
      for (;;) {
        this.space();
        if (this.i >= this.source.length || this.source[this.i] !== '[') break;
        values.push(this.value());
      }
      if (!values.length) throw new SgfParseError(`属性 ${name} 缺少值。`);
      // 规范要求属性单次出现多值；容错合并重复出现的属性（部分工具会拆写）
      if (name in props) props[name].push(...values);
      else props[name] = values;
    }
    return { props, children: [] };
  }
  private tree(depth = 0): SgfNode {
    if (depth > 500) throw new SgfParseError('SGF 树过深。');
    this.expect('(');
    this.space();
    if (this.i >= this.source.length || this.source[this.i] !== ';') {
      throw new SgfParseError('SGF 树缺少节点。');
    }
    const first = this.node();
    let current = first;
    for (;;) {
      this.space();
      if (this.i >= this.source.length || this.source[this.i] !== ';') break;
      const child = this.node();
      current.children.push(child);
      current = child;
    }
    for (;;) {
      this.space();
      if (this.i >= this.source.length || this.source[this.i] !== '(') break;
      current.children.push(this.tree(depth + 1));
    }
    this.expect(')');
    return first;
  }
  parse(): SgfNode {
    const root = this.tree();
    this.space();
    if (this.i !== this.source.length) throw new SgfParseError('SGF 末尾有多余内容。');
    return root;
  }
}

export function parseSgf(text: string): SgfNode {
  return new Parser(text).parse();
}

// ─────────────────────────────────────────────────────────────
// 坐标与压缩点
// ─────────────────────────────────────────────────────────────

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

export function pointToSgf(x: number, y: number): string {
  return LETTERS[x] + LETTERS[y];
}

function sgfToPoint(value: string, size: number): [number, number] | null {
  if (value.length !== 2) return null;
  const x = LETTERS.indexOf(value[0]);
  const y = LETTERS.indexOf(value[1]);
  if (x < 0 || y < 0 || x >= size || y >= size) return null;
  return [x, y];
}

/** 是否 tt 式停一手（仅 ≤19 路的历史格式） */
function isTtPass(value: string, size: number): boolean {
  return value === 'tt' && size <= 19;
}

/** 展开 "aa" / "aa:cc" 压缩点到坐标列表 */
function expandPoints(values: string[], size: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const value of values) {
    if (value.includes(':')) {
      const [lo, hi] = value.split(':');
      const a = sgfToPoint(lo, size);
      const b = sgfToPoint(hi, size);
      if (!a || !b) continue;
      for (let y = Math.min(a[1], b[1]); y <= Math.max(a[1], b[1]); y++) {
        for (let x = Math.min(a[0], b[0]); x <= Math.max(a[0], b[0]); x++) out.push([x, y]);
      }
    } else {
      const p = sgfToPoint(value, size);
      if (p) out.push(p);
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// 回放：SgfNode → 带局面缓存的 GameNode 树
// ─────────────────────────────────────────────────────────────

export type MarkKind = 'label' | 'circle' | 'triangle' | 'square' | 'cross' | 'select';

export interface BoardMark {
  x: number;
  y: number;
  label?: string;
  kind: MarkKind;
}

export interface GameNode {
  parent: GameNode | null;
  children: GameNode[];
  /** 本节点落子（含停一手）；注释/标记节点为 null */
  move: { color: 1 | 2; x: number; y: number; pass: boolean } | null;
  /** 本节点生效后的局面（setup 已应用） */
  board: Board;
  /** 到本节点为止的落子数（含停一手） */
  moveNo: number;
  captures: { black: number; white: number };
  comment: string;
  marks: BoardMark[];
  /** 复盘试下分支（导出时保留为普通变化） */
  isTrial: boolean;
  /** 回放失败的着法（局面沿用父节点，仍可浏览） */
  illegal: string | null;
  /** 该谁落子（试下用） */
  toPlay: 1 | 2;
  /** 根到本节点的局面键链（superko 校验用） */
  keyChain: string[];
  /** 序列化时保留的原始属性（除 B/W/AB/AW/AE/C/LB/CR/TR/MA/SQ/SL 外） */
  extraProps: Record<string, string[]>;
}

export interface GameInfo {
  size: number;
  komi: string | null;
  rule: string | null;
  blackName: string;
  whiteName: string;
  result: string | null;
  date: string | null;
  event: string | null;
  fileName: string | null;
}

export interface LoadedGame {
  root: GameNode;
  info: GameInfo;
  warnings: string[];
}

const MARK_KINDS: Record<string, MarkKind> = {
  CR: 'circle',
  TR: 'triangle',
  SQ: 'square',
  MA: 'cross',
  SL: 'select',
};

/** 找到树中第一手棋的颜色（决定初始轮次；无棋谱默认黑） */
function firstMoveColor(root: SgfNode): 1 | 2 {
  const stack = [root];
  while (stack.length) {
    const node = stack.shift()!;
    for (const child of node.children) stack.push(child);
    if (node.props.B) return 1;
    if (node.props.W) return 2;
  }
  return 1;
}

export function buildGame(sgfRoot: SgfNode, fileName: string | null = null): LoadedGame {
  const warnings: string[] = [];
  const sizeProp = Number(sgfRoot.props.SZ?.[0] ?? '19');
  const size = Number.isInteger(sizeProp) && sizeProp >= 2 && sizeProp <= LETTERS.length ? sizeProp : 19;
  if (size !== sizeProp) warnings.push(`棋盘尺寸 ${sizeProp} 不受支持，按 ${size} 路处理。`);

  const board = emptyBoard(size);
  for (const [prop, color] of [
    ['AB', 1],
    ['AW', 2],
  ] as Array<[string, Color]>) {
    for (const [x, y] of expandPoints(sgfRoot.props[prop] ?? [], size)) board[y][x] = color;
  }
  for (const [x, y] of expandPoints(sgfRoot.props.AE ?? [], size)) board[y][x] = 0;

  const info: GameInfo = {
    size,
    komi: sgfRoot.props.KM?.[0] ?? null,
    rule: sgfRoot.props.RU?.[0] ?? null,
    blackName: sgfRoot.props.PB?.[0] ?? '黑方',
    whiteName: sgfRoot.props.PW?.[0] ?? '白方',
    result: sgfRoot.props.RE?.[0] ?? null,
    date: sgfRoot.props.DT?.[0] ?? null,
    event: sgfRoot.props.EV?.[0] ?? null,
    fileName,
  };

  const pl = sgfRoot.props.PL?.[0];
  let rootToPlay: 1 | 2 = pl === 'W' ? 2 : pl === 'B' ? 1 : firstMoveColor(sgfRoot);

  const root: GameNode = {
    parent: null,
    children: [],
    move: null,
    board: cloneBoard(board),
    moveNo: 0,
    captures: { black: 0, white: 0 },
    comment: (sgfRoot.props.C ?? []).join('\n'),
    marks: parseMarks(sgfRoot, size),
    isTrial: false,
    illegal: null,
    toPlay: rootToPlay,
    keyChain: [boardKey(board)],
    extraProps: pickExtra(sgfRoot),
  };

  const build = (sgf: SgfNode, parent: GameNode) => {
    for (const child of sgf.children) {
      const p = child.props;
      let move: GameNode['move'] = null;
      let nodeBoard = cloneBoard(parent.board);
      let illegal: string | null = null;
      let captured = 0;
      let color: 1 | 2 = parent.toPlay;

      if (p.B || p.W) {
        color = p.B ? 1 : 2;
        const raw = (p.B ?? p.W ?? [''])[0];
        const pass = raw === '' || isTtPass(raw, size);
        if (pass) {
          move = { color, x: -1, y: -1, pass: true };
        } else {
          const point = sgfToPoint(raw, size);
          if (!point) {
            illegal = '坐标超出棋盘范围。';
            move = { color, x: -1, y: -1, pass: true };
          } else {
            try {
              const result = play(parent.board, point[0], point[1], color, parent.keyChain);
              nodeBoard = result.board;
              captured = result.captured;
              move = { color, x: point[0], y: point[1], pass: false };
            } catch (err) {
              illegal = (err as Error).message;
              move = { color, x: point[0], y: point[1], pass: false };
            }
          }
        }
      } else if (p.AB || p.AW || p.AE) {
        for (const [prop, c] of [
          ['AB', 1],
          ['AW', 2],
        ] as Array<[string, Color]>) {
          for (const [x, y] of expandPoints(p[prop] ?? [], size)) nodeBoard[y][x] = c;
        }
        for (const [x, y] of expandPoints(p.AE ?? [], size)) nodeBoard[y][x] = 0;
      }

      const node: GameNode = {
        parent,
        children: [],
        move,
        board: nodeBoard,
        moveNo: parent.moveNo + (move ? 1 : 0),
        captures: {
          black: parent.captures.black + (color === 1 ? captured : 0),
          white: parent.captures.white + (color === 2 ? captured : 0),
        },
        comment: (p.C ?? []).join('\n'),
        marks: parseMarks(child, size),
        isTrial: false,
        illegal,
        toPlay: move ? ((3 - color) as 1 | 2) : parent.toPlay,
        keyChain: move && !move.pass && !illegal ? parent.keyChain.concat(boardKey(nodeBoard)) : parent.keyChain,
        extraProps: pickExtra(child),
      };
      if (illegal) warnings.push(`第 ${node.moveNo} 手无法回放：${illegal}`);
      parent.children.push(node);
      build(child, node);
    }
  };
  build(sgfRoot, root);
  rootToPlay = root.toPlay;
  return { root, info, warnings };
}

function parseMarks(node: SgfNode, size: number): BoardMark[] {
  const marks: BoardMark[] = [];
  for (const value of node.props.LB ?? []) {
    const sep = value.indexOf(':');
    if (sep < 0) continue;
    const p = sgfToPoint(value.slice(0, sep), size);
    if (p) marks.push({ x: p[0], y: p[1], label: value.slice(sep + 1), kind: 'label' });
  }
  for (const [prop, kind] of Object.entries(MARK_KINDS)) {
    for (const [x, y] of expandPoints(node.props[prop] ?? [], size)) {
      marks.push({ x, y, kind });
    }
  }
  return marks;
}

const RESERVED = new Set(['B', 'W', 'AB', 'AW', 'AE', 'C', 'LB', 'CR', 'TR', 'MA', 'SQ', 'SL', 'SZ', 'PL']);

function pickExtra(node: SgfNode): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [key, values] of Object.entries(node.props)) {
    if (!RESERVED.has(key)) out[key] = values;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// 导航与试下
// ─────────────────────────────────────────────────────────────

/** 主线（首孩子链） */
export function mainline(root: GameNode): GameNode[] {
  const path: GameNode[] = [];
  let current: GameNode | null = root;
  while (current) {
    path.push(current);
    current = current.children[0] ?? null;
  }
  return path;
}

export function pathOf(node: GameNode): GameNode[] {
  const path: GameNode[] = [];
  for (let current: GameNode | null = node; current; current = current.parent) path.unshift(current);
  return path;
}

/** 在 parent 下创建试下节点；非法返回 null */
export function addTrialChild(parent: GameNode, x: number, y: number): GameNode | null {
  const color = parent.toPlay;
  let result;
  try {
    result = play(parent.board, x, y, color, parent.keyChain);
  } catch {
    return null;
  }
  const node: GameNode = {
    parent,
    children: [],
    move: { color, x, y, pass: false },
    board: result.board,
    moveNo: parent.moveNo + 1,
    captures: {
      black: parent.captures.black + (color === 1 ? result.captured : 0),
      white: parent.captures.white + (color === 2 ? result.captured : 0),
    },
    comment: '',
    marks: [],
    isTrial: true,
    illegal: null,
    toPlay: (3 - color) as 1 | 2,
    keyChain: parent.keyChain.concat(boardKey(result.board)),
    extraProps: {},
  };
  parent.children.push(node);
  return node;
}

/** 移除 anchor 节点下全部试下分支（不触碰原始变化） */
export function removeTrialChildren(anchor: GameNode) {
  anchor.children = anchor.children.filter((c) => !c.isTrial);
}

// ─────────────────────────────────────────────────────────────
// 序列化：GameNode → SGF 文本
// ─────────────────────────────────────────────────────────────

function escapeValue(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\]/g, '\\]');
}

function serializeMarks(node: GameNode): string {
  // 同一属性的多个值合并写在一起（SGF 规范：属性单次出现、多值）
  const byProp = new Map<string, string[]>();
  const propOf: Record<MarkKind, string> = {
    label: 'LB',
    circle: 'CR',
    triangle: 'TR',
    square: 'SQ',
    cross: 'MA',
    select: 'SL',
  };
  for (const mark of node.marks) {
    const prop = propOf[mark.kind];
    const value =
      mark.kind === 'label'
        ? `${pointToSgf(mark.x, mark.y)}:${escapeValue(mark.label ?? '')}`
        : pointToSgf(mark.x, mark.y);
    const list = byProp.get(prop) ?? [];
    list.push(value);
    byProp.set(prop, list);
  }
  let out = '';
  for (const [prop, values] of byProp) {
    out += values.map((v) => `${prop}[${v}]`).join('');
  }
  return out;
}

function serializeNode(node: GameNode): string {
  let out = ';';
  for (const [key, values] of Object.entries(node.extraProps)) {
    out += values.map((v) => `${key}[${escapeValue(v)}]`).join('');
  }
  if (node.move) {
    const point = node.move.pass ? '' : pointToSgf(node.move.x, node.move.y);
    out += `${node.move.color === 1 ? 'B' : 'W'}[${point}]`;
  }
  if (node.comment) out += `C[${escapeValue(node.comment)}]`;
  out += serializeMarks(node);
  if (node.children.length === 1) {
    out += serializeNode(node.children[0]);
  } else if (node.children.length > 1) {
    for (const child of node.children) out += `(${serializeNode(child)})`;
  }
  return out;
}

export function serializeGame(game: LoadedGame): string {
  const { root, info } = game;
  let head = `(;GM[1]FF[4]CA[UTF-8]AP[GoCoach XDB:1]SZ[${info.size}]`;
  if (info.komi) head += `KM[${escapeValue(info.komi)}]`;
  if (info.rule) head += `RU[${escapeValue(info.rule)}]`;
  head += `PB[${escapeValue(info.blackName)}]PW[${escapeValue(info.whiteName)}]`;
  if (info.result) head += `RE[${escapeValue(info.result)}]`;
  if (info.date) head += `DT[${escapeValue(info.date)}]`;
  if (info.event) head += `EV[${escapeValue(info.event)}]`;
  // 根节点棋子按最终 setup 重写（AB/AW），保证与回放一致
  const setup: string[] = [];
  for (const [prop, color] of [
    ['AB', 1],
    ['AW', 2],
  ] as Array<[string, number]>) {
    const points: string[] = [];
    for (let y = 0; y < info.size; y++) {
      for (let x = 0; x < info.size; x++) {
        if (root.board[y][x] === color) points.push(pointToSgf(x, y));
      }
    }
    if (points.length) setup.push(prop + points.map((p) => `[${p}]`).join(''));
  }
  head += setup.join('');
  if (root.comment) head += `C[${escapeValue(root.comment)}]`;
  head += serializeMarks(root);
  for (const child of root.children) head += `(${serializeNode(child)})`;
  return head + ')';
}

/** 内置示例棋谱：小型官子演示，含变化分支、标记与解说 */
export const SAMPLE_SGF = `(;GM[1]FF[4]CA[UTF-8]SZ[19]KM[7.5]RU[Chinese]PB[示例黑方]PW[示例白方]
C[示例棋谱：一盘演示用的小型对局。←/→ 键或下方按钮逐步打谱，点击「试下」可在任意局面开分支自由计算。]
AB[dd][pd][dp][pp]
(;B[qf]C[挂角：白棋星位小飞挂是最常见的开局之一。]
;W[nc]C[小飞守角，扎实。]
(;B[cf]C[拆边，占大场。]
;W[qk]C[白棋也拆边。]
(;B[jd]C[占据天元方向的大场。]LB[dd:A][pd:B]TR[jd]
;W[cn]
(;B[ck]
;W[dk]
(;B[dj]C[至此布局阶段告一段落。可以点「试下」继续推演后续攻防。])
(;B[fq]C[变化：也可以先在下方拆边。]))
(;B[fq]))
(;B[fq]C[变化：先占下方大场。]))
(;B[cn])))
`;
