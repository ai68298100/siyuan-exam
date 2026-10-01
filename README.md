# Lv Exam (小驴考试)

A local-first **exam question bank learning manager** for SiYuan: import question banks, practice, take mock exams, track wrong answers, review with FSRS flashcards, and learn with AI — powered by your own LLM key. Inspired by apps like Fenbi, but **your question bank lives in your own knowledge base**: every question is a searchable, linkable, syncable SiYuan block.

> In one line: **Fenbi's practice UX × Anki's memory science × SiYuan's knowledge base.**

## Status

Design complete, source still scaffold-level. Current version `v0.1.0` (unreleased); the question-bank/import/practice/wrongbook/report loop is not implemented yet. See [docs/14-仓库审计与改进计划.md](docs/14-仓库审计与改进计划.md) for the evidence and delivery order.

| Folder | Content |
|---|---|
| `TODO.md` | **Master backlog** (27 groups, 391 items; group 26 is the audited vertical-slice and engineering gate) |
| `research/` | 7 competitive research reports (40+ products, 159 research rounds) + cross-angle feature matrix |
| `docs/01-06` | PRD, data model, architecture (incl. verified kernel API list), roadmap, design review, 3 optimization rounds |
| `docs/10-14` | Top-down design & IA, UI wireframes (14 screens), visual design spec (tokens → b3), UI suite master index, **repository audit and delivery plan** |
| `design/prototype/` | **Hi-fi interactive prototype v3** (open index.html: all 14 screens + UI Kit + light/dark themes) |
| `src/scss/` | **Compilable implementation start**: lv-tokens.scss (all tokens mapped to b3) + lv-base.scss (base component classes), wired into build |
| `src/` | Plugin source (Vite 8 + Svelte 5, based on official plugin-sample-vite-svelte) |

## Feature modules (see [docs/01-功能全景PRD.md](docs/01-功能全景PRD.md), Chinese)

1. **Question bank engine** — question block + block attributes + stable IDs; chapter/year/type/wrongbook views; full-text search
2. **Import pipeline** — Excel/CSV template → Aiken/GIFT/TSV → Word (images/formulas) → Anki apkg → AI OCR; field mapping + validation + dedup + preview; never fails in batch
3. **Practice** — quick drill / knowledge tree / full paper; practice & recite modes; option shuffle; resumable sessions
4. **Wrongbook** — auto capture with answer snapshot, 3-way error tagging (careless / unknown / trap), eliminated after 2-in-a-row, "more like this" variants
5. **Memory engine** — SiYuan kernel FSRS (`/api/riff/*`); one-click wrong-answer-to-card; pre-exam cram that never pollutes long-term scheduling
6. **Mock exam** — blueprint assembly, section timing, answer-sheet flags, 4-dimension score report
7. **Recite mode** — cover answer + 4-level self-rating + progressive hints
8. **Reports** — heatmap, knowledge-point mastery tree (FSRS decay), weak top 10, explainable score prediction
9. **AI** (BYO key) — generation pipeline (structured JSON + source block citation + review queue), explanation sidebar (per-option / hint / Socratic)
10. **Study plan / listening / gamification** — countdown-driven daily plan, TTS, streak, challenge codes

## ⚠ Current real capabilities (v0.1 vertical slice, 2026-10-02)

**Implemented (v0.5, 2026-10-02)**: bank guard → import (Excel column-map / Aiken / medical material-group auto-batching) → manual entry form → practice (multi-select toggle, recite-practice mode, keyboard flow) → recite (cover-answer 4-level rating + TTS) → FSRS memory layer (to-card/rating/cram) → mock exam (blueprint/section timing/answer sheet/score report + history sparkline + post-exam scoring) → wrongbook (3-way reasons/elimination/markdown export) → reports (mastery tree/heatmap/weak top10/score prediction) → AI generation & explain (dual channel/2nd-pass review/review queue) → bank .sy.zip package export/import. 102 unit tests.

**Not yet (roadmap)**: topic-tree/paper/fav/cram selection, FSRS memory + recite, mock exam, reports, AI, TTS, bank sharing. Disabled entries state explicit reasons.

**Pending in-SiYuan testing**: real block write/query behavior, mobile UX, loadData sync semantics — see TODO group 26 acceptance.

## Development

```bash
pnpm i                # Node >= 24
pnpm dev              # watch build + livereload
pnpm make-link        # symlink into <workspace>/data/plugins/siyuan-exam/
pnpm check            # typecheck + svelte + i18n + arch checks
pnpm test             # vitest
pnpm build            # dist/ (package.zip is not produced by the current app target)
pnpm make-install     # build and install into a local SiYuan plugin directory
```

## License

MIT
