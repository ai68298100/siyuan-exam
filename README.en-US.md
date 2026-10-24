<div align="center">

# 🐴 Lv Exam (Beta) (小驴考试（内测版）)

> **Beta notice:** Features and UI are still evolving. Try the sample bank or a small bank first. Join QQ group **871707735** to report bugs and suggest improvements.

**An AI-assisted, local-first exam preparation workspace for SiYuan** — import · practice · mock exams · wrongbook · FSRS flashcards · AI

> **Your materials → independent answers → next actions → retesting and personal notes**
> Your questions live in your own knowledge base — every question is a searchable, linkable, syncable **SiYuan block**, not rows in someone else's cloud.

[![Release](https://img.shields.io/github/v/release/ai68298100/siyuan-exam?logo=github)](https://github.com/ai68298100/siyuan-exam/releases)
[![CI](https://github.com/ai68298100/siyuan-exam/actions/workflows/check.yml/badge.svg)](https://github.com/ai68298100/siyuan-exam/actions/workflows/check.yml)
[![Tests](https://img.shields.io/badge/tests-1360%20passed-brightgreen)](#-development)
[![SiYuan](https://img.shields.io/badge/SiYuan-%3E%3D%203.8.0-blue)](https://github.com/siyuan-note/siyuan)
[![License](https://img.shields.io/badge/license-MIT-green)](#-license)

<img src="preview.png" alt="Lv Exam (Beta) preview" width="640"/>


## Screenshots

**Practice home · today cockpit** (goal ring / streak / wrong to kill)　**Answering · keyboard first** (A-J select, Enter submit, 1-3 confidence)

<p>
  <img src="design/screenshots/practice-entry.png" width="49%" alt="Practice home"/>
  <img src="design/screenshots/practice-session.png" width="49%" alt="Answering"/>
</p>

**Import & check · preview before commit**　**Evidence report · separated denominators**

<p>
  <img src="design/screenshots/import-preview.png" width="49%" alt="Import"/>
  <img src="design/screenshots/report-center.png" width="49%" alt="Evidence report"/>
</p>

<p align="center">
  <img src="design/screenshots/session-narrow.png" width="260" alt="Narrow 390px"/><br/>
  <sup>Narrow (390px): answering, options and keyboard hints fully usable</sup>
</p>


*[中文](README.md) | English* · [Current status](docs/STATUS.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

</div>

---

## Latest release: v0.10.2 (2026-10-16)

This release delivers the R54 prototype advanced interaction architecture (Question Peek Drawer, Split-View manual authoring with live question face preview, Studio task sub-navigation, and material-to-question conversion loop), alongside deep tactile micro-depth overhauls across practice cards, CBT radar pulses, and the ⌘K command palette.

- **Question Peek Drawer:** Browsing questions now opens a modern slide-in Peek Drawer (desktop) and Bottom Sheet (mobile <=759px), keeping the question list scroll position and filter state 100% intact with `.active-peek` highlight, Escape key dismiss, and focus restoration.
- **Manual Studio Split-View:** Two-column authoring workflow with live book-like question face preview (20px / 1.75 line-height), instant single/multiple/judge keycaps, structured numeric tolerance hints, multi-blank (;;) simulation, and a blank draft reset action.
- **Studio Sub-Navigation:** Unified task navigation across Manual, Materials, Import, and AI question creation views with smooth touch scrolling on mobile.
- **Material-to-Question Loop:** One-click bridges to import material contexts directly into manual creation or AI material drafts, with per-note question authoring.
- **Tactile & Motion Overhaul:** Dual-ring radar breathing pulse for active CBT mock questions, micro-depth cards with inset highlights, subtle tactile keycaps with micro-elastic active feedback (`active: scale(0.985)`), and blurred glass ⌘K command palette.

## Previous release: v0.10.1 (2026-10-16)

This patch fixes sample-bank creation reporting a failure after SiYuan has already saved the questions, and makes host-data audits more reliable.

- **Sample bank:** When the write receipt is incomplete, creation reads back the source document to confirm the 12 original questions. Retries keep their existing identities.
- **Audit reliability:** Corrected plugin-storage, action, AI-history and check-in bridge paths; cleared sessions are distinguished from damaged JSON, with CLI regression coverage.
- **Validation scope:** Sample writes, practice feedback and persisted answers were checked in an isolated SiYuan 3.8.7 workspace. Complete mock recovery, Android WebView and real AI journeys still await validation. See [current status](docs/STATUS.md).

## Recent patch series: v0.9.7-v0.9.8 (2026-10-14)

This patch makes Practice tab opening observable: host errors are surfaced with a retry path and repeated clicks are locked while opening. The R54 token system, ordinary-block AI entry and complete state feedback remain included.

- **Added:** “Generate questions from this content” in the ordinary block menu; it reads complete kramdown and opens the existing AI review flow. The 12-question original sample bank remains available for demonstrations.
- **Improved:** Color, spacing, type, radius, shadow, motion and common control variants now consume shared `lv-*` tokens; import, AI, notes, mock exams and settings retain explicit busy/success/error/empty feedback.
- **Fixed:** Practice tab opening now catches synchronous errors and async rejections, locks duplicate clicks and shows a readable retry message; empty, offline, failed and oversized block material has guidance; runtime plugin objects never enter serializable tab data.

Style snapshot (`pnpm metrics:style`): raw `px` literals fell from about 1,318 to 1,028; shared `lv-*` token kinds grew from about 88 to 124.

## 小驴 series and feedback

QQ group **871707735** is open for bug reports and feature requests.

| Plugin | One-line description | Repository |
|---|---|---|
| 小驴雷切 | Navigation and work-context hub for SiYuan. | [GitHub](https://github.com/ai68298100/siyuan-speed-switch) |
| 小驴打卡 | Local-first habits and goals tracker. | [GitHub](https://github.com/ai68298100/siyuan-checkin) |
| 小驴人脉 | Contacts, relationships and important dates. | [GitHub](https://github.com/ai68298100/siyuan-contacts) |
| 小驴拾遗 | Clip, sort and revisit saved material. | [GitHub](https://github.com/ai68298100/siyuan-glean) |
| 小驴考试（内测版） | Local-first question-bank practice workspace. | [GitHub](https://github.com/ai68298100/siyuan-exam) |
| 小驴管家（内测版） | Home and life records with reminders. | [GitHub](https://github.com/ai68298100/siyuan-home) |
| 小驴闪卡（内测版） | FSRS-based flashcard learning. | [GitHub](https://github.com/ai68298100/siyuan-lv-cards) |
| 小驴常用（内测版） | Save, search and reuse common snippets. | [GitHub](https://github.com/ai68298100/xiaolv-common) |

## ✨ Why Lv Exam (Beta)

| Pain point | Lv Exam (Beta)'s answer |
|---|---|
| Question banks locked in someone else's cloud | **A bank = one of your SiYuan notebooks**: each question is a block with answer/KP/reason attributes — searchable, linkable, synced by SiYuan |
| Wrong answers forgotten after one pass | **FSRS scheduling** on SiYuan's native kernel (riff): one-tap or batch wrong-to-card, scientifically timed reviews, pre-exam cram that never pollutes long-term scheduling |
| AI explanations behind a paywall | **Bring your own AI**: generation, per-option explanations, Socratic follow-ups — via SiYuan's built-in AI or your own OpenAI-compatible endpoint, with explicit data-flow consent |
| Half-baked mock exams | **CBT engine**: blueprint assembly, section timing, answer-sheet flags, indefinite-question partial credit, answer lockout, post-exam scoring |

## 🆕 What's new in v0.9.8

This release improves the first-run path and closes the handoff loop between Practice, Mock Exam, and Reports.

- **First-run guidance and states:** a three-step introduction, bank empty state, load retry, and clear disabled-action reasons.
- **Cross-module handoff:** weak-topic drills, action redo, and mock wrong-answer review carry the target bank and can hand an active session to an already open Practice tab.
- **Feedback and navigation:** reports refresh after new results, mock saving and recovery expose errors and busy states, and the command palette respects the visible tab.

## 📦 Feature overview (v0.10.1; journey checks ongoing)

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

**30-second tour**: create a bank (= a notebook) → download the official Excel template and fill a few questions → import → hit "Quick drill". Wrong answers flow into the wrongbook automatically; "convert to cards" hands them to FSRS. Before using important data, run the host smoke checklist against your target SiYuan version; offline CI does not verify real file pickers, saves, reload recovery or Android WebView behavior.

**No questions yet?** Click **Create sample bank (12 questions)** in Practice, or **Sample bank** under Content & tools if you already have a bank. Original samples cover single choice, multiple choice, true/false, text/numeric/multi-blank fill-ins and short answers, with explanations. No AI setup is needed. Try a quick drill, deliberately miss a question, then check Wrong Answers and Reports; use the default mock blueprint for a demo exam. Short answers need comparison with the reference answer or self-rating in recitation mode.

Samples are written to a separate SiYuan notebook. Repeated clicks open the existing bank and do not restore edited or deleted questions. Deleting samples keeps attempt records; demo attempts are included in reports.

## 🔒 Data & privacy

- **Tools and content are separate**: the plugin provides import, practice and review tools, not Fenbi, Offcn or Zhonghe question banks. Users upload their own content. Material they are permitted to retain locally may live in SiYuan; restricted online sources should retain only links, personal notes and learning evidence. Free access or purchase does not imply permission to copy or redistribute. Access and rights governance remain research candidates; see [research/15](research/15-考试软件竞品与用户题源接入调研.md).
- **Local first**: questions, attempt logs and the wrongbook all live in your own SiYuan workspace. No telemetry.
- **Explicit AI data flow**: only when you trigger generation/explanation does the selected material leave for your configured AI endpoint (SiYuan built-in or your own key); unconfigured, AI stays fully silent.
- Deletion: your bank is just a notebook — SiYuan's trash and sync history apply as usual.

## 🏗️ Engineering quality

- **577 unit tests in 106 files** (grader / import parsers / event replayer / FSRS mapping / AI pipeline / kernel response-shape regression locks / external-link policy; run on 2026-10-07)
- **Guard gates**: TypeScript strict → svelte-check (0 warnings) → i18n parity + usage coverage → 42 architecture assertions → style audit → ESLint → Vitest
- **Live-kernel preflight**: `pnpm preflight` asserts 17 kernel API behaviors against a running SiYuan. The current recorded contract run targets SiYuan 3.8.6; UI journey and mobile evidence remain separate manual checks.

## 🗺️ Documentation map

| Doc | Content |
|---|---|
| [TODO.md](TODO.md) | Stable backlog: 620 candidates with IDs and status preserved, grouped into 27 work packages; planning only |
| [docs/19 Consolidated plan](docs/19-待办融合与分阶段执行规划.md) · [docs/20 Full mapping](docs/20-全量待办归并索引.md) | Merge decisions, dependency corrections, S0–S4 stages, 8 proposed slices and unique ownership for all 620 IDs |
| [docs/01 PRD](docs/01-功能全景PRD.md) · [docs/02 data model](docs/02-数据模型设计.md) · [docs/03 architecture](docs/03-技术架构.md) | Product / data / architecture (03 includes the live-verified kernel API table) — in Chinese |
| [docs/04 roadmap](docs/04-版本路线图.md) · [CHANGELOG](CHANGELOG.md) | Version plan and changelog |
| [docs/11 UI spec](docs/11-UI原型与交互规范.md) · [R54 prototype](design/prototype-r54/index.html) · [delivery](docs/DELIVERY.md) · [component list](docs/UI-COMPONENTS.md) | Current UI source of truth, state contract, responsive behavior and component parameters (the older `design/prototype` is historical) |
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
pnpm test             # vitest (577 tests in 106 files at v0.9.1)
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
