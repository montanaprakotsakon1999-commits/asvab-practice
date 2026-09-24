#!/usr/bin/env node
/* =====================================================================
   Browser smoke test — run before every push:  node tools/smoke.mjs
   Drives the real page in headless Chromium: theme toggle + persistence,
   start screen, a full 9-subtest exam by keyboard, a second draw, MOS
   mode (68A + the 92A focus card), the home button, console errors.
   Optional arg: a URL or file path to test instead of ../index.html
   (e.g. the live site after a deploy).
   ===================================================================== */
import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = process.argv[2];
const URL_ = arg ? (/^https?:/.test(arg) ? arg : pathToFileURL(path.resolve(arg)).href)
                 : pathToFileURL(path.join(here, '..', 'index.html')).href;

const DARK = 'rgb(13, 20, 17)', LIGHT = 'rgb(220, 225, 220)';
let passed = 0;
const failures = [];
function check(cond, msg){ if (cond) passed++; else { failures.push(msg); console.error('  ✗ ' + msg); } }
const step = name => console.log('· ' + name);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) consoleErrors.push(m.text()); });
page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));

/* exactly ONE dialog handler for the whole run; tests arm it when a dialog is expected */
let dialogs = [], expectDialog = false;
page.on('dialog', async d => {
  dialogs.push(d.message());
  if (!expectDialog) failures.push('unexpected dialog: ' + d.message());
  await d.accept();
});

const bodyBg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const visible = sel => page.evaluate(s => !document.querySelector(s).classList.contains('hidden'), sel);

/* answer every question of every part by keyboard; returns the stems seen */
async function sitExam(expectedParts){
  const stems = [];
  for (let pi = 0; pi < expectedParts; pi++){
    const count = await page.textContent('#ex-count');
    check(count === `Subtest ${pi + 1} of ${expectedParts}`, `exam bar says "${count}", expected part ${pi + 1} of ${expectedParts}`);
    for (let qi = 0; qi < 10; qi++){
      const head = await page.textContent('#qcard .qnum');
      check(new RegExp(`QUESTION ${qi + 1} OF 10`).test(head), `expected question ${qi + 1}, card says "${head}"`);
      stems.push(await page.evaluate(() => {
        const svg = document.querySelector('#qcard .ao-frame');
        return svg ? svg.innerHTML : document.querySelector('#qcard .stem').textContent;
      }));
      await page.keyboard.press('abcd'[(pi + qi) % 4]);
      await page.waitForTimeout(280);                      // auto-advance fires at 220 ms
    }
    check((await page.textContent('#sheet-f')).trim() === '10 / 10', `part ${pi + 1}: answer sheet not 10 / 10`);
    await page.click('#btn-finish');
  }
  return stems;
}

try {
  /* ---------- theme ---------- */
  step('theme: dark default → light → persists → back');
  await page.goto(URL_);
  check(await bodyBg() === DARK, `default body bg is ${await bodyBg()}, want ${DARK}`);
  check((await page.textContent('#theme-btn')) === 'LIGHT MODE', 'theme button should offer LIGHT MODE');
  await page.click('#theme-btn');
  check(await bodyBg() === LIGHT, `light body bg is ${await bodyBg()}, want ${LIGHT}`);
  await page.reload();
  check(await bodyBg() === LIGHT, 'light theme did not persist across reload');
  check((await page.textContent('#theme-btn')) === 'DARK MODE', 'theme button should offer DARK MODE after reload');
  await page.click('#theme-btn');
  check(await bodyBg() === DARK, 'toggle back to dark failed');
  await page.reload();
  check(await bodyBg() === DARK, 'dark theme did not persist across reload');

  /* ---------- start screen ---------- */
  step('start screen: pool stat, study sheets, MOS cards');
  const poolTotal = await page.evaluate(() => POOL_TOTAL);
  check(poolTotal >= 512, `POOL_TOTAL is ${poolTotal}, expected ≥ 512`);
  check((await page.textContent('#stat-pool')) === poolTotal + '+', 'pool stat does not show the live count');
  check((await page.textContent('#pool-n')) === String(poolTotal), 'footer pool count does not show the live count');
  check(await page.locator('#study-wrap > details').count() === 11, 'expected 11 study sheets (9 subtests + TIP + 209)');
  await page.click('#study-wrap details >> nth=0 >> summary');
  check(await page.evaluate(() => document.querySelector('#study-wrap details').open), 'first study sheet did not open');
  check((await page.innerText('#study-wrap details >> nth=0 >> .study-b')).trim().length > 100, 'first study sheet has no content');
  check(await page.locator('#mos-cards .mode').count() === 4, 'expected 4 MOS cards');
  check(await page.getAttribute('#mos-cards .mode >> nth=0', 'data-mos') === '92A', '92A must be the first MOS card');
  check(await page.locator('#mos-cards .mode.focus').count() === 1 &&
        await page.getAttribute('#mos-cards .mode.focus', 'data-mos') === '92A', '92A must be the only gold focus card');
  const foot = await page.innerText('#screen-start footer');
  check(/original/i.test(foot) && /none of it is taken from any copyrighted/i.test(foot), 'start-screen originality disclaimer missing');
  check(/unofficial/i.test(foot), 'start-screen "unofficial estimate" disclaimer missing');

  /* ---------- full exam ---------- */
  step('full exam #1: 9 subtests by keyboard');
  await page.click('.mode[data-mode="full"]');
  check(await visible('#screen-exam'), 'exam screen did not open');
  const draw1 = await sitExam(9);
  check(await visible('#screen-results'), 'results screen did not open');
  check(await page.locator('.scoretab tbody tr').count() === 9, 'expected 9 score rows');
  check(await page.locator('#review .reviewq').count() === 90, 'expected 90 review items');
  const whys = await page.locator('#review .reviewq .why').allInnerTexts();
  check(whys.length === 90 && whys.every(w => w.replace(/^Why [A-D]\s*/, '').trim().length >= 15), 'a review item is missing its explanation');
  check(await page.locator('#review .reviewq svg').count() >= 50, 'AO review SVGs missing');
  check(/th/.test(await page.innerText('.afqt .big')), 'AFQT percentile block missing');
  check(/unofficial/i.test(await page.innerText('#results-body')), 'results "unofficial" disclaimer missing');
  check(await page.locator('#review .reviewq .choice.right').count() === 90, 'each review item should mark exactly one right choice');

  step('home from results (no dialog)');
  dialogs = [];
  await page.click('#home-btn');
  check(await visible('#screen-start') && !(await visible('#screen-results')), 'home button did not return to start from results');
  check(dialogs.length === 0, 'home from results should not open a dialog');

  step('full exam #2: draw differs');
  await page.click('.mode[data-mode="full"]');
  const draw2 = await sitExam(9);
  check(draw2.length === 90 && draw1.length === 90, 'both draws should be 90 questions');
  const overlap = draw2.filter(s => draw1.includes(s)).length;
  check(draw1.join('§') !== draw2.join('§'), 'second full-exam draw is identical to the first');
  check(overlap <= 20, `second draw repeats ${overlap} of 90 questions — unseen-first sampling looks broken`);
  await page.click('#btn-again');
  check(await visible('#screen-start'), '"Take another test" did not return to start');

  /* ---------- MOS mode ---------- */
  step('MOS: 68A → 4-subtest EL drill → estimate vs 107');
  await page.click('#mos-cards .mode[data-mos="68A"]');
  check((await page.textContent('#ex-count')) === 'Subtest 1 of 4', '68A should start a 4-subtest drill');
  await sitExam(4);
  const mosText = await page.innerText('#results-body');
  check(/EL · Electronics — needs ≥ 107/.test(mosText), 'EL estimate vs 107 missing from results');
  check(/How this estimate was built/.test(mosText), '"How this estimate was built" note missing');
  check(/EL = GS \+ AR \+ MK \+ EI/.test(mosText), 'EL composite formula missing');
  const est = parseInt(await page.innerText('.afqt >> nth=0 >> .big'), 10);
  check(est >= 46 && est <= 154, `EL estimate ${est} outside the 46–154 range the formula allows`);
  await page.click('#home-btn');

  step('MOS: 92A focus → CL drill (WK, PC, AR, MK) → CL vs 90 + AFQT');
  await page.click('#mos-cards .mode[data-mos="92A"]');
  check((await page.textContent('#ex-count')) === 'Subtest 1 of 4', '92A should start a 4-subtest drill');
  await sitExam(4);
  const claText = await page.innerText('#results-body');
  check(/CL · Clerical — needs ≥ 90/.test(claText), 'CL estimate vs 90 missing from results');
  check(/Converted to percentile/.test(claText), '92A drill should also yield an AFQT estimate');

  /* ---------- home mid-exam ---------- */
  step('home mid-exam: confirm dialog, sitting abandoned');
  await page.click('#home-btn');
  await page.click('.mode[data-mode="afqt"]');
  await page.keyboard.press('a');
  await page.waitForTimeout(280);
  dialogs = []; expectDialog = true;
  await page.click('#home-btn');
  await page.waitForTimeout(100);
  expectDialog = false;
  check(dialogs.length === 1 && /won't be scored/.test(dialogs[0]), 'mid-exam home should confirm exactly once');
  check(await visible('#screen-start') && !(await visible('#screen-exam')), 'mid-exam home did not return to start');
  check(await page.evaluate(() => EX === null), 'abandoned sitting should clear EX');

  check(consoleErrors.length === 0, 'console errors: ' + consoleErrors.join(' | '));
} catch (e){
  failures.push('smoke run crashed: ' + e.message);
  console.error(e);
} finally {
  await browser.close();
}

if (failures.length){
  console.error(`\nFAIL — ${failures.length} failed, ${passed} passed`);
  [...new Set(failures)].forEach(f => console.error('  ✗ ' + f));
  process.exit(1);
}
console.log(`\nPASS — ${passed} checks, 0 failures`);
