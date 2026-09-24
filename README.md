# ASVAB Practice Exam

A free, self-contained ASVAB practice exam that runs entirely in the browser — no accounts, no tracking, no server.

**Take the test:** https://montanaprakotsakon1999-commits.github.io/asvab-practice/

## What it does

- All **9 subtests** (GS, AR, WK, PC, MK, EI, AS, MC, AO) with per-subtest timers scaled to the real paper test's pace
- **Fresh draw every sitting** — each 10-question subtest is sampled from a bank of **872 original written questions**, and arithmetic, algebra/geometry, vocabulary and assembling-objects items are also **generated fresh** on every run, so no two exams repeat
- **Both Assembling Objects item types**: connectors (join two shapes at marked points) and puzzles (which figure do these loose pieces make?) — puzzles are cut and checked by code so exactly one choice fits
- Answer choices are rearranged per sitting (numeric sets sort ascending like the real test; text sets shuffle)
- The browser remembers which questions you've seen (localStorage only — nothing leaves your machine) and serves unseen questions first
- **Study sheets** for all 9 subtests, with collapsible deeper sections, plus a **test-day strategy** sheet (versions, scoring, retests, study countdown) and a filterable **209-word** vocabulary list
- Full **AFQT estimate** with the VE / AR / MK composite worked out step by step, category rating, and a per-subtest score table
- Complete **review mode** with an explanation for every question, filterable to missed / skipped / flagged
- Modes: full 90-item ASVAB, AFQT-only, single-subtest drill, the 209-word test, and **MOS mode** — pick a no-clearance Army job (92A, 68A, 68C, 36B), drill the subtests behind its line score, and get an unofficial line-score estimate
- **Mock test mode (📖 MOCK)** — no clock; after every question it shows whether you were right, the correct answer, why, and an example (a real-world case, a same-idea mini-problem with new numbers, or the word used in a sentence). Reading questions highlight the proof in the passage; Assembling Objects items explain what is wrong with every other figure
- **Game mode (ASVAB Arcade)** — timed quiz worlds with hearts, combos and XP, plus a Word Match board
- Keyboard-friendly: A–D to answer, arrows to move, F to flag
- **Dark mode by default**, with a light theme one click away (remembered per browser); printing always uses the light palette

## About the questions

Every question, passage and study sheet is original, written for this project. Questions follow the published ASVAB format and content areas but none are reproduced from any test-prep book or from the actual ASVAB, which is a controlled Department of Defense test. Score estimates are unofficial — only a real ASVAB administered at a MEPS or MET site produces a score the military will use.

## Running locally

It's one file. Download `index.html` and open it in any browser.

## Structure

- `index.html` — the whole site: styles, question bank, generators, exam engine and game
  - Question bank: `BANK_*` arrays in the `<script>` block headed "question bank"
  - Procedural generators: `GEN_AR`, `GEN_MK`, `genAO`, `genAOPuzzle`, `gen209` — every generated answer is computed, never hand-keyed
  - Exam engine: sampling, choice shuffling, timers, scoring, review
- `tools/` — dev-only test pass, never loaded by the site. Run `npm install && npx playwright install chromium` once, then `npm test` before every push:
  - `tools/validate.js` — checks every static question, re-derives the answer of every generated question from its text (and rejects ambiguous choice sets), independently re-checks the geometry of generated AO puzzles, and builds hundreds of sittings
  - `tools/smoke.mjs` — drives the real page in headless Chromium: themes, two full exams by keyboard, MOS drills, home button, console errors
  - `tools/smoke54.mjs` — study sections, AO puzzles in exam and review, 390-px phone layout
  - `tools/gsmoke.mjs` — game mode end to end
  - `tools/mocksmoke.mjs` — mock mode end to end: no clock, feedback after every answer, Show answer, proof highlights, 390 px
- `CLAUDE.md` — project notes for AI-assisted sessions

To add questions, append to the relevant `BANK_*` array — each item is `{q, c: [4 choices], a: correctIndex, why: explanation}` (PC items add `p: passageKey`).
