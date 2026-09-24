#!/usr/bin/env node
/* =====================================================================
   Mock-mode smoke test (v5.5):  node tools/mocksmoke.mjs [url-or-file] [--shots dir]
   📖 MOCK pill next to EXAM; persists; untimed; after each answer the card
   shows right/wrong + answer + why + example and does NOT auto-advance;
   Show answer; locked after reveal; Enter = next; PC proof highlighted;
   AO feedback; results labelled MOCK with examples in the review; switching
   back to EXAM restores the timed, auto-advancing exam; 390 px layout.
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
  page.errors = [];
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) page.errors.push(m.text()); });
  page.on('pageerror', e => page.errors.push('pageerror: ' + e.message));
  page.on('dialog', d => d.accept());
  await page.goto(URL_);
  return page;
}
const qhead = page => page.textContent('#qcard .qnum');
const noHScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

/* answer the current question in mock mode and verify the tutor panel */
async function answerAndCheck(page, key, tag){
  const before = await qhead(page);
  await page.keyboard.press(key);
  await page.waitForSelector('#mock-fb', { timeout: 2000 });
  const fb = await page.innerText('#mock-fb');
  check(/Correct!|Not quite|The answer is/.test(fb), `${tag}: feedback header missing`);
  check(/WHY/i.test(fb), `${tag}: "Why" row missing`);
  const isAO = await page.locator('#qcard .ao-frame').count() > 0;
  const isPC = await page.locator('#qcard .passage').count() > 0;
  if (!isAO) check(/ANSWER/i.test(fb), `${tag}: "Answer" row missing`);
  check(/EXAMPLE|HOW TO SEE IT/i.test(fb), `${tag}: example row missing`);
  check(await page.locator('#qcard .choice.right').count() === 1, `${tag}: exactly one choice must be marked right`);
  await page.waitForTimeout(450);
  check(await qhead(page) === before, `${tag}: mock mode auto-advanced`);
  const rightBefore = await page.locator('#qcard .choice.right').count();
  await page.keyboard.press(key === 'a' ? 'b' : 'a');           // locked after reveal
  check(await page.locator('#qcard .choice.right').count() === rightBefore && await page.locator('#mock-fb').count() === 1, `${tag}: answer changed after reveal`);
  return { isAO, isPC, fb };
}

try {
  const page = await open(1280, 900);
  step('📖 MOCK pill sits next to EXAM (after 📚 STUDY); mode persists; start screen explains mock');
  const pills = await page.$$eval('[data-mode-sw]', b => b.map(x => x.dataset.modeSw));
  check(JSON.stringify(pills) === JSON.stringify(['study', 'exam', 'mock', 'game']), `mode pills are ${pills}`);
  await page.click('[data-mode-sw="mock"]');
  check(await page.evaluate(() => document.body.classList.contains('mock') && MOCK === true), 'body.mock / MOCK flag not set');
  check(await page.isVisible('#mock-banner'), 'mock banner not visible');
  check(!(await page.isVisible('#opt-timer-wrap')), 'timer switch should be hidden in mock mode');
  check(/no clock/.test(await page.innerText('.mode[data-mode="full"] .n')), 'full-test card should say "no clock"');
  await page.reload();
  check(await page.evaluate(() => MOCK === true) && await page.isVisible('#mock-banner'), 'mock mode did not persist across reload');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/mock-start.png` });

  step('single GS mock: no clock, tutor panel, no auto-advance, Show answer, Enter = next');
  await page.click('.mode[data-mode="single"]');
  await page.click('.mode[data-only="GS"]');
  check((await page.textContent('#ex-clock')).includes('NO CLOCK'), 'clock should read MOCK · NO CLOCK');
  const c0 = await page.textContent('#ex-clock');
  await page.waitForTimeout(1300);
  check(await page.textContent('#ex-clock') === c0, 'mock clock is counting');
  check(await page.locator('#mock-show').count() === 1, 'Show answer button missing before answering');
  await answerAndCheck(page, 'a', 'GS Q1');
  if (SHOTS) await page.locator('#qcard').screenshot({ path: `${SHOTS}/mock-gs-feedback.png` });
  await page.keyboard.press('Enter');
  check(/QUESTION 2 OF 10/.test(await qhead(page)), 'Enter did not move to question 2');
  await page.click('#mock-show');
  check(/The answer is/.test(await page.innerText('#mock-fb')), 'Show answer did not reveal the answer');
  check(await page.evaluate(() => EX.parts[0].ans[1] === null && EX.parts[0].rev[1] === true), 'Show answer should reveal without recording an answer');
  await page.click('#mock-next');
  for (let i = 2; i < 10; i++){ await answerAndCheck(page, 'abcd'[i % 4], `GS Q${i + 1}`); await page.click('#mock-next'); }
  check(await page.isVisible('#screen-results'), 'mock GS did not reach results');
  const rep = await page.innerText('#results-body');
  check(/MOCK/.test(rep) && /Mock test score/.test(rep), 'results should be labelled MOCK');
  const exLines = await page.locator('#review .why .ex-lbl').count();
  check(exLines === 10, `review shows ${exLines}/10 examples`);
  await page.click('#home-btn');

  step('full 9-subtest mock: every subtest gives feedback; PC proof highlighted; AO tips');
  await page.click('.mode[data-mode="full"]');
  let pcProof = 0, aoSeen = 0, parts = 0;
  for (let pi = 0; pi < 9; pi++){
    parts++;
    for (let qi = 0; qi < 10; qi++){
      const r = await answerAndCheck(page, 'abcd'[(pi + qi) % 4], `full P${pi + 1} Q${qi + 1}`);
      if (r.isPC && await page.locator('#qcard .passage mark.proof').count()) pcProof++;
      if (r.isAO){ aoSeen++; check(/Cross out/.test(r.fb), 'AO feedback lacks its tip example'); }
      if (SHOTS && r.isPC && pcProof === 1) await page.locator('#qcard').screenshot({ path: `${SHOTS}/mock-pc-proof.png` });
      if (SHOTS && r.isAO && aoSeen === 1) await page.locator('#qcard').screenshot({ path: `${SHOTS}/mock-ao.png` });
      await page.keyboard.press('Enter');
      await page.waitForTimeout(40);
    }
  }
  check(parts === 9 && await page.isVisible('#screen-results'), 'full mock did not reach results');
  check(pcProof >= 7, `PC proof highlighted on only ${pcProof}/10 PC questions`);
  check(aoSeen === 10, `AO feedback shown ${aoSeen}/10`);
  check(await page.locator('#review .reviewq').count() === 90, 'full mock review should list 90 items');
  const exAll = await page.locator('#review .why .ex-lbl').count();
  check(exAll === 90, `full mock review shows ${exAll}/90 examples`);

  step('switch back to EXAM: timed clock + auto-advance return');
  await page.click('[data-mode-sw="exam"]');
  check(await page.evaluate(() => MOCK === false && !document.body.classList.contains('mock')), 'exam mode did not clear MOCK');
  await page.click('#home-btn');
  await page.click('.mode[data-mode="single"]');
  await page.click('.mode[data-only="AR"]');
  check(/^\d\d:\d\d$/.test(await page.textContent('#ex-clock')), 'exam clock should show mm:ss');
  await page.keyboard.press('a'); await page.waitForTimeout(350);
  check(/QUESTION 2 OF 10/.test(await qhead(page)), 'exam mode should auto-advance');
  check(await page.locator('#mock-fb, #mock-show').count() === 0, 'exam mode must not show tutor feedback');
  await page.click('#home-btn');                                      // confirm auto-accepted
  check(page.errors.length === 0, 'desktop console errors: ' + page.errors.join(' | '));
  await page.close();

  step('390 px: mock start, feedback card and AO card fit without sideways scroll');
  const ph = await open(390, 844);
  await ph.click('[data-mode-sw="mock"]');
  check(await noHScroll(ph), 'mock start screen scrolls sideways at 390 px');
  const pillsFit = await ph.evaluate(() => { const r = document.querySelector('.mode-sw').getBoundingClientRect(); return r.right <= window.innerWidth + 1 && r.left >= -1; });
  check(pillsFit, 'mode pills overflow the 390-px masthead');
  await ph.click('.mode[data-mode="single"]');
  await ph.click('.mode[data-only="PC"]');
  await ph.keyboard.press('c');
  await ph.waitForSelector('#mock-fb');
  check(await noHScroll(ph), 'mock feedback scrolls sideways at 390 px');
  if (SHOTS) await ph.screenshot({ path: `${SHOTS}/mock-phone-pc.png`, fullPage: true });
  await ph.click('#home-btn');
  await ph.click('.mode[data-mode="single"]');
  await ph.click('.mode[data-only="AO"]');
  for (let i = 0; i < 3; i++){ await ph.keyboard.press('a'); await ph.waitForSelector('#mock-fb'); check(await noHScroll(ph), 'AO mock card scrolls sideways at 390 px'); await ph.keyboard.press('Enter'); }
  check(ph.errors.length === 0, 'phone console errors: ' + ph.errors.join(' | '));
  await ph.close();
} catch (e){
  failures.push('mocksmoke crashed: ' + e.message);
  console.error(e);
} finally {
  await browser.close();
}
if (failures.length){
  console.error(`\nFAIL — ${failures.length} failed, ${passed} passed`);
  [...new Set(failures)].forEach(f => console.error('  ✗ ' + f));
  process.exit(1);
}
console.log(`\nPASS — ${passed} checks`);
