# Lv Exam (小驴考试)

A local-first **exam question bank learning manager** for SiYuan: import question banks, practice, take mock exams, track wrong answers, review with FSRS flashcards, and learn with AI — powered by your own LLM key. Inspired by apps like Fenbi, but **your question bank lives in your own knowledge base**: every question is a searchable, linkable, syncable SiYuan block.

> In one line: **Fenbi's practice UX × Anki's memory science × SiYuan's knowledge base.**

## Status

**Implemented end-to-end** (v0.5.0, pending real-machine smoke): bank → import → practice → wrongbook → FSRS memory → mock exam → reports → AI → sharing all work offline-verified. **151 unit tests**; five quality gates (types / svelte-check / arch 28 assertions / i18n parity+coverage / build+package allowlist) plus a **live-kernel preflight** (`npm run preflight`, 17 kernel-behavior checks, 17/17 on SiYuan 3.8.5). The only release gate left is the 10-minute manual smoke in [docs/17](docs/17-真机冒烟清单.md).

| Folder | Content |
|---|---|
| `TODO.md` | **Master backlog** (35 groups, 443 items; 26-34 are the audited vertical-slice / audit / preflight / feature rounds, all offline items ticked) |
| `research/` | 8 competitive research reports (40+ products, 159 research rounds) + cross-angle feature matrix |
| `docs/01-06` | PRD, data model, architecture (incl. live-verified kernel API list + Haladyna appendix), roadmap, design review, 3 optimization rounds |
| `docs/10-17` | Top-down design & IA, UI wireframes (14 screens), visual design spec (tokens → b3), UI suite master index, repo audit, template & import spec, glossary, **real-machine smoke checklist** |
| `docs/adr/` | Architecture decision records (0001-0008) |
| `design/prototype/` | **Hi-fi interactive prototype v3** (open index.html: all 14 screens + UI Kit + light/dark themes) |
| `src/` | Plugin source (Vite 8 + Svelte 5, TypeScript strict) |
| `scripts/` | Gates (`check-*`, `verify-package`, `smoke-preflight`), asset generator |

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

## ⚠ Current real capabilities

> **Acceptance**: [docs/17 smoke checklist](docs/17-真机冒烟清单.md) (26 steps · 10 min) — passes gate v0.5.0 release (kernel API surface already preflight-verified 17/17, 2026-10-02)

**Implemented (v0.5.0, 2026-10-02)**: bank guard → import (Excel column-map / Aiken / medical material-group auto-batching / runtime-generated official template / drag-drop / CSV encoding detection) → manual entry (incl. material-group linking) → practice (multi-select toggle, practice/recite modes, keyboard flow + kbd hint row, material-group context card & adjacent ordering, favorites & search filter, progress bar, incremental loading) → recite (cover-answer 4-level rating + hint chain + session rating summary + TTS + pure-listen) → daily plan (countdown / sprint posture / **stubborn-wrong weighted reflow** by reason × wrong count) → FSRS memory (to-card / one-tap batch from settle page / rating / cram / favorites drill / daily set) → mock exam (blueprint with CBT lockout & indefinite partial credit / section timing / answer sheet / score report with radar + history + weekly compare + post-exam scoring + challenge codes) → wrongbook (3-way reasons with echo / manual disposition overlay / elimination / markdown export / dock) → report center (KPI / week compare / heatmap / mastery bars / weak drill / hourly) → AI (dual channel / generation with quality gate + 2nd-pass review + **reject-retry repair** / review queue / paste **or current-doc** source / per-option explain + multi-turn follow-up / cost counter) → bank .sy.zip export/import → statusbar mini progress / weekly nudge / `lv-exam:stats` public event.

**Not yet (v1.x+)**: Word/Anki/apkg import, topic tree & full-paper browsing, av database view, AI block-ref citation deepening, marketplace listing (gated on smoke + beta feedback).

## Development

```bash
pnpm i                # Node >= 24
pnpm dev              # watch build + livereload
pnpm make-link        # symlink into <workspace>/data/plugins/siyuan-exam/
pnpm check            # typecheck + svelte + i18n + arch checks
pnpm guard            # full pre-push gate chain (types/svelte/i18n/arch/test)
pnpm check:i18n       # zh/en key parity + usage coverage
pnpm check:arch       # architecture consistency (28 assertions)
pnpm verify:package   # package.zip allowlist
pnpm preflight        # live-kernel API preflight (17 checks, needs SiYuan running)
pnpm test             # vitest (151)
pnpm build            # dist/ + package.zip
pnpm make-install     # build and install into a local SiYuan plugin directory
```

## License

MIT
