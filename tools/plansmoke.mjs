#!/usr/bin/env node
/* =====================================================================
   📅 PLAN smoke test (v6.4):  node tools/plansmoke.mjs [url-or-file]
   Pill order + persistence; plan data (53 weeks, phases, unique task ids,
   every task's ▶ Start maps to real subtests); today panel for a pinned
   date; ▶ Start launches the right sitting in PLAN mode (timed even with
   the Timed switch off, mock when "with answers" is ticked); home / Take
   another test come back to the plan; switching mode mid-sitting
   confirms; ticks persist and drive streak / sessions; week nav, strip,
   roadmap; finished AFQT sittings auto-log AFQT + CL (CL checked against
   the 92A results page), mock / mostly-skipped sittings don't; manual
   scores; settings; backup download + load (own format, old planner
   format, junk); light theme; 390 px; no console errors.
   ===================================================================== */
import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const here = path.dirname(fileURLToPath(import.meta.url));
const target = process.argv[2];
const URL_ = target ? (/^https?:/.test(target) ? target : pathToFileURL(path.resolve(target)).href)
                    : pathToFileURL(path.join(here, '..', 'index.html')).href;
let passed = 0;
const failures = [];
function check(cond, msg){ if (cond) passed++; else { failures.push(msg); console.error('  ✗ ' + msg); } }
const step = name => console.log('· ' + name);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plansmoke-'));

const browser = await chromium.launch();
const errors = [];
let dialogPlan = null, dialogs = [];
async function open(w, h){
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, acceptDownloads: true, locale: 'en-US' });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('dialog', async d => {          /* exactly ONE dialog handler per page */
    dialogs.push(d.message());
    if (dialogPlan === 'dismiss') await d.dismiss();
    else { if (dialogPlan !== 'accept') failures.push('unexpected dialog: ' + d.message()); await d.accept(); }
  });
  await page.goto(URL_);
  return page;
}
const vis = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); return !!e && !e.classList.contains('hidden'); }, sel);
const plan = page => page.evaluate(() => ASVAB_PLAN.state());
const sitting = page => page.evaluate(() => EX && { parts: EX.parts.map(p => p.name === '209 Words' ? 'W209' : p.code), timed: EX.timed, mock: EX.mock, modeAt: EX.modeAt });
const pinDay = (page, d) => page.evaluate(d => ASVAB_PLAN._today(d), d);
const noHScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
/* #screen-plan clips overflow-x, so also check nothing inside it sticks out */
const planFits = page => page.evaluate(() => {
  const s = document.querySelector('#screen-plan');
  if (s.scrollWidth > s.clientWidth + 1) return false;
  return [...s.querySelectorAll('*')].every(e => { const r = e.getBoundingClientRect(); return !r.width || (r.left >= -1 && r.right <= innerWidth + 1); });
});
/* answer every question of every part by keyboard (auto-advance), finishing each part */
async function sitAll(page){
  const n = await page.evaluate(() => EX.parts.length);
  for (let pi = 0; pi < n; pi++){
    const q = await page.evaluate(() => EX.parts[EX.pi].qs.length);
    for (let i = 0; i < q; i++){ await page.keyboard.press('abcd'[(pi + i) % 4]); await page.waitForTimeout(260); }
    await page.click('#btn-finish');
  }
}
async function leaveSitting(page){               // home mid-sitting: one confirm, accepted
  dialogs = []; dialogPlan = 'accept';
  await page.click('#home-btn');
  dialogPlan = null;
  check(dialogs.length === 1, 'home mid-sitting should confirm once');
}

try {
  const page = await open(1280, 900);

  /* ---------- pill + persistence ---------- */
  step('📅 PLAN pill first; opens the plan; remembered across reload');
  const pills = await page.$$eval('[data-mode-sw]', b => b.map(x => x.dataset.modeSw));
  check(JSON.stringify(pills) === JSON.stringify(['plan', 'study', 'exam', 'mock', 'game', 'gameth']), `mode pills are ${pills}`);
  check(await vis(page, '#screen-start') && !(await vis(page, '#screen-plan')), 'first visit should land on the exam start screen');
  await page.click('[data-mode-sw="plan"]');
  check(await vis(page, '#screen-plan') && !(await vis(page, '#screen-start')) && !(await vis(page, '#screen-study')), 'PLAN pill should show only the plan screen');
  check(await page.evaluate(() => localStorage.getItem('asvab_mode')) === '"plan"', 'plan mode not saved');
  await page.reload();
  check(await vis(page, '#screen-plan') && await page.evaluate(() => document.querySelector('[data-mode-sw].on').dataset.modeSw) === 'plan', 'plan mode not restored after reload');

  /* ---------- plan data ---------- */
  step('plan data: 53 weeks, phases cover every week, ids unique, every ▶ Start is a real sitting');
  const data = await page.evaluate(() => {
    const P = ASVAB_PLAN, codes = new Set(SUBTESTS.map(s => s.code).concat(['W209'])), bad = [], ids = new Set();
    let tasks = 0, starts = 0, dx = 0;
    const cover = []; for (let w = 1; w <= P.WEEKS; w++) cover.push(P.PHASES.filter(p => w >= p.a && w <= p.b).length);
    for (let off = 0; off < P.WEEKS * 7; off++){
      const d = new Date(2026, 8, 21 + off), t = P.tasksFor(d) || [];
      t.forEach(x => {
        tasks++;
        if (ids.has(x.id)) bad.push('dup id ' + x.id); ids.add(x.id);
        if (!(x.text && x.code && x.min >= 0)) bad.push('bad task ' + x.id);
        const l = P.launchFor(x);
        if (['AR','MK','PC','GS','MC','EI','AS','AO','WK'].includes(x.code) && !l) bad.push('no Start for ' + x.code + ' ' + x.id);
        if (x.code === 'DX' && /part \d:/i.test(x.text)){ dx++; if (!l || l.codes.length < 2) bad.push('exam part without its subtests: ' + x.text); }
        if (l){ starts++; if (!l.codes.length || !l.codes.every(c => codes.has(c))) bad.push('bad codes ' + l.codes + ' for ' + x.id); }
        if (l && x.code !== 'LOG'){                      // every subtest the task names must be in the sitting it starts
          const nm = (x.code === 'DX' ? x.text.slice(x.text.indexOf(':') + 1) : x.text).match(/\b(GS|AR|WK|PC|MK|EI|AS|MC|AO)\b/g) || [];
          nm.forEach(c => { if (!l.codes.includes(c)) bad.push(`"${x.text}" names ${c} but starts ${l.codes}`); });
        }
        if (/science questions/.test(x.text) && !(l && l.codes.join() === 'GS')) bad.push('science quiz should start GS: ' + (l && l.codes));
      });
    }
    return { weeks: P.W.length, cover, tasks, starts, dx, bad: bad.slice(0, 8) };
  });
  check(data.weeks === 53, `plan has ${data.weeks} weeks`);
  check(data.cover.every(n => n === 1), 'every week must sit in exactly one phase');
  check(data.tasks > 450 && data.starts > 250, `only ${data.tasks} tasks / ${data.starts} Start buttons`);
  check(data.dx === 12, `expected 12 practice-exam part tasks (Exam 1, Exam 2, retake × 4), found ${data.dx}`);
  check(data.bad.length === 0, 'plan data problems: ' + data.bad.join(' | '));

  /* ---------- today + ▶ Start ---------- */
  step('today (pinned Fri Sep 25): exam part 2 → ▶ Start runs WK + PC timed, in PLAN mode');
  await pinDay(page, '2026-09-25');
  const todayTxt = await page.innerText('#pl-today');
  check(/Fri Sep 25/.test(todayTxt) && /part 2: WK \+ PC/.test(todayTxt) && /week 1/i.test(todayTxt), 'today panel wrong: ' + todayTxt.slice(0, 120));
  await page.evaluate(() => { document.querySelector('#opt-timer').checked = false; });     // user turned the clock off elsewhere
  await page.click('#pl-today .pl-go');
  let st = await sitting(page);
  check(await vis(page, '#screen-exam') && !(await vis(page, '#screen-plan')), 'Start should open the exam screen');
  check(st && JSON.stringify(st.parts) === '["WK","PC"]' && st.timed === true && st.mock === false && st.modeAt === 'plan', 'Start launched ' + JSON.stringify(st));
  check(/^\d\d:\d\d$/.test((await page.textContent('#ex-clock')).trim()), 'plan sitting should show a running clock');
  check(await page.evaluate(() => document.body.dataset.mode === 'plan' && document.querySelector('#opt-timer').checked === false), 'launch must keep PLAN mode and leave the Timed switch as it was');
  await leaveSitting(page);
  check(await vis(page, '#screen-plan') && !(await vis(page, '#screen-start')), 'home from a plan sitting should return to the plan');
  await page.evaluate(() => { document.querySelector('#opt-timer').checked = true; });

  step('switching mode mid-sitting asks first (dismiss keeps the sitting)');
  await page.click('#pl-today .pl-go');
  dialogs = []; dialogPlan = 'dismiss';
  await page.click('[data-mode-sw="exam"]');
  dialogPlan = null;
  check(dialogs.length === 1 && /switch to Exam mode/.test(dialogs[0]), 'mode switch mid-sitting should confirm');
  check(await vis(page, '#screen-exam') && (await sitting(page)).modeAt === 'plan', 'dismissed switch should keep the plan sitting');
  await leaveSitting(page);

  /* ---------- ticks, streak, sessions ---------- */
  step('ticking tasks: saved, survives reload, drives streak + sessions');
  await pinDay(page, '2026-09-25');
  await page.check('#pl-today input[type=checkbox]');
  let ps = await plan(page);
  check(ps.done['w0d4_0'] === true, 'tick not saved as w0d4_0: ' + JSON.stringify(ps.done));
  check(await page.locator('#pl-today .pl-task.done').count() === 1 && /Session done/.test(await page.innerText('#pl-today')), 'ticked task should look done + session done');
  let stats = await page.$$eval('.pl-stat .v', v => v.map(x => x.textContent.trim()));
  check(stats[1] === '1' && stats[2] === '1', `streak/sessions should be 1/1, got ${stats}`);
  await page.reload(); await pinDay(page, '2026-09-26');
  check((await plan(page)).done['w0d4_0'] === true, 'tick lost on reload');
  await page.check('#pl-today input[type=checkbox]');
  stats = await page.$$eval('.pl-stat .v', v => v.map(x => x.textContent.trim()));
  check(stats[1] === '2' && stats[2] === '2', `two days in a row should give streak 2, got ${stats}`);
  await page.uncheck('#pl-today input[type=checkbox]');
  check(!(await plan(page)).done['w0d5_0'], 'untick should clear the task');

  /* ---------- week navigation ---------- */
  step('week panel: next / Now, strip cell, roadmap jump');
  await page.click('[data-wn="1"]');
  check(/Number sense & fractions/.test(await page.innerText('#pl-week')), 'next week should be week 2');
  await page.click('[data-wn="0"]');
  check(/Week 1 of 53/i.test(await page.innerText('#pl-week')), 'Now should go back to the current week');
  await page.click('.pl-cell[data-w="9"]');
  check(/Week 10 of 53/i.test(await page.innerText('#pl-week')) && await page.locator('.pl-cell.sel[data-w="9"]').count() === 1, 'strip cell should select week 10');
  await page.click('.pl-phase[data-jump="10"]');
  check(/Week 11 of 53/i.test(await page.innerText('#pl-week')) && /Reading & roots/.test(await page.innerText('#pl-week')), 'roadmap Build should jump to week 11');
  check(await page.locator('#pl-week .pl-go').count() >= 10, 'a Build week should have Start buttons on its tasks');

  /* ---------- with answers (mock) ---------- */
  step('"With answers" launches Mock sittings; not remembered as a mode change');
  await page.check('#pl-mock');
  check((await plan(page)).mock === true, 'mock preference not saved');
  await page.click('.pl-qcard[data-go="W209"]');
  st = await sitting(page);
  check(st && JSON.stringify(st.parts) === '["W209"]' && st.mock === true && st.timed === false && st.modeAt === 'plan', '209 with answers launched ' + JSON.stringify(st));
  check(/NO CLOCK/.test(await page.textContent('#ex-clock')), 'mock plan sitting should have no clock');
  await page.keyboard.press('a');
  await page.waitForSelector('#mock-fb', { timeout: 2000 });
  check(await page.locator('#mock-fb').count() === 1, 'mock feedback should show after answering');
  await leaveSitting(page);
  check(await page.evaluate(() => MOCK === false && document.body.dataset.mode === 'plan'), 'global MOCK must be restored after a plan mock launch');
  await page.uncheck('#pl-mock');

  /* ---------- auto score log ---------- */
  step('AFQT-only sitting from the plan: finished → logged with AFQT + CL, banner, back to plan');
  const before = (await plan(page)).scores.length;
  await page.click('.pl-qcard[data-go="AR,WK,PC,MK"]');
  check(JSON.stringify((await sitting(page)).parts) === '["AR","WK","PC","MK"]', 'AFQT card should launch AR WK PC MK');
  await sitAll(page);
  check(await vis(page, '#screen-results'), 'results should show');
  const shownPct = parseInt(await page.innerText('.afqt .big'), 10);
  ps = await plan(page);
  const e1 = ps.scores[ps.scores.length - 1];
  check(ps.scores.length === before + 1 && e1.auto === 1 && /AFQT only/.test(e1.n), 'AFQT sitting not auto-logged: ' + JSON.stringify(e1));
  check(e1 && e1.s === shownPct, `logged AFQT ${e1 && e1.s} ≠ results page ${shownPct}`);
  check(e1 && e1.cl >= 46 && e1.cl <= 154, `CL estimate ${e1 && e1.cl} out of range`);
  check(e1 && e1.d === '2026-09-26', 'auto entry should use today\'s date');
  check(/Saved to your plan/.test(await page.innerText('#pl-logged')), 'results should say the score was saved to the plan');
  await page.click('#btn-again');
  check(await vis(page, '#screen-plan') && !(await vis(page, '#screen-start')), '"Take another test" should return to the plan');
  const sv = await page.$$eval('.pl-stat .v', v => v.map(x => x.textContent.trim()));
  check(sv[3] === String(e1.s) && sv[4] === String(e1.cl), `stats should show latest AFQT/CL ${e1.s}/${e1.cl}, got ${sv}`);
  check(await page.locator('.pl-scores li').count() === ps.scores.length && await page.locator('.pl-chart circle').count() === ps.scores.length, 'score list / chart points missing');

  step('92A drill from EXAM mode: logged CL equals the CL on the results page');
  await page.click('[data-mode-sw="exam"]');
  await page.click('#mos-cards .mode[data-mos="92A"]');
  await sitAll(page);
  const clShown = parseInt(await page.innerText('.afqt >> nth=0 >> .big'), 10);
  ps = await plan(page);
  const e2 = ps.scores[ps.scores.length - 1];
  check(e2 && /92A drill/.test(e2.n) && e2.cl === clShown, `92A: logged CL ${e2 && e2.cl} ≠ results CL ${clShown}`);
  await page.click('#home-btn');
  await page.click('[data-mode-sw="plan"]');

  step('not logged: mock sittings, mostly-skipped sittings, sittings without all four AFQT parts');
  const count = async () => (await plan(page)).scores.length;
  const n0 = await count();
  const fake = (codes, mock, fill) => page.evaluate(([codes, mock, fill]) => {
    const was = MOCK; MOCK = mock; startExam(codes.map(byCode)); MOCK = was;
    EX.parts.forEach(p => p.ans = p.ans.map((_, i) => i < Math.round(p.qs.length * fill) ? p.qs[i].a : null));
    finish();
  }, [codes, mock, fill]);
  await fake(['AR', 'WK', 'PC', 'MK'], true, 1);
  check(await count() === n0 && await page.locator('#pl-logged').count() === 0, 'mock AFQT sitting must not be logged');
  await fake(['AR', 'WK', 'PC', 'MK'], false, 0.3);
  check(await count() === n0, 'a 30%-answered sitting must not be logged');
  await fake(['AR', 'MK'], false, 1);
  check(await count() === n0, 'AR + MK alone has no AFQT and must not be logged');
  await fake(['AR', 'WK', 'PC', 'MK'], false, 1);
  ps = await plan(page);
  check(ps.scores.length === n0 + 1 && ps.scores[ps.scores.length - 1].s >= 90, 'all-correct AFQT sitting should log a high AFQT');
  await page.evaluate(() => { const t = document.querySelector('#opt-timer'), w = t.checked; t.checked = false;
    startExam(['AR', 'WK', 'PC', 'MK'].map(byCode)); t.checked = w; EX.parts.forEach(p => p.ans = p.qs.map(q => q.a)); finish(); });
  ps = await plan(page);
  check(ps.scores.length === n0 + 2 && /\(untimed\)$/.test(ps.scores[ps.scores.length - 1].n), 'untimed sitting should be logged and marked (untimed)');
  await page.click('#btn-again');
  check(await vis(page, '#screen-plan'), 'back to plan after results');

  /* ---------- manual scores + settings ---------- */
  step('manual score add / remove; goal + test date settings');
  await page.fill('#pl-sc-note', 'Real ASVAB');
  await page.fill('#pl-sc-val', '63');
  await page.fill('#pl-sc-date', '2027-04-02');
  await page.click('#pl-add button[type=submit]');
  ps = await plan(page);
  const man = ps.scores.find(x => x.n === 'Real ASVAB');
  check(man && man.s === 63 && man.d === '2027-04-02' && !man.auto, 'manual score not saved: ' + JSON.stringify(man));
  check((await page.$$eval('.pl-stat .v', v => v.map(x => x.textContent.trim())))[3] === '63', 'latest AFQT should be the newest-dated score');
  await page.click(`[data-del="${man.id}"]`);
  check(!(await plan(page)).scores.some(x => x.n === 'Real ASVAB'), 'remove did not delete the score');
  await page.fill('#pl-goal', '65'); await page.press('#pl-goal', 'Enter'); await page.locator('#pl-goal').blur();
  await page.waitForTimeout(100);
  check((await plan(page)).goal === 65 && /goal 65/.test(await page.innerText('.pl-stats')), 'goal setting not applied');
  await page.fill('#pl-test', '2027-03-01'); await page.locator('#pl-test').blur(); await page.waitForTimeout(100);
  check((await plan(page)).testDate === '2027-03-01' && /days to test · Mar 1/i.test(await page.innerText('.pl-counts')), 'test date setting not applied');
  await page.focus('#pl-test');                          // type a date key by key (Chrome saves after each segment)
  await page.keyboard.type('05052028', { delay: 30 });   // day = month, so segment order doesn't matter
  await page.waitForTimeout(100);
  check((await plan(page)).testDate === '2028-05-05', 'typed test date saved as ' + (await plan(page)).testDate);
  check(await page.evaluate(() => document.activeElement && document.activeElement.id === 'pl-test'), 'typing a date must keep focus in the field');
  check(/days to test · May 5\b/i.test(await page.innerText('.pl-counts')), 'counter not updated while typing a date');
  await page.fill('#pl-test', '2027-03-01'); await page.locator('#pl-test').blur();
  step('a new day while the tab stays open moves Today forward');
  await pinDay(page, '2026-09-28');
  await page.evaluate(() => ASVAB_PLAN._today('2026-09-29', true));
  check(/Mon Sep 28/.test(await page.innerText('#pl-today')), 'setup: Today should still show Sep 28 before refresh');
  await page.evaluate(() => ASVAB_PLAN.refresh());
  check(/Tue Sep 29/.test(await page.innerText('#pl-today')), 'refresh after midnight should move Today to Sep 29');
  await pinDay(page, '2026-09-26');

  /* ---------- backup ---------- */
  step('backup: download, then load into a fresh browser; old planner format; junk file');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#pl-export')]);
  const file = path.join(tmp, 'backup.json');
  await dl.saveAs(file);
  const bk = JSON.parse(fs.readFileSync(file, 'utf8'));
  ps = await plan(page);
  check(bk.app === 'asvab-plan' && bk.plan && bk.plan.done['w0d4_0'] === true && bk.plan.scores.length === ps.scores.length, 'backup file content wrong');
  check(/asvab-plan-backup-\d{4}-\d{2}-\d{2}\.json/.test(dl.suggestedFilename()), 'backup filename ' + dl.suggestedFilename());
  const fresh = await open(1280, 900);
  await fresh.click('[data-mode-sw="plan"]');
  await fresh.setInputFiles('#pl-import', file);
  await fresh.waitForFunction(() => ASVAB_PLAN.state().scores.length > 0);
  const fs1 = await fresh.evaluate(() => ASVAB_PLAN.state());
  check(fs1.done['w0d4_0'] === true && fs1.scores.length === ps.scores.length && fs1.goal === 65 && fs1.testDate === '2027-03-01', 'backup did not load fully');
  check(/Loaded backup/.test(await fresh.innerText('#pl-msg')), 'no confirmation after loading a backup');
  const old = path.join(tmp, 'old.json');
  fs.writeFileSync(old, JSON.stringify({ done: { '20260924_0': true, '20261001_1': true, '20260925_0': false }, scores: [{ id: 'b1', d: '2026-09-27', s: 41, n: 'Exam 1 baseline' }], testDate: '2027-05-03', shipDate: '2027-07-01', goal: 55 }));
  await fresh.setInputFiles('#pl-import', old);
  await fresh.waitForFunction(() => ASVAB_PLAN.state().scores.some(x => x.id === 'b1'));
  const fs2 = await fresh.evaluate(() => ASVAB_PLAN.state());
  check(fs2.done['w0d3_0'] === true && fs2.done['w1d3_1'] === true && fs2.testDate === '2027-05-03' && fs2.goal === 55, 'old planner format not converted: ' + JSON.stringify(fs2.done));
  check(fs2.done['w0d4_0'] === true && fs1.scores.every(x => fs2.scores.some(y => y.id === x.id)), 'Load must merge, not replace: earlier ticks / scores lost');
  const empty = path.join(tmp, 'empty.json');
  fs.writeFileSync(empty, '{}');
  await fresh.evaluate(() => { document.querySelector('#pl-msg').textContent = ''; });
  await fresh.setInputFiles('#pl-import', empty);
  await fresh.waitForFunction(() => /isn’t a plan backup/.test(document.querySelector('#pl-msg').textContent));
  const fs3 = await fresh.evaluate(() => ASVAB_PLAN.state());
  check(fs3.goal === 55 && fs3.testDate === '2027-05-03', '{} must not reset settings');
  const noid = path.join(tmp, 'noid.json');
  fs.writeFileSync(noid, JSON.stringify({ scores: [{ d: '2026-10-10', s: 44, n: 'Hand typed' }] }));
  for (let k = 0; k < 2; k++){
    await fresh.evaluate(() => { document.querySelector('#pl-msg').textContent = ''; });
    await fresh.setInputFiles('#pl-import', noid);
    await fresh.waitForFunction(() => /Loaded backup/.test(document.querySelector('#pl-msg').textContent));
  }
  const fs4 = await fresh.evaluate(() => ASVAB_PLAN.state());
  check(fs4.scores.filter(x => x.n === 'Hand typed').length === 1 && fs4.goal === 55, 'loading the same id-less score twice must not duplicate it (or touch settings)');
  const junk = path.join(tmp, 'junk.json');
  fs.writeFileSync(junk, 'not json at all');
  await fresh.evaluate(() => { document.querySelector('#pl-msg').textContent = ''; });
  await fresh.setInputFiles('#pl-import', junk);
  await fresh.waitForFunction(() => /isn’t a plan backup/.test(document.querySelector('#pl-msg').textContent));
  check((await fresh.evaluate(() => ASVAB_PLAN.state())).scores.length === fs4.scores.length, 'junk file changed the plan');
  step('two tabs: a score logged in one tab survives a tick in the other, and shows there');
  const tabB = await fresh.context().newPage();
  tabB.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await tabB.goto(URL_);
  const nA = (await fresh.evaluate(() => ASVAB_PLAN.state())).scores.length;
  const rowsA = () => fresh.locator('.pl-scores li').count();
  check(await rowsA() === nA, 'setup: tab A score rows');
  await tabB.evaluate(() => { startExam(['AR', 'WK', 'PC', 'MK'].map(byCode)); EX.parts.forEach(p => p.ans = p.qs.map(q => q.a)); finish(); });
  const shown = await fresh.waitForFunction(n => document.querySelectorAll('.pl-scores li').length === n, nA + 1, { timeout: 3000 }).then(() => true, () => false);
  check(shown, 'tab A should pick up the score tab B logged without a reload');
  const boxId = await fresh.locator('#pl-week input[type=checkbox]:not(:checked)').first().getAttribute('data-t');
  await fresh.locator(`#pl-week input[data-t="${boxId}"]`).check();    // by id: ":not(:checked)" would move to the next box
  const stored = await fresh.evaluate(() => JSON.parse(localStorage.getItem('asvab_plan')));
  check(stored.done[boxId] === true, 'setup: tab A tick not saved');
  check(stored.scores.length === nA + 1, `tab A's tick erased tab B's score (${stored.scores.length} stored, want ${nA + 1})`);
  await fresh.context().close();

  /* ---------- light theme ---------- */
  step('light theme: plan renders on the light palette');
  await page.click('#theme-btn');
  check(await page.evaluate(() => getComputedStyle(document.body).backgroundColor) === 'rgb(220, 225, 220)', 'light theme not applied');
  const pc = await page.evaluate(() => getComputedStyle(document.querySelector('.pl-count')).borderTopColor);
  check(pc === 'rgb(162, 51, 111)', 'plan accent should switch to its light token, got ' + pc);
  await page.click('#theme-btn');
  await page.context().close();

  /* ---------- phone ---------- */
  step('390 px: pills fit, plan fits, Start works');
  const ph = await open(390, 844);
  await ph.click('[data-mode-sw="plan"]');
  await pinDay(ph, '2026-10-06');
  await ph.evaluate(() => { startExam(['AR', 'WK', 'PC', 'MK'].map(byCode)); EX.parts.forEach(p => p.ans = p.qs.map(q => q.a)); finish(); });
  await ph.click('#btn-again');
  check(await noHScroll(ph), '390px: horizontal scroll on the plan');
  check(await planFits(ph), '390px: plan content overflows (hidden by overflow-x:clip)');
  const tiny = await ph.evaluate(() => [...document.querySelectorAll('.pl-chart text')].filter(t => t.getBoundingClientRect().height < 8).length);
  check(tiny === 0, `390px: ${tiny} chart labels are too small to read`);
  const boxes = await ph.$$eval('[data-mode-sw]', b => b.map(x => { const r = x.getBoundingClientRect(); return [r.left, r.right]; }));
  check(boxes.length === 6 && boxes.every(([l, r]) => l >= 0 && r <= 390), '390px: a mode pill is off screen ' + JSON.stringify(boxes));
  check(await ph.locator('#pl-today .pl-go').count() === 2, '390px: Oct 6 should have 2 Start buttons');
  await ph.click('#pl-today .pl-go >> nth=1');
  check(JSON.stringify((await sitting(ph)).parts) === '["PC"]' && await noHScroll(ph), '390px: second Start should run PC and fit');
  await ph.context().close();

  check(errors.length === 0, 'console errors: ' + errors.join(' | '));
} catch (e){
  failures.push('plansmoke crashed: ' + e.message);
  console.error(e);
} finally {
  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}

if (failures.length){
  console.error(`\nFAIL — ${failures.length} failed, ${passed} passed`);
  [...new Set(failures)].forEach(f => console.error('  ✗ ' + f));
  process.exit(1);
}
console.log(`\nPASS — ${passed} checks, 0 failures`);
