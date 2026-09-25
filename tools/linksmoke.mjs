#!/usr/bin/env node
/* =====================================================================
   Deep-link smoke test (v6.3):  node tools/linksmoke.mjs [url-or-file]
   #afqt · #full · #w209 · #only-GS … #only-AO, optional -mock / -exam.
   Every link × suffix is opened as a fresh page load and must land on the
   right sitting, in the right mode (mock → Mock, exam/none → Exam), timed
   or untimed, with the hash cleared and the saved mode untouched. Saved
   Game / Thai game / Study / Mock users drop to the linked mode for that
   launch only. Unknown hashes stay on home. hashchange while the page is
   open (home, results, mid-sitting confirm accept/dismiss, game hub) —
   and Back is not swallowed by a leftover link entry. Exam links force the
   clock on without changing the user's Timed switch. The address-bar
   fallback (replaceState refused, no Navigation API) never loops Back.
   A deep-linked sitting runs to results and home. 390-px layout. No
   console errors.
   ===================================================================== */
import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const target = process.argv[2];
const BASE = (target ? (/^https?:/.test(target) ? target : pathToFileURL(path.resolve(target)).href)
                     : pathToFileURL(path.join(here, '..', 'index.html')).href).replace(/#.*$/, '');
let passed = 0;
const failures = [];
function check(cond, msg){ if (cond) passed++; else { failures.push(msg); console.error('  ✗ ' + msg); } }
const step = name => console.log('· ' + name);

const ALL = ['GS','AR','WK','PC','MK','EI','AS','MC','AO'];
const AFQT = ['AR','WK','PC','MK'];
const LINKS = [['afqt', AFQT], ['full', ALL], ['w209', ['W209']]].concat(ALL.map(c => ['only-' + c, [c]]));
const SUFFIXES = ['', '-exam', '-mock'];

const browser = await chromium.launch();
const errors = [];
/* exactly ONE dialog handler per page; tests set dialogPlan before an expected dialog */
let dialogPlan = null, dialogs = [];
async function open(w, h){
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('dialog', async d => {
    dialogs.push(d.message());
    if (dialogPlan === 'dismiss') await d.dismiss();
    else { if (dialogPlan !== 'accept') failures.push('unexpected dialog: ' + d.message()); await d.accept(); }
  });
  return page;
}
/* a real page load (not a same-document hash navigation) */
async function load(page, hash){
  await page.goto('about:blank');
  await page.goto(BASE + (hash || ''));
}
async function setSaved(page, mode){
  await load(page, '');
  await page.evaluate(m => { if (m === null) localStorage.removeItem('asvab_mode'); else localStorage.setItem('asvab_mode', JSON.stringify(m)); }, mode);
}
const state = page => page.evaluate(() => {
  const vis = s => { const el = document.querySelector(s); return !!el && !el.classList.contains('hidden'); };
  return {
    hash: location.hash, href: location.href,
    mode: document.body.dataset.mode || 'exam',
    pill: (document.querySelector('[data-mode-sw].on') || {}).dataset?.modeSw || null,
    th: document.body.classList.contains('th'),
    exam: vis('#screen-exam'), start: vis('#screen-start'), study: vis('#screen-study'), plan: vis('#screen-plan'),
    game: vis('#screen-game'), results: vis('#screen-results'),
    ex: EX ? { mock: !!EX.mock, timed: !!EX.timed, modeAt: EX.modeAt,
               parts: EX.parts.map(p => p.name === '209 Words' ? 'W209' : p.code),
               lens: EX.parts.map(p => p.qs.length) } : null,
    clock: document.querySelector('#ex-clock').textContent.trim(),
    clockCls: document.querySelector('#ex-clock').className,
    timerBox: document.querySelector('#opt-timer').checked,
    saved: localStorage.getItem('asvab_mode'),
    card: (document.querySelector('#qcard .qnum') || {}).textContent || ''
  };
});
/* a hashchange link steps back over its own history entry (async) — wait for the clean URL */
const settle = page => page.waitForFunction(() => location.href.indexOf('#') === -1, null, { timeout: 3000 });
const navIndex = page => page.evaluate(() => window.navigation ? navigation.currentEntry.index : -1);
const noHScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

/* assert the page is on a freshly-linked sitting */
function expectSitting(s, parts, mock, tag){
  check(s.exam && !s.start && !s.study && !s.plan && !s.game && !s.results, `${tag}: exam screen should be the only screen showing`);
  check(!!s.ex, `${tag}: no sitting started`);
  if (!s.ex) return;
  check(JSON.stringify(s.ex.parts) === JSON.stringify(parts), `${tag}: parts ${JSON.stringify(s.ex.parts)}, want ${JSON.stringify(parts)}`);
  check(s.ex.lens.every((n, i) => n === (parts[i] === 'W209' ? 20 : 10)), `${tag}: wrong question counts ${JSON.stringify(s.ex.lens)}`);
  const mode = mock ? 'mock' : 'exam';
  check(s.mode === mode && s.pill === mode && s.ex.modeAt === mode, `${tag}: mode ${s.mode}/pill ${s.pill}/modeAt ${s.ex.modeAt}, want ${mode}`);
  check(s.ex.mock === mock, `${tag}: EX.mock is ${s.ex.mock}`);
  check(s.ex.timed === !mock, `${tag}: EX.timed is ${s.ex.timed}, want ${!mock}`);
  if (mock) check(/NO CLOCK/.test(s.clock) && /mock/.test(s.clockCls), `${tag}: mock clock shows "${s.clock}"`);
  else check(/^\d\d:\d\d$/.test(s.clock) && !/off|mock/.test(s.clockCls), `${tag}: exam clock shows "${s.clock}" (${s.clockCls})`);
  check(!s.th, `${tag}: Thai class still on`);
  check(s.hash === '' && s.href.indexOf('#') === -1, `${tag}: hash not cleared (${s.href})`);
  check(/QUESTION 1 OF/.test(s.card), `${tag}: first question not showing ("${s.card}")`);
}

try {
  const page = await open(1280, 900);

  /* ---------- parser ---------- */
  step('parser: every link × suffix, case-insensitive, rejects junk');
  await load(page, '');
  const parsed = await page.evaluate(([links, sufs]) => links.flatMap(([l]) => sufs.map(s => {
    const r = ASVAB_LINK.parse('#' + l + s);
    return r && { h: l + s, what: r.what, mock: r.mock, n: r.list.length };
  })), [LINKS, SUFFIXES]);
  check(parsed.every(Boolean) && parsed.length === LINKS.length * SUFFIXES.length, 'parser rejected a valid link');
  check(parsed.every(r => r.mock === /-mock$/.test(r.h)), 'parser got the mock suffix wrong');
  const junk = await page.evaluate(() => ['', '#', '#nope', '#only-ZZ', '#only-', '#only-ARX', '#afqt-quiz', '#afqt-mock-exam',
    '#full-', '#w209mock', '#only AR', 'afqt', '#-mock', '#only-AR-mock-mock'].filter(h => ASVAB_LINK.parse(h) !== null));
  check(junk.length === 0, 'parser accepted junk: ' + JSON.stringify(junk));
  const cases = await page.evaluate(() => ['#AFQT', '#Only-ar', '#only-mc-MOCK', '#FULL-Exam', '#W209-Mock'].map(h => { const r = ASVAB_LINK.parse(h); return r && r.what + (r.mock ? '/m' : ''); }));
  check(JSON.stringify(cases) === JSON.stringify(['afqt', 'only-AR', 'only-MC/m', 'full', 'w209/m']), 'case-insensitive parse: ' + JSON.stringify(cases));

  /* ---------- no hash: nothing launches ---------- */
  step('no hash: start screen, no sitting');
  await setSaved(page, null);
  await load(page, '');
  let s = await state(page);
  check(s.start && !s.exam && !s.ex, 'plain load should show the start screen with no sitting');

  /* ---------- every link × suffix, fresh load ---------- */
  step(`all ${LINKS.length * SUFFIXES.length} links on a fresh load`);
  for (const [l, parts] of LINKS){
    for (const suf of SUFFIXES){
      await load(page, '#' + l + suf);
      s = await state(page);
      expectSitting(s, parts, suf === '-mock', '#' + l + suf);
      check(s.saved === null, `#${l}${suf}: a deep link must not save a mode (saved = ${s.saved})`);
      check(s.timerBox === true, `#${l}${suf}: Timed switch should stay at its default (checked)`);
    }
  }

  /* ---------- saved modes: drop to the linked mode for this launch only ---------- */
  step('saved Game / Thai / Study / Plan / Mock / Exam: linked mode for this launch, saved mode kept');
  for (const saved of ['game', 'gameth', 'study', 'plan', 'mock', 'exam']){
    for (const [hash, parts, mock] of [['#only-AR', ['AR'], false], ['#afqt-mock', AFQT, true], ['#w209-exam', ['W209'], false]]){
      await setSaved(page, saved);
      await load(page, hash);
      s = await state(page);
      expectSitting(s, parts, mock, `saved ${saved} + ${hash}`);
      check(s.saved === JSON.stringify(saved), `saved ${saved} + ${hash}: saved mode changed to ${s.saved}`);
    }
    await load(page, '');                                   // next plain visit is back in the saved mode
    s = await state(page);
    check(s.mode === saved && s.pill === saved && !s.exam && !s.ex, `saved ${saved}: plain reload should return to ${saved} (got ${s.mode})`);
    if (saved === 'game' || saved === 'gameth') check(s.game, `saved ${saved}: game hub should show after reload`);
    if (saved === 'gameth') check(s.th, 'saved gameth: Thai class should come back after reload');
    if (saved === 'study') check(s.study, 'saved study: study screen should show after reload');
    if (saved === 'plan') check(s.plan && !s.start, 'saved plan: plan screen should show after reload');
  }
  await setSaved(page, null);

  /* ---------- bad hashes ---------- */
  step('unknown hash: cleared, home screen, no sitting');
  for (const bad of ['#nope', '#only-ZZ', '#afqt-quiz', '#only-AR-mock-exam', '#%E0%B8%81', '#']){
    await load(page, bad);
    s = await state(page);
    check(s.start && !s.exam && !s.ex, `${bad}: should stay on the start screen`);
    check(s.href.indexOf('#') === -1, `${bad}: hash not cleared (${s.href})`);
  }
  await setSaved(page, 'game');
  await load(page, '#nope');
  s = await state(page);
  check(s.game && !s.exam && !s.ex && s.mode === 'game', 'bad hash with saved Game should stay on the game hub');
  await setSaved(page, null);

  /* ---------- hashchange while the page is open ---------- */
  step('hashchange: from home, mid-sitting (dismiss / accept), from results, from game hub');
  await load(page, '');
  const homeIdx = await navIndex(page), homeLen = await page.evaluate(() => history.length);
  await page.evaluate(() => { location.hash = '#only-MK-mock'; });
  await page.waitForFunction(() => EX && !document.querySelector('#screen-exam').classList.contains('hidden'));
  await settle(page);
  s = await state(page);
  expectSitting(s, ['MK'], true, 'hashchange from home #only-MK-mock');
  if (homeIdx >= 0) check(await navIndex(page) === homeIdx, `hashchange link left an extra history entry (index ${await navIndex(page)}, home was ${homeIdx}) — Back would be swallowed`);
  check(await page.evaluate(() => history.length) <= homeLen + 1, 'hashchange link grew history by more than its own entry');

  await page.keyboard.press('a');                            // answer one question so the sitting has state
  dialogs = []; dialogPlan = 'dismiss';
  await page.evaluate(() => { location.hash = '#only-AR'; });
  await page.waitForTimeout(250);
  dialogPlan = null;
  await settle(page).catch(() => {});
  s = await state(page);
  check(dialogs.length === 1 && /won't be scored/.test(dialogs[0]), 'mid-sitting link should confirm exactly once');
  check(s.ex && JSON.stringify(s.ex.parts) === '["MK"]' && s.ex.mock && s.mode === 'mock', 'dismissing the confirm should keep the running sitting');
  check(s.href.indexOf('#') === -1, 'dismissed link should still clear the hash');
  check(await page.evaluate(() => EX.parts[0].ans[0] !== null), 'dismissing the confirm lost the recorded answer');

  dialogs = []; dialogPlan = 'accept';
  await page.evaluate(() => { location.hash = '#only-AR'; });
  await page.waitForFunction(() => EX && EX.parts[0].code === 'AR');
  dialogPlan = null;
  await settle(page);
  s = await state(page);
  check(dialogs.length === 1, 'accepting should have shown exactly one confirm');
  expectSitting(s, ['AR'], false, 'hashchange mid-sitting accepted #only-AR');

  step('deep-linked sitting runs to results, then home');
  for (let i = 0; i < 10; i++){ await page.keyboard.press('abcd'[i % 4]); await page.waitForTimeout(280); }
  await page.click('#btn-finish');
  s = await state(page);
  check(s.results && !s.exam, 'finishing a deep-linked sitting should show results');
  dialogs = [];
  await page.evaluate(() => { location.hash = '#w209-mock'; });   // from results: no confirm
  await page.waitForFunction(() => EX && EX.parts[0].name === '209 Words');
  await settle(page);
  s = await state(page);
  check(dialogs.length === 0, 'a link from the results screen should not confirm');
  expectSitting(s, ['W209'], true, 'hashchange from results #w209-mock');
  dialogPlan = 'accept';
  await page.click('#home-btn');
  dialogPlan = null;
  s = await state(page);
  check(s.start && !s.exam && s.mode === 'mock', 'home after a mock link should show the start screen in Mock mode');

  await setSaved(page, 'game');
  await load(page, '');
  check((await state(page)).game, 'saved game should open the game hub');
  await page.evaluate(() => { location.hash = '#afqt'; });
  await page.waitForFunction(() => EX && !document.querySelector('#screen-exam').classList.contains('hidden'));
  await settle(page);
  s = await state(page);
  expectSitting(s, AFQT, false, 'hashchange from game hub #afqt');
  check(s.saved === '"game"', 'hashchange from game hub changed the saved mode');
  await setSaved(page, null);

  /* ---------- Timed switch: exam links force the clock, the switch is left as the user set it ---------- */
  step('Timed switch off: exam link is still timed, mock link has no clock, switch stays off');
  await load(page, '');
  await page.uncheck('#opt-timer');
  await page.evaluate(() => { location.hash = '#only-AR'; });
  await page.waitForFunction(() => EX && EX.parts[0].code === 'AR');
  await settle(page);
  s = await state(page);
  expectSitting(s, ['AR'], false, 'switch off + #only-AR');
  check(s.timerBox === false, 'exam link must put the Timed switch back to OFF after starting');
  dialogs = []; dialogPlan = 'accept';
  await page.evaluate(() => { location.hash = '#only-AR-mock'; });
  await page.waitForFunction(() => EX && EX.mock);
  dialogPlan = null;
  await settle(page);
  s = await state(page);
  expectSitting(s, ['AR'], true, 'switch off + #only-AR-mock');
  check(s.timerBox === false, 'mock link must leave the Timed switch OFF');
  await page.close();

  /* ---------- address-bar fallback: replaceState refused ---------- */
  step('replaceState refused: link still lands, Back never loops');
  const fb = await open(1280, 900);
  await fb.addInitScript(() => {
    history.replaceState = function(){ throw new DOMException('refused', 'SecurityError'); };
    try { Object.defineProperty(window, 'navigation', { value: undefined, configurable: true }); } catch(e){}
  });
  await load(fb, '#only-EI');
  s = await state(fb);
  check(s.exam && s.ex && JSON.stringify(s.ex.parts) === '["EI"]' && s.ex.timed, 'fallback: #only-EI on load did not start a timed EI sitting');
  check(!/#only/i.test(s.href), `fallback: link hash left in the address bar (${s.href})`);
  const fbLen = await fb.evaluate(() => history.length);
  await fb.evaluate(() => { window.__hc = 0; addEventListener('hashchange', () => window.__hc++); });
  dialogs = []; dialogPlan = 'accept';                     // an EI sitting is open, so the link confirms first
  await fb.evaluate(() => { location.hash = '#only-AS'; });
  await fb.waitForFunction(() => EX && EX.parts[0].code === 'AS');
  await fb.waitForTimeout(300);                            // let any stray hashchange / fallback navigation run
  dialogPlan = null;
  check(dialogs.length === 1, `fallback: expected exactly one confirm, got ${dialogs.length}`);
  s = await state(fb);
  check(s.ex && JSON.stringify(s.ex.parts) === '["AS"]', 'fallback: hashchange #only-AS did not start AS');
  check(!/#only/i.test(s.href), `fallback: hashchange left the link hash (${s.href})`);
  check(await fb.evaluate(() => history.length) === fbLen + 1, 'fallback: must add only the one entry the hash itself pushed');
  check(await fb.evaluate(() => window.__hc) <= 2, 'fallback: hashchange looped');
  dialogs = []; dialogPlan = 'accept';
  await fb.goBack().catch(() => {});
  await fb.waitForTimeout(300);
  dialogPlan = null;
  s = await state(fb);
  check(dialogs.length === 0 && s.ex && JSON.stringify(s.ex.parts) === '["AS"]', 'fallback: Back re-opened the link (Back loop)');
  await fb.close();

  /* ---------- phone ---------- */
  step('390 px: links land and fit the screen');
  const phone = await open(390, 844);
  for (const h of ['#afqt-mock', '#full', '#only-AO', '#w209-mock', '#only-PC-exam']){
    await load(phone, h);
    s = await state(phone);
    const parts = h.startsWith('#afqt') ? AFQT : h.startsWith('#full') ? ALL : h.startsWith('#w209') ? ['W209'] : [h.slice(6, 8)];
    expectSitting(s, parts, /-mock$/.test(h), '390px ' + h);
    check(await noHScroll(phone), `390px ${h}: horizontal scroll`);
    const card = await phone.locator('#qcard').boundingBox();
    check(card && card.width > 250 && card.x >= 0 && card.x + card.width <= 391, `390px ${h}: question card off-screen ${JSON.stringify(card)}`);
  }
  await phone.close();

  check(errors.length === 0, 'console errors: ' + errors.join(' | '));
} catch (e){
  failures.push('linksmoke crashed: ' + e.message);
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
