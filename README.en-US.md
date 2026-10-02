<div align="center">

# 🐴 Lv Exam (小驴考试)

**Local-first exam question bank learning for SiYuan** — import · practice · mock exams · wrongbook · FSRS flashcards · AI

> **Fenbi-style practice UX × Anki-grade memory science × SiYuan knowledge base**
> Your questions live in your own knowledge base — every question is a searchable, linkable, syncable **SiYuan block**, not rows in someone else's cloud.

[![Release](https://img.shields.io/github/v/release/ai68298100/siyuan-exam?logo=github)](https://github.com/ai68298100/siyuan-exam/releases)
[![CI](https://github.com/ai68298100/siyuan-exam/actions/workflows/check.yml/badge.svg)](https://github.com/ai68298100/siyuan-exam/actions/workflows/check.yml)
[![Tests](https://img.shields.io/badge/tests-151%20passed-brightgreen)](#-development)
[![SiYuan](https://img.shields.io/badge/SiYuan-%3E%3D%203.8.0-blue)](https://github.com/siyuan-note/siyuan)
[![License](https://img.shields.io/badge/license-MIT-green)](#-license)

<img src="preview.png" alt="Lv Exam preview" width="640"/>

*[中文](README.md) | English*

</div>

---

## ✨ Why Lv Exam

| Pain point | Lv Exam's answer |
|---|---|
| Question banks locked in someone else's cloud | **A bank = one of your SiYuan notebooks**: each question is a block with answer/KP/reason attributes — searchable, linkable, synced by SiYuan |
| Wrong answers forgotten after one pass | **FSRS scheduling** on SiYuan's native kernel (riff): one-tap or batch wrong-to-card, scientifically timed reviews, pre-exam cram that never pollutes long-term scheduling |
| AI explanations behind a paywall | **Bring your own AI**: generation, per-option explanations, Socratic follow-ups — via SiYuan's built-in AI or your own OpenAI-compatible endpoint, with explicit data-flow consent |
| Half-baked mock exams | **CBT engine**: blueprint assembly, section timing, answer-sheet flags, indefinite-question partial credit, answer lockout, post-exam scoring |

## 📦 Feature overview (implemented in v0.5.0)

| Module | Capabilities |
|---|---|
| 📥 **Import** | Excel/CSV column mapping · Aiken · medical **material-group auto-batching** · runtime-generated official template · drag-drop · CSV encoding detection (GBK/BOM) · per-row error list export — never fails in batch |
| ✏️ **Manual entry** | All question types (single/multiple/judge/fill/short/material) · material-group linking · letter-tap correct options |
| 🖥️ **Practice** | Quick/wrong/favorites/daily drills · practice & recite modes · **keyboard flow** (A-J choose / Enter submit / J-K navigate / E fav / Esc exit) · material context card · search filter · resumable sessions |
| 🧠 **Wrongbook** | 3-way reason tags (careless/unknown/trap, with echo) · auto-eliminate after 2-in-a-row · manual disposition overlay · dock inline actions · Markdown export |
| 📅 **Daily plan** | Exam countdown · sprint posture · **stubborn-wrong weighted reflow** (wrong count × reason weight) · FSRS due cards first |
| 🔁 **Memory engine** | SiYuan kernel FSRS (riff) · wrong-to-card (single & one-tap batch at settle) · 4-level self-rating mapping · cram queue · jump back to source note from recite |
| 📝 **Mock exam** | Blueprint configurator (shortage warnings, persistence) · CBT lockout · indefinite partial credit · section timing with auto-switch · answer-sheet flags · score report (radar/history/week compare) · post-exam scoring (bank-sourced answer keys + source filter) · challenge codes |
| 📊 **Reports** | KPIs · week compare · 53-week heatmap · KP mastery (FSRS retention) · weak Top5 re-drill · hourly distribution |
| 🤖 **AI** | Dual channel (SiYuan built-in / BYO key) · generation pipeline (overshoot + Haladyna distractor rules + quality gate + **second-pass adversarial review** + review queue + **reject-retry repair**) · paste **or current-document** source · per-option explain + Socratic + multi-turn follow-up · cost tracking |
| 🔗 **SiYuan integration** | Block attribute contract (`custom-exam-*`) · query-embed drill (circle a query, practice its results) · wrongbook dock · status bar · `lv-exam:stats` public event · bank sharing via `.sy.zip` |
| 🔊 **Listen & learn** | TTS read-aloud · pure-listening mode · progressive hint chain · cover-answer 4-level self-rating |

<details>
<summary><b>🚧 Not yet (v1.x roadmap — click to expand)</b></summary>

- Word (images/formulas), GIFT, TSV, Anki apkg import
- Topic-tree browsing, full-paper view
- SiYuan database (av) management view
- AI block-reference citation deepening
- Mobile polish, marketplace listing (gated on beta feedback)

</details>

## 🚀 Quick start

**Install** (either):

1. **Manual**: download `package.zip` from [Releases](https://github.com/ai68298100/siyuan-exam/releases), extract to `<SiYuan workspace>/data/plugins/siyuan-exam/`, restart SiYuan and enable it in Settings.
2. **Dev**: clone this repo, `pnpm i && pnpm make-link`, reload the plugin in SiYuan.

**30-second tour**: create a bank (= a notebook) → download the official Excel template and fill a few questions → import → hit "Quick drill". Wrong answers flow into the wrongbook automatically; "convert to cards" hands them to FSRS.

## 🔒 Data & privacy

- **Local first**: questions, attempt logs and the wrongbook all live in your own SiYuan workspace. No telemetry.
- **Explicit AI data flow**: only when you trigger generation/explanation does the selected material leave for your configured AI endpoint (SiYuan built-in or your own key); unconfigured, AI stays fully silent.
- Deletion: your bank is just a notebook — SiYuan's trash and sync history apply as usual.

## 🏗️ Engineering quality

- **151 unit tests** (grader / import parsers / event replayer / FSRS mapping / AI pipeline / kernel response-shape regression locks)
- **Six commit gates**: TypeScript strict → svelte-check (0 warnings) → i18n parity + usage coverage → 28 architecture assertions → build + package allowlist → pre-push hook
- **Live-kernel preflight**: `pnpm preflight` asserts 17 kernel API behaviors against a running SiYuan (notebook lifecycle / block write & attribute indexing / full FSRS chain / .sy.zip export) — 17/17 on SiYuan 3.8.5, which surfaced and fixed 4 real kernel API drifts

## 🗺️ Documentation map

| Doc | Content |
|---|---|
| [TODO.md](TODO.md) | Master backlog (36 groups, 446 items, with retro audits) |
| [docs/01 PRD](docs/01-功能全景PRD.md) · [docs/02 data model](docs/02-数据模型设计.md) · [docs/03 architecture](docs/03-技术架构.md) | Product / data / architecture (03 includes the live-verified kernel API table) — in Chinese |
| [docs/04 roadmap](docs/04-版本路线图.md) · [CHANGELOG](CHANGELOG.md) | Version plan and changelog |
| [docs/11 UI spec](docs/11-UI原型与交互规范.md) · [design/prototype](design/prototype/index.html) | 14-screen hi-fi prototype (open in a browser) |
| [docs/17 smoke checklist](docs/17-真机冒烟清单.md) | 26-step acceptance list + preflight guide |
| [docs/adr](docs/adr) | 8 architecture decision records |
| [research](research) | 8 competitive research reports (40+ products) |

## 🧑‍💻 Development

```bash
pnpm i                # Node >= 24
pnpm dev              # watch build + livereload
pnpm make-link        # symlink into <workspace>/data/plugins/siyuan-exam/
pnpm check            # typecheck + svelte + i18n + arch checks
pnpm guard            # full pre-push gate chain
pnpm test             # vitest (151)
pnpm preflight        # live-kernel API preflight (17 checks; needs SiYuan running)
pnpm build            # dist/ + package.zip
pnpm make-install     # build and install into a local SiYuan plugin dir
git config core.hooksPath .githooks   # enable the local pre-push hook (once per clone)
```

Stack: Vite 8 · Svelte 5 · TypeScript strict · SiYuan kernel API (no backend of our own). The domain layer (grading/replay/planning/import) is pure functions, fully testable offline; kernel access is consolidated in `src/kernel/client.ts` with response-shape regression locks.

## 🤝 Feedback

- 🐛 Bugs: [Issues](https://github.com/ai68298100/siyuan-exam/issues)
- 💬 Discussions: [https://github.com/ai68298100/siyuan-exam/discussions](https://github.com/ai68298100/siyuan-exam/discussions)
- When reporting, referencing the docs/17 smoke step number helps a lot.

## 📄 License

[MIT](LICENSE)
