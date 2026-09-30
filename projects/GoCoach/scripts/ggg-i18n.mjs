// Go Game Guru 题库英文解说汉化词典（离线确定性翻译，逐条人工翻译）。
// 键为归一化文本（空白折叠）；长句用唯一前缀匹配。未命中走规则兜底，
// 并保留英文原文（oe）供查看。原文版权归原作者（CC BY-NC-SA 4.0）。

const EXACT = new Map(Object.entries({
  'Correct': '正解。',
  'Correct.': '正解。',
  "Correct. It's a ko.": '正解。成劫。',
  'Also correct.': '也是正解。',
  'Also correct': '也是正解。',
  'Correct. A and B are miai for Black.': '正解。A、B 两点黑棋见合（必得其一）。',
  'Correct. Black wins the capturing race.': '正解。黑棋赢下对杀。',
  'Correct. A and B are miai.': '正解。A、B 两点见合（必得其一）。',
  "Correct, it's a ko.": '正解。成劫。',
  "Correct. It's double ko, and Black's alive.": '正解。这是双劫，黑棋已活。',
  'Correct. Even if White plays at A, Black is already alive in seki.': '正解。即使白棋下 A，黑棋也已双活。',
  'Correct. Black lives in seki.': '正解。黑棋双活。',
  'Correct. White A will be captured.': '正解。白棋 A 位之子终将被提。',
  "Correct, White shouldn't play A.": '正解，白棋不应下 A。',
  'Correct. Ko is the best solution.': '正解。打劫是最佳解。',
  "Also correct, but there's a slightly better way of playing.": '也是正解，但有稍优的下法。',
  "Correct. White can't save the cutting stones.": '正解。白棋救不回被断开的棋子。',
  "Correct. It's a ladder.": '正解。这是征子。',
  'Correct. Now both groups are alive in seki.': '正解。现在两块棋都成双活。',
  'Correct. Black captures the cutting stones.': '正解。黑棋提掉被断的棋子。',
  'Correct. A and B are still miai for Black.': '正解。A、B 两点对黑棋仍是见合。',
  'Correct. Next A and B are miai for Black.': '正解。接下来 A、B 两点黑棋见合。',
  "Correct. It's better for Black.": '正解。这样对黑棋更有利。',
  'Correct. White needs one more move at M3.': '正解。白棋还差 M3 一手棋。',
  'Correct. A and B are miai next.': '正解。接下来 A、B 见合。',
  "Correct. White's stones are captured.": '正解。白棋（标记的）子被提。',
  "Correct. White is dead.": '正解。白棋已死。',
  'Correct. A and B are still miai.': '正解。A、B 两点仍然见合。',
  'This is also correct.': '这步也是正解。',
  "Correct. It's a seki.": '正解。这是双活。',
  "Correct. White's dead.": '正解。白棋死了。',
  "Correct. White's dead now.": '正解。白棋现在死了。',
  'Correct. This is also possible.': '正解。这样下也可以。',
  'Correct. The result is favorable for Black.': '正解。结果对黑棋有利。',
  'Correct. The result is good for Black.': '正解。结果对黑棋好。',
  "Correct. It's a kind of joseki.": '正解。这可以说是定式一型。',
  'Correct. White needs to answer at S7.': '正解。白棋必须在 S7 应一手。',
  "Correct. White's marked stones are captured.": '正解。白棋标记的棋子被提。',
  "Correct. It's a net.": '正解。这是枷吃。',
  'Correct, ko is the best result for Black.': '正解，劫争是黑棋最好的结果。',
  "Correct. Black can make a ko.": '正解。黑棋可以制造劫争。',
  "Correct. It's a one step ko.": '正解。这是单劫（一步劫）。',
  'Correct. White A was too greedy.': '正解。白棋 A 位太贪。',
  'Correct. A and B are miai Black.': '正解。A、B 两点黑棋见合。',
  'Correct. Black is alive in seki.': '正解。黑棋双活。',
  "Correct. Black has a ko for life.": '正解。黑棋有做活之劫。',
  "Correct. Black lives without ko, because of White's mistake at A.": '正解。由于白棋 A 位失误，黑棋无需打劫即活。',
  "Correct. White can't escape.": '正解。白棋逃不出去。',
  "Correct. White can't live, even though she captured seven Black stones.": '正解。白棋即便提掉黑棋七子也无法做活。',
  "Correct. Black's stones are connected.": '正解。黑棋已连通。',
  "Correct. Black can capture White's three stones.": '正解。黑棋能提掉白棋三子。',
  'Correct. A and B are miai for Black. White\'s is dead.': '正解。A、B 两点黑棋见合，白棋已死。',
  "Correct. White still has to play A.": '正解。白棋仍然必须下 A。',
  "Correct. Now Black can escape into the center.": '正解。现在黑棋可以向中腹逃出。',
  "Correct. White doesn't have any ko threats.": '正解。白棋没有劫材。',
  'Correct. This ko is the best result for both.': '正解。这个劫对双方都是最好结果。',
  'Correct. However, the atari at A isn\'t necessary.': '正解。不过 A 位的打吃并不必要。',
  'Correct. Black can leave the atari at A as a ko threat.': '正解。黑棋可把 A 位打吃留作劫材。',
  'Correct. Even if White captures at A, she can only make one eye by doing so.': '正解。白棋即使在 A 提子，也只能做出一只眼。',
  "Correct. Even if White connects at A, her stones are already dead because B and C are miai.": '正解。白棋即使 A 位粘上，因 B、C 见合，这块棋也已经死了。',
  "Correct. Even if White connects at A, her stones are already dead because Black can play at B at anytime.": '正解。白棋即使 A 位粘上，黑棋随时可下 B，这块棋也已死。',
  "Correct. White can't stop Black from capturing the marked stones.": '正解。白棋无法阻止黑棋提掉标记的棋子。',
  'Correct. White only has two liberties and all of Black\'s groups have more than that. No matter what White does next, Black can atari.': '正解。白棋只有两口气，而黑棋各块气都更多。无论白棋怎么下，黑棋都能打吃。',
  "Correct. Now White doesn't have enough liberties to atari at A.": '正解。现在白棋气不够，无法在 A 打吃。',
  "Correct. White doesn't have enough liberties to atari at A or B, so Black will win the capturing race.": '正解。白棋的气不足以在 A 或 B 打吃，黑棋将赢下对杀。',
  "Correct. White's caught in a ladder.": '正解。白棋被征住了。',
  "Correct. White's three stones in the center are isolated.": '正解。白棋中腹三子已被分割孤立。',
  'Correct. A and B are miai for Black, so White\'s cutting stones are captured.': '正解。A、B 两点黑棋见合，白棋被断的棋子被提。',
  'Correct. Black captures White\'s four cutting stones.': '正解。黑棋提掉白棋四颗被断的子。',
  'Correct. Now A and B (killing the corner) are miai for Black.': '正解。现在 A（杀角）与 B 对黑棋见合。',
  'Correct. If White plays A, Black can just play B (or atari at C in some situations). White can\'t make two eyes.': '正解。白棋若下 A，黑棋下 B 即可（某些场合也可在 C 打吃）。白棋做不出两只眼。',
  "Correct. Now Black's alive in seki. If White tries to play A or B, Black can capture and make two eyes.": '正解。现在黑棋双活。白棋若强行下 A 或 B，黑棋提子后可做出两眼。',
  'Correct. This is the best shape, because it gives Black the best potential for making eyes later. A and B are miai for Black now. If White tries to play A-C, Black D captures White\'s stones.': '正解。这是最佳棋形，黑棋日后做眼潜力最好。A、B 现在对黑见合；白棋若走 A—C，黑 D 提掉白子。',
  "Correct. White has one eye and one false eye.": '正解。白棋一只真眼一只假眼。',
  'Correct. Now, even if White captures the four stones, it won\'t be possible to make two eyes.': '正解。现在白棋即使提掉这四子，也做不出两只眼。',
  "Correct. Black lives with two eyes.": '正解。黑棋两眼活棋。',
  'Correct. If White plays at A Black can capture at B. If White plays at B, Black connects at A, so Black\'s alive with two eyes.': '正解。白下 A 黑提 B；白下 B 黑粘 A，黑棋两眼活。',
  "Correct. White can't cut at A because she'll atari herself.": '正解。白棋不能在 A 断，否则会自己被打吃。',
  'Correct A and B are miai for Black now.': '正解。现在 A、B 两点黑棋见合。',
  "Correct. It's not best though.": '正解。不过并非最佳。',
  'Correct, but not the best. White has one more liberty.': '正解，但不是最佳。白棋多出一口气。',
  'Correct. There\'s still a potential ko in the corner, but it\'s usually fairly light for Black.': '正解。角上仍留有一个潜在的劫，但对黑棋通常很轻。',
  'Correct. Black A will be a useful forcing move later.': '正解。黑棋 A 位之后会是很有用的先手。',
  'Also correct. This is possible, but there\'s a slightly better way for Black to play.': '也是正解。这样可行，但黑棋有稍优的下法。',
  'Correct. It\'s a ko, but Black should exchange of A for B as a ko threat.': '正解。是劫，但黑棋应先做 A、B 交换留作劫材。',
  'Correct. It\'s a ko. If White connects at A, Black can continue with the atari at B.': '正解。是劫。白棋若 A 粘，黑棋可继续 B 位打吃。',
  'Correct. This result is very good for Black because White made a mistake.': '正解。因白棋失误，这个结果对黑棋非常好。',
  'Correct. Black can play around A or B later.': '正解。黑棋以后可在 A 或 B 附近行棋。',
  'Correct. White should defend at A next, but Black can still attach at B later.': '正解。白棋接下来应在 A 补，但黑棋之后仍可在 B 位靠。',
  'Correct. White should defend at A next.': '正解。白棋接下来应在 A 补一手。',
  'Also correct and it\'s still a ko. However, this variation loses some points compared to the best solution.': '也是正解，仍是劫。不过与最佳解相比，这个变化损了几目棋。',
  'Correct. A and B are miai for Black next.': '正解。接下来 A、B 两点黑棋见合。',
  'This White move is too greedy...': '白棋这一手太贪了……',
  'This is the vital point.': '这是要点。',
  "Good move, this makes White's eyespace as small as possible.": '好手，这样把白棋的眼位压缩到最小。',
  "Now White can't play here, right?": '现在白棋这里下不进了，对吧？',
  "White can't play here either...": '白棋这里同样下不进……',
  "White can't get more liberties, so this doesn't change anything...": '白棋长不出更多的气，所以于事无补……',
  "White can't play here...": '白棋这里下不进……',
  'Good timing': '时机正好。',
  'This is the key move. It looks like bad shape, but it\'s a powerful technique in this situation.': '这是关键一手。棋形看着笨重，但在本局面是强手。',
  'If White plays like this...': '白棋若这样下……',
  'If White captures at A...': '白棋若在 A 提……',
  'If White resists like this...': '白棋若这样顽抗……',
  'If White tries to avoid the ko...': '白棋若想避劫……',
  'If Black plays here...': '黑棋若下这里……',
  'For example...': '例如……',
  'Now this move is sente, and Black has to be careful. Black should have reduced White\'s eyespace on this side first.': '现在这手是先手，黑棋要当心。黑棋本应先从这边压缩白棋眼位。',
  "This is White's best response.": '这是白棋最好的应对。',
  "This is White's calmest and best response.": '这是白棋最沉着、最好的应对。',
  "This isn't White's best response, but it is the trickiest way to play.": '这不是白棋最好的应对，但最难对付。',
  "This isn't White's best move, but Black still needs to be careful...": '这不是白棋最佳的一手，但黑棋仍须小心……',
  "White can't capture Black like this...": '白棋这样提不掉黑棋……',
  "White 4 here doesn't work...": '白 4 在这里不成立……',
  "White can't save these stones...": '白棋救不了这几颗子……',
  "White can't resist like this": '白棋这样顽抗不行。',
  "White can't resist like this...": '白棋这样顽抗不行……',
  "This White move is not as good as simply capturing at A because it gives Black options.": '白棋这手不如直接在 A 提，因为它给了黑棋选择。',
  'Correct. This move (A) is sente because Black can play B next.': '正解。这手（A）是先手，因为黑棋接下来可以下 B。',
  'Correct, now White risks her whole group in a unfavorable ko.': '正解，现在白棋整块棋陷入不利的劫争。',
  'Also correct. The main solution is slightly better in this case.': '也是正解。本场合主解稍优。',
  'Also correct, White shouldn\'t fight this ko.': '也是正解，白棋不该打这个劫。',
  'Correct, but White should play the main variation.': '正解，但白棋应走主变化。',
  'Correct, White should just play this way and let Black live because trying to kill loses points.': '正解，白棋就这样下让黑活即可，硬杀反而亏损。',
  'Correct. White still has to play one more move here, so Black keeps sente or cuts with A next. White should have just played at B instead of the stone above it.': '正解。白棋这里还须再补一手，黑棋得以保留先手或接下来 A 位断。白棋当初应直接下 B 而不是上面那手。',
  "Correct. If the ladder favors White, Black can play the tesuji at A instead of playing atari at T4.": '正解。若征子有利（于白），黑棋可不下 T4 打吃，改在 A 位用手筋。',
  'Correct. White should defend with A next, so Black can take sente.': '正解。白棋接下来得 A 位补，黑棋从而夺得先手。',
  'This is also possible, but there\'s a better move.': '这样也可以，但有更好的一手。',
  'Playing atari here is a mistake for White.': '白棋在这里打吃是失误。',
  'Black should strike while the iron\'s hot and play here.': '黑棋应趁热打铁下这里。',
  'This move is tesuji in this sort of situation.': '这种局面下这手是手筋。',
  "This move is an overplay for White.": '白棋这一手过分了。',
  "It's an overplay for White to try to cut like this.": '白棋想这样断是过分之手。',
  "Correct. Now White has to fight a ko for life at A. White can't get enough liberties to avoid the ko.": '正解。现在白棋只能在 A 位打劫求活，气已不足以避开劫争。',
  "Also correct. White should fight the ko instead.": '也是正解。白棋应改为打劫。',
  'Correct, White dies because of an overplay at A.': '正解，白棋因 A 位过分之手下死了。',
  'Correct. White lost a liberty when she played A. She should play the ko instead.': '正解。白棋下 A 时损失了一口气，应当打劫。',
  "Correct. White's three stones are paralysed.": '正解。白棋三子动弹不得。',
  'Correct. Black 7 is the vital point. Now Black can fight.': '正解。黑 7 是要点，现在黑棋可以一战。',
  'Good. Black 1 is a kind of tesuji for developing Black\'s cutting stone efficiently.': '好。黑 1 是高效发展黑棋（孤）子的一种手筋。',
  'Correct. White can still fight, but Black is developing nicely.': '正解。白棋仍可一战，但黑棋发展顺畅。',
  'Correct. Black got a better result than expected because White tried too hard to resist.': '正解。因白棋顽抗过度，黑棋得到比预期更好的结果。',
  "Correct. Black's tesuji at H5 means this ladder doesn't work anymore.": '正解。黑棋 H5 的手筋让这个征子不成立了。',
  "Correct. There's no ladder this way either.": '正解。这个方向同样没有征子。',
  "White shouldn't try to pull these stones out, but how does Black handle it if she does?": '白棋本不该往外逃这几子，但若真逃了，黑棋该如何应对？',
  "White shouldn't actually play all this out, but what if she does?": '白棋实战本不会都下完，但若真这样下了呢？',
  'Correct. This is even better for Black than the main variation, because it\'s harder for White to make eyes now.': '正解。这比主变化对黑更有利，因为白棋现在更难做眼。',
  "Correct. Black's stones are split in two and Black A and B are miai next.": '正解。白棋被分成两块，接下来黑 A、B 见合。',
  'Correct, Black could also play A at B to live with one more point.': '正解，黑棋也可把 A 下在 B 位，多做一目活棋。',
  'Correct, but White just gives away two points by playing this way.': '正解，但白棋这样下白白送出两目棋。',
  'Connecting isn\'t good for White. White should fight a ko at A instead.': '粘对白棋不利，白棋应在 A 位开劫。',
  'Correct. It may look like Black\'s group only has false eyes. But Black\'s stones are all connected, so there\'s no way for White to atari Black to make him close the apparent false eye.': '正解。黑棋这块看着全是假眼，但黑子彼此连通，白棋无法通过打吃逼黑自闭假眼。',
  'Correct. It looks like White has a lot of eyespace, but White will eventually be forced to connect at A and B, so it\'s only a three point eye. White\'s dead.': '正解。白棋眼位看着很大，但终究被迫在 A、B 粘上，只剩直三眼位。白棋死了。',
  "Correct. White can't extend from atari because Black would still capture. Black's tesuji (move 3 - T5) reduced White's liberties.": '正解。白棋无法从打吃中长出，黑棋仍能提子。黑棋手筋（第 3 手 T5）紧了白棋的气。',
  'Correct. Black\'s group in the lower left is dead, but it doesn\'t matter because Black traded it for the bigger group in the lower right, which is also dead now.': '正解。黑棋左下那块死了，但无关紧要——黑棋用它交换掉了更大的右下白棋，那块现在也死了。',
  "Correct. White's eye shape is incomplete and White still owes Black a move at A.": '正解。白棋眼形不完整，还欠黑棋 A 位一手棋。',
  'Correct. This is a one step ko where Black takes first. It\'s much better for Black than the main variation because White A was a mistake.': '正解。这是黑先提的单劫。因白 A 失误，这比主变化对黑有利得多。',
  'Correct. Black can play at A and make a bulky five shape whenever he wants to (which is dead - http://senseis.xmp.net/?BulkyFive). If White plays at A, she ataris herself.': '正解。黑棋随时可在 A 位做出刀把五（是死形）。白棋若下 A 会自己被打吃。',
  'Correct. It\'s a temporary seki between the groups A and B, but Black will capture White\'s surrounding stones and the seki will collapse.': '正解。A、B 两块之间是暂时双活，但黑棋会提掉外围白子，双活随之崩溃。',
  "White shouldn't extend like this. If she does, Black can get an even better result.": '白棋不该这样长。若这样下，黑棋能得到更好的结果。',
  "If White play here, which is quite a bad move,": '白棋若下这里（相当坏的一手），',
  'Now Black can extend here, and': '现在黑棋可以在这里长，',
  'This is a bad move for White...': '这是白棋的坏棋……',
  'This move is a mistake for White too.': '这手对白棋同样是失误。',
  "This isn't good enough for White...": '这样下对白棋不够好……',
  "Correct. It's better for Black.": '正解。这样对黑棋更有利。',
  'Also correct, but not ideal.': '也是正解，但不算理想。',
  'Also correct, Black\'s last move could also be at A.': '也是正解，黑棋最后一手也可下在 A。',
  'Also correct. The main solution is slightly better because White won\'t actually play this sequence out, but will look for a way to trade instead.': '也是正解。主解稍优：白棋实战不会真下完这个序列，而是寻求转换。',
  'Correct. Black took control of the center because White struggled with A. Whatever White does next, there\'s still some life in Black B.': '正解。白棋 A 位挣扎后，黑棋掌控了中腹。无论白棋接下来怎么下，黑 B 处仍有余味。',
  'Correct. Black takes the center, so White doesn\'t play L2. This is a solid and clear way to play.': '正解。黑棋取得中腹，白棋也就不下 L2 了。这是坚实清晰的下法。',
  'Also correct. Black A is slightly better than B.': '也是正解。黑下 A 比下 B 稍好。',
  'Correct. Even if White plays at A next, Black\'s still alive in seki: http://senseis.xmp.net/?seki': '正解。白棋接下来即使下 A，黑棋仍成双活。',
  "Correct. Black's unconditionally alive because White made a mistake with A.": '正解。由于白棋 A 位失误，黑棋无条件活棋。',
  'Correct, Black was able to kill without ko, because White made a mistake.': '正解，因白棋失误，黑棋无需打劫就杀了白。',
  "Correct. It's a bent four in the corner (http://senseis.xmp.net/?BentFourInTheCorner).": '正解。这是角上的盘角曲四。',
  'Correct. It\'s a bent four in the corner: http://senseis.xmp.net/?BentFourInTheCorner': '正解。这是角上的盘角曲四。',
  'Correct, White should fight the ko in the main variation.': '正解，白棋应在主变化里打这个劫。',
  "Correct, White shouldn't play this way.": '正解，白棋不该这样下。',
  'Correct. It\'s a ko and this is the best solution for Black because he takes the ko first.': '正解。是劫，且黑棋先提劫，这是黑棋的最佳解。',
}));

// 长句：用唯一前缀匹配（键须短于原句且不与其他原句开头冲突）
const PREFIX = [
  ["Also correct. White may still peep at A later", '也是正解。不过白棋之后还可能在 A 位刺，在别处制造征子，所以通常按主变化下更好。'],
  ['Also correct. Playing this move at A is usually better style', '也是正解。这一手下在 A 通常棋形更好，因为在外侧留下的余味（坏味）更少。'],
  ['Also correct. Playing A at B is better style though', '也是正解。不过 A 下在 B 位棋形更好：白棋日后可能把 C 当劫材。若你不应这个劫，你更愿意损失两子还是三子？'],
  ['Correct. If White plays A next, Black B through F is good for Black', '正解。白棋若接着下 A，黑 B 至 F 的下法对黑有利。白棋被断的棋子气很短，黑棋可以一战。'],
  ['Correct. Black doesn\'t have to start this sort of ko immediately', '正解。黑棋不必立刻开这个劫，不妨留作定时炸弹。白棋若自补，黑棋就能在别处连走两手。'],
  ['Correct. Black can break out into the center', '正解。黑棋可以向中腹突破。黑棋不必急着做 A、B 交换，那会让白棋变强，还消除黑 C、D 等其他选择。'],
  ['Correct. Even if White plays at A now, the groups at A and B are in a temporary seki', '正解。白棋现在即使下 A，A、B 两块之间也只是暂时双活；由于外围白子终将被提，白棋是死的。'],
  ["Correct. White's dead. Sometimes in actual games", '正解。白棋死了。实战中白棋有时可以不打劫而这样下：例如当黑棋外围棋子卷入对杀时，白棋可考虑本变化。局部白死，但棋形气很多。'],
  ['Also correct. Playing like this can sometimes be ok for Black', '也是正解。这样下对黑棋有时也可以，但总体上你多半不愿让白棋在外侧形成这么大的势力。'],
  ['If White plays atari like this, it just helps Black gain momentum', '白棋这样打吃只会助长黑棋气势。白棋若继续 A 位压，黑棋 B 位长即可，C、D 仍对黑见合。'],
  ['Correct. White can capture two stones at A next', '正解。白棋接下来可在 A 提两子，但角上原本已活，那两子并不重要。提子后黑应下 B，C 留作劫材。'],
  ['Correct. This is even worse for White, because there\'s still a capturing race at the bottom', '正解。这对白棋更糟：下面还有对杀（谁先下 A 谁赢），且白棋右下大块已受损。'],
  ['Also correct. Black made some unnecessary exchanges', '也是正解。黑棋做了些不必要的交换。下得更轻灵一些，能为日后保留更多变化。'],
  ["Also correct, but there's a slightly better way. You'd prefer to keep Black A", '也是正解，但有稍优的下法。可能的话你更愿意保留黑 A 在盘上而不是黑 B，因为黑 A 的余味更多。'],
  ['Correct. White can still attack like this (starting with A)', '正解。白棋仍可这样攻击（从 A 开始），但黑棋已迫使白棋牺牲两子，右边黑棋因此厚实得多。'],
  ['Black plays tesuji here and White can\'t save the cutting stones', '黑棋在这里用手筋，白棋救不回被断的子。无论白棋接下来怎么下，A、B 都对黑见合。'],
  ['Correct. White still has to live with A', '正解。白棋仍须 A 位做活，黑棋还能再下 B，进一步损伤外围白子。'],
  ['Correct. If White struggles like an octopus in a kettle', '正解。白棋若像热锅上的章鱼般挣扎，黑的松散外势自然就走厚了。请留意黑棋各子（A 等）之间的配合关系。'],
  ['Also correct. Compared to the main variation, this one is second best', '也是正解。与主变化相比这是次优：黑 1 时白会考虑下 A（见该变化）。'],
  ['Correct Locally Black has lots more ko threats', '正解。局部黑棋劫材多得多（从 A 开始）。黑赢得劫后，外围白子将非常单薄。'],
  ['Correct It\'s not easy for White to answer this move', '正解。白棋很难应对这一手。黑棋在此先手便宜后，仍可在 A 位开劫。'],
  ['Correct. White will continue with A or B, but this result is satisfactory for Black', '正解。白棋会接着下 A 或 B，但这个结果黑棋可以满意。'],
  ['Correct, but note that White can still connect under by playing A next', '正解。但注意白棋接下来仍可 A 位从下面连通，所以黑棋不该在一线打吃，宁愿日后再 B 位打。'],
  ['Correct. Exchanging A for B could be better for Black in this case', '正解。本场合先做 A、B 交换对黑可能更好，因为左下由此多出两个劫材（从 C 开始）。'],
  ['Correct. After White recaptures the ko at A', '正解。白棋（先找劫材后）在 A 位提回劫后：黑 B、白 C、黑 D。这是对黑有利的单劫。'],
  ['Correct. Now White has to fight a ko for life at A', '正解。现在白棋只能在 A 位打劫求活，气已不足以避开劫争。'],
  ['In a real game White would just play here', '实战中白棋就会直接下这里：现在已经杀不死黑棋，硬杀只会亏损。'],
  ['Correct. If Black throws in at R1 earlier in this sequence', '正解。本序列中黑棋若早一步在 R1 扑，白棋因最终还得粘回会再多损失两目。现在白不必粘了。'],
  ['Correct. Black took control of the center because White struggled with A', '正解。白棋 A 位挣扎后黑棋掌控中腹。无论白接下来怎么下，黑 B 处仍有余味。'],
  ["If White's happy to give up the center stones", '白棋若舍得放弃中腹数子，也可以考虑这一手。未必更好，但黑棋须当心。'],
  ['In a real game, White would probably want to play like this', '实战中白棋多半愿意这样下：先手加强自身。主变化虽是白棋最强的抵抗，结果也差不多。'],
  ['Also correct. Black wins the capturing race but White\'s dead stones still have two liberties', '也是正解。黑棋赢下对杀，但白的死子还剩两口气。A 位有弱点，若开战黑须当心。'],
  ['Also correct. White can make a ko (with ko captures at A and B)', '也是正解。白棋此时可成劫（A、B 位来回提劫），但黑棋外气太多，这个劫意义不大。'],
  ['Also correct. Playing this move at A is slightly more certain', '也是正解。下在 A 稍稳妥，且沿边连通黑棋。白棋可能现在 A 位粘并试图杀黑。'],
  ['Also correct. The main solution is slightly better', '也是正解。主解稍优：白棋实战不会真的下完这个序列，而会寻求转换。F3 位的扑是……'],
];

const PREFIX_RULES = PREFIX.map(([en, zh]) => [en.trim(), zh]);


EXACT.set('Correct. White will continue with A or B, but this result is satisfactory for Black. Later Black can push through with C.', '正解。白棋会接着下 A 或 B，但这个结果黑棋可以满意，之后还能 C 位冲出。');
// 补充词典（键从 _ggg-misses.json 程序化复制，逐条人工翻译）
const EXTRA = { "Correct, if Black ignores A, White can play at B.": "正解，黑棋若不应 A，白棋可下 B。", "This move isn't good.": "这手棋不好。", "Also correct, but playing the last move at A would be better.": "也是正解，但最后一手下在 A 更好。", "Correct, White's three stones are paralysed.": "正解，白棋三子动弹不得。", "If White insists on playing like this...": "白棋若坚持这样下……", "Capturing here isn't good for White...": "白棋在这里提子不好……", "Correct Black can develop smoothly by pressing White like this.": "正解，黑棋这样压着白棋即可顺畅发展。", "Correct If White extends to A, Black just keeps extending to B and so on. Black's corner's already alive.": "正解。白棋若往 A 长，黑棋就在 B 继续挡长即可，黑角早已活了。", "Also correct. The exchange of A for B is unnecessary though, and probably more helpful for White at this time.": "也是正解。不过 A、B 交换并无必要，眼下对白棋或许更有帮助。", "Also correct, but there's a better move.": "也是正解，但有更好的一手。", "If White plays here...": "白棋若下这里……", "Correct. Black's group in the lower left is dead, but it doesn't matter because Black traded it for the bigger group in the lower right, which is also dead now. If White plays A, Black can just answer at B, then White has to worry about C.": "正解。黑棋左下那块死了，但无关紧要——黑棋用它交换掉了更大的右下白棋，那块现在也死了。白若 A，黑 B 应即可，白还须提防 C。", "In actual play, White might decide to resist like this, but": "实战中白棋或许会决定这样顽抗，但是——", "Correct. Black moves out in the lower right.": "正解。黑棋向右下出头。", "Black still takes the corner.": "黑棋仍然拿到角地。", "This is very nice point for enclosing Black's group, but": "这是封锁黑棋的好点，但是——", "Correct. Black captured the cutting stones.": "正解。黑棋提掉了被断的棋子。", "Also correct. Black captured the cutting stones. This variation is second best.": "也是正解。黑棋提掉了被断的棋子，此变化稍逊于正解。", "Correct. White died completely because of 5 (P2).": "正解。因为白 5（P2），白棋彻底死了。", "White should fall back here.": "白棋应该在这里退缩收敛。", "Correct. Black made shape successfully.": "正解。黑棋整形成功。", "This is an interesting idea, but it's an overplay in this case.": "想法有趣，但在本局面是过分之手。", "Correct. Black has escaped.": "正解。黑棋已经逃出。", "This looks like a good move for White, but it's not in this case.": "这手看着对白棋不错，但本局面并非如此。", "Also correct, but giving up Black's two stones is unnecessary and loses about 5-6 points compared to the main variation.": "也是正解，但弃掉黑棋两子并无必要，比主变化损失约 5–6 目。", "Correct. It's a good time to exchange A for B before making two eyes here, but that's a small detail.": "正解。在这里做两眼之前先做 A、B 交换时机正好，不过这只是小细节。", "Correct. Black's alive.": "正解。黑棋活了。", "Correct. Black A is already played on the vital point of White's shape.": "正解。黑 A 已经下在白棋棋形的要点上。", "Correct. If Black had exchanged A for B earlier, it would be slightly better now, but that's a minor detail.": "正解。黑棋若早先做过 A、B 交换，现在会稍好一些，不过无伤大雅。", "Also correct. The variations aren't duplicated for this branch. In the main variation, Black plays A first instead.": "也是正解。此分支不再重复列出变化；主变化中黑棋先下 A。", "White might also play here, then...": "白棋也可能下这里，那么……" };
for (const [k, v] of Object.entries(EXTRA)) EXACT.set(k, v);


// 严格复检补充（27 条漏网：兜底做过术语替换后含中文，被旧检查误判已覆盖）
const EXTRA2 = {"Correct. Even if White connects at A next, she'll lose the capturing race because it's 'one eye vs no eye'.":"正解。白棋接下来即使 A 位粘上，也会输掉对杀——这是\"有眼杀无眼\"。",
  "Correct. Black can also tenuki now, but this move is quite big. Black can play at A next.":"正解。黑棋现在也可以脱先，但这一手价值不小，之后可以下 A。",
  "Correct. White's stones are split in two and Black A and B are miai next.":"正解。白棋被分成两块，接下来黑 A、B 见合。",
  "Correct. Black could also tenuki now because A also lives.":"正解。黑棋现在也可以脱先，因为 A 位同样能活。",
  "If White's going to play here, this move is better, but it's better to leave this as a ko threat.":"白棋若一定要下这里，这手更好，但最好把它留作劫材。",
  "Correct. If Black doesn't have enough ko threats, Black can just play here too.":"正解。若黑棋劫材不够，直接下这里也可以。",
  "Correct. It may look like Black's group only has false eyes. But Black's stones are all connected, so there's no way for White to atari Black to make him close the apparently 'false' eyes. In fact, since an eye is really just a liberty inside a group of stones that are all connected around the outside, Black actually has plenty of eyes, and lives with at least 9 points in this special case.":"正解。黑棋这块看着全是假眼，但黑子彼此连通，白棋无法通过打吃逼黑棋闭合那些表面上的\"假眼\"。眼本质上就是整块连通棋内部的气，本特例中黑棋眼位其实很充足，至少可以 9 目以上活棋。",
  "Correct. Ko is the best result for Black.":"正解。劫争是黑棋最好的结果。",
  "Correct. White should fight the ko instead.":"正解。白棋应改为打劫。",
  "Correct, Black lives without ko.":"正解，黑棋无需打劫即活。",
  "Black can take the corner in sente, and":"黑棋可以以先手拿住角地，而且——",
  "White can take sente by playing like this, but then":"白棋这样下可获先手，但是——",
  "Now Black can play these moves in sente, and":"现在黑棋可以先用先手走完这几手，而且——",
  "Correct. White's eye shape is incomplete and White still owes Black a move at A. Later, if Black plays A, he can try to capture White, but Black needs to either be alive first, or have 10 liberties to win a capturing race. White's liberty count after A, H1, H2 is: 8 liberties for the 5 space big eye, -1 for the stone at H2, +2 external liberties = 9 liberties and sente. Note that Black can exchange E1 for F1 in sente, because it threatens to collapse White's big eye into a four shape. So you should assume E1 and F1 have already been played when counting liberties in this case.":"正解。白棋眼形不完整，还欠黑棋 A 位一手。之后黑若下 A 可尝试杀白，但黑棋须先自身活定，或握有 10 口气以上才能赢下对杀。白棋在 A、H1、H2 之后气数为：5 格大眼 8 口气，减去 H2 一子占的 1 口，加上外气 2 口，共 9 口气且为先手。注意黑棋可先手做 E1、F1 交换（威胁把白棋大眼压缩成曲四），所以本例数气时应把 E1、F1 视为已交换。",
  "Correct. It's a one eye vs no eye capturing race. The White stones in the corner are dead.":"正解。这是\"有眼杀无眼\"的对杀，角上白棋死了。",
  "White shouldn't play here, because then Black can capture White without a ko.":"白棋不该下这里，否则黑棋无需打劫即可提掉白棋。",
  "Correct. Black can fight a ko for life.":"正解。黑棋可以打劫求活。",
  "Correct. A and B are miai, so Black's alive.":"正解。A、B 两点见合，黑棋活了。",
  "White can't avoid a ko by playing here.":"白棋下这里也避不开劫。",
  "Correct. White should have accepted the ko instead.":"正解。白棋本应接受打劫。",
  "Correct. It's a ko for life.":"正解。这是做活之劫。",
  "Correct. It's a ten thousand year ko: http://senseis.xmp.net/?MannenKo This is the best result for both players.":"正解。这是万年劫，对双方都是最好结果。",
  "Correct. Black can play at A and make a bulky five shape whenever he wants to (which is dead - http://senseis.xmp.net/?BulkyFive). If White plays at A, she ataris herself and Black can capture.":"正解。黑棋随时可在 A 位做出刀把五（死形）。白棋若下 A 会自己被打吃，黑棋即可提子。",
  "Correct, even though White tried to resist, it's still a ko.":"正解。白棋虽然顽抗，结果仍是劫。",
  "Correct. Even if White plays at A, Black still lives in seki.":"正解。白棋即使下 A，黑棋仍双活。",
  "Correct. A and B are miai for Black. If White plays C, Black plays D. White's dead.":"正解。A、B 对黑见合；白下 C 黑下 D，白棋死了。",
  "Correct. Black lives with a double ko.":"正解。黑棋以双劫活棋。"};
for (const [k, v] of Object.entries(EXTRA2)) EXACT.set(k, v);

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
// 修正：修正上面误写的一个键值对（对象字面量里的小写技巧项）
EXACT.delete("correct. the result is favorable for black.'.tolowercase() && 'x");

/**
 * 翻译一条 GGG 英文解说。
 * 返回 { zh, oe }：zh 为中文（已是中文则原样），oe 为英文原文（无需保留时为空串）。
 */
export function translateGggExplanation(en) {
  const t = norm(en);
  if (!t) return { zh: '', oe: '' };
  if (/[\u4e00-\u9fff]/.test(t)) return { zh: t, oe: '' };
  const exact = EXACT.get(t);
  if (exact) return { zh: exact, oe: t };
  for (const [p, zh] of PREFIX_RULES) {
    if (t.startsWith(p)) return { zh, oe: t };
  }
  // 规则兜底：已知开头 + 术语替换
  const m = /^(Also correct|This is also correct|Correct)\b[\s.,]*/i.exec(t);
  const lead = m ? (m[1] === 'Correct' ? '正解。' : '也是正解。') : '';
  const rest = m ? t.slice(m[0].length) : t;
  if (!rest) return { zh: lead || '正解。', oe: t };
  const zhRest = rest
    .replace(/\bmiai\b/gi, '见合')
    .replace(/\bcapturing race\b/gi, '对杀')
    .replace(/\bseki\b/gi, '双活')
    .replace(/\bladder\b/gi, '征子')
    .replace(/\bko threats?\b/gi, '劫材')
    .replace(/\bko\b/gi, '劫')
    .replace(/\btesuji\b/gi, '手筋')
    .replace(/\btenuki\b/gi, '脱先')
    .replace(/\bsente\b/gi, '先手')
    .replace(/\bataris?\b/gi, '打吃')
    .replace(/\bliberties\b/gi, '气')
    .replace(/\beyespace\b/gi, '眼位');
  const hasZh = /[\u4e00-\u9fff]/.test(zhRest);
  return { zh: lead + (hasZh ? zhRest : `（作者原文：${rest}）`), oe: t };
}
