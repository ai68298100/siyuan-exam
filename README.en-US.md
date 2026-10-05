<div align="center">

# 🐴 Lv Exam (小驴考试)

**An AI-assisted, local-first exam preparation workspace for SiYuan** — import · practice · mock exams · wrongbook · FSRS flashcards · AI

> **Your materials → independent answers → next actions → retesting and personal notes**
> Your questions live in your own knowledge base — every question is a searchable, linkable, syncable **SiYuan block**, not rows in someone else's cloud.

[![Release](https://img.shields.io/github/v/release/ai68298100/siyuan-exam?logo=github)](https://github.com/ai68298100/siyuan-exam/releases)
[![CI](https://github.com/ai68298100/siyuan-exam/actions/workflows/check.yml/badge.svg)](https://github.com/ai68298100/siyuan-exam/actions/workflows/check.yml)
[![Tests](https://img.shields.io/badge/tests-479%20passed-brightgreen)](#-development)
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

## 📦 Feature overview (v0.7.0; journey checks ongoing)

The capabilities below have source implementations and automated coverage where stated. "Journey checks ongoing" means per-screen manual walkthroughs are still in progress — see the [release checklist](docs/23-发版检查清单.md) for known unverified items.

| Module | Capabilities |
|---|---|
| 📥 **Import** | One-click bank creation · manual entry with draft protection · XLSX/XLS binary reading · CSV/TSV/GIFT/Aiken parsing · **manual column mapping** · duplicate strategy (skip/coexist/update) · trial import + read-back confirmation · progress/cancel · native package multipart import with auto-registration |
| ✏️ **Practice** | Recall-first mode · one-layer-at-a-time hints (leak guard + formal reveal) · multiple-choice & keyboard flow · resumable sessions with negotiation · receipt drill-down per attempt |
| 🧠 **Wrongbook** | Dispositions (suspend/self-diagnosis/self-explanation) · reason tags · AI error-analysis hypotheses (stored separately from your own reflection) · flashcard candidates (created only after confirmation) |
| 📅 **Daily plan** | Exam countdown · sprint posture · weighted wrong reflow · FSRS due cards first · minute-budget estimates · check-in streak projection |
| 🔁 **Memory engine** | SiYuan kernel FSRS (riff) · wrong-to-card · 4-level self-rating · cram queue · AI flashcard candidates |
| 📝 **Mock exam** | Run snapshot/resume/submit audit · multiple choice · keyboard · real dwell timing · quota assembly · blueprint health checks · score sheets with data-table & CSV export |
| 📊 **Reports** | KPIs · date-range filter · heatmap/trend/hourly with data-table & CSV · confidence calibration · delayed independent recall · AI report explanation · AI next-action suggestions |
| 📚 **Study materials** | Register PDF/audio/video/links (copied into workspace assets or by link) · open & locate (page / timestamp) · personal notes per material · question↔material linking with located open |
| 🗺️ **Syllabus & governance** | Paste-outline syllabus import · coverage per node (questions / independently mastered / missing source) · gap CSV export · KP governance (merge/rename/fill) · errata import by question ID · relation contract validation (cycles/invalid nodes/cross-version diff) |
| 🧮 **Structured grading (foundation)** | `answerSpec` v1: numeric questions with tolerance/equivalent-units/scientific notation, multi-blank ";;" per-blank grading — legacy string answers fully compatible; answer UI and template columns land in 0.8 |
| 🖨️ **Print & export** | Question sheet / answer sheet separated printing (question sheet never contains answers) · CSV exports (bank/wrongbook/mock/charts) · JSON data export |
| 🤖 **AI tasks** | Seven runtime explanation/review tasks use one task envelope (context fingerprint / budget / strictMock gate / audit & usage accounting); a separate generate/review/repair pipeline handles question candidates — SiYuan built-in model or your own OpenAI-compatible endpoint |
| 🔗 **SiYuan integration** | Block attribute contract · query-embed drill · section tree · event bus (envelope v1) · check-in bridge · widget · Glean source bridge · `window.siyuanExam` public API · bank sharing via `.sy.zip` |
| 🔊 **Listen & learn** | TTS read-aloud · pure-listening mode · cover-answer self-rating |

<details>
<summary><b>🚧 Not yet (click to expand)</b></summary>

- SiYuan agent entry registration (planning; contract layer ready)
- OCR / subtitle transcription / in-fragment AI for materials; native-file editing; cloud-drive authorized APIs
- Errata status for disputed questions; multi-party review round-trips (contract validated, feature pending real data)
- Stable syllabus node identity across renames; Anki apkg export
- Multi-party review round-trips (57-01/02) — contract validated, feature pending
- Marketplace listing (gated on beta feedback per TODO 7B)

</details>

## 🚀 Quick start

**Install** (either):

1. **Manual**: download `package.zip` from [Releases](https://github.com/ai68298100/siyuan-exam/releases), extract to `<SiYuan workspace>/data/plugins/siyuan-exam/`, restart SiYuan and enable it in Settings.
2. **Dev**: clone this repo, `pnpm i && pnpm make-link`, reload the plugin in SiYuan.

**30-second tour**: create a bank (= a notebook) → download the official Excel template and fill a few questions → import → hit "Quick drill". Wrong answers flow into the wrongbook automatically; "convert to cards" hands them to FSRS.

## 🔒 Data & privacy

- **Tools and content are separate**: the plugin provides import, practice and review tools, not Fenbi, Offcn or Zhonghe question banks. Users upload their own content. Material they are permitted to retain locally may live in SiYuan; restricted online sources should retain only links, personal notes and learning evidence. Free access or purchase does not imply permission to copy or redistribute. Access and rights governance remain research candidates; see [research/15](research/15-考试软件竞品与用户题源接入调研.md).
- **Local first**: questions, attempt logs and the wrongbook all live in your own SiYuan workspace. No telemetry.
- **Explicit AI data flow**: only when you trigger generation/explanation does the selected material leave for your configured AI endpoint (SiYuan built-in or your own key); unconfigured, AI stays fully silent.
- Deletion: your bank is just a notebook — SiYuan's trash and sync history apply as usual.

## 🏗️ Engineering quality

- **479 unit tests in 91 files** (grader / import parsers / event replayer / FSRS mapping / AI pipeline / kernel response-shape regression locks; run on 2026-10-05)
- **Guard gates**: TypeScript strict → svelte-check (0 warnings) → i18n parity + usage coverage → 42 architecture assertions → style audit → ESLint → Vitest
- **Live-kernel preflight**: `pnpm preflight` asserts 17 kernel API behaviors against a running SiYuan. The current recorded contract run targets SiYuan 3.8.6; UI journey and mobile evidence remain separate manual checks.

## 🗺️ Documentation map

| Doc | Content |
|---|---|
| [TODO.md](TODO.md) | Stable backlog: 620 candidates with IDs and status preserved, grouped into 27 work packages; planning only |
| [docs/19 Consolidated plan](docs/19-待办融合与分阶段执行规划.md) · [docs/20 Full mapping](docs/20-全量待办归并索引.md) | Merge decisions, dependency corrections, S0–S4 stages, 8 proposed slices and unique ownership for all 620 IDs |
| [docs/01 PRD](docs/01-功能全景PRD.md) · [docs/02 data model](docs/02-数据模型设计.md) · [docs/03 architecture](docs/03-技术架构.md) | Product / data / architecture (03 includes the live-verified kernel API table) — in Chinese |
| [docs/04 roadmap](docs/04-版本路线图.md) · [CHANGELOG](CHANGELOG.md) | Version plan and changelog |
| [docs/11 UI spec](docs/11-UI原型与交互规范.md) · [design/prototype](design/prototype/index.html) | 15-scene hi-fi prototype (open in a browser) |
| [docs/17 smoke checklist](docs/17-真机冒烟清单.md) | 40-step acceptance list (A–E for v0.5.x, +F for v0.6-dev); automatable steps covered by `pnpm smoke` |
| [docs/18 AI agent and prompt specification](docs/18-AI智能体与提示词模板规范.md) | 13 task template bodies, 19 task entries, exam/subject/media overlays and permission/evidence contracts; runtime prompts and agent capabilities have not been updated |
| [docs/adr](docs/adr) | 11 architecture decision records |
| [FAQ](docs/FAQ.md) · [CONTRIBUTING](CONTRIBUTING.md) | Where data lives / zero-telemetry & AI data flow / FSRS; local dev, gates and commit conventions |
| [Product status and backlog](docs/25-产品现状评审与精品化待办.md) | v0.7.0 evidence levels, priorities, and productization backlog |
| [research](research) · [research/16 AI and SiYuan agents](research/16-AI全流程与思源智能体融合调研.md) | 17 reports covering competitive products, implementation/API review, UX/ecosystem flows, content lifecycle, learning evidence, product positioning, exams/sources, intellectual property and AI across the learning journey; agent integration still requires capability and version checks |

## 🧑‍💻 Development

```bash
pnpm i                # Node >= 24
pnpm dev              # watch build + livereload
pnpm make-link        # symlink into <workspace>/data/plugins/siyuan-exam/
pnpm check            # typecheck + svelte + i18n + arch checks
pnpm guard            # full pre-push gate chain
pnpm test             # vitest (479 tests / 91 files at v0.7.0)
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

MIT covers the plugin code. It grants no permission to use or distribute third-party questions, explanations, audio, video, images or books; user materials remain subject to their original rights and permissions.
