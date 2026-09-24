#!/usr/bin/env node
/* =====================================================================
   Bank validator — run before every push:  node tools/validate.js

   1. Static bank: shape, unique choices, answer index, explanation,
      passage keys, AO options/base agreement, duplicate stems.
   2. Generators: every AR/MK template is run many times; the question
      TEXT is re-parsed and the answer recomputed independently, then
      checked against the keyed choice — and against every other choice
      (ambiguity check). genAO is checked structurally.
   3. AO puzzles (genAOPuzzle): an independent geometric re-check —
      best-fit rigid alignment proves the keyed figure is made of the
      stem pieces and every wrong figure is off by ≥ 5 units even when
      flipped; pieces tile their figure with no gaps or overlaps.
   4. buildQuestions: many sittings per subtest — 10 items, valid
      structure, PC passages contiguous, numeric sets ascending, no
      repeated stem in a sitting, consecutive draws differ; plus the
      20-item 209-word test (key = the word's curated synonym).
   ===================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

const FILE = process.argv[2] || path.join(__dirname, '..', 'index.html');   // optional path, for testing a copy
const html = fs.readFileSync(FILE, 'utf8');

const GEN_RUNS = 400, AO_RUNS = 800, BUILD_RUNS = 100;

/* ---------- extract the bank script + the engine's builder block ---------- */
function sliceBank(src){
  const mark = src.indexOf('question bank');
  if (mark === -1) throw new Error('could not find the "question bank" header comment');
  const open = src.lastIndexOf('<script>', mark);
  const close = src.indexOf('</script>', mark);
  if (open === -1 || close === -1) throw new Error('could not find the bank <script> block');
  return src.slice(open + '<script>'.length, close);
}
function sliceBuilder(src){
  const start = src.indexOf('function shuffled(');
  const end = src.indexOf('function startExam');
  if (start === -1 || end === -1 || end < start) throw new Error('could not find the engine builder block');
  const block = src.slice(start, end);
  if (block.indexOf('let MEM_SEEN') === -1) throw new Error('builder block is missing MEM_SEEN');
  return block;
}

const store = new Map();
const localStorageStub = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: k => { store.delete(k); },
  clear: () => store.clear()
};

const EXPORTS = ['BLUEPRINT','PASSAGES','TIMES','BANK','POOL_TOTAL','AO_SHAPES','GEN_AR','GEN_MK',
                 'genAO','genAOPuzzle','GEN','GEN_MIX','STUDY','W209','W209_TEST','samplePool','finalizeChoices','buildQuestions','parseNumish',
                 'EXAMPLES','PROOFS','W209_EX','exampleFor','exKey','w209Item','aoConWhy'];
const S = new Function('localStorage',
  sliceBank(html) + '\n' + sliceBuilder(html) + '\nreturn {' + EXPORTS.join(',') + '};'
)(localStorageStub);

/* ---------- tiny assertion harness ---------- */
let checks = 0;
const failures = [];
function ok(cond, msg){
  checks++;
  if (!cond && failures.length < 60) failures.push(msg);
  else if (!cond) failures.push(null);
  return cond;
}
const strip = s => String(s).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const near = (x, y) => Math.abs(x - y) < 0.005;

/* =====================================================================
   1. STATIC BANK
   ===================================================================== */
const CODES = ['GS','AR','WK','PC','MK','EI','AS','MC','AO'];
ok(JSON.stringify(Object.keys(S.BANK).sort()) === JSON.stringify(CODES.slice().sort()), 'BANK keys are not the 9 subtests');
ok(S.BLUEPRINT.length === 9, 'BLUEPRINT should list 9 subtests');
CODES.forEach(c => ok(S.TIMES[c] > 0, `TIMES.${c} missing`));
const SHEETS = CODES.concat(['TIP', '209']);
ok(CODES.every(c => S.STUDY.some(s => s.code === c)), 'STUDY is missing a subtest sheet');
ok(new Set(S.STUDY.map(s => s.code)).size === S.STUDY.length, 'STUDY has a duplicated sheet code');
S.STUDY.forEach(s => ok(SHEETS.includes(s.code) && strip(s.body).length > 100, `study sheet ${s.code} is empty or mis-coded`));
S.STUDY.forEach(s => { const o = (s.body.match(/<details/g) || []).length, c = (s.body.match(/<\/details>/g) || []).length;
  ok(o === c, `study sheet ${s.code}: unbalanced <details> (${o} open, ${c} close)`);
  ok(!/<b>[^<]{80,}<\/b>/.test(s.body), `study sheet ${s.code}: a long <b> run would render as a block heading`); });

function checkTextItem(it, where, code){
  ok(typeof it.q === 'string' && strip(it.q).length >= 8, `${where}: question text missing/too short`);
  if (!ok(Array.isArray(it.c) && it.c.length === 4, `${where}: needs exactly 4 choices`)) return;
  const flat = it.c.map(strip);
  ok(flat.every(t => t.length > 0), `${where}: empty choice`);
  ok(new Set(flat.map(t => t.toLowerCase())).size === 4, `${where}: choices not unique — ${JSON.stringify(flat)}`);
  ok(Number.isInteger(it.a) && it.a >= 0 && it.a <= 3, `${where}: answer index ${it.a} out of range`);
  ok(typeof it.why === 'string' && strip(it.why).length >= 15, `${where}: explanation missing/too short`);
  if (code === 'PC') ok(it.p && Object.prototype.hasOwnProperty.call(S.PASSAGES, it.p), `${where}: passage key "${it.p}" not in PASSAGES`);
  else ok(!it.p, `${where}: non-PC item carries a passage key`);
}
function checkAOItem(it, where){
  const shapeOK = pr => Array.isArray(pr) && pr.length === 2 && pr.every(s =>
    Array.isArray(s) && S.AO_SHAPES[s[0]] && Object.prototype.hasOwnProperty.call(S.AO_SHAPES[s[0]].anchors, s[1]));
  ok(shapeOK(it.base), `${where}: bad base ${JSON.stringify(it.base)}`);
  if (!ok(Array.isArray(it.options) && it.options.length === 4, `${where}: needs 4 options`)) return;
  ok(it.options.every(shapeOK), `${where}: option references unknown shape/anchor`);
  ok(new Set(it.options.map(o => JSON.stringify(o))).size === 4, `${where}: options not unique`);
  ok(Number.isInteger(it.a) && it.a >= 0 && it.a <= 3, `${where}: answer index out of range`);
  ok(JSON.stringify(it.options[it.a]) === JSON.stringify(it.base), `${where}: options[a] does not equal base`);
  it.options.forEach((o, i) => { if (i !== it.a) ok(JSON.stringify(o) !== JSON.stringify(it.base), `${where}: wrong option ${i} equals base`); });
}

let staticTotal = 0;
CODES.forEach(code => {
  const seenStem = new Map();
  S.BANK[code].forEach((it, i) => {
    staticTotal++;
    const where = `${code}[${i}]`;
    if (code === 'AO'){
      checkAOItem(it, where);
      const key = JSON.stringify(it.base) + JSON.stringify(it.options.map(o => JSON.stringify(o)).sort());
      ok(!seenStem.has(key), `${where}: duplicate of ${code}[${seenStem.get(key)}]`);
      seenStem.set(key, i);
    } else {
      checkTextItem(it, where, code);
      const key = (it.p || '') + '|' + strip(it.q).toLowerCase();
      ok(!seenStem.has(key), `${where}: duplicate stem of ${code}[${seenStem.get(key)}] — "${strip(it.q).slice(0, 60)}"`);
      seenStem.set(key, i);
    }
  });
});
ok(S.POOL_TOTAL === staticTotal, `POOL_TOTAL ${S.POOL_TOTAL} != counted ${staticTotal}`);
Object.keys(S.PASSAGES).forEach(k => {
  ok(strip(S.PASSAGES[k]).length > 200, `passage ${k} is suspiciously short`);
  ok(S.BANK.PC.some(it => it.p === k), `passage ${k} has no questions`);
});

/* =====================================================================
   2. GENERATORS — independent semantic re-check
   ===================================================================== */
const FRAC = { '¼': .25, '½': .5, '¾': .75 };
function mixed(s){                       // "1½" / "¾" / "3" -> number
  const m = String(s).trim().match(/^(\d+)?([¼½¾])?$/);
  if (!m || (!m[1] && !m[2])) return NaN;
  return (m[1] ? +m[1] : 0) + (m[2] ? FRAC[m[2]] : 0);
}
const num = s => parseFloat(String(s).replace(/[$,]/g, ''));
function clockMins(s){                   // "9:05 a.m." -> minutes after midnight
  const m = String(s).match(/^(\d{1,2}):(\d{2}) (a\.m\.|p\.m\.)$/);
  if (!m) return NaN;
  return ((+m[1] % 12) + (m[3] === 'p.m.' ? 12 : 0)) * 60 + +m[2];
}
function poly(s){                        // "x² − 3x + 2" -> [1,-3,2]; "7x − 12" -> [0,7,-12]
  let t = String(s).replace(/\s+/g, '').replace(/−/g, '-');
  let a = 0, b = 0, c = 0;
  const terms = t.match(/[+-]?[^+-]+/g);
  if (!terms) return null;
  for (const term of terms){
    let m;
    if ((m = term.match(/^([+-]?)(\d*)x²$/))) a += (m[1] === '-' ? -1 : 1) * (m[2] === '' ? 1 : +m[2]);
    else if ((m = term.match(/^([+-]?)(\d*)x$/))) b += (m[1] === '-' ? -1 : 1) * (m[2] === '' ? 1 : +m[2]);
    else if ((m = term.match(/^([+-]?)(\d+)$/))) c += (m[1] === '-' ? -1 : 1) * +m[2];
    else return null;
  }
  return [a, b, c];
}
const samePoly = (p, q) => !!p && !!q && p.every((v, i) => v === q[i]);
const SUP = { '²': 2, '³': 3, '⁴': 4 };
const SUPALL = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const supNum = t => +String(t).split('').map(ch => SUPALL.indexOf(ch)).join('');
const minus = t => +String(t).replace('−', '-');

/* Each checker: regex on the question text -> predicate(choiceText) that is
   true only for a correct choice. Written independently of the generator. */
const numIs = (expected, re) => ch => {
  const m = String(ch).match(re);
  return !!m && near(num(m[1]), expected);
};
const PLAIN = /^(-?[\d,]+(?:\.\d+)?)$/, MONEY = /^\$(-?[\d,]+(?:\.\d+)?)$/;

const CHECKERS = {
  AR: [
    ['fuel', /^A vehicle travels (\d+) miles and uses (\d+) gallons/, m => numIs(m[1] / m[2], PLAIN)],
    ['discount', /priced at \$(\d+) is marked down (\d+) percent/, m => numIs(m[1] * (100 - m[2]) / 100, MONEY)],
    ['overtime', /earns \$(\d+) per hour.*for a (\d+)-hour week/, m => numIs(40 * m[1] + 1.5 * m[1] * (m[2] - 40), MONEY)],
    ['recipe', /serves (\d+) people calls for ([\d¼½¾]+) cups of flour.*serve (\d+) people/,
      m => ch => { const c = String(ch).match(/^([\d¼½¾]+) cups$/); return !!c && near(mixed(c[1]), mixed(m[2]) / m[1] * m[3]); }],
    ['clock', /departs at (\d{1,2}:\d{2} [ap]\.m\.) on a trip that takes (\d+) hours and (\d+) minutes/,
      m => ch => clockMins(ch) === (clockMins(m[1]) + m[2] * 60 + +m[3]) % 1440],
    ['together', /in (\d+) hours; another can do the same job in (\d+) hours/,
      m => numIs((m[1] * m[2]) / (+m[1] + +m[2]), /^([\d.]+) hours$/)],
    ['interest', /simple interest does \$([\d,]+) earn in (\d+) years at an annual rate of (\d+) percent/,
      m => numIs(num(m[1]) * m[2] * m[3] / 100, MONEY)],
    ['tank', /^A (\d+)-gallon tank already holds (\d+) gallons\. If it fills at (\d+) gallons per minute/,
      m => numIs((m[1] - m[2]) / m[3], /^([\d.]+) minutes$/)],
    ['ratio', /ratio of 1 officer to every (\d+) enlisted members\. If the unit has (\d+) members/,
      m => numIs(m[2] / (+m[1] + 1), PLAIN)],
    ['needScore', /scores (\d+), (\d+) and (\d+) on three tests.*exactly (\d+)\?/,
      m => numIs(4 * m[4] - (+m[1] + +m[2] + +m[3]), PLAIN)],
    ['distance', /drives for ([\d½]+) hours at an average speed of (\d+) miles per hour/,
      m => numIs(mixed(m[1]) * m[2], /^([\d,]+) miles$/)],
    ['unitPrice', /cost \$([\d.]+) for a (\d+)-pound bag.*how much would (\d+) pounds cost/,
      m => numIs(m[1] / m[2] * m[3], MONEY)],
    ['growth', /town of ([\d,]+) people grows by (\d+) percent/, m => numIs(num(m[1]) * (100 + +m[2]) / 100, PLAIN)],
    ['change', /priced \$([\d.]+) and \$([\d.]+), paying with a \$(\d+) bill/,
      m => numIs(m[3] - m[1] - m[2], MONEY)],
    ['pieces', /^A (\d+)-inch rope is cut into pieces (\d+) inches long/, m => numIs(m[1] / m[2], PLAIN)],
    ['reversePct', /^After a (\d+)% discount, a .+ sells for \$([\d.]+)\. What was the original price\?$/,
      m => numIs(m[2] / (1 - m[1] / 100), MONEY)],
    ['interestMonths', /^A soldier borrows \$([\d.]+) at (\d+)% simple interest per year\. How much interest is owed after (\d+) months\?$/,
      m => numIs(m[1] * m[2] / 100 * m[3] / 12, MONEY)],
    ['speedMinutes', /^A courier drives ([\d.]+) miles in (\d+) minutes\. What is the average speed in miles per hour\?$/,
      m => numIs(m[1] * 60 / m[2], /^([\d.]+) mph$/)],
    ['roundUp', /^(\d+) soldiers need a ride to the range\. Each truck carries (\d+) soldiers\. What is the fewest number of trucks needed\?$/,
      m => numIs(Math.ceil(m[1] / m[2]), /^(\d+) trucks$/)],
    ['flatFee', /^A truck rental costs \$(\d+) plus \$([\d.]+) per mile\. The bill came to \$([\d.]+)\. How many miles were driven\?$/,
      m => numIs((m[3] - m[1]) / m[2], /^(\d+) miles$/)]
  ],
  MK: [
    ['linear', /^Solve for x: (\d+)x \+ (\d+) = (\d+)$/,
      m => ch => { const c = String(ch).match(/^x = (-?\d+)$/); return !!c && m[1] * c[1] + +m[2] === +m[3]; }],
    ['foil', /^Multiply: \(x \+ (\d+)\)\(x ([+−]) (\d+)\)$/,
      m => { const p = +m[1], q = (m[2] === '−' ? -1 : 1) * m[3]; return ch => samePoly(poly(ch), [1, p + q, p * q]); }],
    ['circle', /^What is the (area|circumference) of a circle with a radius of (\d+) inches\?$/,
      m => m[1] === 'area' ? numIs(m[2] * m[2], /^(\d+)π sq in$/) : numIs(2 * m[2], /^(\d+)π in$/)],
    ['volume', /box measures (\d+) in by (\d+) in by (\d+) in/, m => numIs(m[1] * m[2] * m[3], /^(\d+) cu in$/)],
    ['power', /^What is (\d+)([²³⁴])\?$/, m => numIs(Math.pow(+m[1], SUP[m[2]]), PLAIN)],
    ['angles', /triangle measure (\d+)° and (\d+)°/, m => numIs(180 - m[1] - m[2], /^(-?\d+)°$/)],
    ['roots', /^What is the value of √(\d+) \+ √(\d+)\?$/, m => numIs(Math.sqrt(m[1]) + Math.sqrt(m[2]), PLAIN)],
    ['fracEq', /^If (\d+)⁄(\d+) x = (\d+), what is x\?$/,
      m => ch => { const c = String(ch).match(/^x = (-?\d+)$/); return !!c && near(m[1] * c[1] / m[2], +m[3]); }],
    ['pctOf', /^What is (\d+) percent of (\d+)\?$/, m => numIs(m[1] * m[2] / 100, PLAIN)],
    ['stats', /^What is the (median|range) of the numbers ([\d, ]+)\?$/,
      m => { const v = m[2].split(',').map(Number).sort((x, y) => x - y);
             return numIs(m[1] === 'median' ? v[(v.length - 1) / 2] : v[v.length - 1] - v[0], PLAIN); }],
    ['distribute', /^Simplify: (\d+)\((\d+)x − (\d+)\) \+ (\d+)x$/,
      m => ch => samePoly(poly(ch), [0, m[1] * m[2] + +m[4], -m[1] * m[3]])],
    ['pythag-hyp', /legs of (\d+) inches and (\d+) inches\. How long is the hypotenuse/,
      m => numIs(Math.sqrt(m[1] * m[1] + m[2] * m[2]), /^(\d+) in$/)],
    ['pythag-leg', /hypotenuse of (\d+) inches and one leg of (\d+) inches/,
      m => numIs(Math.sqrt(m[1] * m[1] - m[2] * m[2]), /^(\d+) in$/)],
    ['square-perim', /^A square has an area of (\d+) square feet\. What is its perimeter\?$/,
      m => numIs(4 * Math.sqrt(m[1]), /^(\d+) ft$/)],
    ['square-area', /^A square has a perimeter of (\d+) feet\. What is its area\?$/,
      m => numIs((m[1] / 4) * (m[1] / 4), /^(\d+) sq ft$/)],
    ['marbles', /holds (\d+) red, (\d+) blue and (\d+) green marbles.*probability it is (red|blue|green)\?$/,
      m => { const cnt = { red: +m[1], blue: +m[2], green: +m[3] }, tot = cnt.red + cnt.blue + cnt.green;
             return ch => { const c = String(ch).match(/^(\d+)\/(\d+)$/); return !!c && near(c[1] / c[2], cnt[m[4]] / tot); }; }],
    ['inequality', /^Solve the inequality: (\d+)x \+ (\d+) < (\d+)$/,
      m => ch => { const c = String(ch).match(/^x ([<>]) (-?\d+)$/); return !!c && c[1] === '<' && near(+c[2], (m[3] - m[2]) / m[1]); }],
    ['ineqFlip', /^Solve the inequality: (\d+) − (\d+)x > (−?\d+)$/,
      m => ch => { const c = String(ch).match(/^x ([<>]) (−?\d+)$/);     // b − ax > c  →  x < (b − c)/a
                   return !!c && c[1] === '<' && near(minus(c[2]), (m[1] - minus(m[3])) / m[2]); }],
    ['circleFromC', /^What is the area of a circle whose circumference is (\d+)π inches\?$/,
      m => numIs((m[1] / 2) * (m[1] / 2), /^(\d+)π sq in$/)],
    ['powProd', /^Simplify: \((\d)x([⁰¹²³⁴⁵⁶⁷⁸⁹]+)\)([⁰¹²³⁴⁵⁶⁷⁸⁹]+)$/,
      m => ch => { const c = String(ch).match(/^(\d+)x([⁰¹²³⁴⁵⁶⁷⁸⁹]+)$/);
                   return !!c && +c[1] === Math.pow(+m[1], supNum(m[3])) && supNum(c[2]) === supNum(m[2]) * supNum(m[3]); }],
    ['evalNeg', /^If x = −(\d+) and y = (\d+), what is the value of x² − (\d)xy\?$/,
      m => { const x = -m[1], y = +m[2], v = x * x - m[3] * x * y;
             return ch => { const c = String(ch).match(/^(−?\d+)$/); return !!c && minus(c[1]) === v; }; }]
  ]
};

function checkGenerated(code, it, where){
  checkTextItem(it, where, code);
  ok(it.ord === 1, `${where}: generated item must carry ord:1`);
  const hit = CHECKERS[code].filter(ck => ck[1].test(it.q));
  if (!ok(hit.length === 1, `${where}: ${hit.length} checkers match "${it.q}" — add/fix a re-check in tools/validate.js`)) return null;
  const pred = hit[0][2](it.q.match(hit[0][1]));
  const verdicts = it.c.map(ch => pred(strip(ch)));
  ok(verdicts[it.a] === true, `${where} [${hit[0][0]}]: keyed choice "${it.c[it.a]}" is WRONG for "${it.q}" ${JSON.stringify(it.c)}`);
  ok(verdicts.filter(Boolean).length === 1, `${where} [${hit[0][0]}]: ${verdicts.filter(Boolean).length} choices satisfy "${it.q}" ${JSON.stringify(it.c)}`);
  return hit[0][0];
}

const covered = { AR: new Set(), MK: new Set() };
[['AR', S.GEN_AR], ['MK', S.GEN_MK]].forEach(([code, gens]) => {
  gens.forEach(fn => {
    const mine = new Set();
    for (let i = 0; i < GEN_RUNS; i++){
      let it;
      try { it = fn(); } catch (e){ ok(false, `GEN_${code}.${fn.name} threw: ${e.message}`); break; }
      const name = checkGenerated(code, it, `GEN_${code}.${fn.name}#${i}`);
      if (name){ mine.add(name); covered[code].add(name); }
    }
    ok(mine.size > 0, `GEN_${code}.${fn.name}: no output was recognised by a checker`);
  });
  CHECKERS[code].forEach(ck => ok(covered[code].has(ck[0]), `checker ${code}/${ck[0]} never fired — stale checker or dead template branch`));
});

for (let i = 0; i < AO_RUNS; i++){
  const it = S.genAO();
  checkAOItem(it, `genAO#${i}`);
  ok(it.ord === 1, `genAO#${i}: must carry ord:1`);
}

/* ---------- AO puzzle items: independent geometric re-check ----------
   Written separately from the generator (which compares edge/angle sequences):
   here pieces are compared by best-fit rigid alignment of their vertices. */
const cen = P => [P.reduce((t, p) => t + p[0], 0) / P.length, P.reduce((t, p) => t + p[1], 0) / P.length];
const parea = P => { let t = 0; for (let i = 0; i < P.length; i++){ const p = P[i], q = P[(i + 1) % P.length]; t += p[0] * q[1] - q[0] * p[1]; } return t / 2; };
function convex(P){
  let pos = 0, neg = 0;
  for (let i = 0; i < P.length; i++){
    const a = P[i], b = P[(i + 1) % P.length], c = P[(i + 2) % P.length];
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (cr > 1e-6) pos++; else if (cr < -1e-6) neg++;
  }
  return pos === 0 || neg === 0;
}
function hullArea(pts){
  const P = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const p of P){ while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (const p of P.slice().reverse()){ while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
  return Math.abs(parea(lo.slice(0, -1).concat(hi.slice(0, -1))));
}
function alignGap(X, Y, mirror){             // max vertex gap after the best rotation (+ mirror) of Y onto X
  if (X.length !== Y.length) return Infinity;
  const n = X.length, cx = cen(X), cy = cen(Y);
  const Xc = X.map(p => [p[0] - cx[0], p[1] - cx[1]]);
  const base = Y.map(p => [p[0] - cy[0], p[1] - cy[1]]);
  const variants = [base].concat(mirror ? [base.map(p => [-p[0], p[1]]).reverse()] : []);
  let best = Infinity;
  for (const V of variants) for (let sh = 0; sh < n; sh++){
    const Ys = V.map((_, i) => V[(i + sh) % n]);
    let sd = 0, sx = 0;
    for (let i = 0; i < n; i++){ const a = Xc[i], b = Ys[i]; sd += a[0] * b[0] + a[1] * b[1]; sx += b[0] * a[1] - b[1] * a[0]; }
    const th = Math.atan2(sx, sd), co = Math.cos(th), si = Math.sin(th);
    let gap = 0;
    for (let i = 0; i < n; i++){ const b = Ys[i], r = [b[0] * co - b[1] * si, b[0] * si + b[1] * co]; gap = Math.max(gap, Math.hypot(r[0] - Xc[i][0], r[1] - Xc[i][1])); }
    best = Math.min(best, gap);
  }
  return best;
}
function permsOf(n){ if (n === 1) return [[0]]; const o = []; permsOf(n - 1).forEach(p => { for (let i = 0; i <= p.length; i++){ const q = p.slice(); q.splice(i, 0, n - 1); o.push(q); } }); return o; }
function setGap(A, B, cost){                  // best pairing of two piece sets, worst pair's cost
  if (A.length !== B.length) return Infinity;
  const C = A.map(x => B.map(y => cost(x, y)));
  let best = Infinity;
  permsOf(A.length).forEach(p => { let w = 0; p.forEach((j, i) => { w = Math.max(w, C[i][j]); }); best = Math.min(best, w); });
  return best;
}
const TURNS = [0, 45, 90, 135, 180, 225, 270, 315];
let puzPie = 0, puzPoly = 0;
function checkPuzzle(it, where){
  if (!ok(it && it.kind === 'puz' && Array.isArray(it.stem) && Array.isArray(it.options), `${where}: not a puzzle item`)) return;
  ok(it.ord === 1, `${where}: puzzle must carry ord:1`);
  ok(typeof it.key === 'string' && it.key.length > 10, `${where}: missing key`);
  ok(typeof it.why === 'string' && strip(it.why).length > 30, `${where}: missing explanation`);
  ok(it.stem.length >= 2 && it.stem.length <= 4, `${where}: stem has ${it.stem.length} pieces`);
  if (!ok(it.options.length === 4, `${where}: needs 4 options`)) return;
  if (!ok(Number.isInteger(it.a) && it.a >= 0 && it.a <= 3, `${where}: answer index`)) return;
  it.stem.forEach(s => ok(TURNS.includes(s.rot), `${where}: stem turn ${s.rot}`));
  it.options.forEach(o => ok([0, 90, 180, 270].includes(o.rot), `${where}: option turn ${o.rot}`));
  const stemP = it.stem.map(s => s.g);
  if (it.pie){
    puzPie++;
    const sweeps = P => P.map(g => g.sw);
    const sum = P => sweeps(P).reduce((x, y) => x + y, 0);
    ok(sum(stemP) === 360, `${where}: stem sectors sum to ${sum(stemP)}`);
    it.options.forEach((o, k) => ok(sum(o.pieces) === 360, `${where}: option ${k} sectors sum to ${sum(o.pieces)}`));
    it.options.forEach((o, k) => {
      const gap = setGap(stemP, o.pieces, (x, y) => Math.abs(x.sw - y.sw));
      if (k === it.a) ok(gap === 0, `${where}: keyed pie differs from the pieces (${gap}°)`);
      else ok(gap >= 20, `${where}: wrong pie ${k} is too close to the pieces (${gap}°)`);
    });
    return;
  }
  puzPoly++;
  const polyOK = P => Array.isArray(P) && P.length >= 3 && P.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) && p[0] >= -0.5 && p[0] <= 100.5 && p[1] >= -0.5 && p[1] <= 100.5);
  it.options.forEach((o, k) => {
    ok(o.pieces.length >= 2 && o.pieces.length <= 5, `${where}: option ${k} has ${o.pieces.length} pieces`);
    if (!ok(o.pieces.every(polyOK), `${where}: option ${k} has a malformed piece`)) return;
    ok(o.pieces.every(convex), `${where}: option ${k} has a non-convex piece`);
    const tot = o.pieces.reduce((t, P) => t + Math.abs(parea(P)), 0), hull = hullArea([].concat(...o.pieces));
    ok(Math.abs(tot - hull) / hull < 0.01, `${where}: option ${k} pieces overlap or leave gaps (${tot.toFixed(1)} vs hull ${hull.toFixed(1)})`);
    const gap = setGap(stemP, o.pieces, (x, y) => alignGap(x, y, k !== it.a));
    if (k === it.a) ok(gap < 0.3, `${where}: keyed figure is not made of the stem pieces (gap ${gap.toFixed(2)})`);
    else ok(gap >= 5, `${where}: wrong figure ${k} could pass for the pieces (gap ${gap.toFixed(2)})`);
  });
  it.stem.forEach((s, i) => {           // turned piece must fit its 130-unit display slot
    const c0 = cen(s.g), r = s.rot * Math.PI / 180;
    const pts = s.g.map(p => [(p[0] - c0[0]) * Math.cos(r) - (p[1] - c0[1]) * Math.sin(r), (p[0] - c0[0]) * Math.sin(r) + (p[1] - c0[1]) * Math.cos(r)]);
    const w = Math.max(...pts.map(p => p[0])) - Math.min(...pts.map(p => p[0])), h = Math.max(...pts.map(p => p[1])) - Math.min(...pts.map(p => p[1]));
    ok(w <= 126 && h <= 126, `${where}: stem piece ${i} too big for its slot (${w.toFixed(0)}×${h.toFixed(0)})`);
  });
}
const PUZ_RUNS = +process.env.PUZ_RUNS || 1500;   // PUZ_RUNS=20000 node tools/validate.js for a deep soak
for (let i = 0; i < PUZ_RUNS; i++) checkPuzzle(S.genAOPuzzle(), `genAOPuzzle#${i}`);
ok(puzPie > PUZ_RUNS * .15 && puzPoly > PUZ_RUNS * .5, `puzzle mix off: ${puzPie} pies, ${puzPoly} polygons`);


/* =====================================================================
   3. buildQuestions — whole sittings
   ===================================================================== */
let aoPuz = 0;
CODES.forEach(code => {
  store.clear();
  let prevKey = null;
  for (let run = 0; run < BUILD_RUNS; run++){
    const qs = S.buildQuestions({ code: code });
    const where = `build ${code}#${run}`;
    if (!ok(Array.isArray(qs) && qs.length === 10, `${where}: got ${qs && qs.length} items, want 10`)) continue;
    const stems = [];
    qs.forEach((q, i) => {
      if (code === 'AO'){
        if (q.kind === 'puz'){ aoPuz++; checkPuzzle(q, `${where}[${i}]`); stems.push(q.key); }
        else { checkAOItem(q, `${where}[${i}]`); stems.push(JSON.stringify(q.base) + JSON.stringify(q.options)); }
        return;
      }
      checkTextItem(q, `${where}[${i}]`, code);
      stems.push((q.p || '') + '|' + q.q);
      const nums = q.c.map(S.parseNumish);
      if (!q.ord && nums.every(v => v !== null) && new Set(nums).size === 4)
        ok(nums.every((v, k) => k === 0 || nums[k - 1] < v), `${where}[${i}]: numeric choices not ascending ${JSON.stringify(q.c)}`);
    });
    ok(new Set(stems).size === 10, `${where}: the same question appears twice in one sitting`);
    if (code === 'PC'){
      const closed = new Set(); let cur = null;
      qs.forEach(q => { if (q.p !== cur){ ok(!closed.has(q.p), `${where}: passage ${q.p} is split apart`); if (cur) closed.add(cur); cur = q.p; } });
    }
    const key = stems.slice().sort().join('||');
    ok(key !== prevKey, `${where}: identical draw to the previous sitting`);
    prevKey = key;
  }
});

ok(aoPuz > BUILD_RUNS * 3 && aoPuz < BUILD_RUNS * 6, `AO sittings: ${aoPuz} puzzle items in ${BUILD_RUNS} sittings (want ~4–5 per sitting)`);

/* the 209-word test: 20 items, valid, key survives the shuffle */
store.clear();
for (let run = 0; run < 60; run++){
  const qs = S.buildQuestions(S.W209_TEST);
  if (!ok(Array.isArray(qs) && qs.length === 20, `W209_TEST#${run}: got ${qs && qs.length}`)) continue;
  qs.forEach((q, i) => {
    checkTextItem(q, `W209_TEST#${run}[${i}]`, 'WK');
    const w = strip(q.q).replace(/ most nearly means$/, '');
    const e = S.W209.find(x => x.w === w);
    ok(!!e && strip(q.c[q.a]) === e.k, `W209_TEST#${run}[${i}]: key for "${w}" is not its curated synonym`);
  });
  ok(new Set(qs.map(q => q.q)).size === 20, `W209_TEST#${run}: repeated word in one sitting`);
}

/* a static item whose keyed answer survives finalizeChoices: the text at q.a must not change */
CODES.filter(c => c !== 'AO').forEach(code => {
  S.BANK[code].forEach((it, i) => {
    const copy = JSON.parse(JSON.stringify(it));
    S.finalizeChoices(copy, code);
    ok(copy.c[copy.a] === it.c[it.a], `${code}[${i}]: finalizeChoices moved the key off the correct choice`);
  });
});


/* =====================================================================
   5. Mock-mode tutor content (v5.5): an example for every written item,
      PC proofs that really occur in the passage, an example sentence for
      every 209-list word, and a "same idea" sibling for every template.
   ===================================================================== */
const onlyB = t => !/<(?!\/?b>)[a-z\/]/i.test(String(t));
let exAttached = 0, proofs = 0;
CODES.filter(c => c !== 'AO').forEach(code => S.BANK[code].forEach((it, i) => {
  const where = `${code}[${i}]`;
  if (!ok(typeof it.ex === 'string', `${where}: no Mock-mode example`)) return;
  exAttached++;
  const len = strip(it.ex).length;
  ok(len >= 20 && len <= 320, `${where}: example length ${len}`);
  ok(onlyB(it.ex), `${where}: example has HTML other than <b>`);
  ok(!/\b(answer|choice) (is )?[A-D]\b/.test(strip(it.ex)), `${where}: example names an answer letter`);
  if (it.proof !== undefined){
    proofs++;
    ok(code === 'PC' && S.PASSAGES[it.p].indexOf(it.proof) !== -1, `${where}: proof quote not found verbatim in passage ${it.p}`);
  }
}));
ok(exAttached === Object.keys(S.EXAMPLES).length, `EXAMPLES has ${Object.keys(S.EXAMPLES).length} entries but ${exAttached} items got one — orphaned or colliding keys`);
ok(proofs === Object.keys(S.PROOFS).length && proofs >= S.BANK.PC.length - 5, `PC proofs attached: ${proofs} of ${Object.keys(S.PROOFS).length}`);
S.W209.forEach(e => {
  const x = S.W209_EX[e.w];
  ok(typeof x === 'string' && /<b>[^<]+<\/b>/.test(x) && strip(x).length >= 20 && onlyB(x), `W209_EX: bad or missing sentence for "${e.w}"`);
  ok(S.w209Item(e).ex === x, `w209Item("${e.w}") does not carry its example`);
});
[['AR', S.GEN_AR], ['MK', S.GEN_MK]].forEach(([code, gens]) => {
  gens.forEach(fn => {
    for (let i = 0; i < 60; i++){
      const q = fn(); q.tpl = fn.name;
      const x = S.exampleFor(q, code);
      ok(/^Same idea: .+ → <b>.+<\/b>\. /.test(x), `GEN_${code}.${fn.name}: no same-idea example (${String(x).slice(0, 60)})`);
      const sib = (String(x).match(/^Same idea: (.+?) → <b>/) || [])[1];
      ok(sib && sib !== q.q, `GEN_${code}.${fn.name}: example repeats the question itself`);
    }
  });
  for (let i = 0; i < 200; i++){
    const g = S.GEN[code]();
    ok(gens.some(f => f.name === g.tpl), `GEN.${code}() item carries no template tag`);
  }
});
ok(/Cross out/.test(S.exampleFor(S.genAO(), 'AO')) && /Cross out/.test(S.exampleFor(S.genAOPuzzle(), 'AO')), 'AO items need a tip example');
{ const L = ['A','B','C','D'];
  const conItems = S.BANK.AO.map(x => JSON.parse(JSON.stringify(x))).concat(Array.from({length: 300}, () => S.genAO()));
  conItems.forEach((q, n) => {
    if (n < S.BANK.AO.length) S.finalizeChoices(q, 'AO');
    const w = S.aoConWhy(q);
    ok(w.startsWith(L[q.a] + ' is the only figure'), `aoConWhy #${n}: does not name the key first`);
    q.options.forEach((o, k) => { if (k !== q.a) ok(w.indexOf(' ' + L[k] + ' ') !== -1, `aoConWhy #${n}: says nothing about wrong figure ${L[k]} — ${w}`); });
    ok(!/undefined/.test(w), `aoConWhy #${n}: undefined in "${w}"`);
  });
}

/* ---------- report ---------- */
const counts = CODES.map(c => `${c}:${S.BANK[c].length}`).join(' ');
console.log(`bank  ${counts}  = ${staticTotal} static items, ${Object.keys(S.PASSAGES).length} passages`);
console.log(`gens  AR ${S.GEN_AR.length} templates · MK ${S.GEN_MK.length} templates · ${GEN_RUNS} runs each · genAO ${AO_RUNS} runs`);
console.log(`build ${BUILD_RUNS} sittings × ${CODES.length} subtests · AO puzzles ${aoPuz} in sittings · genAOPuzzle ${PUZ_RUNS} runs (${puzPie} pies)`);
console.log(`mock  ${exAttached} written examples · ${proofs} PC proofs · ${Object.keys(S.W209_EX).length} word sentences · same-idea examples for ${S.GEN_AR.length + S.GEN_MK.length} templates`);
if (failures.length){
  console.error(`\nFAIL — ${failures.length} of ${checks} checks failed:`);
  failures.filter(Boolean).forEach(f => console.error('  ✗ ' + f));
  if (failures.some(f => f === null)) console.error('  … (further failures suppressed)');
  process.exit(1);
}
console.log(`\nPASS — ${checks.toLocaleString()} checks, 0 failures`);
