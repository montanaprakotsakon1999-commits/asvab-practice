# ASVAB Practice Site

A free, single-file ASVAB practice exam site. It is **live and public**:

- **Live site:** https://montanaprakotsakon1999-commits.github.io/asvab-practice/
- **Repo:** https://github.com/montanaprakotsakon1999-commits/asvab-practice — public; GitHub Pages deploys automatically from `main`, root folder.
- The whole site is **one file: `index.html`**. No build system, no runtime dependencies, no server. `package.json` / `node_modules` / `tools/` are dev-only test tooling and are never loaded by the site.
- This repo is public — never commit personal details. Machine-local context lives in the gitignored `CLAUDE.local.md`.

## How to work on it

1. Edit `index.html` directly.
2. **Run the full test pass before every push — non-negotiable; it has caught real bugs in every round:**
   ```bash
   npm test          # = node tools/validate.js && node tools/smoke.mjs  (~90 s)
   ```
   First time on a machine: `npm install && npx playwright install chromium`.
3. Commit and push to `main`. Pages redeploys in ~1–2 minutes; verify with
   `curl -s <live url> | wc -c` against `wc -c index.html`, and optionally `node tools/smoke.mjs <live url>`.
4. When convenient, sync the local mirrors: `~/Downloads/asvab-practice/index.html` and `~/Downloads/asvab-practice-exam.html`.

## Product rules

- **MOS mode lists only Army jobs with no security-clearance requirement.** 27D and 42A were researched and **rejected** for that reason; 56M is unverified and stays off until a recruiter confirms it. Add a MOS card only after the owner confirms the job needs no clearance.
- **92A is the focus MOS** (gold-highlighted card, first in the MOS row). Its composite is CL = VE + AR + MK, so 92A drills double as AFQT prep. Gold is reserved for that focus.

## Non-negotiable content rules

1. **Every question, passage, and study sheet is ORIGINAL, written for this project.** Never copy questions, passages, explanations, or study text from any test-prep book or website — the site is publicly hosted and that is copyright infringement. Prep books may be consulted ONLY as a topic checklist to find coverage gaps; then write fresh original questions for those topics.
2. Keep the footer/results disclaimers: questions follow the public ASVAB format but come from no book or real test; score and line-score estimates are unofficial.
3. Every static question needs a worked explanation (`why`), 4 unique choices, and a verified correct answer. Every generated item's answer must be computed by code, never hand-keyed.

## Architecture of index.html

Three scripts in order: a tiny head script (applies the saved light theme pre-paint), the **bank script** (the `<script>` whose header comment says "question bank" — it is NOT the first script tag in the file), and the **engine script**.

**Bank script**
- `BLUEPRINT` (subtest metadata), `PASSAGES` (17 reading passages, keys p1–p17), `TIMES` (seconds per 10-question subtest).
- **512 static questions** in `BANK_GS…BANK_AO` plus `BANK_GS2…` extensions, concatenated into `BANK` (GS 70, AR 50, WK 90, PC 42, MK 55, EI 60, AS 60, MC 65, AO 20). `POOL_TOTAL` is computed from `BANK` and displayed live.
- Item shapes: `{q, c:[4 choices], a: correctIndex, why}`; PC items add `p:'p1'`; AO items are `{base:[[shape,anchor],[shape,anchor]], options:[4 such pairs], a}` rendered as SVG from `AO_SHAPES`. `ord:1` means the choices are pre-arranged and the engine must not reorder them (all generated items carry it; some static items do too).
- **Generators**: `GEN_AR` (15 templates), `GEN_MK` (15 templates; `pythag` and `square` each have two question forms), `genAO`. Answers are computed. Helpers: `mkNum` (4 unique numeric choices, ascending, from computed wrong-answer traps), `mkStr` (shuffled string choices). `GEN_MIX = {AR:4, MK:4, AO:5}` = generated items per 10-question subtest.
- `STUDY`: 9 original per-subtest study sheets rendered as `<details>` on the start screen.

**Engine script**
- `samplePool(code, pool, n)` — random draw preferring questions this browser hasn't seen (`localStorage asvab_seen_<code>`, try/catch-guarded, resets when the pool is exhausted).
- `finalizeChoices(q, code)` — all-numeric choice sets sort ascending, text sets shuffle, `ord:1` untouched, AO options shuffle with `a` remapped.
- `buildQuestions(subtest)` — sample + generate (re-rolling any generated item that repeats a stem already in the sitting) + finalize; PC questions regrouped so same-passage items stay adjacent.
- AFQT estimate: `VE` from WK+PC combined, raw = 2·VE + AR + MK mapped through `AFQT_CURVE` to a percentile + category.
- **Theme**: dark default (tokens on `:root`); light palette under `:root[data-theme="light"]`; `#theme-btn` persists to `localStorage asvab_theme`; `@media print` forces light. `--gold`/`--gold-tint` exist in both themes.
- **MOS mode**: `MOS_COMPOSITES` (GT=VE+AR, CL=VE+AR+MK, EL=GS+AR+MK+EI, ST=GS+VE+MK+MC); `MOS_LIST` — 92A (CL ≥ 90, `focus:1`), 68A (EL ≥ 107), 68C (ST ≥ 101 AND GT ≥ 107), 36B (CL ≥ 101). `mosSubtests(m)` builds the drill (VE expands to WK+PC). A card click runs `startExam(mosSubtests(m))` then sets `EX.mos = m`. Line-score estimate: `stdEst(p) = clamp(23, 77, round(50 + (p − .5) × 54))` per component, composite = `round(2 × mean(stdEsts))`, shown vs. the requirement with a verdict and methodology note.
- **Home button**: masthead badge `#home-btn` → `goHome()`; mid-exam it `confirm()`s first and abandons the sitting unscored.

## The test pass

- **`tools/validate.js`** (node, no deps) — slices the bank script (by its "question bank" comment) and the engine builder block (`function shuffled` … `function startExam`) out of `index.html` and evals them with a localStorage stub. Checks every static item's shape, runs every AR/MK generator 400× **re-parsing the question text and recomputing the answer independently** (keyed choice must be right and no other choice may also be right), runs `genAO` 800×, and builds 100 sittings per subtest. **Every new generator template needs a matching entry in `CHECKERS`** — the validator fails on any generated question no checker recognises, and on any checker that never fires. Takes an optional file path.
- **`tools/smoke.mjs`** (Playwright/Chromium) — theme toggle + persistence, start screen, two full 9-subtest exams by keyboard (second draw must differ), 68A and 92A MOS drills through to the estimate, home button from results and mid-exam, zero console errors. Registers exactly one dialog handler for the whole run — keep it that way. Takes an optional URL/file path.

## Backlog (pre-approved, rough priority)

- Score history: persist each sitting's per-subtest results + AFQT/CL estimates in localStorage; trend chart or table on the start screen (a running CL-estimate tracker for the 92A focus is the killer feature).
- Study mode: untimed drill with instant right/wrong feedback + explanation after each answer.
- CAT-length option (15 q/subtest with rescaled times).
- Printable study sheets.
- More original questions and more AR/MK generator templates.
- Additional MOS cards only once confirmed to need no clearance.

## Style

Dark-first, mint-green `--form` accent, gold reserved for the 92A focus, IBM Plex Mono for data/labels, Archivo for headings, Source Serif for body, sharp 2px radii, the paper-form/answer-sheet aesthetic. Both themes and print must stay clean for any new UI.
