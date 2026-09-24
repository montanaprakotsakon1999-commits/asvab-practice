#!/usr/bin/env node
/* =====================================================================
   Word voice + tap-a-word smoke test (v6.1):  node tools/wordsmoke.mjs [url-or-file] [--shots dir]
   Speech is stubbed so every spoken string and rate is recorded.
   Dictionary covers every WK test word, WK choice word and 209-list word;
   tapify keeps the text intact; WK: auto-say, tap word → card (meaning
   behind a hint that blocks "perfect"), 🔊 on choices, word card in the
   feedback, match tiles speak; PC: dotted words open cards, read aloud
   start/stop, proof highlight keeps tappable words; voice settings
   (slow / off / auto-say); a browser without speech; 390 px.
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
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name) }); };

const STUB = () => {
  window.__said = []; window.__cancel = 0;
  window.SpeechSynthesisUtterance = class { constructor(t){ this.text = t; this.rate = 1; } };
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
    speak(u){ window.__said.push({ t: u.text, r: u.rate }); window.__last = u; },
    cancel(){ window.__cancel++; }, getVoices(){ return []; }, addEventListener(){}
  }});
};
const NOSPEECH = () => {
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: undefined });
  try { delete window.SpeechSynthesisUtterance; } catch(e){}
  window.SpeechSynthesisUtterance = undefined;
};

const browser = await chromium.launch();
async function open(w, h, init){
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.errors = [];
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) page.errors.push(m.text()); });
  page.on('pageerror', e => page.errors.push('pageerror: ' + e.message));
  page.on('dialog', d => d.accept());
  await page.addInitScript(init || STUB);
  await page.goto(URL_);
  return page;
}
const said = page => page.evaluate(() => window.__said.slice());
const lastSaid = async page => { const s = await said(page); return s.length ? s[s.length - 1] : null; };
const noHScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
async function openNode(page, id){
  await page.click(`[data-node="${id}"]`);
  await page.waitForSelector('.gp-pop');
  await page.click('.gp-pop [data-go]');
  await page.waitForSelector('.gq');
}
async function chip(page, code){ await page.click(`[data-sub="${code}"]`); await page.waitForSelector(`[data-sub="${code}"].on`); }
/* answer the current exercise correctly; returns its kind (or null at the end screen) */
async function answerRight(page){
  const st = await page.evaluate(() => { const L = ASVAB_GAME._state(); if (!L || L.phase !== 'answer') return null;
    return { kind: L.ex.kind, a: L.ex.q.a, pairs: L.ex.kind === 'match' ? L.ex.q.pairs : null, val: L.ex.kind === 'type' ? ASVAB_GAME._typeSpec(L.ex.q).val : null }; });
  if (!st) return null;
  if (st.kind === 'match'){ for (const p of st.pairs){ await page.click(`.gq-tile[data-w="${p.w}"]`); await page.click(`.gq-tile[data-m="${p.w}"]`); } }
  else if (st.kind === 'type'){ await page.fill('#gq-in', String(st.val)); await page.press('#gq-in', 'Enter'); }
  else { await page.click(`.gq-ch[data-k="${st.a}"]`); await page.click('#gq-check'); }
  await page.waitForSelector('#gq-next');
  return st;
}
async function finishLesson(page){
  for (let g = 0; g < 40; g++){
    if (await page.locator('.gq-end').count()) return (await page.innerText('.gq-end h2')).trim();
    const st = await answerRight(page);
    if (st) await page.click('#gq-next'); else await page.waitForTimeout(100);
  }
  return 'stuck';
}

try {
  const page = await open(1280, 900);
  await page.click('[data-mode-sw="game"]');

  step('dictionary coverage + tapify keeps the text');
  const aud = await page.evaluate(() => {
    const G = ASVAB_GAME, bad = [], strip = s => String(s).replace(/<[^>]+>/g, '');
    const POS = new Set(['n','v','adj','adv','prep','conj','pron','det','interj','phrase']);
    const n = Object.keys(window.WORDS).length;
    for (const [k, e] of Object.entries(window.WORDS)){
      if (!POS.has(e[1]) || !e[2] || e[2].length < 4) bad.push('entry ' + k);
    }
    BANK.WK.forEach(q => {
      const m = q.q.match(/<span class="kw">([^<]+)<\/span>/);
      if (m && !G._lookup(m[1])) bad.push('WK word ' + m[1]);
      q.c.forEach(c => { const t = strip(c).trim().replace(/[.,;:!?]+$/, ''); if (!/\s/.test(t) && !G._lookup(t)) bad.push('WK choice ' + t); });
      if (strip(G._tapify(q.q)) !== strip(q.q)) bad.push('tapify changed WK text');
    });
    W209.forEach(e => { if (!G._lookup(e.w)) bad.push('209 ' + e.w); if (!/\s/.test(e.k) && !G._lookup(e.k)) bad.push('209 key ' + e.k); });
    let minDotted = 99;
    Object.entries(PASSAGES).forEach(([id, p]) => {
      const html = G._tapify(p), d = (html.match(/class="tw d"/g) || []).length;
      minDotted = Math.min(minDotted, d);
      if (strip(html) !== strip(p)) bad.push('tapify changed ' + id);
      if (/undefined/.test(html)) bad.push('undefined in ' + id);
    });
    return { n, bad: bad.slice(0, 15), total: bad.length, minDotted };
  });
  check(aud.n > 1300, `dictionary has ${aud.n} entries`);
  check(aud.total === 0, `dictionary gaps (${aud.total}): ${aud.bad.join(' | ')}`);
  check(aud.minDotted >= 3, `a passage has only ${aud.minDotted} dotted words`);

  step('voice settings row + test button');
  check(await page.locator('#gp-voice').count() === 1 && await page.$eval('#gp-voice', s => s.value) === 'normal', 'voice select missing / not normal');
  check(await page.$eval('#gp-auto', c => c.checked), 'auto-say should default on');
  await page.click('#gp-vtest');
  check(/Arithmetic Reasoning/.test((await lastSaid(page) || {}).t || ''), 'Test button did not speak');

  step('WK lesson: auto-say, tap word → card with meaning behind a hint');
  await chip(page, 'WK');
  await openNode(page, 'wk-209a');
  let guard = 0;
  while (await page.evaluate(() => ASVAB_GAME._state().ex.kind) === 'match' && guard++ < 3){ await answerRight(page); await page.click('#gq-next'); }
  await page.waitForTimeout(400);
  const kw = (await page.innerText('.gq-q .kw')).trim();
  check((await said(page)).some(x => x.t === kw), `auto-say did not say "${kw}"`);
  check(await page.locator('.gq-q .kw .tw.d').count() === 1, 'test word is not a tappable dictionary word');
  await page.click('.gq-q .kw .tw');
  await page.waitForSelector('.g-wc');
  check((await lastSaid(page)).t === kw, 'tapping the word did not say it');
  const cardTxt = await page.innerText('.g-wc');
  check(/noun|verb|adjective|adverb/.test(cardTxt), 'card has no part of speech: ' + cardTxt.slice(0, 80));
  check(!(await page.isVisible('#wc-def')), 'meaning should be hidden behind the hint before answering');
  await page.click('#wc-slow');
  check((await lastSaid(page)).r === 0.6, 'slow button should speak at 0.6');
  await page.click('#wc-hint');
  check(await page.isVisible('#wc-def') && (await page.innerText('#wc-def')).length > 5, 'hint did not reveal the meaning');
  check(await page.locator('.g-wc .wc-chip').count() >= 1, 'no synonym chips');
  await page.click('.g-wc .wc-chip');
  const syn = (await page.locator('.g-wc .wc-chip').first().getAttribute('data-say'));
  check((await lastSaid(page)).t === syn, 'synonym chip did not speak');
  check(await page.evaluate(() => ASVAB_GAME._state().hints === 1 && ASVAB_GAME._state().ex.hint === true), 'hint not recorded');
  await shot(page, 'word-card.png');
  await page.click('#g-ov-ok');
  check(!(await page.locator('#g-ov').count()), 'card did not close');

  step('🔊 on a choice speaks it / opens its card');
  const c0 = (await page.getAttribute('.gq-chw:nth-child(1) .gq-say', 'data-say')).trim().replace(/[.,;:!?]+$/, '');
  await page.click('.gq-chw:nth-child(1) .gq-say');
  check((await lastSaid(page)).t.replace(/[.,;:!?]+$/, '') === c0, `choice 🔊 did not say "${c0}"`);
  if (await page.locator('#g-ov').count()){ check(await page.locator('#wc-hint').count() === 1, 'choice card before answering should be hint-gated'); await page.click('#g-ov-ok'); }
  check(await page.evaluate(() => ASVAB_GAME._state().phase === 'answer' && ASVAB_GAME._state().sel === null), 'choice 🔊 must not select the choice');

  step('WK feedback shows a word card; hint blocks Perfect');
  await answerRight(page);
  const fb = await page.innerText('#gq-fb');
  check(await page.locator('#gq-fb .gq-wcard').count() === 1 && /noun|verb|adjective|adverb/.test(fb), 'feedback word card missing');
  await page.click('#gq-fb .wc-mini');
  check((await lastSaid(page)).t === kw, 'feedback 🔊 did not say the word');
  await page.click('#gq-next');
  const before = (await said(page)).length;
  const endT = await finishLesson(page);
  check(endT === 'Lesson complete!', `a lesson with a hint must not be Perfect (got "${endT}")`);
  const words = await page.evaluate(n => window.__said.slice(n).map(x => x.t), before);
  check(words.length >= 5, `too little speech during the lesson (${words.length})`);
  await page.click('#gq-cont');

  step('voice settings: slow, off, auto-say off');
  await page.selectOption('#gp-voice', 'slow');
  await openNode(page, 'wk-209a');
  await page.waitForTimeout(350);
  if (await page.locator('.gq-q .kw .tw').count()){
    await page.click('.gq-q .kw .tw'); await page.waitForSelector('.g-wc');
    check((await lastSaid(page)).r === 0.72, 'slow speed not applied');
    await page.click('#g-ov-ok');
  }
  await page.click('#gq-x'); await page.click('#g-ov-quit');
  await page.selectOption('#gp-voice', 'off');
  await page.uncheck('#gp-auto');
  const n0 = (await said(page)).length;
  await openNode(page, 'wk-209a');
  await page.waitForTimeout(400);
  if (await page.locator('.gq-q .kw .tw').count()){
    await page.click('.gq-q .kw .tw'); await page.waitForSelector('.g-wc');
    check(/voice is off/i.test(await page.innerText('.g-wc')), 'card should say the voice is off');
    await page.click('#g-ov-ok');
  }
  check((await said(page)).length === n0, 'nothing should be spoken with the voice off');
  await page.click('#gq-x'); await page.click('#g-ov-quit');
  await page.selectOption('#gp-voice', 'normal');
  await page.check('#gp-auto');
  check(await page.evaluate(() => JSON.parse(localStorage.getItem('asvab_g_voice')).speed === 'normal'), 'voice setting not saved');

  step('PC lesson: dotted words, free meaning card, read aloud, proof keeps words tappable');
  await chip(page, 'PC');
  await openNode(page, 'pc-main');
  check(await page.locator('#gq-passage .tw.d').count() >= 3, 'passage has no dotted words');
  const dw = (await page.locator('#gq-passage .tw.d').first().innerText()).trim();
  await page.locator('#gq-passage .tw.d').first().click();
  await page.waitForSelector('.g-wc');
  check((await lastSaid(page)).t === dw, 'tapping a passage word did not say it');
  check(await page.isVisible('#wc-def') && !(await page.locator('#wc-hint').count()), 'PC cards should show the meaning right away');
  await shot(page, 'word-card-pc.png');
  await page.click('#g-ov-ok');
  const plain = page.locator('#gq-passage .tw:not(.d)').first();
  const pw = (await plain.innerText()).trim();
  await plain.click();
  check(!(await page.locator('#g-ov').count()) && (await lastSaid(page)).t === pw, 'an everyday word should just be spoken');
  const c1 = await page.evaluate(() => window.__cancel);
  await page.click('#gq-read');
  const para = (await lastSaid(page)).t;
  check(para.length > 200 && /⏹ Stop/.test(await page.innerText('#gq-read')), 'read aloud did not start');
  await page.click('#gq-read');
  check(await page.evaluate(() => window.__cancel) > c1 && /Read aloud/.test(await page.innerText('#gq-read')), 'read aloud did not stop');
  await page.click('#gq-read');
  await page.evaluate(() => window.__last.onend && window.__last.onend());
  check(/Read aloud/.test(await page.innerText('#gq-read')), 'read aloud button did not reset at the end');
  const pc0 = await page.getAttribute('.gq-chw:nth-child(2) .gq-say', 'data-say');
  await page.click('.gq-chw:nth-child(2) .gq-say');
  check((await lastSaid(page)).t.replace(/[.,;:!?]+$/, '') === pc0.trim().replace(/[.,;:!?]+$/, ''), 'PC choice 🔊 should read the choice');
  if (await page.locator('#g-ov').count()){ check(!/\s/.test(pc0.trim()), 'only one-word choices open a card'); await page.click('#g-ov-ok'); }
  const hasProof = await page.evaluate(() => !!ASVAB_GAME._state().ex.q.proof);
  await answerRight(page);
  check(await page.locator('#gq-passage .tw').count() > 20, 'passage words lost after answering');
  if (hasProof) check(await page.locator('#gq-passage mark.proof').count() === 1, 'proof highlight missing');
  check(await page.evaluate(() => ASVAB_GAME._state().hints || 0) === 0, 'PC word cards must not count as hints');
  await page.click('#gq-next');
  await page.click('#gq-x'); await page.click('#g-ov-quit');

  step('match tiles speak the word');
  await chip(page, 'WK');
  await openNode(page, 'wk-209a');
  for (let g = 0; g < 12; g++){
    if (await page.evaluate(() => ASVAB_GAME._state() && ASVAB_GAME._state().ex.kind === 'match')) break;
    await answerRight(page); await page.click('#gq-next');
  }
  if (await page.evaluate(() => ASVAB_GAME._state() && ASVAB_GAME._state().ex.kind === 'match')){
    const w0 = await page.getAttribute('.gq-tile[data-w]', 'data-w');
    await page.click(`.gq-tile[data-w="${w0}"]`);
    check((await lastSaid(page)).t === w0, 'match tile did not speak');
  } else check(false, 'no match exercise reached');
  check(page.errors.length === 0, 'console errors: ' + page.errors.join(' | '));
  await page.close();

  step('browser without speech: cards still work, no errors');
  const ns = await open(1280, 900, NOSPEECH);
  await ns.click('[data-mode-sw="game"]');
  check(/can't speak/.test(await ns.innerText('#gp-voice-row')), 'no-speech note missing');
  await chip(ns, 'WK');
  await openNode(ns, 'wk-209a');
  if (await ns.locator('.gq-q .kw .tw').count()){
    await ns.click('.gq-q .kw .tw'); await ns.waitForSelector('.g-wc');
    check(/can't speak/.test(await ns.innerText('.g-wc')), 'card should explain there is no voice');
    await ns.click('#g-ov-ok');
  }
  check(ns.errors.length === 0, 'no-speech console errors: ' + ns.errors.join(' | '));
  await ns.close();

  step('390 px');
  const ph = await open(390, 844);
  await ph.click('[data-mode-sw="game"]');
  await chip(ph, 'PC');
  await openNode(ph, 'pc-main');
  check(await noHScroll(ph), 'PC lesson scrolls sideways at 390 px');
  await ph.locator('#gq-passage .tw.d').first().click();
  await ph.waitForSelector('.g-wc');
  check(await noHScroll(ph), 'word card scrolls sideways at 390 px');
  await shot(ph, 'word-card-390.png');
  await ph.click('#g-ov-ok');
  await ph.click('#gq-x'); await ph.click('#g-ov-quit');
  await chip(ph, 'WK');
  await openNode(ph, 'wk-209a');
  check(await noHScroll(ph), 'WK lesson scrolls sideways at 390 px');
  await shot(ph, 'wk-390.png');
  check(ph.errors.length === 0, '390 console errors: ' + ph.errors.join(' | '));
  await ph.close();
} catch (e) {
  failures.push('crash: ' + (e.stack || e));
} finally {
  await browser.close();
}
console.log(`\n${failures.length ? '✗ FAIL' : '✓ PASS'} — ${passed} checks passed, ${failures.length} failed`);
if (failures.length){ failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
