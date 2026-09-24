#!/usr/bin/env node
/* =====================================================================
   Study-mode smoke test (v5.6):  node tools/studysmoke.mjs [url-or-file] [--shots dir]
   📚 STUDY pill sits first (before EXAM); persists; the study screen spells
   out the AFQT codes (AR/MK/WK/PC = full names); tabs + key tiles switch
   lessons (tab remembered); every worked example's ✅ letter matches its
   choice text; cheat sheets present; "with answers" launches a Mock sitting
   and "Timed" a timed one (global MOCK and the timer switch restored);
   home / "Take another test" return to the study screen; mode switching
   mid-sitting confirms; game ↔ study; light theme; 390 px layout.
   ===================================================================== */
import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
let SHOTS = null, target = null;
for (let i = 0; i < args.length; i++){ if (args[i] === '--shots') SHOTS = args[++i]; else target = args[i]; }
const URL_ = target ? (/^https?:/.test(target) ? target : pathToFileURL(path.resolve(target)).href)
                    : pathToFileURL(path.join(here, '..', 'index.html')).href;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
let passed = 0;
const failures = [];
function check(cond, msg){ if (cond) passed++; else { failures.push(msg); console.error('  ✗ ' + msg); } }
const step = name => console.log('· ' + name);

const browser = await chromium.launch();
async function open(w, h){
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.errors = []; page.dialogs = [];
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) page.errors.push(m.text()); });
  page.on('pageerror', e => page.errors.push('pageerror: ' + e.message));
  page.on('dialog', d => { page.dialogs.push(d.message()); d.accept(); });
  await page.goto(URL_);
  return page;
}
const vis = (page, sel) => page.isVisible(sel);
const noHScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name), fullPage: true }); };
const NAMES = { AR: 'Arithmetic Reasoning', MK: 'Mathematics Knowledge', WK: 'Word Knowledge', PC: 'Paragraph Comprehension' };

try {
  const page = await open(1280, 900);

  step('📚 STUDY pill is first, before 📝 EXAM; default stays EXAM');
  const pills = await page.$$eval('[data-mode-sw]', b => b.map(x => x.dataset.modeSw));
  check(JSON.stringify(pills) === JSON.stringify(['study', 'exam', 'mock', 'game']), `mode pills are ${pills}`);
  check(await vis(page, '#screen-start') && !(await vis(page, '#screen-study')), 'fresh load should open the EXAM start screen');

  step('switch to STUDY: screen, body class, persistence');
  await page.click('[data-mode-sw="study"]');
  check(await vis(page, '#screen-study'), 'study screen not visible');
  check(!(await vis(page, '#screen-start')), 'start screen should be hidden in study mode');
  check(await page.evaluate(() => document.body.classList.contains('study') && !document.body.classList.contains('mock') && MOCK === false), 'body.study / MOCK flags wrong');
  check(await page.$eval('[data-mode-sw="study"]', b => b.classList.contains('on')), 'STUDY pill not highlighted');
  check(/study/.test(await page.evaluate(() => localStorage.getItem('asvab_mode')) || ''), 'study mode not saved');

  step('code key: AR / MK / WK / PC spelled out; other 5 codes listed');
  const keys = await page.$$eval('.st-key', ks => ks.map(k => ({ c: k.querySelector('.c').textContent.trim(), eq: k.querySelector('.eq').textContent.replace(/\s+/g, ' ').trim() })));
  check(keys.length === 4, `expected 4 code tiles, got ${keys.length}`);
  check(keys.map(k => k.c).join() === 'AR,MK,WK,PC', `tile order ${keys.map(k => k.c)}`);
  keys.forEach(k => check(k.eq === '= ' + NAMES[k.c], `tile ${k.c} reads "${k.eq}"`));
  const others = await page.innerText('.st-others');
  ['GS = General Science', 'EI = Electronics Information', 'AS = Auto & Shop', 'MC = Mechanical Comprehension', 'AO = Assembling Objects']
    .forEach(t => check(others.includes(t), `other-codes line missing "${t}"`));
  const formula = await page.innerText('.st-eqn');
  check(/VE = WK \+ PC/.test(formula) && /AFQT = 2 × VE \+ AR \+ MK/.test(formula), 'AFQT formula missing');
  await shot(page, 'study-desktop.png');

  step('lessons: tabs, headings, examples, cheat sheets, launch buttons');
  for (const c of ['AR', 'MK', 'WK', 'PC']){
    await page.click(`.st-tab[data-st-tab="${c}"]`);
    const shown = await page.$$eval('.st-lesson', ls => ls.filter(l => getComputedStyle(l).display !== 'none').map(l => l.dataset.l));
    check(shown.length === 1 && shown[0] === c, `tab ${c}: visible lessons ${shown}`);
    check(await page.getAttribute(`.st-tab[data-st-tab="${c}"]`, 'aria-selected') === 'true', `tab ${c} not aria-selected`);
    const h2 = (await page.innerText(`#st-l-${c} h2`)).trim();
    check(h2 === `${c} = ${NAMES[c]}`, `lesson heading "${h2}"`);
    const exs = await page.$$(`#st-l-${c} .st-ex`);
    check(exs.length >= 2, `${c}: only ${exs.length} examples`);
    for (let i = 0; i < exs.length; i++){
      const ex = exs[i];
      check(!(await ex.$eval('.ans', a => a.checkVisibility())), `${c} ex${i + 1}: answer visible before tapping`);
      await (await ex.$('summary')).click();
      const ans = await ex.$eval('.ans', a => a.innerText);
      check(await ex.$eval('.ans', a => a.checkVisibility()), `${c} ex${i + 1}: answer did not open`);
      const m = ans.match(/✅\s*([A-D])(?:\s*—\s*(.+))?/);
      check(!!m, `${c} ex${i + 1}: no ✅ letter`);
      if (m){
        const items = await ex.$$eval('ol.ch li', lis => lis.map(li => ({ l: li.dataset.l, t: li.textContent.trim() })));
        check(items.length === 4, `${c} ex${i + 1}: ${items.length} choices`);
        const hit = items.find(x => x.l === m[1]);
        check(!!hit, `${c} ex${i + 1}: letter ${m[1]} not among choices`);
        if (hit && m[2]){
          const want = m[2].split('\n')[0].trim();
          const norm = s => s.replace(/^x = /, '').trim();
          check(norm(want) === norm(hit.t), `${c} ex${i + 1}: ✅ says "${want}" but ${m[1]} is "${hit.t}"`);
        }
      }
    }
    check(await page.$$eval(`#st-l-${c} .study-d .study-b li`, l => l.length) > 5, `${c}: cheat sheet empty`);
    check(await page.locator(`#st-l-${c} [data-st-go="${c}"][data-kind="mock"]`).count() === 1, `${c}: practice button missing`);
    check(await page.locator(`#st-l-${c} [data-st-go="${c}"][data-kind="timed"]`).count() === 1, `${c}: timed button missing`);
  }
  check(await page.locator('#st-l-WK [data-st-go="W209"]').count() === 1, 'WK lesson: 209 Words button missing');

  step('key tile jumps to its lesson; arrow keys move tabs; tab remembered on reload');
  await page.click('.st-key[data-st-jump="WK"]');
  check(await page.getAttribute('.st-tab[data-st-tab="WK"]', 'aria-selected') === 'true', 'WK tile did not open WK lesson');
  await page.focus('.st-tab[data-st-tab="WK"]');
  await page.keyboard.press('ArrowRight');
  check(await page.getAttribute('.st-tab[data-st-tab="PC"]', 'aria-selected') === 'true', 'ArrowRight from WK should select PC');
  await page.keyboard.press('ArrowRight');
  check(await page.getAttribute('.st-tab[data-st-tab="AR"]', 'aria-selected') === 'true', 'ArrowRight should wrap PC → AR');
  await page.click('.st-tab[data-st-tab="MK"]');
  await page.reload();
  check(await vis(page, '#screen-study'), 'study mode not restored on reload');
  check(await page.getAttribute('.st-tab[data-st-tab="MK"]', 'aria-selected') === 'true', 'MK tab not remembered on reload');

  step('📖 Practice 10 (AR) → mock sitting, flags restored');
  await page.click('#st-l-AR [data-st-go="AR"][data-kind="mock"]').catch(async () => {
    await page.click('.st-tab[data-st-tab="AR"]'); await page.click('#st-l-AR [data-st-go="AR"][data-kind="mock"]');
  });
  check(await vis(page, '#screen-exam') && !(await vis(page, '#screen-study')), 'practice did not open the exam screen');
  const s1 = await page.evaluate(() => ({ mock: EX.mock, timed: EX.timed, codes: EX.parts.map(p => p.code), n: EX.parts[0].qs.length, MOCK, modeAt: EX.modeAt }));
  check(s1.mock === true && s1.timed === false, `practice sitting mock=${s1.mock} timed=${s1.timed}`);
  check(s1.codes.join() === 'AR' && s1.n === 10, `practice sitting ${s1.codes} × ${s1.n}`);
  check(s1.MOCK === false, 'global MOCK leaked as true after launch');
  check(s1.modeAt === 'study', `modeAt ${s1.modeAt}`);
  check(/NO CLOCK/.test(await page.innerText('#ex-clock')), 'practice should show NO CLOCK');
  await page.keyboard.press('a');
  await page.waitForSelector('#mock-fb', { timeout: 2000 });
  check(/WHY/i.test(await page.innerText('#mock-fb')), 'tutor panel missing in study practice');

  step('home mid-sitting → confirm → back to the STUDY screen');
  page.dialogs = [];
  await page.click('#home-btn');
  check(page.dialogs.length === 1 && /won't be scored/.test(page.dialogs[0]), 'home mid-sitting should confirm once');
  check(await vis(page, '#screen-study') && !(await vis(page, '#screen-start')) && !(await vis(page, '#screen-exam')), 'home should land on the study screen');

  step('📝 Timed 10 (MK) forces a timed sitting even with the timer switch off; restores the switch');
  await page.evaluate(() => { document.getElementById('opt-timer').checked = false; });
  await page.click('.st-tab[data-st-tab="MK"]');
  await page.click('#st-l-MK [data-st-go="MK"][data-kind="timed"]');
  const s2 = await page.evaluate(() => ({ mock: EX.mock, timed: EX.timed, codes: EX.parts.map(p => p.code), sw: document.getElementById('opt-timer').checked }));
  check(s2.mock === false && s2.timed === true, `timed sitting mock=${s2.mock} timed=${s2.timed}`);
  check(s2.codes.join() === 'MK', `timed sitting codes ${s2.codes}`);
  check(s2.sw === false, 'timer switch was not restored');
  check(!/NO CLOCK/.test(await page.innerText('#ex-clock')), 'timed sitting shows NO CLOCK');
  page.dialogs = [];
  await page.evaluate(() => finish());
  await page.waitForSelector('#screen-results:not(.hidden)', { timeout: 3000 });
  check(page.dialogs.length === 0, 'finishing opened a dialog');
  await page.click('#btn-again');
  check(await vis(page, '#screen-study') && !(await vis(page, '#screen-start')), '"Take another test" should return to the study screen');
  await page.evaluate(() => { document.getElementById('opt-timer').checked = true; });

  step('209 Words + AFQT launchers');
  await page.click('.st-tab[data-st-tab="WK"]');
  await page.click('#st-l-WK [data-st-go="W209"]');
  const s3 = await page.evaluate(() => ({ mock: EX.mock, n: EX.parts[0].qs.length, name: EX.parts[0].name }));
  check(s3.mock === true && s3.n === 20, `209 launcher mock=${s3.mock} n=${s3.n}`);
  await page.click('#home-btn');
  await page.click('[data-st-go="AFQT"][data-kind="mock"]');
  const s4 = await page.evaluate(() => ({ mock: EX.mock, codes: EX.parts.map(p => p.code).sort().join() }));
  check(s4.mock === true && s4.codes === 'AR,MK,PC,WK', `AFQT practice ${JSON.stringify(s4)}`);
  await page.click('#home-btn');
  await page.click('[data-st-go="AFQT"][data-kind="timed"]');
  const s5 = await page.evaluate(() => ({ mock: EX.mock, timed: EX.timed, n: EX.parts.reduce((a, p) => a + p.qs.length, 0) }));
  check(s5.mock === false && s5.timed === true && s5.n === 40, `AFQT timed ${JSON.stringify(s5)}`);

  step('switch STUDY → EXAM mid-sitting confirms and closes it');
  page.dialogs = [];
  await page.click('[data-mode-sw="exam"]');
  check(page.dialogs.length === 1 && /switch to Exam mode/.test(page.dialogs[0]), `expected one confirm, got ${JSON.stringify(page.dialogs)}`);
  check(await vis(page, '#screen-start') && !(await vis(page, '#screen-exam')) && !(await vis(page, '#screen-study')), 'EXAM start screen should show');
  check(await page.evaluate(() => !document.body.classList.contains('study')), 'body.study left on');

  step('EXAM sitting → STUDY confirms; MOCK ↔ STUDY; GAME ↔ STUDY');
  await page.click('.mode[data-mode="afqt"]');
  page.dialogs = [];
  await page.click('[data-mode-sw="study"]');
  check(page.dialogs.length === 1 && /switch to Study mode/.test(page.dialogs[0]), 'EXAM → STUDY mid-sitting should confirm');
  check(await vis(page, '#screen-study') && !(await vis(page, '#screen-exam')), 'study screen should show after confirm');
  await page.click('[data-mode-sw="mock"]');
  check(await vis(page, '#screen-start') && await vis(page, '#mock-banner') && !(await vis(page, '#screen-study')), 'MOCK start screen should show');
  await page.click('[data-mode-sw="study"]');
  check(await page.evaluate(() => MOCK === false && !document.body.classList.contains('mock')), 'mock flags left on in study');
  await page.click('[data-mode-sw="game"]');
  check(await vis(page, '#screen-game') && !(await vis(page, '#screen-study')), 'game should hide the study screen');
  await page.click('[data-mode-sw="study"]');
  check(await vis(page, '#screen-study') && !(await vis(page, '#screen-game')), 'study should hide the game');

  step('light theme');
  await page.click('#theme-btn');
  const lightOk = await page.evaluate(() => {
    const k = document.querySelector('.st-key .c'); const c = getComputedStyle(k).color;
    return document.documentElement.getAttribute('data-theme') === 'light' && c !== 'rgb(183, 156, 255)';
  });
  check(lightOk, 'light theme did not restyle the study accents');
  await shot(page, 'study-light.png');
  await page.click('#theme-btn');
  check(page.errors.length === 0, 'console errors: ' + page.errors.join(' | '));
  await page.close();

  step('390 px phone layout');
  const ph = await open(390, 844);
  await ph.click('[data-mode-sw="study"]');
  check(await noHScroll(ph), 'study screen scrolls sideways at 390 px');
  const pillsFit = await ph.evaluate(() => { const r = document.querySelector('.mode-sw').getBoundingClientRect(); return r.right <= window.innerWidth + 1 && r.left >= -1; });
  check(pillsFit, 'mode pills overflow at 390 px');
  for (const c of ['AR', 'MK', 'WK', 'PC']){
    await ph.click(`.st-tab[data-st-tab="${c}"]`);
    await ph.$$eval(`#st-l-${c} details`, ds => ds.forEach(d => d.open = true));
    check(await noHScroll(ph), `${c} lesson scrolls sideways at 390 px`);
  }
  const tabsFit = await ph.$$eval('.st-tab', ts => ts.every(t => { const r = t.getBoundingClientRect(); return r.right <= innerWidth + 1 && r.width > 60; }));
  check(tabsFit, 'lesson tabs do not fit at 390 px');
  await ph.click('.st-tab[data-st-tab="AR"]');
  await shot(ph, 'study-390.png');
  check(ph.errors.length === 0, '390 console errors: ' + ph.errors.join(' | '));
  await ph.close();
} catch (e) {
  failures.push('crash: ' + (e.stack || e));
} finally {
  await browser.close();
}
console.log(`\n${failures.length ? '✗ FAIL' : '✓ PASS'} — ${passed} checks passed, ${failures.length} failed`);
if (failures.length){ failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
