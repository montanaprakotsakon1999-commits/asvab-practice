#!/usr/bin/env node
/* =====================================================================
   Bank validator — run before every push:  node tools/validate.js

   1. Static bank: shape, unique choices, answer index, explanation,
      passage keys, AO options/base agreement, duplicate stems.
   2. Generators: every AR/MK template is run many times; the question
      TEXT is re-parsed and the answer recomputed independently, then
      checked against the keyed choice — and against every other choice
      (ambiguity check). genAO is checked structurally.
   3. buildQuestions: many sittings per subtest — 10 items, valid
      structure, PC passages contiguous, numeric sets ascending, no
      repeated stem in a sitting, consecutive GS draws differ.
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
                 'genAO','GEN','GEN_MIX','STUDY','samplePool','finalizeChoices','buildQuestions','parseNumish'];
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
ok(S.STUDY.length === 9, 'STUDY should have 9 sheets');
S.STUDY.forEach(s => ok(CODES.includes(s.code) && strip(s.body).length > 100, `study sheet ${s.code} is empty or mis-coded`));

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
    ['pieces', /^A (\d+)-inch rope is cut into pieces (\d+) inches long/, m => numIs(m[1] / m[2], PLAIN)]
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
      m => ch => { const c = String(ch).match(/^x ([<>]) (-?\d+)$/); return !!c && c[1] === '<' && near(+c[2], (m[3] - m[2]) / m[1]); }]
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

/* =====================================================================
   3. buildQuestions — whole sittings
   ===================================================================== */
CODES.forEach(code => {
  store.clear();
  let prevKey = null;
  for (let run = 0; run < BUILD_RUNS; run++){
    const qs = S.buildQuestions({ code: code });
    const where = `build ${code}#${run}`;
    if (!ok(Array.isArray(qs) && qs.length === 10, `${where}: got ${qs && qs.length} items, want 10`)) continue;
    const stems = [];
    qs.forEach((q, i) => {
      if (code === 'AO'){ checkAOItem(q, `${where}[${i}]`); stems.push(JSON.stringify(q.base) + JSON.stringify(q.options)); return; }
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

/* a static item whose keyed answer survives finalizeChoices: the text at q.a must not change */
CODES.filter(c => c !== 'AO').forEach(code => {
  S.BANK[code].forEach((it, i) => {
    const copy = JSON.parse(JSON.stringify(it));
    S.finalizeChoices(copy, code);
    ok(copy.c[copy.a] === it.c[it.a], `${code}[${i}]: finalizeChoices moved the key off the correct choice`);
  });
});

/* ---------- report ---------- */
const counts = CODES.map(c => `${c}:${S.BANK[c].length}`).join(' ');
console.log(`bank  ${counts}  = ${staticTotal} static items, ${Object.keys(S.PASSAGES).length} passages`);
console.log(`gens  AR ${S.GEN_AR.length} templates · MK ${S.GEN_MK.length} templates · ${GEN_RUNS} runs each · genAO ${AO_RUNS} runs`);
console.log(`build ${BUILD_RUNS} sittings × ${CODES.length} subtests`);
if (failures.length){
  console.error(`\nFAIL — ${failures.length} of ${checks} checks failed:`);
  failures.filter(Boolean).forEach(f => console.error('  ✗ ' + f));
  if (failures.some(f => f === null)) console.error('  … (further failures suppressed)');
  process.exit(1);
}
console.log(`\nPASS — ${checks.toLocaleString()} checks, 0 failures`);
