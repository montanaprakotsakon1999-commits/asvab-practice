#!/usr/bin/env node
/* =====================================================================
   v5.4 browser checks:  node tools/smoke54.mjs [url-or-file] [--shots dir]
   Study-sheet sub-sections, AO puzzle items (exam + review), .kw keyword
   styling, new generated AR/MK templates reaching sittings, and 390-px
   phone layout with no horizontal scroll. Zero console errors.
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
async function newPage(w, h){
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.errors = [];
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) page.errors.push(m.text()); });
  page.on('pageerror', e => page.errors.push('pageerror: ' + e.message));
  page.on('dialog', d => d.accept());
  return page;
}
const noHScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const visible = (page, sel) => page.evaluate(s => !document.querySelector(s).classList.contains('hidden'), sel);

/* sit one AO-only practice: returns number of puzzle cards seen */
async function sitAO(page, shotPrefix){
  await page.click('.mode[data-mode="single"]');
  await page.click('.mode[data-only="AO"]');
  let puz = 0, shot = 0;
  for (let qi = 0; qi < 10; qi++){
    const isPuz = await page.locator('#qcard svg.aop-stem').count() === 1;
    if (isPuz){
      puz++;
      check(await page.locator('#qcard .ao-choices svg.aop-opt').count() === 4, 'puzzle card should show 4 answer figures');
      check(/pieces fitted together/.test(await page.innerText('#qcard .stem')), 'puzzle stem text missing');
      const paths = await page.locator('#qcard svg.aop-stem path.aop-piece').count();
      check(paths >= 2 && paths <= 4, `puzzle stem shows ${paths} pieces`);
      const bb = await page.evaluate(() => {           // stem pieces must not overlap each other on screen
        const r = [...document.querySelectorAll('#qcard svg.aop-stem path')].map(p => p.getBoundingClientRect());
        let hit = 0;
        for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++){
          const a = r[i], b = r[j];
          if (a.left < b.right - 2 && b.left < a.right - 2 && a.top < b.bottom - 2 && b.top < a.bottom - 2) hit++;
        }
        return hit;
      });
      check(bb === 0, 'puzzle stem pieces overlap on screen');
      if (SHOTS && shot < 2 && shotPrefix){ await page.locator('#qcard').screenshot({ path: `${SHOTS}/${shotPrefix}-puz${++shot}.png` }); }
    }
    await page.keyboard.press('abcd'[qi % 4]);
    await page.waitForTimeout(280);
  }
  await page.click('#btn-finish');
  return puz;
}

try {
  /* ---------------- desktop ---------------- */
  const page = await newPage(1280, 900);
  await page.goto(URL_);

  step('study sheets: 11 sheets, v5.4 sub-sections open and close');
  check(await page.locator('#study-wrap > details.study-d').count() === 11, 'expected 11 study sheets (9 subtests + TIP + 209)');
  const subs = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#study-wrap > details.study-d')].map(d =>
    [d.querySelector('summary .tcode').textContent, d.querySelectorAll('details.study-sub').length])));
  for (const [c, min] of Object.entries({GS: 6, AS: 4, MC: 3, EI: 3, MK: 3, AR: 3, WK: 3, PC: 2, AO: 1, TIP: 5}))
    check((subs[c] || 0) >= min, `study sheet ${c} has ${subs[c] || 0} sub-sections, want ≥ ${min}`);
  const gs = page.locator('#study-wrap > details.study-d', { has: page.locator('summary .tcode', { hasText: /^GS$/ }) });
  await gs.locator('> summary').click();
  const sub0 = gs.locator('details.study-sub').first();
  check(!(await sub0.evaluate(d => d.open)), 'sub-sections should start closed');
  await sub0.locator('> summary').click();
  check(await sub0.evaluate(d => d.open), 'sub-section did not open');
  check((await sub0.locator('li').count()) >= 5, 'opened sub-section shows no bullets');
  const marker = await sub0.locator('> summary').evaluate(s => getComputedStyle(s, '::after').content);
  check(marker === 'none' || marker === 'normal', `nested summary still shows the sheet's +/− marker (${marker})`);
  if (SHOTS) await gs.screenshot({ path: `${SHOTS}/study-gs.png` });
  await gs.locator('> summary').click();

  step('AO practice: puzzle items render, review explains them');
  let puzTotal = 0;
  for (let r = 0; r < 3; r++){
    puzTotal += await sitAO(page, r === 0 ? 'desk' : null);
    check(await visible(page, '#screen-results'), 'AO practice did not reach results');
    const whys = await page.locator('#review .reviewq .why').allInnerTexts();
    check(whys.length === 10, 'AO review should list 10 items');
    const puzWhy = whys.filter(w => /is built from exactly the \d pieces shown/.test(w)).length;
    const puzRev = await page.locator('#review svg.aop-stem').count();
    check(puzWhy === puzRev, `review: ${puzRev} puzzle items but ${puzWhy} puzzle explanations`);
    check(await page.locator('#review .reviewq .choice.right').count() === 10, 'each AO review item needs one right choice');
    if (SHOTS && r === 0) await page.locator('#review .reviewq', { has: page.locator('svg.aop-stem') }).first().screenshot({ path: `${SHOTS}/review-puz.png` });
    await page.click('#home-btn');
  }
  check(puzTotal >= 6 && puzTotal <= 24, `3 AO sittings showed ${puzTotal} puzzle items (expect ~13)`);

  step('WK: keyword is underlined (.kw) in the exam card');
  await page.click('.mode[data-mode="single"]');
  await page.click('.mode[data-only="WK"]');
  let kwSeen = 0;
  for (let qi = 0; qi < 10; qi++){
    const k = page.locator('#qcard .stem .kw');
    if (await k.count()){
      kwSeen++;
      const bb = await k.first().evaluate(e => getComputedStyle(e).borderBottomStyle);
      check(bb === 'solid', 'WK keyword is not underlined');
    }
    await page.keyboard.press('a'); await page.waitForTimeout(280);
  }
  check(kwSeen >= 8, `only ${kwSeen}/10 WK stems carry the underlined keyword`);
  await page.click('#btn-finish');
  await page.click('#home-btn');

  step('new generated templates reach real sittings');
  const seen = await page.evaluate(() => {
    const names = new Set();
    for (let i = 0; i < 400; i++){
      ['AR', 'MK'].forEach(code => buildQuestions({ code }).forEach(q => {
        if (/^After a \d+% discount|^A soldier borrows|^A courier drives|soldiers need a ride|^A truck rental costs/.test(q.q)) names.add(q.q.split(' ').slice(0, 3).join(' '));
        if (/^Solve the inequality: \d+ − |circumference is \d+π|^Simplify: \(\d+x|^If x = −/.test(q.q)) names.add(q.q.split(' ').slice(0, 3).join(' '));
      }));
    }
    return names.size;
  });
  check(seen >= 9, `only ${seen} of the 9 new AR/MK templates appeared in 400 sittings each`);

  check(page.errors.length === 0, 'desktop console errors: ' + page.errors.join(' | '));
  await page.close();

  /* ---------------- phone ---------------- */
  step('390 px phone: no horizontal scroll on start, AO puzzle card, review; study sheet readable');
  const ph = await newPage(390, 844);
  await ph.goto(URL_);
  check(await noHScroll(ph), 'start screen scrolls sideways at 390 px');
  await ph.click('#study-wrap > details.study-d >> nth=0 >> summary');
  await ph.click('#study-wrap details.study-sub >> nth=0 >> summary');
  check(await noHScroll(ph), 'opened study sub-section scrolls sideways at 390 px');
  await ph.click('.mode[data-mode="single"]');
  await ph.click('.mode[data-only="AO"]');
  let phonePuz = 0;
  for (let qi = 0; qi < 10; qi++){
    if (await ph.locator('#qcard svg.aop-stem').count()){
      phonePuz++;
      check(await noHScroll(ph), 'AO puzzle card scrolls sideways at 390 px');
      const w = await ph.evaluate(() => {
        const s = document.querySelector('#qcard svg.aop-stem').getBoundingClientRect();
        const o = document.querySelector('#qcard svg.aop-opt').getBoundingClientRect();
        return { stemScale: s.width / document.querySelector('#qcard svg.aop-stem').viewBox.baseVal.width, optScale: o.width / 120 };
      });
      check(w.optScale / w.stemScale > 0.8 && w.optScale / w.stemScale < 1.25, `phone: stem and answer figures drawn at different scales (${w.stemScale.toFixed(2)} vs ${w.optScale.toFixed(2)})`);
      if (SHOTS && phonePuz === 1) await ph.screenshot({ path: `${SHOTS}/phone-puz.png`, fullPage: true });
    }
    await ph.keyboard.press('b'); await ph.waitForTimeout(280);
  }
  await ph.click('#btn-finish');
  check(await noHScroll(ph), 'AO review scrolls sideways at 390 px');
  check(ph.errors.length === 0, 'phone console errors: ' + ph.errors.join(' | '));
  await ph.close();
} catch (e){
  failures.push('smoke54 crashed: ' + e.message);
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
