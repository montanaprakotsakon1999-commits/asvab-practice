#!/usr/bin/env node
/* =====================================================================
   Game-mode smoke test (ASVAB Arcade):  node tools/gsmoke.mjs [url-or-file]
   Mode switch + persistence, every quiz world played to its end screen,
   all three Word Match boards with zero mistakes, home button → hub,
   exam mode still works afterwards, 390-px layout, zero console errors.
   ===================================================================== */
import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = process.argv[2];
const URL_ = arg ? (/^https?:/.test(arg) ? arg : pathToFileURL(path.resolve(arg)).href)
                 : pathToFileURL(path.join(here, '..', 'index.html')).href;
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
const shown = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); return !!e && !e.classList.contains('hidden') && e.offsetParent !== null; }, sel);
const noHScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

/* play one quiz world: always tap the first answer; wrong answers show Next */
async function playWorld(page, id){
  await page.click(`#g-root [data-world="${id}"]`);
  for (let guard = 0; guard < 40; guard++){
    if (await page.locator('#g-root .g-end').count()) return true;
    const q = page.locator('#g-root .g-q');
    if (await q.count()){
      const txt = (await q.innerText()).trim();
      check(txt.length > 3 && !/undefined|NaN/.test(txt), `${id}: bad question text "${txt.slice(0, 60)}"`);
      const n = await page.locator('#g-root .g-ch').count();
      check(n === 4, `${id}: ${n} answer buttons`);
      const labels = await page.locator('#g-root .g-ch').allInnerTexts();
      check(labels.every(l => l.trim().length > 0 && !/undefined|NaN/.test(l)), `${id}: empty/undefined answer label`);
      await page.locator('#g-root .g-ch').first().click();
      await page.waitForTimeout(120);
      if (await page.locator('#g-next').count()){
        check(await page.locator('#g-root .g-ex').count() === 1, `${id}: wrong-answer panel has no example`);
        await page.click('#g-next');
      }
      else await page.waitForTimeout(1000);                  // correct → auto-advance after 950 ms
    } else await page.waitForTimeout(200);
  }
  return false;
}

try {
  const page = await open(1280, 900);
  step('switch to game mode; persists across reload');
  await page.click('[data-mode-sw="game"]');
  check(await shown(page, '#screen-game'), 'game screen not shown after switching');
  check(/^"?game"?$/.test(await page.evaluate(() => localStorage.getItem('asvab_mode')) || ''), 'mode not saved to localStorage');
  await page.reload();
  check(await shown(page, '#screen-game'), 'game mode did not persist across reload');
  const worlds = await page.$$eval('#g-root [data-world]', b => b.map(x => x.dataset.world));
  check(worlds.length === 9, `hub shows ${worlds.length} worlds, want 9`);

  step('every quiz world plays to its end screen');
  for (const id of worlds.filter(w => w !== 'match')){
    const done = await playWorld(page, id);
    check(done, `world ${id} never reached its end screen`);
    if (done){
      check(/correct/.test(await page.innerText('#g-root .g-end')), `world ${id}: end screen lacks the score line`);
      await page.click('#g-home');
    }
  }

  step('Word Match: 3 boards, zero mistakes');
  await page.click('#g-root [data-world="match"]');
  for (let b = 0; b < 3; b++){
    const words = await page.$$eval('#g-root .g-tile.w', t => t.map(x => x.dataset.w));
    check(words.length === 6, `board ${b + 1}: ${words.length} word tiles`);
    for (const w of words){
      await page.click(`#g-root .g-tile.w[data-w="${w}"]`);
      await page.click(`#g-root .g-tile.m[data-m="${w}"]`);
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(900);
  }
  check(await page.locator('#g-root .g-end').count() === 1, 'Word Match did not reach its end screen');
  check(/All matched!/.test(await page.innerText('#g-root')) && / 0 mistakes /.test(await page.innerText('#g-root .g-sub')), 'Word Match should finish with 0 mistakes');
  if (await page.locator('#g-home').count()) await page.click('#g-home');

  step('masthead home → hub; back to exam mode still runs');
  await page.click(`#g-root [data-world="${worlds[0]}"]`);
  await page.click('#home-btn');
  check(await page.locator('#g-root [data-world]').count() === 9, 'home button in game mode should return to the world hub');
  await page.click('[data-mode-sw="exam"]');
  check(await shown(page, '#screen-start'), 'exam start screen not shown after switching back');
  await page.click('.mode[data-mode="single"]');
  await page.click('.mode[data-only="GS"]');
  check(await shown(page, '#screen-exam'), 'exam did not start after leaving game mode');
  await page.keyboard.press('a'); await page.waitForTimeout(260);
  await page.click('#home-btn');                               // confirm dialog auto-accepted
  check(page.errors.length === 0, 'desktop console errors: ' + page.errors.join(' | '));
  await page.close();

  step('390 px: hub and a question fit without sideways scroll');
  const ph = await open(390, 844);
  await ph.click('[data-mode-sw="game"]');
  check(await noHScroll(ph), 'game hub scrolls sideways at 390 px');
  await ph.click('#g-root [data-world="mix"]');
  check(await noHScroll(ph), 'game question scrolls sideways at 390 px');
  check(ph.errors.length === 0, 'phone console errors: ' + ph.errors.join(' | '));
  await ph.close();
} catch (e){
  failures.push('gsmoke crashed: ' + e.message);
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
