#!/usr/bin/env node
/* =====================================================================
   Game-mode smoke test (v6 · ASVAB Path):  node tools/gsmoke.mjs [url-or-file] [--shots dir]
   Subject chips spell out the codes (AFQT four first); every topic builds
   valid exercises (mc / type / match / AO); lessons by keyboard + mouse;
   wrong answers come back, cost hearts and land in Fix my mistakes;
   out-of-hearts screen; chest; Jump here; unit review; AFQT Mix; quit
   sheet + home button; guide → Study; XP / streak / crowns / goal;
   every subject's first lesson; mode switching; light theme; 390 px.
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
const shot = async (page, name, full) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name), fullPage: !!full }); };

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
const vis = (page, sel) => page.isVisible(sel);
const noHScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const NAMES = { AR:'Arithmetic Reasoning', MK:'Mathematics Knowledge', WK:'Word Knowledge', PC:'Paragraph Comprehension' };
const stats = page => page.evaluate(() => ({
  xp: JSON.parse(localStorage.getItem('asvab_g_xp') || '0'),
  path: JSON.parse(localStorage.getItem('asvab_g_path') || '{}'),
  miss: JSON.parse(localStorage.getItem('asvab_g_miss') || '[]').length,
  streak: JSON.parse(localStorage.getItem('asvab_g_streak') || '{"n":0}').n
}));
const seen = { mc:0, type:0, match:0, ao:0, retry:0, swap:0 };

/* answer the exercise on screen. mode: 'right' | 'wrong' | 'key' (right, by keyboard) */
async function answerOne(page, mode){
  const st = await page.evaluate(() => {
    const L = ASVAB_GAME._state(); if (!L || L.phase !== 'answer') return null;
    const ex = L.ex;
    return { kind: ex.kind, a: ex.q.a, n: ex.q.c ? ex.q.c.length : (ex.q.options || []).length, tries: ex.tries,
             pairs: ex.kind === 'match' ? ex.q.pairs : null,
             val: ex.kind === 'type' ? ASVAB_GAME._typeSpec(ex.q).val : null,
             text: ex.q.q || '', code: ex.code };
  });
  if (!st) return null;
  seen[st.kind]++; if (st.tries) seen.retry++;
  check(!/undefined|NaN/.test(st.text), `bad exercise text: ${st.text.slice(0, 60)}`);
  if (st.kind === 'match'){
    for (const p of st.pairs){
      await page.click(`.gq-tile[data-w="${p.w}"]`);
      await page.click(`.gq-tile[data-m="${p.w}"]`);
    }
  } else if (st.kind === 'type'){
    if (mode !== 'wrong' && seen.swap === 0){            // once: try the "Show choices instead" switch
      await page.click('#gq-swap'); seen.swap++;
      check(await page.locator('.gq-ch').count() === 4, 'Show choices did not switch to 4 choices');
      await page.click(`.gq-ch[data-k="${st.a}"]`); await page.click('#gq-check');
    } else {
      await page.fill('#gq-in', mode === 'wrong' ? String(st.val + 1) : String(st.val));
      await page.press('#gq-in', 'Enter');
    }
  } else {
    check(st.n === 4, `${st.code}: ${st.n} choices`);
    const k = mode === 'wrong' ? (st.a + 1) % 4 : st.a;
    if (mode === 'key'){ await page.keyboard.press(String(k + 1)); await page.keyboard.press('Enter'); }
    else { await page.click(`.gq-ch[data-k="${k}"]`); await page.click('#gq-check'); }
  }
  await page.waitForSelector('#gq-next', { timeout: 3000 });
  const fb = await page.innerText('#gq-fb');
  const ok = await page.$eval('#gq-foot', f => f.classList.contains('ok'));
  if (st.kind !== 'match'){
    check(/Answer|Correct answer/.test(fb), `feedback without an answer line (${st.code})`);
    if (!ok) check(fb.length > 40, `wrong-answer feedback too thin (${st.code}): ${fb.slice(0, 80)}`);
  }
  if (mode === 'wrong' && st.kind !== 'match') check(!ok, `${st.code} ${st.kind}: a wrong answer was marked right`);
  if (mode !== 'wrong') check(ok, `${st.code} ${st.kind}: the right answer was marked wrong`);
  if (mode === 'key') await page.keyboard.press('Enter'); else await page.click('#gq-next');
  return { ok, kind: st.kind };
}
/* play until an end screen; wrongFirst = how many exercises to miss first */
async function play(page, wrongFirst, useKeys){
  let miss = wrongFirst || 0;
  for (let guard = 0; guard < 60; guard++){
    if (await page.locator('.gq-end').count()) return (await page.innerText('.gq-end h2')).trim();
    const r = await answerOne(page, miss > 0 ? 'wrong' : useKeys ? 'key' : 'right');
    if (r && r.kind !== 'match' && miss > 0) miss--;
    if (!r) await page.waitForTimeout(100);
  }
  return 'stuck';
}
async function openNode(page, id, jump){
  await page.click(`[data-node="${id}"]`);
  await page.waitForSelector('.gp-pop', { timeout: 2000 });
  await page.click(jump ? '.gp-pop [data-jump]' : '.gp-pop [data-go]');
  await page.waitForSelector('.gq', { timeout: 2000 });
}
async function toHub(page){ if (await page.locator('#gq-cont').count()) await page.click('#gq-cont'); else if (await page.locator('#gq-back').count()) await page.click('#gq-back'); await page.waitForSelector('.gp-path'); }
async function chip(page, code){ await page.click(`[data-sub="${code}"]`); await page.waitForSelector(`[data-sub="${code}"].on`); }

try {
  const page = await open(1280, 900);

  step('switch to GAME, persistence, hub');
  await page.click('[data-mode-sw="game"]');
  check(await vis(page, '#screen-game') && !(await vis(page, '#screen-start')), 'game screen not shown');
  check(/game/.test(await page.evaluate(() => localStorage.getItem('asvab_mode')) || ''), 'game mode not saved');
  check(/ASVAB Path/.test(await page.innerText('.gp-title')), 'hub title missing');

  step('subject chips: AFQT four first, codes spelled out');
  const afqt = await page.$$eval('.gp-afqt .gp-sub', b => b.map(x => [x.dataset.sub, x.querySelector('.eq').textContent.trim()]));
  check(afqt.map(x => x[0]).join() === 'AR,MK,WK,PC', `AFQT chips ${afqt.map(x => x[0])}`);
  afqt.forEach(([c, eq]) => check(eq === '= ' + NAMES[c], `chip ${c} reads "${eq}"`));
  const more = await page.$$eval('.gp-more .gp-sub', b => b.map(x => x.dataset.sub));
  check(more.join() === 'GS,EI,AS,MC,AO', `more chips ${more}`);
  check(/AFQT/.test(await page.innerText('.gp-lbl')), 'AFQT label missing');

  step('every topic builds valid exercises (25 lessons each)');
  const audit = await page.evaluate(() => {
    const G = ASVAB_GAME, bad = [], sizes = {};
    for (const code in G._topics) for (const t of G._topics[code]){
      const P = G._pool(t.id);
      if (!t.w209 && !t.ao && !(t.gens && t.gens.length) && P.bank.length < 6) bad.push(`${t.id}: only ${P.bank.length} items`);
      for (let r = 0; r < 25; r++){
        const n = code === 'PC' || code === 'AO' ? 6 : 10;
        const exs = G._build(t.id, n, code === 'WK');
        sizes[t.id] = exs.length;
        if (exs.length < Math.min(n, 5)) bad.push(`${t.id}: lesson has ${exs.length}`);
        const keys = new Set();
        for (const ex of exs){
          const q = ex.q;
          if (ex.kind === 'match'){
            const ks = new Set(q.pairs.map(p => p.k));
            if (q.pairs.length < 4 || ks.size !== q.pairs.length) bad.push(`${t.id}: match pairs ${q.pairs.length}/${ks.size}`);
            continue;
          }
          if (ex.kind === 'ao'){ if (!q.options || q.options.length !== 4 || q.a < 0 || q.a > 3) bad.push(`${t.id}: AO item shape`); continue; }
          const k = (q.p || '') + '|' + q.q; if (keys.has(k)) bad.push(`${t.id}: repeated question in one lesson`); keys.add(k);
          if (!q.c || q.c.length !== 4 || new Set(q.c).size !== 4) bad.push(`${t.id}: choices ${JSON.stringify(q.c)}`);
          if (!(q.a >= 0 && q.a < 4)) bad.push(`${t.id}: key ${q.a}`);
          if (/undefined|NaN/.test(q.q + q.c.join('|'))) bad.push(`${t.id}: undefined/NaN in "${q.q.slice(0, 50)}"`);
          if (!q.why) bad.push(`${t.id}: no explanation for "${q.q.slice(0, 50)}"`);
          if (code === 'PC' && !PASSAGES[q.p]) bad.push(`${t.id}: missing passage ${q.p}`);
          if (ex.kind === 'type'){
            const sp = G._typeSpec(q), pn = parseNumish(q.c[q.a].replace(/^x = /, ''));
            if (!sp || (pn !== null && Math.abs(pn - sp.val) > 1e-9)) bad.push(`${t.id}: type spec ${q.c[q.a]} → ${sp && sp.val}`);
          }
        }
      }
    }
    return { bad: [...new Set(bad)].slice(0, 20), sizes };
  });
  check(audit.bad.length === 0, 'exercise audit: ' + audit.bad.join(' | '));
  const rv = await page.evaluate(() => ['AR','MK','WK','PC','GS','EI','AS','MC','AO'].map(c => ASVAB_GAME._review(c).length));
  check(rv.every(n => n >= 8), `unit reviews too short: ${rv}`);

  step('path per subject: unit banner, START on first node, rest locked');
  for (const c of ['AR','MK','WK','PC','GS','EI','AS','MC','AO']){
    await chip(page, c);
    const h = (await page.innerText('#gp-unit-h')).trim();
    check(h.startsWith(c + ' = '), `unit banner "${h}"`);
    if (NAMES[c]) check(h === `${c} = ${NAMES[c]}`, `unit banner "${h}"`);
    const ns = await page.$$eval('.gp-node', b => b.map(x => ({ id: x.dataset.node, cur: x.classList.contains('cur'), locked: x.classList.contains('locked') })));
    const want = await page.evaluate(code => ASVAB_GAME._nodes(code).length, c);
    check(ns.length === want && want >= 3, `${c}: ${ns.length} nodes`);
    check(ns[0].cur && !ns[0].locked && ns.slice(1).every(n => n.locked), `${c}: first node should be START, rest locked`);
    check(await page.locator('.gp-startb').count() === 1, `${c}: START bubble missing`);
  }
  await shot(page, 'game-hub.png', true);

  step('AR lesson 1 by keyboard, all right → Perfect, XP, streak, crown, next node unlocked');
  await chip(page, 'AR');
  const s0 = await stats(page);
  await openNode(page, 'ar-pct');
  check(/❤️ 5/.test(await page.innerText('#gq-hearts')), 'lesson should start with 5 hearts');
  check(/AR · Percents/.test(await page.innerText('.gq-tag')), 'lesson tag should name the code + topic');
  await shot(page, 'game-lesson.png');
  const end1 = await play(page, 0, true);
  check(end1 === 'Perfect lesson!', `end title "${end1}"`);
  await shot(page, 'game-end.png');
  const s1 = await stats(page);
  check(s1.xp === s0.xp + 15, `XP ${s0.xp} → ${s1.xp} (want +15)`);
  check(s1.streak === 1 && await page.locator('#gq-streak').count() === 1, 'streak should start at 1 with a badge');
  check(s1.path['ar-pct'] === 1, 'ar-pct should be level 1');
  await toHub(page);
  check(await page.$eval('[data-node="ar-rate"]', b => b.classList.contains('cur')), 'ar-rate should be the new START');
  check((await page.innerText('#gp-crowns')).trim() === '1', 'crowns should read 1');
  check((await page.innerText('#gp-day')).trim() === '15', 'today XP should read 15');

  step('wrong answers: cost a heart, come back, land in Fix my mistakes');
  await openNode(page, 'ar-rate');
  const end2 = await play(page, 2, false);
  check(end2 === 'Lesson complete!', `end title "${end2}"`);
  check(seen.retry >= 2, `missed items did not come back (retries seen: ${seen.retry})`);
  check(/Review these/.test(await page.innerText('.gq-end')), 'end screen should list missed items');
  const s2 = await stats(page);
  check(s2.miss >= 2, `mistake bank has ${s2.miss}`);
  check(s2.xp === s1.xp + 10, 'lesson with mistakes should give +10 XP');
  await toHub(page);

  step('treasure chest after two lessons');
  const chestId = 'AR-chest1';
  check(await page.$eval(`[data-node="${chestId}"]`, b => b.classList.contains('cur')), 'chest should be next');
  await page.click(`[data-node="${chestId}"]`);
  await page.waitForSelector('#g-ov-ok');
  const chestTxt = await page.innerText('#g-ov');
  const gain = +((chestTxt.match(/\+(\d+) XP/) || [])[1] || 0);
  check(gain >= 5 && gain <= 15, `chest gave ${gain}`);
  await page.click('#g-ov-ok');
  const s3 = await stats(page);
  check(s3.xp === s2.xp + gain && s3.path[chestId] === 1, 'chest XP / state not saved');
  await page.click(`[data-node="${chestId}"]`);
  check((await stats(page)).xp === s3.xp, 'an opened chest paid out twice');

  step('replay raises the crown level');
  await openNode(page, 'ar-pct');
  await play(page, 0, false);
  check((await stats(page)).path['ar-pct'] === 2, 'ar-pct should be level 2 after a replay');
  await toHub(page);

  step('out of hearts → fail screen');
  await chip(page, 'MK');
  await openNode(page, 'mk-num');
  const endF = await play(page, 99, false);
  check(endF === 'Out of hearts', `fail title "${endF}"`);
  check(await page.locator('#gq-retry').count() === 1, 'Try again missing');
  check(!(await stats(page)).path['mk-num'], 'a failed lesson must not count as done');
  await page.click('#gq-back');

  step('Fix my mistakes clears what you get right');
  const m0 = (await stats(page)).miss;
  check(m0 >= 5 && !(await page.$eval('#gp-fix', b => b.disabled)), `fix button / bank (${m0})`);
  await page.click('#gp-fix');
  const endX = await play(page, 0, false);
  check(endX === 'Mistakes fixed!', `fix title "${endX}"`);
  check((await stats(page)).miss === Math.max(0, m0 - 10), `mistake bank ${m0} → ${(await stats(page)).miss}`);
  await toHub(page);

  step('Jump here (WK): pass a locked lesson → everything before it unlocks; match pairs');
  await chip(page, 'WK');
  await openNode(page, 'wk-ctx', true);
  const endJ = await play(page, 0, false);
  check(/complete|Perfect/.test(endJ), `jump end "${endJ}"`);
  const pj = (await stats(page)).path;
  check(['wk-209a','wk-syn','wk-209b','WK-chest1','wk-ctx'].every(id => pj[id] >= 1), 'jump did not unlock earlier nodes: ' + JSON.stringify(pj));
  check(seen.match >= 1, 'no match-pairs exercise was played');
  await toHub(page);

  step('unit review (PC): 3 hearts, passing marks the unit done');
  await chip(page, 'PC');
  await openNode(page, 'PC-review', true);
  check(/❤️ 3/.test(await page.innerText('#gq-hearts')), 'review should start with 3 hearts');
  check(await page.locator('.gq-passage').count() === 1, 'PC exercise without a passage');
  const endR = await play(page, 0, false);
  check(endR === 'Unit review passed!', `review end "${endR}"`);
  await toHub(page);
  check(await page.locator('.gp-node.locked').count() === 0 && await page.locator('.gp-node.cur').count() === 0, 'PC path should be complete');

  step('first lesson in every other subject (incl. AO figures)');
  for (const c of ['GS','EI','AS','MC','AO']){
    await chip(page, c);
    const first = await page.$eval('.gp-node.cur', b => b.dataset.node);
    await openNode(page, first);
    const e = await play(page, 1, false);
    check(/complete|Perfect/.test(e), `${c}: end "${e}"`);
    await toHub(page);
  }
  check(seen.ao >= 6, `AO exercises played: ${seen.ao}`);
  check(seen.type >= 1, `no type-the-answer exercise came up (mc ${seen.mc})`);

  step('AFQT Mix covers AR · MK · WK · PC');
  await page.click('#gp-mix');
  const codes = await page.evaluate(() => [...new Set(ASVAB_GAME._state().items.map(e => e.code))].sort().join());
  check(codes === 'AR,MK,PC,WK', `mix codes ${codes}`);
  const endM = await play(page, 0, false);
  check(/AFQT Mix done/.test(endM), `mix end "${endM}"`);
  await toHub(page);

  step('quit sheet, home button, Escape');
  await chip(page, 'AR');
  await openNode(page, 'ar-money');
  await page.click('#gq-x');
  check(await vis(page, '#g-ov'), 'quit sheet did not open');
  await page.click('#g-ov-keep');
  check(!(await page.locator('#g-ov').count()) && await vis(page, '.gq'), 'Keep learning should close the sheet and stay');
  await page.click('#home-btn');
  check(await vis(page, '#g-ov-quit'), 'home mid-lesson should ask first');
  await page.keyboard.press('Escape');
  check(!(await page.locator('#g-ov').count()) && await vis(page, '.gq'), 'Escape should close the sheet');
  await page.click('#gq-x'); await page.click('#g-ov-quit');
  check(await vis(page, '.gp-path'), 'Quit should return to the path');
  await page.click('#home-btn');
  check(await vis(page, '.gp-path'), 'home on the path should stay on the path');

  step('guide → Study; daily goal; mute');
  await page.click('#gp-guide');
  const gt = await page.innerText('#g-ov');
  check(/AR = Arithmetic Reasoning/.test(gt) && /Step by step/i.test(gt) && /Must know/i.test(gt), 'AR guide content missing');
  await page.click('#g-ov-study');
  check(await vis(page, '#screen-study') && await page.getAttribute('.st-tab[data-st-tab="AR"]', 'aria-selected') === 'true', 'guide did not open the AR study lesson');
  await page.click('[data-mode-sw="game"]');
  await chip(page, 'GS');
  await page.click('#gp-guide');
  check(await page.locator('#g-ov .study-b li').count() > 5, 'GS guide should show the study sheet');
  await page.click('#g-ov-ok');
  await page.selectOption('#gp-goal', '10');
  check(await page.evaluate(() => localStorage.getItem('asvab_g_goal')) === '10' && /\/10 XP/.test(await page.innerText('.gp-top')), 'daily goal not saved');
  await page.click('#gp-mute');
  check(await page.evaluate(() => localStorage.getItem('asvab_g_mute')) === 'true', 'mute not saved');

  step('mode switching keeps the path; exam still works');
  await page.click('[data-mode-sw="exam"]');
  check(await vis(page, '#screen-start') && !(await vis(page, '#screen-game')), 'exam start screen not shown');
  await page.click('.mode[data-mode="afqt"]');
  check(await vis(page, '#screen-exam'), 'exam did not start after game mode');
  await page.click('[data-mode-sw="game"]');
  check(await vis(page, '.gp-path') && await page.$eval('[data-sub="GS"]', b => b.classList.contains('on')), 'subject not remembered');

  step('light theme');
  await page.click('#theme-btn');
  const bg = await page.$eval('#screen-game', e => getComputedStyle(e).backgroundColor);
  check(bg === 'rgb(244, 247, 245)', `light game background ${bg}`);
  await shot(page, 'game-light.png', true);
  await page.click('#theme-btn');
  check(page.errors.length === 0, 'console errors: ' + page.errors.join(' | '));
  await page.close();

  step('390 px phone layout');
  const ph = await open(390, 844);
  await ph.click('[data-mode-sw="game"]');
  check(await noHScroll(ph), 'hub scrolls sideways at 390 px');
  check(await ph.evaluate(() => { const r = document.querySelector('.mode-sw').getBoundingClientRect(); return r.right <= innerWidth + 1 && r.left >= -1; }), 'mode pills overflow at 390 px');
  await shot(ph, 'game-390-hub.png', true);
  await openNode(ph, 'ar-pct');
  check(await noHScroll(ph), 'lesson scrolls sideways at 390 px');
  await answerOne(ph, 'wrong');
  await ph.waitForSelector('.gq-ch, .gq-tile, #gq-in');
  check(await noHScroll(ph), 'feedback scrolls sideways at 390 px');
  await shot(ph, 'game-390-lesson.png');
  await play(ph, 0, false);
  await toHub(ph);
  await chip(ph, 'AO');
  await openNode(ph, 'ao-con');
  check(await noHScroll(ph), 'AO lesson scrolls sideways at 390 px');
  await shot(ph, 'game-390-ao.png');
  check(ph.errors.length === 0, '390 console errors: ' + ph.errors.join(' | '));
  await ph.close();
} catch (e) {
  failures.push('crash: ' + (e.stack || e));
} finally {
  await browser.close();
}
console.log(`  exercises played: ${JSON.stringify(seen)}`);
console.log(`\n${failures.length ? '✗ FAIL' : '✓ PASS'} — ${passed} checks passed, ${failures.length} failed`);
if (failures.length){ failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
