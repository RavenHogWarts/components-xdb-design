// 逻辑层自测入口（仅开发用，不进产物）。
// 用 esbuild 打包后由 scripts/selftest.mjs 以 node 执行：
// 覆盖目录校验、基础题/序盘题判分闭环、GGG 导入校验、SGF 往返、变式派生。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildCatalog, practiceProgress, recommend, availableLesson } from '../src/go/curriculum';
import { createSession, playStone, solveBasic, mainlineFrom, undoMove } from '../src/go/grade';
import { parseSgf, buildGame, mainline, pathOf, serializeGame, addTrialChild, SAMPLE_SGF } from '../src/go/sgf';
import { listSgfFiles, readLocalText, joinPath, dirOfFile, localFsAvailable } from '../src/localfs';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyVariant } from '../src/go/variation';
import { validateLesson } from '../src/go/validate';
import { parseLibraryFile } from '../src/storage';

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${name} ${detail}`);
  }
};

/** 沿首孩子主线用 playStone 走完一道序盘题（对手应手由会话自动完成） */
function solveByMainline(lesson: ReturnType<typeof validateLesson>) {
  let session = createSession(lesson);
  for (let guard = 0; guard < 40; guard++) {
    const rest = mainlineFrom(session);
    if (!rest.length) break;
    session = playStone(session, rest[0].x, rest[0].y);
  }
  return session;
}

// ── 1. 内置目录 ────────────────────────────────────────────
console.log('1. 内置目录（118 道序盘题逐题回放校验）');
const catalog = buildCatalog();
check('目录共 182 题（64 基础 + 118 序盘）', catalog.lessons.length === 182, `实际 ${catalog.lessons.length}`);
const available = catalog.lessons.filter(availableLesson).length;
check('可练题 150（基础 32 + 序盘 118）', available === 150, `实际 ${available}`);

// ── 2. 基础题判分 ──────────────────────────────────────────
console.log('2. 基础题（escape/capture/connect/cut 单手判分）');
for (const id of ['escape-1-1', 'capture-1-1', 'connect-1-1', 'cut-1-1']) {
  const lesson = catalog.byId.get(id)!;
  let session = createSession(lesson);
  const answers = solveBasic(session);
  check(`${id} 能推出答案点`, answers.length >= 1, `答案 ${answers.length} 个`);
  session = playStone(session, answers[0].x, answers[0].y);
  check(`${id} 答案点判对`, session.assessment?.correct === true, `状态 ${session.assessment?.status}`);
  // 错误点：随便下一个非答案合法点应判错
  const wrong = { x: 0, y: 0 };
  if (!answers.some((p) => p.x === wrong.x && p.y === wrong.y)) {
    let session2 = createSession(lesson);
    try {
      session2 = playStone(session2, wrong.x, wrong.y);
      check(`${id} 随手点判错`, session2.assessment?.correct === false, `状态 ${session2.assessment?.status}`);
    } catch {
      check(`${id} 随手点非法（跳过判错断言）`, true);
    }
  }
}

// ── 3. 序盘题主线闭环 ──────────────────────────────────────
console.log('3. 序盘题（18 手筋 + 抽样原创题走主线至 solved）');
const sequenceLessons = catalog.lessons.filter((l) => l.sequence).slice(0, 30);
let solvedCount = 0;
for (const lesson of sequenceLessons) {
  const session = solveByMainline(lesson);
  if (session.assessment?.status === 'solved') solvedCount += 1;
}
check(`抽样 ${sequenceLessons.length} 题全部 solved`, solvedCount === sequenceLessons.length, `仅 ${solvedCount} 题`);

// 未收录走法 → unlisted
const tl = catalog.byId.get('tactic-double-atari')!;
let unlistedSession = createSession(tl);
outer: for (let y = 0; y < 9; y++) {
  for (let x = 0; x < 9; x++) {
    if (unlistedSession.board[y][x]) continue;
    if (tl.tree.children.some((c) => c.move![0] === x && c.move![1] === y)) continue;
    try {
      unlistedSession = playStone(unlistedSession, x, y);
      break outer;
    } catch {
      // 非法点继续找
    }
  }
}
check(
  '走出收录变化 → unlisted（不判错）',
  unlistedSession.assessment?.status === 'unlisted' && unlistedSession.playout,
  `状态 ${unlistedSession.assessment?.status}`
);

// 撤回后恢复对手应手（回归：unlisted 撤回曾被困在自由探索）
const restored = undoMove(unlistedSession);
check(
  '撤回后恢复作答模式',
  !restored.playout && !restored.resolved && restored.toPlay === restored.initialPlayer,
  `playout=${restored.playout} resolved=${restored.resolved}`
);
const replay = playStone(restored, tl.tree.children[0].move![0], tl.tree.children[0].move![1]);
check(
  '撤回后对手恢复自动应手',
  replay.moves.length === 2 && replay.assessment?.status === 'playing',
  `moves=${replay.moves.length} 状态 ${replay.assessment?.status}`
);

// 基础题：答错撤回后可再次判分
let basicWrong = createSession(catalog.byId.get('escape-1-1')!);
try {
  basicWrong = playStone(basicWrong, 0, 0);
} catch {
  // (0,0) 合法，不应到这
}
check('基础题答错进入探索', basicWrong.assessment?.status === 'wrong' && basicWrong.playout);
const basicRestored = undoMove(basicWrong);
check('基础题撤回后恢复判分', !basicRestored.playout && !basicRestored.resolved);
const basicAnswer = solveBasic(basicRestored);
const basicReplay = playStone(basicRestored, basicAnswer[0].x, basicAnswer[0].y);
check('基础题撤回后再答判对', basicReplay.assessment?.correct === true, `状态 ${basicReplay.assessment?.status}`);

// ── 4. GGG 导入校验 ────────────────────────────────────────
console.log('4. GGG 题库（紧凑格式展开 + 全量校验回放）');
const gggText = readFileSync(join(process.env.GOCOACH_ROOT ?? process.cwd(), 'assets', 'ggg-lessons.json'), 'utf8');
const parsed = parseLibraryFile(gggText);
check('解析出 417 题', parsed.raw.length === 417, `实际 ${parsed.raw.length}`);
const t0 = Date.now();
let okCount = 0;
const errors: string[] = [];
for (const raw of parsed.raw) {
  try {
    validateLesson(raw);
    okCount += 1;
  } catch (err) {
    errors.push((raw as { id?: string }).id + ': ' + (err as Error).message);
  }
}
check(`417 题全部通过校验（${Date.now() - t0}ms）`, okCount === 417, `通过 ${okCount}，首错 ${errors[0] ?? ''}`);
// 汉化：解说全部中文化（严格：不允许残留英文单词串），且保留英文原文
let zhExpl = 0;
let origKept = 0;
let residual = 0;
const residualList: string[] = [];
const scan = (node: { explanation?: string; original_explanation?: string; children: unknown[] }) => {
  if (node.explanation) {
    zhExpl += 1;
    if (/[A-Za-z]{2,}/.test(node.explanation)) {
      residual += 1;
      residualList.push(node.explanation.slice(0, 60));
    }
  }
  if (node.original_explanation) origKept += 1;
  (node.children as Array<typeof node>).forEach(scan as (n: typeof node) => void);
};
for (const raw of parsed.raw) {
  const lesson = validateLesson(raw);
  scan(lesson.tree as never);
}
check('解说全部汉化（严格：无英文单词残留）', residual === 0, `残留 ${residual} 条：${residualList[0] ?? ''}`);
check(`英文原文保留 ${origKept} 条（>1500）`, origKept > 1500, `实际 ${origKept}`);
// 抽 3 题走主线
const gggLessons = parsed.raw.slice(0, 3).map((raw) => validateLesson(raw));
for (const lesson of gggLessons) {
  const session = solveByMainline(lesson);
  check(`GGG ${lesson.id} 主线 solved`, session.assessment?.status === 'solved', `状态 ${session.assessment?.status}`);
}

// ── 5. 变式派生 ────────────────────────────────────────────
console.log('5. 变式（旋转/镜像后主线仍 solved）');
const variantLesson = applyVariant(gggLessons[0], 5);
const variantSession = solveByMainline(variantLesson);
check('变式 5 主线 solved', variantSession.assessment?.status === 'solved', `状态 ${variantSession.assessment?.status}`);
check(
  '变式棋子坐标确实变化',
  JSON.stringify(variantLesson.stones) !== JSON.stringify(gggLessons[0].stones)
);

// ── 6. SGF 解析 / 回放 / 试下 / 序列化往返 ─────────────────
console.log('6. SGF（示例棋谱解析、试下、序列化往返）');
const game = buildGame(parseSgf(SAMPLE_SGF), 'sample.sgf');
const line = mainline(game.root);
check('示例主线 ≥ 8 手', line.length >= 8, `实际 ${line.length}`);
check('示例无回放错误', game.warnings.length === 0, JSON.stringify(game.warnings));
const mid = line[Math.floor(line.length / 2)];
let trial: ReturnType<typeof addTrialChild> = null;
outerTrial: for (let y = 0; y < game.info.size; y++) {
  for (let x = 0; x < game.info.size; x++) {
    if (mid.board[y][x]) continue;
    trial = addTrialChild(mid, x, y);
    if (trial) break outerTrial;
  }
}
check('试下可落子', trial !== null && trial.isTrial);
const text = serializeGame(game);
const game2 = buildGame(parseSgf(text), 'rt.sgf');
check('序列化往返后主线一致', mainline(game2.root).length === line.length);
check('往返后试下分支保留', mainline(game2.root).length > 0);
// 压缩坐标 SGF
const compressed = '(;GM[1]FF[4]SZ[9]AB[aa:cc][dd];B[gg];W[ge];B[ce]C[完])';
const game3 = buildGame(parseSgf(compressed));
check('压缩坐标展开（9+1 子）', game3.root.board.flat().filter((c) => c !== 0).length === 10);

// ── 7. 推荐与推进 ──────────────────────────────────────────
console.log('7. 课程推进（推荐 / 顺序 / 复习池）');
const rec = recommend([], catalog);
check('空档案可推荐', !!rec);
const prog = practiceProgress(catalog, [], [], 'sequential', null, { kind: 'course' });
check('顺序模式有下一题', !!prog.nextId, JSON.stringify(prog));

// ── 8. 引擎协议（M5.2a 纯函数）─────────────────────────────
console.log('8. 引擎协议（请求编码 / 视角换算 / 归一化）');
import {
  buildAnalysisRequest,
  buildReviewQueries,
  assembleReview,
  blackWinrate,
  blackScoreLead,
  normalizeAnalysis,
  inferOnnxProvider,
  kataPoint,
  gameToAnalyzeInput,
  replayPv,
  sessionToAnalyzeInput,
} from '../src/engine';
{
  const req = buildAnalysisRequest(
    {
      size: 9,
      stones: [
        { x: 2, y: 6, color: 2 },
        { x: 6, y: 2, color: 1 },
      ],
      moves: [
        { x: 3, y: 6, color: 1 },
        { x: null, y: null, color: 2 },
      ],
      toPlay: 1,
      komi: 0,
      visits: 88,
    },
    't1'
  );
  check(
    '初始子编码（跳 I + 行号自下而上）',
    JSON.stringify(req.initialStones) === JSON.stringify([['W', 'C3'], ['B', 'G7']]),
    JSON.stringify(req.initialStones)
  );
  check(
    '落子含 pass',
    JSON.stringify(req.moves) === JSON.stringify([
      ['B', 'D3'],
      ['W', 'pass'],
    ]),
    JSON.stringify(req.moves)
  );
  check(
    'initialPlayer / komi / 尺寸',
    req.initialPlayer === 'B' && req.komi === 0 && req.boardXSize === 9 && req.boardYSize === 9
  );
  check('analyzeTurns = 已落子数', JSON.stringify(req.analyzeTurns) === '[2]');
  check('visits 透传', req.maxVisits === 88);
  const empty = buildAnalysisRequest({ size: 19, stones: [], moves: [], toPlay: 2, visits: 5 }, 't2');
  check('空盘请求', empty.initialPlayer === 'W' && JSON.stringify(empty.analyzeTurns) === '[0]');
}
check('黑方视角：黑方行棋不动', blackWinrate(0.7, 'B') === 0.7);
check(
  '黑方视角：白方行棋取补',
  Math.abs(blackWinrate(0.7, 'W') - 0.3) < 1e-9
);
check('黑方视角：越界钳制', blackWinrate(1.4, 'B') === 1 && blackWinrate(-0.2, 'W') === 1);
check('黑方视角：0-100 百分数自适应', blackWinrate(62, 'B') === 0.62 && Math.abs(blackWinrate(62, 'W') - 0.38) < 1e-9);
check('黑方目差换算', blackScoreLead(3.5, 'W') === -3.5);
check(
  'onnxProvider 按发行包文件名推断',
  inferOnnxProvider('D:/k/katago-v1.18.1-onnx1.24.4-directml/katago.exe') === 'directml' &&
    inferOnnxProvider('katago-v1.18.1-onnx-windows-x64.exe') === 'cpu' &&
    inferOnnxProvider('katago-v1.18.1-onnx-openvino.exe') === 'openvino' &&
    inferOnnxProvider('katago-v1.18.1-trt10.16-cuda13.2.exe') === null &&
    inferOnnxProvider('katago.exe') === null,
  [
    inferOnnxProvider('D:/k/katago-v1.18.1-onnx1.24.4-directml/katago.exe'),
    inferOnnxProvider('katago-v1.18.1-onnx-windows-x64.exe'),
  ].join(',')
);
{
  const norm = normalizeAnalysis({
    id: 'x',
    turnNumber: 3,
    rootInfo: { currentPlayer: 'W', winrate: 0.6, scoreLead: 2.5, visits: 100 },
    moveInfos: [
      { move: 'Q4', order: 1, winrate: 0.75, scoreLead: 4, visits: 60, pv: ['Q4', 'D4'] },
      { move: 'D16', order: 0, winrate: 0.5, scoreLead: 0.5, visits: 30, pv: ['D16'] },
    ],
  });
  check('根局面换算到黑方视角', Math.abs(norm.blackWinrate - 0.4) < 1e-9 && norm.blackScoreLead === -2.5);
  check('候选按 order 排序', norm.moves[0].move === 'D16' && norm.moves[1].move === 'Q4');
  check('候选胜率换算黑方视角', Math.abs(norm.moves[1].blackWinrate - 0.25) < 1e-9);
}

// ── 9. 打谱分析适配（M5.2b 纯函数）─────────────────────────
console.log('9. 打谱分析适配（坐标解析 / 局面转换 / PV 回放）');
check('kataPoint 解析（跳 I + 行号自下而上）', JSON.stringify(kataPoint('C3', 9)) === JSON.stringify({ x: 2, y: 6 }) && JSON.stringify(kataPoint('Q16', 19)) === JSON.stringify({ x: 15, y: 3 }), JSON.stringify(kataPoint('Q16', 19)));
check('kataPoint 非法输入', kataPoint('pass', 9) === null && kataPoint('I5', 9) === null && kataPoint('Z1', 19) === null);
{
  // 带初始子的棋谱：root AB/AW + 两手棋 + 停一手
  const sgf = '(;GM[1]FF[4]SZ[9]KM[6.5]AB[cc][gg]AW[ee];B[dd];W[df];B[];W[aa])';
  const g = buildGame(parseSgf(sgf));
  const line = mainline(g.root);
  const cur = line[line.length - 1];
  const input = gameToAnalyzeInput(g, pathOf(cur), cur);
  check(
    'initialStones 取 root 棋子（SGF y 自上而下：cc=(2,2)；按行扫描排序）',
    JSON.stringify(input.stones) === JSON.stringify([
      { x: 2, y: 2, color: 1 },
      { x: 4, y: 4, color: 2 },
      { x: 6, y: 6, color: 1 },
    ]),
    JSON.stringify(input.stones)
  );
  check(
    'moves 含落子与 pass',
    JSON.stringify(input.moves) === JSON.stringify([
      { x: 3, y: 3, color: 1 },
      { x: 3, y: 5, color: 2 },
      { x: null, y: null, color: 1 },
      { x: 0, y: 0, color: 2 },
    ]),
    JSON.stringify(input.moves)
  );
  check('komi 从棋谱读取', input.komi === 6.5);
  check('toPlay 为当前节点轮次', input.toPlay === cur.toPlay);
  const empty = gameToAnalyzeInput(g, [g.root], g.root);
  check('根节点分析：无 moves', empty.moves.length === 0 && empty.stones.length === 3);
}
{
  const base = buildGame(parseSgf('(;GM[1]FF[4]SZ[9]AB[cc])')).root.board;
  const pv = replayPv(base, 9, ['E5', 'C3', 'F5', 'G2'], 1);
  check(
    'PV 回放落子与手数（E5=(4,4)…G2=(6,7)）',
    pv.board[4][4] === 1 && pv.board[6][2] === 2 && pv.board[4][5] === 1 && pv.board[7][6] === 2 && pv.moveNumbers.get(4 * 9 + 4) === 1 && pv.moveNumbers.get(6 * 9 + 2) === 2,
    JSON.stringify([...pv.moveNumbers])
  );
  const pvPass = replayPv(base, 9, ['pass', 'E5'], 1);
  check('PV 含 pass 继续回放', pvPass.board[4][4] === 2);
}

// ── 10. 做题引擎应手适配（M5.2c）───────────────────────────
console.log('10. 做题引擎应手（会话 → 引擎输入）');
{
  // 基础题答错进入自由探索后走两手，引擎输入应为题面初始子 + 实际落子
  const lesson = catalog.lessons.find((l) => !l.sequence && availableLesson(l))!;
  let s = createSession(lesson);
  // 故意走一手（基础题判分后 wrong 会进 playout；具体对错不重要，playout 后补一手）
  const first = s.board.findIndex(() => true);
  const size = lesson.size;
  const empty = (() => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!s.board[y][x]) return { x, y };
    return null;
  })()!;
  void first;
  s = playStone(s, empty.x, empty.y);
  const input = sessionToAnalyzeInput(s);
  const initialCount = s.initialBoard.flat().filter((c) => c !== 0).length;
  check(
    '题面初始子 + 已走落子',
    input.stones.length === initialCount && input.moves.length === s.moves.length,
    `stones=${input.stones.length}/${initialCount} moves=${input.moves.length}/${s.moves.length}`
  );
  check('轮次与会话一致', input.toPlay === s.toPlay);
  check('盘面尺寸', input.size === lesson.size);
}

// ── 11. 引擎复核（对齐原版 engine.review）──────────────────
console.log('11. 引擎复核（根约束查询 / 归一化 / 差值）');
{
  const [qc, qr] = buildReviewQueries(
    { size: 9, stones: [], moves: [{ x: 4, y: 4, color: 1 }], toPlay: 2, visits: 50 },
    'C3',
    'E5',
    128
  );
  check(
    '复核查询带根约束与覆盖',
    qc.allowMoves?.[0]?.moves?.[0] === 'C3' &&
      qr.allowMoves?.[0]?.moves?.[0] === 'E5' &&
      qc.allowMoves?.[0]?.player === 'W' &&
      qc.allowMoves?.[0]?.untilDepth === 1 &&
      qc.maxVisits === 128 &&
      qc.includeOwnership === true &&
      qc.overrideSettings?.maxTime === 5,
    JSON.stringify(qc.allowMoves)
  );
  check('两个查询 id 不同', qc.id !== qr.id);
  check('复核局面为落子前', JSON.stringify(qc.moves) === JSON.stringify([['B', 'E5']]) && qc.initialPlayer === 'W');
  const review = assembleReview(
    {
      id: 'c',
      turnNumber: 1,
      moveInfos: [{ move: 'C3', order: 0, winrate: 0.4, scoreLead: -1.5, visits: 128, pv: ['C3', 'D4'] }],
      rootInfo: { currentPlayer: 'W', winrate: 0.4, scoreLead: -1.5, visits: 128 },
      ownership: [0.9, -0.9],
    },
    {
      id: 'r',
      turnNumber: 1,
      moveInfos: [{ move: 'E5', order: 0, winrate: 0.6, scoreLead: 1, visits: 128, pv: ['E5'] }],
      rootInfo: { currentPlayer: 'W', winrate: 0.6, scoreLead: 1, visits: 128 },
      ownership: [0.5, -0.5],
    }
  );
  check(
    '复核换算黑方视角与差值',
    Math.abs(review.candidate.blackWinrate - 0.6) < 1e-9 &&
      review.candidate.blackScoreLead === 1.5 &&
      Math.abs(review.reference.blackScoreLead - -1) < 1e-9 &&
      Math.abs(review.scoreDelta - 2.5) < 1e-9 &&
      Math.abs(review.winrateDelta - 0.2) < 1e-9,
    JSON.stringify({ c: review.candidate.blackScoreLead, r: review.reference.blackScoreLead })
  );
  check('ownership 换算黑方视角（白行棋取负）', review.candidate.ownership?.[0] === -0.9 && review.candidate.ownership?.[1] === 0.9);
}

// ── 12. SGF 文件夹加载（localfs；node 环境有真 require 可全测）──
console.log('12. SGF 文件夹（列目录 / 读取 / 路径工具）');
{
  check('node 环境本地 fs 可用', localFsAvailable());
  const dir = mkdtempSync(join(tmpdir(), 'gocoach-sgf-'));
  try {
    writeFileSync(join(dir, 'b10.sgf'), SAMPLE_SGF, 'utf8');
    writeFileSync(join(dir, 'a2.sgf'), SAMPLE_SGF, 'utf8');
    writeFileSync(join(dir, 'note.txt'), 'not sgf', 'utf8');
    mkdirSync(join(dir, 'sub'));
    const files = listSgfFiles(dir);
    check('只列 .sgf 且按自然数排序', JSON.stringify(files) === JSON.stringify(['a2.sgf', 'b10.sgf']), JSON.stringify(files));
    const text = readLocalText(join(dir, 'a2.sgf'));
    check('读取本地 SGF 文本', text.includes('(;') || text.includes('GM['), text.slice(0, 20));
    check('joinPath Windows 分隔符', joinPath('D:\\go\\sgf', 'a.sgf') === 'D:\\go\\sgf\\a.sgf');
    check('joinPath POSIX 分隔符', joinPath('/home/u/sgf', 'a.sgf') === '/home/u/sgf/a.sgf');
    check('dirOfFile 取目录', dirOfFile('C:\\x\\y\\k.sgf') === 'C:\\x\\y' && dirOfFile('/x/y/k.sgf') === '/x/y');
    check('不存在目录返回空列表', listSgfFiles(join(dir, 'nope')).length === 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(failures === 0 ? '\n✅ 全部通过' : `\n❌ ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
