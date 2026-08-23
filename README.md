# ASVAB Practice Exam

A free, self-contained ASVAB practice exam that runs entirely in the browser — no accounts, no tracking, no server.

**Take the test:** https://montanaprakotsakon1999-commits.github.io/asvab-practice/

## What it does

- All **9 subtests** (GS, AR, WK, PC, MK, EI, AS, MC, AO) with per-subtest timers scaled to the real paper test's pace
- **Fresh draw every sitting** — each 10-question subtest is randomly sampled from a bank of **310 original written questions**, and arithmetic, algebra/geometry and assembling-objects items are additionally **generated with fresh random numbers** on every run, so no two exams repeat
- Answer choices are rearranged per sitting (numeric sets sort ascending like the real test; text sets shuffle)
- The browser remembers which questions you've seen (localStorage only — nothing leaves your machine) and serves unseen questions first
- Full **AFQT estimate** with the VE / AR / MK composite worked out step by step, category rating, and a per-subtest score table
- Complete **review mode** with an explanation for every question, filterable to missed / skipped / flagged
- Three modes: full 90-item ASVAB, AFQT-only (the 4 subtests that decide enlistment), or single-subtest drill
- Keyboard-friendly: A–D to answer, arrows to move, F to flag

## About the questions

Every question is original, written for this project. Questions follow the published ASVAB format and content areas but none are reproduced from any test-prep book or from the actual ASVAB, which is a controlled Department of Defense test. Score estimates are unofficial — only a real ASVAB administered at a MEPS or MET site produces a score the military will use.

## Running locally

It's one file. Download `index.html` and open it in any browser.

## Structure

- `index.html` — the whole site: styles, question bank, generators, and exam engine
  - Question bank: `BANK_GS` … `BANK_AO` (static items) in the first `<script>` block
  - Procedural generators: `GEN_AR`, `GEN_MK`, `genAO` — every generated answer is computed, never hand-keyed
  - Exam engine: sampling, choice shuffling, timers, scoring, review

To add questions, append to the relevant `BANK_*` array — each item is `{q, c: [4 choices], a: correctIndex, why: explanation}` (PC items add `p: passageKey`).
