/* ==========================================================================
 * theory/counterpoint.js — 严格对位规则检查器（二声部，五种对位）
 * --------------------------------------------------------------------------
 * 设计原则：
 *   1. 每条规则都有编号、中英名称、判据说明、依据来源，可单独开关。
 *   2. 检查结果分 error（违反硬规则）/ warn（风格问题）/ info（中性观察）。
 *   3. 同一份代码既用于「生成谱例的质量闸门」，也用于「你练习的自动批改」。
 *
 * 规则依据（教材层面）：
 *   · Fux, Gradus ad Parnassum — 五种对位的经典框架
 *   · Jeppesen, Counterpoint: The Polyphonic Vocal Style of the 16th Century — 16 世纪实际写法
 *   · Salzer & Schachter, Counterpoint in Composition — 音程与声部进行的分析视角
 *   · 陈铭志《复调音乐写作基础教程》/ 于苏贤《复调音乐教程》 — 中文教学体系
 *   注意：不同教材在细节上（尤其反向五八度、连续三六度的上限）并不一致，
 *   所以每条规则都做成可切换的，你按自己跟的体系调整。
 * ========================================================================== */
(function (global) {
  'use strict';

  var TH = global.TH || (typeof require !== 'undefined' ? require('./core.js') : null);

  /* ------------------------------------------------------------ 规则清单 */

  var RULES = {
    /* --- 纵向：音程与声部进行 --- */
    H01: { id: 'H01', level: 'error', zh: '平行五度', en: 'Parallel fifths',
      why: '相邻两个纵向音程同为纯五度且两声部同向（含同度到五度、五度到十二度）。这是最硬的禁忌。' },
    H02: { id: 'H02', level: 'error', zh: '平行八度/一度', en: 'Parallel octaves/unisons',
      why: '相邻两个纵向音程同为八度或一度且同向，包含八度到十五度。' },
    H03: { id: 'H03', level: 'error', zh: '隐伏五度/八度', en: 'Hidden (direct) fifths/octaves',
      why: '两声部同向进行、同时跳到完全协和音程（五度/八度）。外声部之间尤其禁止；若上方声部为级进则通常允许。' },
    H04: { id: 'H04', level: 'warn', zh: '反向到达五度/八度', en: 'Contrary fifths/octaves',
      why: '两声部反向进行到达完全协和。Fux 体系允许，部分 16 世纪风格与中文教材会规避，按你的体系决定。' },
    H05: { id: 'H05', level: 'warn', zh: '声部交错', en: 'Voice crossing',
      why: '两声部的上下次序发生反转。写作时应尽量避免——它会让听者短暂搞不清谁是上方声部。' +
        '但本条是【提示】而非硬规则：与 Fux《Gradus》交叉验证时发现，' +
        '图 82（二声部第五类）与图 154（三声部第五类）里 Fux 本人都写了短暂交错，' +
        '尤其出现在 florid 写法中。既然权威范例自己就这么写，当硬规则会冤枉正确的写法。' },
    H06: { id: 'H06', level: 'error', zh: '声部超越', en: 'Voice overlap',
      why: '一个声部越过另一声部刚刚唱过的音（如上方声部低于下方声部的前一个音）。' },
    H07: { id: 'H07', level: 'warn', zh: '连续三度/六度超过三个', en: 'More than three consecutive 3rds/6ths',
      why: '连续同向的不完全协和超过三个会失去独立性。部分教材允许，标记为风格提示。' },
    H08: { id: 'H08', level: 'error', zh: '不协和音程位置不当', en: 'Dissonance placement',
      why: '不协和音程出现在不允许的位置（各类对位的具体判据不同）。' },
    H09: { id: 'H09', level: 'error', zh: '不协和音未按经过/辅助音处理', en: 'Dissonance not a passing/neighbor tone',
      why: '弱拍上的不协和音必须由级进引入并级进离开（经过音），或级进离开后返回（辅助音）。' },
    H10: { id: 'H10', level: 'error', zh: '挂留音结构不完整', en: 'Malformed suspension',
      why: '挂留必须：协和准备 → 同音保持成为不协和 → 下行级进解决到协和。' },
    H11: { id: 'H11', level: 'warn', zh: '挂留音未下行解决', en: 'Suspension not resolved downward',
      why: '挂留音的解决必须下行（9-8、7-6、4-3、2-1）。' },

    /* --- 纵向：起止与终止式 --- */
    E01: { id: 'E01', level: 'error', zh: '起始音程不是完全协和', en: 'Opening must be a perfect consonance',
      why: '二声部对位以同度、五度或八度开始（实践中八度最常见）。' },
    E02: { id: 'E02', level: 'error', zh: '结束音程不是八度或同度', en: 'Final must be octave or unison',
      why: '严格对位一律以八度（或同度）结束。' },
    E03: { id: 'E03', level: 'error', zh: '终止式不成立', en: 'Cadence formula missing',
      why: '结束前必须是 6→8（或 3→1）：两声部反向级进到达八度。' },

    /* --- 横向：旋律写作 --- */
    M01: { id: 'M01', level: 'error', zh: '使用了增音程', en: 'Augmented melodic interval',
      why: '旋律中禁止增四度、增二度等增音程（难以演唱，且破坏调式感）。' },
    M02: { id: 'M02', level: 'warn', zh: '大跳后未反向级进', en: 'Leap not recovered by step',
      why: '超过三度的跳进之后，宜反向级进填回——旋律连贯性的要求。' +
        '注意本条是【风格提示】而非硬规则：与 Fux《Gradus》图 55 交叉验证时发现，' +
        'Fux 本人在八度下行大跳后用三度折返（E5 F5 F4 A4）。' +
        '既然权威范例自己就偏离这条，把它当错误会冤枉正确的写法，故降级为提示。' },
    M03: { id: 'M03', level: 'warn', zh: '连续同向跳进', en: 'Consecutive leaps in same direction',
      why: '两个以上同向跳进会使旋律失控。' },
    M04: { id: 'M04', level: 'warn', zh: '同音反复过多', en: 'Too many repeated notes',
      why: '严格对位中同音反复很少用，连续三个以上会显得呆板。' },
    M05: { id: 'M05', level: 'error', zh: '超出声部音域', en: 'Out of range',
      why: '各声部有惯用音域，超出后无法由人声舒适演唱。' },
    M06: { id: 'M06', level: 'warn', zh: '跳进后未填满音域', en: 'Leap outline not filled',
      why: '大跳所跨过的音域，后续应逐步填满。' },
    M07: { id: 'M07', level: 'warn', zh: '级进使用不足', en: 'Insufficient stepwise motion',
      why: '严格对位以级进为主体，跳进应占少数。' }
  };

  function rule(id, level, at, detail) {
    var r = RULES[id];
    return {
      id: id, level: level || r.level,
      zh: r.zh, en: r.en, why: r.why,
      at: at, detail: detail || ''
    };
  }

  /* -------------------------------------------------------------- 声部音域 */

  var RANGES = {
    soprano: { lo: 60, hi: 81, zh: '女高音 C4–A5' },
    alto: { lo: 55, hi: 77, zh: '女低音 G3–F5' },
    tenor: { lo: 48, hi: 69, zh: '男高音 C3–A4' },
    bass: { lo: 40, hi: 62, zh: '男低音 E2–D4' }
  };

  /* ------------------------------------------------------------ 主检查器 */

  /**
   * @param {Object} score TH.makeScore(...) 的产物
   * @param {Object} opts  { disabled:[ruleId], upperVoice:'cf'|'cp', rangeUpper, rangeLower }
   */
  function check(score, opts) {
    opts = opts || {};
    var disabled = {};
    (opts.disabled || []).forEach(function (id) { disabled[id] = true; });
    var out = [];
    function add(id, at, detail, level) {
      if (disabled[id]) return;
      out.push(rule(id, level, at, detail));
    }

    var grid = TH.onsetGrid(score);
    if (grid.length < 2) {
      return { score: score, ok: false, messages: [{ id: 'X', level: 'error', zh: '谱例为空', detail: '' }], columns: [] };
    }

    /* ---- 1. 纵向音程表 ---- */
    var columns = [];
    grid.forEach(function (onset) {
      var a = TH.soundingAt(score.cfE, onset);
      var b = TH.soundingAt(score.cpE, onset);
      if (!a || !b || a.midi === null || b.midi === null) return;
      var lower = a.midi <= b.midi ? a : b;
      var upper = a.midi <= b.midi ? b : a;
      var iv = TH.intervalBetween(lower.src.p, upper.src.p);
      columns.push({
        onset: onset, lower: lower, upper: upper, iv: iv,
        cf: a, cp: b,          // 明确记住哪个事件属于哪个声部
        /* 原始上下次序（>0 表示 CF 在 CP 之上）。
           不能只看归一化后的 lower/upper —— 那样每一列都会"自动变成正常次序"，
           声部交错就永远检不出来。这是本检查器曾经的一个真 bug：
           H05 因为只用归一化后的值判断，成了死代码。 */
        order: Math.sign(a.midi - b.midi),
        bar: Math.floor(onset / (score.totalQ / Math.max(1, countBars(score)))) + 1
      });
    });
    if (columns.length < 2) {
      return { score: score, ok: false, messages: [{ id: 'X', level: 'error', zh: '两声部没有同时发声的时点', detail: '' }], columns: columns };
    }

    /* 声部交错的基准次序：以第一列为准，之后反转即为交错。
       （两声部可以在结尾同度/八度上汇合，那不算反转。） */
    var baseOrder = columns.length ? columns[0].order : 0;

    /* ---- 2. 起始 / 结束 / 终止式 ---- */
    var first = columns[0], last = columns[columns.length - 1];
    if (first.iv.class !== 'perfect') {
      add('E01', describe(score, first), '起始为' + first.iv.name);
    }
    if (!(last.iv.simpleNum === 8 || last.iv.simpleNum === 1)) {
      add('E02', describe(score, last), '结束为' + last.iv.name);
    }
    if (columns.length >= 2) {
      /* 终止式比较「最后两列」，不是"最后两个强拍"。
         教训：我曾改成只看强拍列，理由是"最后一小节是长音"。
         但那只说明最后一列是长音，不说明倒数第二列是强拍——
         第二、三、四类里，真正的终止式接近发生在最后一个音之前的那个音上，
         而它通常是弱拍。改成只看强拍之后，第三类对位永远过不了终止式检查。 */
      var penult = columns[columns.length - 2];
      var okCad = penult.iv.class === 'imperfect' &&
        (last.iv.simpleNum === 1 && last.iv.quality === 'P') &&
        oppositeStep(penult, last);
      if (!okCad) {
        add('E03', describe(score, penult),
          '结束前一个是 ' + penult.iv.name + ' → ' + last.iv.name +
          '，未构成「不完全协和 → 八度/同度、两声部反向级进」的终止式');
      }
    }

    /* ---- 3. 相邻音程：平行 / 隐伏 / 交错 / 超越 ---- */
    function motionOf(p, q) {
      var up1 = q.upper.midi - p.upper.midi;
      var up2 = q.lower.midi - p.lower.midi;
      var s1 = Math.sign(up1), s2 = Math.sign(up2);
      if (s1 === 0 && s2 === 0) return 'oblique-none';
      if (s1 === 0 || s2 === 0) return 'oblique';
      return s1 === s2 ? 'similar' : 'contrary';
    }

    for (var i = 1; i < columns.length; i++) {
      var p = columns[i - 1], q = columns[i];
      var at = describe(score, q);
      var motion = motionOf(p, q);

      /* 平行完全协和 */
      var pP5 = p.iv.quality === 'P' && p.iv.simpleNum === 5;
      var qP5 = q.iv.quality === 'P' && q.iv.simpleNum === 5;
      var pP8 = (p.iv.simpleNum === 1 || p.iv.simpleNum === 8) && p.iv.quality === 'P';
      var qP8 = (q.iv.simpleNum === 1 || q.iv.simpleNum === 8) && q.iv.quality === 'P';

      if (pP5 && qP5 && motion === 'similar') {
        add('H01', at, p.iv.name + ' → ' + q.iv.name + '，两声部同向');
      }
      if (pP5 && qP5 && motion === 'contrary') {
        add('H04', at, p.iv.name + ' → ' + q.iv.name + '，反向（视体系而定）', 'warn');
      }
      if (pP8 && qP8 && motion === 'similar') {
        add('H02', at, p.iv.name + ' → ' + q.iv.name + '，两声部同向');
      }
      if (pP8 && qP8 && motion === 'contrary') {
        add('H04', at, p.iv.name + ' → ' + q.iv.name + '，反向（视体系而定）', 'warn');
      }

      /* 隐伏（同向）到达完全协和 */
      if (motion === 'similar' && q.iv.class === 'perfect' && !pP5 && !pP8) {
        var upperStep = Math.abs(q.upper.midi - p.upper.midi) <= 2;
        if (upperStep) {
          add('H03', at, '同向到达 ' + q.iv.name + '，但上方声部为级进（多数体系允许）', 'warn');
        } else {
          add('H03', at, '两声部同向跳进到达 ' + q.iv.name);
        }
      }

      /* 声部交错 / 超越。
         交错必须用【原始次序】判断：归一化后的 upper/lower 每列都保证 upper 在上，
         拿它们比较恒为假——H05 曾经因此成为死代码，检查器永远报不出交错，
         而 B1 的正文却把交错当错误级讲。 */
      if (baseOrder !== 0 && q.order !== 0 && q.order === -baseOrder) {
        add('H05', at, '两声部的上下次序反转（' +
          (baseOrder > 0 ? 'CF 原本在上' : 'CF 原本在下') + '）');
      }
      var crossOver = (q.upper.midi < p.lower.midi) || (q.lower.midi > p.upper.midi);
      if (crossOver && q.order === baseOrder) {
        add('H06', at, '一个声部越过了另一声部刚唱过的音');
      }

      /* 连续三六度 */
      if (p.iv.class === 'imperfect' && q.iv.class === 'imperfect' &&
        p.iv.simpleNum === q.iv.simpleNum && motion === 'similar') {
        q._run = (p._run || 1) + 1;
        if (q._run > 3) add('H07', at, q._run + ' 个连续' + q.iv.simpleNum + '度');
      }
    }

    /* ---- 4. 各类对位的不协和音处理 ---- */
    var species = score.species || 1;
    var barQ = score.totalQ / Math.max(1, countBars(score));

    if (species === 1) {
      columns.forEach(function (c) {
        /* 按【归约后的简单音程】判定协和，而不是按 class ——
           core.js 的 intervalBetween 只把 simpleNum 3/6 的大小音程算作
           imperfect，也承认 1/5/8 为 perfect，但复音程一律落到 dissonant。
           于是纯十二度、大十度这些完全正常的写法会被误判为不协和，
           而小七度这种真正的不协和又该被这条规则抓到。
           这条规则自己的 why 写的是"不得用增音程、减音程，复音程大跳除外"——
           所以这里按 simpleNum + 性质判定，复音程归约后照同一套标准。 */
        var sN = c.iv.simpleNum, q = c.iv.quality;
        var consonant = (sN === 1 || sN === 5) ? q === 'P'
          : (sN === 3 || sN === 6) ? (q === 'M' || q === 'm')
            : false;
        if (!consonant) {
          add('H08', describe(score, c),
            '第一类对位要求全部协和，此处为 ' + c.iv.name +
            (c.iv.compound ? '（复音程按归约后的简单音程判定）' : ''));
        }
      });
    } else if (species === 2 || species === 3 || species === 5) {
      columns.forEach(function (c, idx) {
        if (c.iv.class !== 'dissonant') return;
        var prev = columns[idx - 1], next = columns[idx + 1];
        var strong = Math.abs(c.onset % barQ) < 1e-6;

        /* 挂留：对位声部从上一刻保持同音，且上一刻是协和的。
           第五类（混合 / 弗罗里德）允许挂留落在强拍上，甚至跨小节。
           依据：与 Fux《Gradus》图 82 交叉验证——该练习第 8、9、10 小节的
           强拍不协和全部是跨小节挂留（前一小节末准备，保持过来成为不协和）。
           此前本条与第二、三类共用"强拍必须协和"的判据，于是把 Fux 判成了违规。 */
        var isSusp = prev && prev.cp && c.cp &&
          prev.cp.midi === c.cp.midi && prev.iv.class !== 'dissonant';
        if (isSusp) {
          if (!next) {
            add('H10', describe(score, c), '不协和音 ' + c.iv.name + ' 之后没有解决');
            return;
          }
          var mv = next.cp.midi - c.cp.midi;
          if (!(mv < 0 && Math.abs(mv) <= 2)) {
            add('H11', describe(score, c),
              '挂留解决不是下行级进（对位声部实际移动 ' + mv + ' 个半音）');
          }
          if (next.iv.class === 'dissonant' && Math.abs(next.onset % barQ) < 1e-6) {
            add('H10', describe(score, next), '解决到的不协和音 ' + next.iv.name);
          }
          return;
        }

        if (strong) {
          add('H08', describe(score, c), '强拍上的 ' + c.iv.name +
            ' 不协和，且对位声部不是从协和音保持过来的挂留');
          return;
        }
        if (!prev || !next) return;
        var verdict = classifyDissonance(prev, c, next, columns[idx + 2]);
        if (!verdict.ok) {
          add('H09', describe(score, c), c.iv.name + '：' + verdict.reason);
        }
      });
    } else if (species === 4) {
      columns.forEach(function (c, idx) {
        if (c.iv.class !== 'dissonant') return;
        var prev = columns[idx - 1], next = columns[idx + 1];
        /* 准备：CP 保持同音，且该音在前一刻是协和的（CF 移动才造成不协和） */
        var prep = prev && prev.cp && c.cp &&
          prev.cp.midi === c.cp.midi && prev.iv.class !== 'dissonant';
        if (!prep) {
          add('H10', describe(score, c),
            '不协和音 ' + c.iv.name + ' 之前，对位声部没有以协和音同音保持作为准备');
        }
        if (!next) {
          add('H10', describe(score, c), '不协和音 ' + c.iv.name + ' 之后没有解决');
          return;
        }
        var move = next.cp.midi - c.cp.midi;
        if (!(move < 0 && Math.abs(move) <= 2)) {
          add('H11', describe(score, c),
            '解决不是下行级进（对位声部实际移动 ' + move + ' 个半音）');
        }
        if (next.iv.class === 'dissonant') {
          add('H10', describe(score, next), '解决到的不协和音 ' + next.iv.name);
        }
      });
    }

    /* ---- 5. 旋律检查（两个声部都查） ---- */
    [['cf', score.cfE, 'CF'], ['cp', score.cpE, 'CP']].forEach(function (pair) {
      var who = pair[0], ev = pair[1], label = pair[2];
      var sounding = ev.filter(function (e) { return e.midi !== null; });
      for (var k = 1; k < sounding.length; k++) {
        var a = sounding[k - 1], b = sounding[k];
        var d = b.midi - a.midi;
        var at = { voice: label, onset: b.onset, index: k, note: b.src.p.str };
        if (Math.abs(d) > 12) { /* 复音程跳进按简单音程看 */ }
        var ivM = TH.intervalBetween(
          d >= 0 ? a.src.p : b.src.p, d >= 0 ? b.src.p : a.src.p);

        /* 增音程 */
        if (ivM.quality === 'A') {
          add('M01', at, label + ' 出现' + ivM.name + '（' + a.src.p.str + '→' + b.src.p.str + '）');
        }
        /* 大跳后未反向级进。
           八度及以上的大跳放宽到"反向三度"——依据是与 Fux《Gradus》图 55 的
           交叉验证：Fux 原文写 E5 F5 F4 A4，八度下行后用三度折返，
           而更严格的"必须级进"会把它判成违规。
           注意：这条阈值目前只由一个样本校准，语料变多后需要复核。 */
        if (Math.abs(d) >= 5) {
          var c2 = sounding[k + 1];
          if (c2) {
            var d2 = c2.midi - b.midi;
            var maxRecover = Math.abs(d) >= 12 ? 3 : 2;
            var recovered = Math.sign(d2) === -Math.sign(d) && Math.abs(d2) <= maxRecover;
            if (!recovered && Math.abs(d) >= 7) {
              add('M02', at, label + ' 在 ' + a.src.p.str + '→' + b.src.p.str +
                ' 跳动 ' + Math.abs(d) + ' 个半音后，下一个音未反向级进');
            }
          }
        }
        /* 连续同向跳进 */
        if (k >= 2) {
          var a0 = sounding[k - 2];
          var d0 = a.midi - a0.midi;
          if (Math.abs(d0) >= 3 && Math.abs(d) >= 3 && Math.sign(d0) === Math.sign(d)) {
            add('M03', at, label + ' 连续同向跳进（' + a0.src.p.str + '→' + a.src.p.str + '→' + b.src.p.str + '）', 'warn');
          }
        }
      }
      /* 同音反复 */
      var rep = 1;
      for (var r = 1; r < sounding.length; r++) {
        if (sounding[r].midi === sounding[r - 1].midi) {
          rep++;
          if (rep >= 3) {
            add('M04', { voice: label, onset: sounding[r].onset, note: sounding[r].src.p.str },
              label + ' 连续 ' + (rep) + ' 个同音', 'warn');
          }
        } else rep = 1;
      }
      /* 音域（M05）。
         【当前接线状态，动手改之前先读这段】
         真正生效的选项名是 range_CF / range_CP（下面 opts['range_' + label]）；
         第 102 行的 JSDoc 写的是 rangeUpper / rangeLower，
         而 rangeKey 这个变量算了却从没被用过 —— 同一功能三套名字。
         更要紧的是：**全仓库没有任何调用方传过 range 选项**
         （tools/verify.js、assets/js/drills.js 的 spot 练习都没传），
         所以这条登记为 error 的硬规则在网站和所有工具里目前从不生效。
         tools/check-rules.js 已用一条显式传 range_CF/range_CP 的反例守着它，
         但"统一选哪个名字、要不要让 spot 练习真的传进去"是待定判断，
         未擅自改动。详见 docs/检查器交接文档.md 第四轮附录。 */
      var rangeKey = opts.rangeUpper && who === 'cf' ? opts.rangeUpper : opts.rangeLower;
      var midis = sounding.map(function (e) { return e.midi; });
      if (midis.length) {
        var lo = Math.min.apply(null, midis), hi = Math.max.apply(null, midis);
        var rk = opts['range_' + label];
        if (rk && RANGES[rk]) {
          var R = RANGES[rk];
          if (lo < R.lo) add('M05', { voice: label, onset: sounding[0].onset, note: TH.midiToName(lo) },
            label + ' 最低音 ' + TH.midiToName(lo) + ' 低于' + R.zh + '下限');
          if (hi > R.hi) add('M05', { voice: label, onset: sounding[0].onset, note: TH.midiToName(hi) },
            label + ' 最高音 ' + TH.midiToName(hi) + ' 高于' + R.zh + '上限');
        }
      }
      /* 级进占比 */
      var steps = 0, leaps = 0;
      for (var s = 1; s < sounding.length; s++) {
        var dd = Math.abs(sounding[s].midi - sounding[s - 1].midi);
        if (dd <= 2) steps++; else if (dd >= 3) leaps++;
      }
      if (steps + leaps > 0 && leaps / (steps + leaps) > 0.5) {
        add('M07', { voice: label }, label + ' 跳进占 ' + Math.round(100 * leaps / (steps + leaps)) + '%，级进偏少', 'warn');
      }

      /* 跳进后未填满音域（M06）。
         这条规则在 RULES 表和 docs/检查器交接文档.md 的规则一览里都登记了，
         却一直没有实现（没有任何 add('M06') 调用）——是条挂着名字的空规则。
         判据：一个三度及以上的跳进所跨越的音域，后续应当由【音高落在该音域内】
         的音逐步填满；若跳进后一路走远、再没有任何音回到这个音域里，就提示。
         只看"有没有回到音域内"，不要求严格级进——否则会与 M02 重复
         （M02 已经管"大跳之后必须反向级进折返"）。
         注意本条是【提示】：Fux 的解答里也有跳进后直接离去的写法。 */
      for (var kk = 0; kk < sounding.length - 1; kk++) {
        var from = sounding[kk], to = sounding[kk + 1];
        var span = to.midi - from.midi;
        if (Math.abs(span) < 3) continue;              // 三度以下不算跳进
        var loM = Math.min(from.midi, to.midi), hiM = Math.max(from.midi, to.midi);
        var filled = false;
        for (var j = kk + 1; j < sounding.length; j++) {
          var mj = sounding[j].midi;
          if (mj > loM && mj < hiM) { filled = true; break; }
        }
        if (!filled) {
          /* 度数据音名级数算（intervalBetween 的 generic），不能用半音数除以 2
             ——那样 E5→C5 会写成"2 度"，而它是三度。 */
          var ivM6 = TH.intervalBetween(
            span >= 0 ? from.src.p : to.src.p, span >= 0 ? to.src.p : from.src.p);
          add('M06', { voice: label, onset: to.onset, note: to.src.p.str },
            label + ' 在 ' + from.src.p.str + '→' + to.src.p.str + ' 跳进' + ivM6.name +
            '后，跨越的音域始终没有被填满', 'warn');
        }
      }
    });

    var errors = out.filter(function (m) { return m.level === 'error'; });
    return {
      score: score, ok: errors.length === 0,
      errorCount: errors.length,
      warnCount: out.filter(function (m) { return m.level === 'warn'; }).length,
      messages: out, columns: columns
    };
  }

  /* -------------------------------------------------------------- 辅助 */

  function countBars(score) {
    var n = 0;
    score.cf.concat(score.cp).forEach(function (x) { if (x.bar > n) n = x.bar; });
    return n;
  }

  function sameSounding(prev, cur) {
    return prev.upper.midi === cur.upper.midi && prev.lower.midi === cur.lower.midi;
  }

  function oppositeStep(p, q) {
    var du = q.upper.midi - p.upper.midi;
    var dl = q.lower.midi - p.lower.midi;
    return Math.sign(du) === -Math.sign(dl) && Math.abs(du) <= 2 && Math.abs(dl) <= 2;
  }

  /* 弱拍不协和音 → 经过音 / 辅助音 / 换音(cambiata) / 其他
     判据只看「对位声部（CP）」的走向：不协和是 CP 造成的，
     所以必须由 CP 自己级进进入、级进离开。看 CF 的移动是错的。

     cambiata（换音）：级进进入 → 同向跳三度离开 → 反向级进折回。
     这是第三类对位的标志性音型，也是本检查器曾经漏掉的东西——
     与 Fux《Gradus》图 55 交叉验证时才暴露出来：
     Fux 原文写 E5 D5 B4 C5（D5 不协和），我的规则当时判它违规。 */
  function classifyDissonance(prev, cur, next, after) {
    if (!prev.cp || !cur.cp || !next.cp) {
      return { ok: false, reason: '缺少声部信息，无法判定' };
    }
    var inMove = cur.cp.midi - prev.cp.midi;    // CP 如何进入
    var outMove = next.cp.midi - cur.cp.midi;   // CP 如何离开

    if (Math.abs(inMove) >= 1 && Math.abs(inMove) <= 2 &&
      Math.abs(outMove) >= 1 && Math.abs(outMove) <= 2) {
      if (Math.sign(inMove) === Math.sign(outMove)) {
        return { ok: true, kind: 'passing', reason: '经过音（同向级进穿过）' };
      }
      return { ok: true, kind: 'neighbor', reason: '辅助音（级进离开后折回）' };
    }

    /* 换音 cambiata：级进进入 → 同向跳三度 → 反向级进折回 */
    if (after && after.cp &&
      Math.abs(inMove) >= 1 && Math.abs(inMove) <= 2 &&
      Math.abs(outMove) >= 3 && Math.abs(outMove) <= 4 &&
      Math.sign(outMove) === Math.sign(inMove)) {
      var back = after.cp.midi - next.cp.midi;
      if (Math.sign(back) === -Math.sign(outMove) && Math.abs(back) >= 1 && Math.abs(back) <= 2) {
        return { ok: true, kind: 'cambiata', reason: '换音 cambiata（级进进入、同向跳三度、反向级进折回）' };
      }
    }

    return {
      ok: false,
      reason: '对位声部既不是级进进入也不是级进离开（进入 ' + inMove + ' 半音、离开 ' + outMove + ' 半音）'
    };
  }

  function describe(score, col) {
    var barQ = score.totalQ / Math.max(1, countBars(score));
    var bar = Math.floor(col.onset / barQ) + 1;
    var beat = col.onset % barQ + 1;
    return {
      bar: bar, beat: beat, onset: col.onset,
      note: TH.midiToName(col.upper.midi) + ' / ' + TH.midiToName(col.lower.midi),
      interval: col.iv.name
    };
  }

  /* -------------------------------------------------------------- 报告 */

  function formatReport(result) {
    var s = result.score;
    var lines = [];
    lines.push('谱例：' + (s.title || s.id) + '   [第' + s.species + '类对位, ' + s.key + ', ' + s.meter + ']');
    lines.push('纵向音程 ' + result.columns.length + ' 个检查点');
    if (!result.messages.length) {
      lines.push('  ✓ 未发现任何规则问题');
    } else {
      result.messages.forEach(function (m) {
        var loc = m.at ? ('第' + (m.at.bar || '?') + '小节 第' + (m.at.beat || '?') + '拍') : '';
        var tag = m.level === 'error' ? '✗ 错误' : m.level === 'warn' ? '⚠ 提示' : '· 观察';
        lines.push('  ' + tag + ' [' + m.id + ' ' + m.zh + '] ' + loc + (m.detail ? ' — ' + m.detail : ''));
      });
    }
    lines.push('  → 错误 ' + result.errorCount + ' 项，提示 ' + result.warnCount + ' 项');
    return lines.join('\n');
  }

  /* ==================================================== 三声部：声部对检查 */
  /*
   * 三个声部时，最核心的变化有两条：
   *
   * 1. 平行五度 / 平行八度要在【所有声部对】之间检查，一共三对
   *    （高-中、中-低、高-低）。只听最外面两个声部是不够的——
   *    中声部与任一声部之间的平行，同样会毁掉声部独立。
   *
   * 2. 纯四度的身份变了：在三个声部里，低音上方的纯四度算【协和】
   *    （它被理解为 6/3 或 6/4 和弦的一部分），
   *    但两个【上方声部之间】的纯四度仍然是不协和。
   *    所以三声部的四度判定必须知道"这个四度是不是跨着低音"。
   *
   * 依据：Fux《Gradus》第三部分（三声部）的写法，
   *       语料见 scores/fux/gap_101.krn（图 101，第一类，三声部）。
   */
  function pairsCheck(voices, opts) {
    opts = opts || {};
    if (!voices || voices.length < 2) return { ok: false, messages: [], pairs: [] };
    var parts = voices.map(function (v, i) {
      return { name: v.name || ('声部' + (i + 1)), events: v.events, idx: i };
    });
    var onsets = {};
    parts.forEach(function (p) {
      p.events.forEach(function (e) { if (e.midi !== null) onsets[e.onset] = true; });
    });
    var grid = Object.keys(onsets).map(Number).sort(function (a, b) { return a - b; });
    var messages = [];

    function at(events, t) {
      for (var i = 0; i < events.length; i++) {
        var e = events[i];
        if (e.onset <= t + 1e-9 && t < e.onset + e.dur - 1e-9) return e;
      }
      return null;
    }

    /* 逐对声部构造音程序列 */
    var pairs = [];
    for (var a = 0; a < parts.length; a++) {
      for (var b = a + 1; b < parts.length; b++) {
        var cols = [];
        grid.forEach(function (t) {
          var ea = at(parts[a].events, t), eb = at(parts[b].events, t);
          if (!ea || !eb || ea.midi === null || eb.midi === null) return;
          var lo = ea.midi <= eb.midi ? ea : eb;
          var hi = ea.midi <= eb.midi ? eb : ea;
          cols.push({
            onset: t, lo: lo, hi: hi,
            iv: TH.intervalBetween(lo.src.p, hi.src.p),
            aMid: ea.midi, bMid: eb.midi, aIdx: a, bIdx: b
          });
        });
        pairs.push({ a: parts[a], b: parts[b], cols: cols });
      }
    }

    /* 低音声部按【实际音高】认定，不能假定它排在最后一个下标——
       kern 语料里低音恰恰是第一列，写死成 length-1 会让判定蒙对或蒙错。 */
    var bottomIdx = 0, lowestAvg = Infinity;
    parts.forEach(function (p, i) {
      var ms = p.events.filter(function (e) { return e.midi !== null; });
      if (!ms.length) return;
      var avg = ms.reduce(function (a, e) { return a + e.midi; }, 0) / ms.length;
      if (avg < lowestAvg) { lowestAvg = avg; bottomIdx = i; }
    });

    pairs.forEach(function (pr) {
      /* 声部次序以【第一列】为基准：之后发生了反转就是声部交错或超越。
         不能假设"下标小的在上"——kern 语料里低音恰好排在最后一列。 */
      var baseOrder = pr.cols.length
        ? Math.sign(pr.cols[0].aMid - pr.cols[0].bMid)   // >0 表示 a 高于 b
        : 0;

      for (var i = 1; i < pr.cols.length; i++) {
        var p = pr.cols[i - 1], q = pr.cols[i];
        var dLo = Math.sign(q.lo.midi - p.lo.midi), dHi = Math.sign(q.hi.midi - p.hi.midi);
        var similar = dLo !== 0 && dHi !== 0 && dLo === dHi;
        var isP5 = function (c) { return c.iv.quality === 'P' && c.iv.simpleNum === 5; };
        var isP8 = function (c) { return c.iv.quality === 'P' && c.iv.simpleNum === 1; };
        var where = pr.a.name + ' × ' + pr.b.name;
        var bar = Math.floor(q.onset / (opts.barQ || 4)) + 1;

        if (similar && isP5(p) && isP5(q)) {
          messages.push({ id: 'H01', level: 'error', zh: '平行五度',
            detail: where + '：第 ' + bar + ' 小节' });
        }
        if (similar && isP8(p) && isP8(q)) {
          messages.push({ id: 'H02', level: 'error', zh: '平行八度/一度',
            detail: where + '：第 ' + bar + ' 小节' });
        }
        if (baseOrder !== 0 && Math.sign(q.aMid - q.bMid) === -baseOrder) {
          /* 三声部里，上方两声部之间【短暂】交错是可以见到的写法，
             尤其在第五类（混合/弗罗里德）里。依据：Fux《Gradus》图 154
             第 7 小节，最高声部短暂下探到中声部之下。
             所以这里给 warn 而不是 error —— 它是要避免的习惯，不是硬违规。 */
          messages.push({ id: 'H05', level: 'warn', zh: '声部交错',
            detail: where + '：第 ' + bar + ' 小节两声部次序反转' });
        }
      }

      /* 纯四度：这里【故意不做自动判定】，原因值得记下来。
       *
       * 常见说法是"三声部里低音上方的四度算协和，两个上方声部之间的四度仍不协和"。
       * 但拿 Fux《Gradus》图 101 第 4 小节一验就出问题：
       * 那里是 F3–A3–D4，A3 到 D4 正是两个上方声部之间的纯四度，
       * 而 Fux 本人就是这么写的——因为 F3–D4 是六度、F3–A3 是三度，
       * 两个上方声部各自与低音协和，它们之间的四度只是排列的副产物。
       *
       * 所以那句规则不能机械套用：它针对的是"只有这两个声部"的情形，
       * 不是"三声部织体里任意两个上方声部"。自动判定会产生假阳性，
       * 因此这里不做判定，只把它作为需要人判断的点记录在案。
       * 详见 docs/检查器交接文档.md。 */
    });

    var errors = messages.filter(function (m) { return m.level === 'error'; });
    return {
      ok: errors.length === 0,
      errorCount: errors.length,
      warnCount: messages.filter(function (m) { return m.level === 'warn'; }).length,
      messages: messages,
      pairs: pairs.map(function (p) {
        return { name: p.a.name + ' × ' + p.b.name, intervals: p.cols.map(function (c) { return c.iv.name; }) };
      })
    };
  }

  var API = {
    check: check, pairsCheck: pairsCheck,
    RULES: RULES, RANGES: RANGES, formatReport: formatReport
  };
  global.CP = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof window !== 'undefined' ? window : globalThis);
