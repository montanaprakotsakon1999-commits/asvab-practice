# ASVAB Practice Site

A free, single-file ASVAB practice exam site. It is **live and public**:

- **Live site:** https://montanaprakotsakon1999-commits.github.io/asvab-practice/
- **Repo:** https://github.com/montanaprakotsakon1999-commits/asvab-practice — public; GitHub Pages deploys automatically from `main`, root folder.
- The whole site is **one file: `index.html`**. No build system, no runtime dependencies, no server. `package.json` / `node_modules` / `tools/` are dev-only test tooling and are never loaded by the site.
- This repo is public — never commit personal details. Machine-local context (local mirror paths, owner notes) lives in the gitignored `CLAUDE.local.md`.

## How to work on it

1. Edit `index.html` directly.
2. **Run the full test pass before every push — non-negotiable; it has caught real bugs in every round:**
   ```bash
   npm test          # validate.js + smoke.mjs + smoke54.mjs + gsmoke.mjs + mocksmoke.mjs + studysmoke.mjs + wordsmoke.mjs (~6 min)
   ```
   First time on a machine: `npm install && npx playwright install chromium`.
3. Commit and push to `main`. Pages redeploys in ~1–2 minutes; verify with
   `curl -s <live url> | wc -c` against `wc -c index.html`, and optionally `node tools/smoke.mjs <live url>`.
4. When convenient, sync the local mirrors listed in `CLAUDE.local.md`.

## Product rules

- **MOS mode lists only Army jobs with no security-clearance requirement.** 27D and 42A were researched and **rejected** for that reason; 56M is unverified and stays off until a recruiter confirms it. Add a MOS card only after the owner confirms the job needs no clearance.
- **92A is the focus MOS** (gold-highlighted card, first in the MOS row). Its composite is CL = VE + AR + MK, so 92A drills double as AFQT prep. Gold is reserved for that focus.

## Non-negotiable content rules

1. **Every question, passage, and study sheet is ORIGINAL, written for this project.** Never copy questions, passages, explanations, or study text from any test-prep book or website — the site is publicly hosted and that is copyright infringement. Prep books may be consulted ONLY as a topic checklist to find coverage gaps; then write fresh original questions for those topics (new scenarios, new numbers, new wording). Before shipping content written with a book open, run an 8-word overlap check of the new text against the book (v5.4: 0 hits).
2. Keep the footer/results disclaimers: questions follow the public ASVAB format but come from no book or real test; score and line-score estimates are unofficial.
3. Every static question needs a worked explanation (`why`), 4 unique choices, and a verified correct answer. Every generated item's answer must be computed by code, never hand-keyed.

## Architecture of index.html

Scripts in order: a tiny head script (applies the saved light theme pre-paint), the **bank script** (the `<script>` whose header comment says "question bank" — it is NOT the first script tag), the **engine script**, and the **game script** (ASVAB Arcade, one IIFE near `</body>`, exposes `window.ASVAB_GAME`).

**Bank script**
- `BLUEPRINT` (subtest metadata), `PASSAGES` (p1–p26), `TIMES` (seconds per 10-question subtest).
- **872 static questions**: base banks `BANK_GS…BANK_AO` plus extensions `BANK_*2` (v2), `BANK_*3` (v5.2 audit) and `BANK_*4` / `BANK_AS3` / `BANK_PC3` (v5.4 audit), concatenated into `BANK` (GS 166, AR 83, WK 133, PC 65, MK 105, EI 95, AS 106, MC 99, AO 20). `POOL_TOTAL` is computed from `BANK` and displayed live.
- Item shapes: `{q, c:[4 choices], a: correctIndex, why}`; PC items add `p:'p18'`; AO connector items are `{base:[[shape,anchor],[shape,anchor]], options:[4 such pairs], a}` rendered from `AO_SHAPES`. `ord:1` means choices are pre-arranged and the engine must not reorder them (all generated items carry it).
- **WK style:** the tested word is `<span class="kw">word</span>` (underlined) once, inside the sentence for context items; `<b>` is only for emphasis such as **OPPOSITE** / **NOT**.
- **Generators** (answers computed): `GEN_AR` (20 templates), `GEN_MK` (19), `genAO` (connectors), `genAOPuzzle` (AO puzzle items), `gen209` (209-word list). Helpers: `mkNum` (4 unique positive numeric choices, ascending), `mkNumZ` (same, allows zero/negatives with a real minus sign), `mkStr` (shuffled strings). `GEN_MIX = {AR:4, MK:4, AO:5, WK:3}` generated items per 10-question subtest; `GEN.AO` serves a puzzle 90% of the time, so an AO sitting is roughly half connectors, half puzzles.
- **AO puzzles (`AOP`)**: a convex figure (9 outlines) or a circle is cut into 2–4 pieces with random straight or radial cuts; three wrong figures are cut differently. A wrong figure must differ from the pieces under any turn *or flip* (edge/angle cost ≥ 12 and a vertex gap ≥ 7 units). Item: `{kind:'puz', pie, stem:[{g, rot}], options:[{pieces, rot}], a, ord:1, key, why}`.
- `W209` (the 209-word vocab list: word|pos|key synonym|synonyms|cluster) and `W209_TEST` (20 items, 380 s).
- `STUDY`: 11 sheets — 9 subtests + `TIP` (test-day strategy, scoring, retests) + `209` (filterable list). v5.2 and v5.4 additions are appended by IIFEs; v5.4 notes sit in collapsible `<details class="study-sub">` sections. Inside sheets `<b>` renders as a block heading, so never use it for inline emphasis there.

**Engine script**
- `samplePool(code, pool, n)` — random draw preferring questions this browser hasn't seen (`localStorage asvab_seen_<code>`, try/catch-guarded, resets when the pool is exhausted).
- `finalizeChoices(q, code)` — all-numeric choice sets sort ascending, text sets shuffle, `ord:1` untouched, AO connector options shuffle with `a` remapped.
- `buildQuestions(subtest)` — sample + generate (re-rolling any generated item whose `q`/`key` repeats a stem already in the sitting) + finalize; PC questions regrouped so same-passage items stay adjacent.
- AO rendering: `aoSVG` (connectors) and `aopStemSVG` / `aopOptSVG` (puzzles — stem and choices share one scale, ~1.15 px per unit).
- AFQT estimate: `VE` from WK+PC combined, raw = 2·VE + AR + MK mapped through `AFQT_CURVE` to a percentile + category.
- **Theme**: dark default (tokens on `:root`); light palette under `:root[data-theme="light"]`; `#theme-btn` persists to `localStorage asvab_theme`; `@media print` forces light.
- **MOS mode**: `MOS_COMPOSITES` (GT=VE+AR, CL=VE+AR+MK, EL=GS+AR+MK+EI, ST=GS+VE+MK+MC); `MOS_LIST` — 92A (CL ≥ 90, `focus:1`), 68A (EL ≥ 107), 68C (ST ≥ 101 AND GT ≥ 107), 36B (CL ≥ 101).
- **Home button**: masthead badge `#home-btn` → `goHome()`; mid-exam it `confirm()`s first and abandons the sitting unscored. In game mode it returns to the world hub.

**Mock mode (v5.5)** — masthead pill `[data-mode-sw="mock"]` between EXAM and GAME; global `MOCK` flag + `body.mock`; persisted in `localStorage asvab_mode`. Same start screen and tests, but `startExam` forces untimed and sets `EX.mock`; each part keeps `rev[]` (answer shown). `pick()` records the first answer, reveals, and does not auto-advance; `renderQ` then marks right/wrong choices and appends `mockPanel()` (verdict, Answer, Why, Proof, Example, Next). "Show answer" reveals without recording an answer. Enter = next. `markProof()` highlights a PC item's proof inside its passage (also in the review). Results are labelled MOCK.
- Tutor content lives in the bank script: `EXAMPLES` (one original example per written item) and `PROOFS` (PC: exact words from the passage), both keyed by `exKey(code, item)` = FNV-1a of `code|p|q` — **editing a stem orphans its example; the validator will flag it, so write a new one**. `W209_EX` holds a sentence per 209-list word (`w209Item` attaches it). `exampleFor(q, code)` returns the written example or, for a generated AR/MK item (tagged `q.tpl` by `GEN.AR/MK`), a solved sibling from the same template; AO gets `AO_TIPS`. `aoConWhy(q)` explains every figure of a connector item.

**Study mode (v5.6)** — masthead pill `[data-mode-sw="study"]`, FIRST (before EXAM); `body.study`, `body.dataset.mode`, persisted in `asvab_mode`. `#screen-study` is built by its own script after the game script (`initStudyMode`, `window.ASVAB_STUDY`). AFQT focus only: code key (AR/MK/WK/PC = full names, plus the 5 non-AFQT codes), the AFQT formula (VE = WK + PC; 2×VE + AR + MK), four tabbed lessons in simple English (`LESSONS`: what it is, step-by-step, must-know, original worked examples with 👀 Show answer, traps, the full `STUDY` sheet) and launch buttons: "with answers" = a Mock sitting (MOCK set only for the `startExam` call), "Timed" = timed even if the timer switch is off (switch restored). `EX.modeAt` records the launching mode; `setMode` confirms when leaving a sitting for a different mode. `showHomeScreen()` makes home / "Take another test" return to the study screen in study mode. Last tab in `localStorage asvab_study_tab`. **Every example's ✅ letter must match its choice text — studysmoke checks it.**

**Game script (v6 · ASVAB Path)** — lesson-path game, one IIFE (`window.ASVAB_GAME`: `setMode`, `hub` + `_state/_topics/_pool/_nodes/_build/_review/_mix/_typeSpec` test hooks). Subject chips spell out the codes (AFQT four first: AR, MK, WK, PC; then GS, EI, AS, MC, AO). `TOPICS` splits each subject into lessons; static items are sorted by regex (`CLASSIFY` sets the match order; last topic catches the rest) and AR/MK lessons add generator templates by name (`gens`). WK lessons draw 209-list sets and add a match-the-pairs exercise; AO uses `genAO`/`genAOPuzzle` + the static connectors. Path per subject = lessons, a 🎁 chest after every 2nd lesson, 🏆 unit review (3 hearts). Lesson = 10 exercises (PC/AO 6), 5 hearts, a missed exercise goes back to the end of the queue, Check → feedback sheet (answer, why, example) → Continue; generated numeric answers can be typed (`typeSpec`, with "Show choices instead"). Crowns = level 1–3 per lesson, "Jump here" unlocks everything above on a pass. XP `asvab_g_xp`, today `asvab_g_day`, goal `asvab_g_goal`, streak `asvab_g_streak`, progress `asvab_g_path`, mistakes `asvab_g_miss` (Fix my mistakes), per-topic seen `asvab_g_seen`, subject `asvab_g_subj`, mute `asvab_g_mute`. No browser dialogs inside the game (in-page sheets). **Word voice + tap-a-word (v6.1, WK/PC only):** `window.WORDS` (own `<script>` before the game) is an ORIGINAL learner dictionary — key → [base word ('' = same), part of speech, simple meaning, synonyms joined by |] — covering every WK test word and answer choice, the 209 list and every less-common word (wordfreq zipf < 5) in the PC passages/stems. `tapify()` wraps words in `.tw` spans (`.d` = has a card); tap → `SAY.speak()` (Web Speech API, en-US, rate .95 / slow .72 / 🐢 .6) + `wordCard()`; everyday words are only spoken. WK: auto-say the test word, 🔊 on every choice, meaning of the test word/choices is behind "👀 Show meaning" before answering (sets `ex.hint`; any hint = not Perfect, no bonus); the feedback shows a mini word card. PC: 🔊 Read aloud / ⏹ Stop, cards free. Settings `asvab_g_voice` {speed normal|slow|off, auto}. No speech support → note, cards still work. **When you add WK items or PC passages, add their words to `WORDS` (wordsmoke fails on any WK word/choice or 209 word without an entry).** Game CSS uses `gp-`/`gq-` prefixes — **never bare class names like `.afqt` or `.why`; the exam CSS already owns those**.

## The test pass

- **`tools/validate.js`** (node, no deps) — evals the bank script + the engine builder block with a localStorage stub. Static items: shape, unique choices, explanations, passage keys, duplicate stems, study-sheet structure. Every AR/MK generator runs 400× with the question text **re-parsed and the answer recomputed independently** (the key must be right and no other choice may be right) — **every new template needs a matching entry in `CHECKERS`**. `genAO` 800×; `genAOPuzzle` 1,500× (set `PUZ_RUNS=20000` for a soak) checked by an **independent** geometry test (best-fit rigid alignment: the keyed figure uses exactly the stem pieces, every wrong figure is ≥ 5 units off even when flipped, pieces tile without gaps). 100 sittings per subtest + the 209-word test.
- **`tools/smoke.mjs`** (Playwright) — themes, two full exams by keyboard, MOS drills, home button, console errors. Registers exactly one dialog handler — keep it that way.
- **`tools/smoke54.mjs`** — study sub-sections, AO puzzle cards + review, WK keyword styling, new templates reaching sittings, 390-px layout. `--shots <dir>` saves screenshots.
- **`tools/gsmoke.mjs`** — game mode (v6): chips spell out codes, every topic builds valid exercises (25 lessons each), path locking/START, keyboard lesson, XP/streak/crowns, wrong answers come back + Fix my mistakes, out of hearts, chest, replay levels, Jump here, unit review, every subject's first lesson (AO figures), AFQT Mix, quit sheet/home/Escape, guide → Study, goal/mute, mode switching, light theme, 390 px.
- **`tools/studysmoke.mjs`** — study mode: pill order, persistence, code key spelled out, tabs/tiles/arrow keys/remembered tab, every worked example's ✅ letter vs its choice, launchers (mock / timed / 209 / AFQT) and flag restore, home + Take another test → study screen, confirms when switching mid-sitting, game ↔ study, light theme, 390 px.
- **`tools/wordsmoke.mjs`** — word voice (speech stubbed + recorded): dictionary coverage, tapify keeps text, auto-say, tap → card, hint gating + not Perfect, choice 🔊, feedback card, match tiles speak, PC dotted words + read aloud start/stop + proof, voice slow/off/auto, no-speech browser, 390 px.
- **`tools/mocksmoke.mjs`** — mock mode: pill order, persistence, no clock, tutor panel after every answer (no auto-advance, locked after reveal), Show answer, Enter = next, a full 9-subtest mock with PC proofs + AO feedback, MOCK results with examples in the review, switching back to a timed exam, 390 px.

## Backlog (pre-approved, rough priority)

- Score history: persist each sitting's per-subtest results + AFQT/CL estimates in localStorage; trend chart on the start screen (a running CL-estimate tracker for the 92A focus is the killer feature).
- CAT-length option (15 q/subtest with rescaled times).
- Printable study sheets.
- Game: daily challenge, boss round, flashcard flip mode.
- Additional MOS cards only once confirmed to need no clearance.

## Style

Dark-first, mint-green `--form` accent, gold reserved for the 92A focus, IBM Plex Mono for data/labels, Archivo for headings, Source Serif for body, sharp 2px radii, the paper-form/answer-sheet aesthetic. Both themes and print must stay clean for any new UI.
