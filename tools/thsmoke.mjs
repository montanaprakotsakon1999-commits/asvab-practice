#!/usr/bin/env node
/* =====================================================================
   Thai + English game smoke test (v6.2):  node tools/thsmoke.mjs [url-or-file] [--shots dir]
   🇹🇭 pill after GAME; mode persists; Thai data covers every written
   question (why), every generator template, AO tips, the four AFQT
   lessons, the five study sheets (same HTML tags) and every dictionary
   word; hub / nodes / prompts / buttons / feedback / end screens are
   bilingual; Thai explanation after an answer; word cards show Thai
   (behind the WK hint gate) and speak it with a th-TH voice; guides in
   Thai (study sheets with an English toggle); switching language mid-
   lesson keeps the question; English GAME stays English; shared
   progress; 390 px; no console errors.
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
const THAI = /[฀-๿]/;

const STUB = () => {
  window.__said = [];
  window.SpeechSynthesisUtterance = class { constructor(t){ this.text = t; this.rate = 1; this.lang = ''; } };
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
    speak(u){ window.__said.push({ t: u.text, lang: u.lang }); }, cancel(){}, getVoices(){ return []; }, addEventListener(){}
  }});
};
const browser = await chromium.launch();
async function open(w, h){
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.errors = [];
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) page.errors.push(m.text()); });
  page.on('pageerror', e => page.errors.push('pageerror: ' + e.message));
  page.on('dialog', d => d.accept());
  await page.addInitScript(STUB);
  await page.goto(URL_);
  return page;
}
const noHScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const lastSaid = page => page.evaluate(() => window.__said[window.__said.length - 1] || null);
async function chip(page, code){ await page.click(`[data-sub="${code}"]`); await page.waitForSelector(`[data-sub="${code}"].on`); }
async function openNode(page, id, jump){
  await page.click(`[data-node="${id}"]`); await page.waitForSelector('.gp-pop');
  await page.click(jump ? '.gp-pop [data-jump]' : '.gp-pop [data-go]'); await page.waitForSelector('.gq');
}
async function state(page){
  return page.evaluate(() => { const L = ASVAB_GAME._state(); if (!L || L.phase !== 'answer') return null;
    return { kind: L.ex.kind, a: L.ex.q.a, pairs: L.ex.kind === 'match' ? L.ex.q.pairs : null, val: L.ex.kind === 'type' ? ASVAB_GAME._typeSpec(L.ex.q).val : null }; });
}
async function answer(page, right){
  const st = await state(page); if (!st) return null;
  if (st.kind === 'match'){ for (const p of st.pairs){ await page.click(`.gq-tile[data-w="${p.w}"]`); await page.click(`.gq-tile[data-m="${p.w}"]`); } }
  else if (st.kind === 'type'){ await page.fill('#gq-in', String(right ? st.val : st.val + 1)); await page.press('#gq-in', 'Enter'); }
  else { await page.click(`.gq-ch[data-k="${right ? st.a : (st.a + 1) % 4}"]`); await page.click('#gq-check'); }
  await page.waitForSelector('#gq-next');
  return st;
}
async function finish(page){
  for (let g = 0; g < 40; g++){
    if (await page.locator('.gq-end').count()) return (await page.innerText('.gq-end h2')).trim();
    const st = await answer(page, true); if (st) await page.click('#gq-next'); else await page.waitForTimeout(100);
  }
  return 'stuck';
}

try {
  const page = await open(1280, 900);

  step('🇹🇭 pill sits after GAME; mode persists');
  const pills = await page.$$eval('[data-mode-sw]', b => b.map(x => x.dataset.modeSw));
  check(JSON.stringify(pills) === JSON.stringify(['plan', 'study', 'exam', 'mock', 'game', 'gameth']), `mode pills are ${pills}`);
  await page.click('[data-mode-sw="gameth"]');
  check(await page.isVisible('#screen-game') && await page.evaluate(() => ASVAB_GAME._th() && document.body.classList.contains('th')), 'Thai game not on');
  check(/gameth/.test(await page.evaluate(() => localStorage.getItem('asvab_mode')) || ''), 'gameth not saved');
  await page.reload();
  check(await page.isVisible('#screen-game') && await page.evaluate(() => ASVAB_GAME._th()), 'Thai game not restored on reload');

  step('Thai data coverage');
  const cov = await page.evaluate(() => {
    const T = window.TH_DATA, bad = [], thai = /[฀-๿]/, tags = s => (String(s).match(/<[^>]+>/g) || []).join('');
    let n = 0;
    for (const code in BANK) BANK[code].forEach(q => { if (!q.why) return; n++; const t = T.why[exKey(code, q)]; if (!t || !thai.test(t)) bad.push('why ' + code + ' ' + String(q.q || '').slice(0, 30)); });
    GEN_AR.concat(GEN_MK).forEach(f => { if (!T.gens[f.name] || !thai.test(T.gens[f.name])) bad.push('gen ' + f.name); });
    ['__ao_con', '__ao_puz'].forEach(k => { if (!thai.test(T.gens[k] || '')) bad.push(k); });
    ['AR','MK','WK','PC'].forEach(c => { const en = ASVAB_STUDY.LESSONS[c], th = T.lessons[c];
      if (!th || !thai.test(th.what)) bad.push('lesson ' + c);
      else ['steps','know','traps'].forEach(f => { if (th[f].length !== en[f].length) bad.push(`lesson ${c}.${f} length`); }); });
    ['GS','EI','AS','MC','AO'].forEach(c => { const en = STUDY.find(s => s.code === c).body, th = T.study[c];
      if (!th || !thai.test(th)) bad.push('study ' + c); else if (tags(th) !== tags(en)) bad.push('study tags ' + c); });
    const noTh = Object.entries(window.WORDS).filter(([k, e]) => !e[4] || !thai.test(e[4])).map(([k]) => k);
    if (noTh.length) bad.push('words without Thai: ' + noTh.slice(0, 5).join(','));
    return { n, bad: bad.slice(0, 12), total: bad.length };
  });
  check(cov.n > 800, `only ${cov.n} explained questions`);
  check(cov.total === 0, `Thai data gaps (${cov.total}): ${cov.bad.join(' | ')}`);

  step('hub is bilingual; every subject + node has Thai');
  check(/เส้นทาง ASVAB/.test(await page.innerText('.gp-title')), 'Thai title missing');
  check(THAI.test(await page.innerText('.gp-intro')), 'Thai intro missing');
  const chips = await page.$$eval('.gp-sub', b => b.map(x => [x.dataset.sub, (x.querySelector('.thl') || {}).textContent || '']));
  check(chips.length === 9 && chips.every(c => /[฀-๿]/.test(c[1])), 'a subject chip has no Thai name: ' + JSON.stringify(chips.filter(c => !c[1])));
  for (const c of ['AR','MK','WK','PC','GS','EI','AS','MC','AO']){
    await chip(page, c);
    const labels = await page.$$eval('.gp-nlabel', l => l.map(x => (x.querySelector('.thl') || {}).textContent || ''));
    check(labels.length >= 3 && labels.every(t => /[฀-๿]/.test(t)), `${c}: a path node has no Thai label`);
    check(THAI.test(await page.innerText('.gp-unit')), `${c}: unit banner has no Thai`);
  }
  await shot(page, 'th-hub.png', true);

  step('AR lesson: bilingual prompt/buttons, Thai explanation after a wrong answer');
  await chip(page, 'AR');
  await openNode(page, 'ar-pct');
  check(THAI.test(await page.innerText('.gq-prompt')), 'prompt has no Thai');
  check(/ตรวจคำตอบ/.test(await page.innerText('#gq-check')), 'Check button has no Thai');
  check(THAI.test(await page.innerText('.gq-tag')), 'lesson tag has no Thai topic');
  const w1 = await answer(page, false);
  check(await page.locator('#gq-fb .gq-thwhy').count() === 1, `no Thai explanation after a wrong ${w1.kind} answer`);
  check(THAI.test(await page.innerText('#gq-fb .gq-thwhy')), 'Thai explanation is empty');
  check(/ยังไม่ถูก/.test(await page.innerText('#gq-fb h4')), 'feedback header has no Thai');
  await shot(page, 'th-feedback.png');
  await page.click('#gq-next');
  const endT = await finish(page);
  check(THAI.test(endT) && /Lesson complete/.test(endT), `end title "${endT}"`);
  check(THAI.test(await page.innerText('.gq-cards')), 'end cards have no Thai');
  const xpTh = await page.evaluate(() => JSON.parse(localStorage.getItem('asvab_g_xp') || '0'));
  await page.click('#gq-cont');

  step('WK: Thai meaning behind the hint gate; Thai voice');
  await chip(page, 'WK');
  await openNode(page, 'wk-209a');
  for (let g = 0; g < 3 && (await state(page)).kind === 'match'; g++){ await answer(page, true); await page.click('#gq-next'); }
  await page.click('.gq-q .kw .tw');
  await page.waitForSelector('.g-wc');
  check(!(await page.isVisible('#wc-th')), 'Thai meaning should be hidden before the hint');
  await page.click('#wc-hint');
  check(await page.isVisible('#wc-th') && THAI.test(await page.innerText('#wc-th')), 'Thai meaning missing after hint');
  check(/คำ(นาม|กริยา|คุณศัพท์|กริยาวิเศษณ์)|วลี/.test(await page.innerText('.wc-pos')), 'Thai part of speech missing');
  await page.click('#wc-thsay');
  const ts = await lastSaid(page);
  check(ts && ts.lang === 'th-TH' && THAI.test(ts.t), 'Thai 🔊 should speak Thai with th-TH');
  await shot(page, 'th-wordcard.png');
  await page.click('#g-ov-ok');
  await answer(page, false);
  check(await page.locator('#gq-fb .gq-wcard .thl').count() === 1, 'feedback word card has no Thai meaning');
  check(await page.locator('#gq-fb .gq-thwhy').count() === 1, 'WK feedback has no Thai explanation');
  await page.click('#gq-next');

  step('switch language mid-lesson keeps the question');
  const q1 = await page.evaluate(() => ASVAB_GAME._state().ex.q.q);
  await page.click('[data-mode-sw="game"]');
  check(await page.evaluate(() => !ASVAB_GAME._th() && !!ASVAB_GAME._state()), 'English switch should keep the lesson');
  check(await page.evaluate(() => ASVAB_GAME._state().ex.q.q) === q1, 'question changed when switching to English');
  check(await page.locator('#g-root .thl').count() === 0 && !THAI.test(await page.innerText('#g-root')), 'English game should have no Thai');
  await page.click('[data-mode-sw="gameth"]');
  check(await page.evaluate(() => ASVAB_GAME._state().ex.q.q) === q1 && THAI.test(await page.innerText('.gq-prompt')), 'Thai switch should keep the same question');
  await page.click('#gq-x'); await page.click('#g-ov-quit');

  step('PC: Thai on word cards straight away');
  await chip(page, 'PC');
  await openNode(page, 'pc-main');
  check(/อ่านออกเสียง/.test(await page.innerText('#gq-read')), 'Read aloud has no Thai');
  await page.locator('#gq-passage .tw.d').first().click();
  await page.waitForSelector('.g-wc');
  check(await page.isVisible('#wc-th'), 'PC card should show Thai right away');
  await page.click('#g-ov-ok');
  await answer(page, false);
  check(await page.locator('#gq-fb .gq-thwhy').count() === 1, 'PC feedback has no Thai explanation');
  await page.click('#gq-x').catch(() => {}); if (await page.locator('#g-ov-quit').count()) await page.click('#g-ov-quit');
  if (await page.locator('#gq-next').count()){ await page.click('#gq-next'); await page.click('#gq-x'); await page.click('#g-ov-quit'); }

  step('AO: Thai tip after an answer');
  await chip(page, 'AO');
  await openNode(page, 'ao-con');
  await answer(page, false);
  check(THAI.test(await page.innerText('#gq-fb .gq-thwhy')), 'AO Thai tip missing');
  await page.click('#gq-x'); await page.click('#g-ov-quit');

  step('guides: AFQT lesson lines in Thai; study sheets in Thai with an English toggle');
  await chip(page, 'MK');
  await page.click('#gp-guide');
  const nLi = await page.locator('#g-ov li').count(), nTh = await page.locator('#g-ov li .thl').count();
  check(nLi > 8 && nTh === nLi, `MK guide: ${nTh}/${nLi} lines have Thai`);
  await page.click('#g-ov-ok');
  await chip(page, 'GS');
  await page.click('#gp-guide');
  check(await page.isVisible('#g-ov-th') && !(await page.isVisible('#g-ov-en')) && THAI.test(await page.innerText('#g-ov-th')), 'GS guide should open in Thai');
  await page.click('#g-ov-lang');
  check(await page.isVisible('#g-ov-en') && !(await page.isVisible('#g-ov-th')), 'English toggle failed');
  await shot(page, 'th-guide.png');
  await page.click('#g-ov-ok');

  step('shared progress with the English game; English stays English');
  await page.click('[data-mode-sw="game"]');
  check((await page.innerText('#gp-xp')).replace(/,/g, '') === String(xpTh), 'XP should be shared between the two games');
  check(await page.locator('#g-root .thl').count() === 0 && !THAI.test(await page.innerText('#g-root')), 'English hub shows Thai');
  await page.click('[data-mode-sw="exam"]');
  check(await page.isVisible('#screen-start') && await page.evaluate(() => !document.body.classList.contains('th')), 'exam mode should clear Thai');
  check(page.errors.length === 0, 'console errors: ' + page.errors.join(' | '));
  await page.close();

  step('390 px');
  const ph = await open(390, 844);
  await ph.click('[data-mode-sw="gameth"]');
  check(await noHScroll(ph), 'Thai hub scrolls sideways at 390 px');
  check(await ph.evaluate(() => { const r = document.querySelector('.mode-sw').getBoundingClientRect(); return r.right <= innerWidth + 1 && r.left >= -1; }), 'mode pills overflow at 390 px');
  await openNode(ph, 'ar-pct');
  await answer(ph, false);
  check(await noHScroll(ph), 'Thai feedback scrolls sideways at 390 px');
  await shot(ph, 'th-390-feedback.png');
  await ph.click('#gq-next');
  await ph.click('#gq-x'); await ph.click('#g-ov-quit');
  await chip(ph, 'EI');
  await ph.click('#gp-guide');
  check(await noHScroll(ph), 'Thai guide scrolls sideways at 390 px');
  await ph.click('#g-ov-ok');
  check(ph.errors.length === 0, '390 console errors: ' + ph.errors.join(' | '));
  await ph.close();
} catch (e) {
  failures.push('crash: ' + (e.stack || e));
} finally {
  await browser.close();
}
console.log(`\n${failures.length ? '✗ FAIL' : '✓ PASS'} — ${passed} checks passed, ${failures.length} failed`);
if (failures.length){ failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
