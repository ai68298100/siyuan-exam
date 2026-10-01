# 国际闪卡 SRS 产品调研

> **元信息**
> - 调研角度：国际闪卡与间隔重复（SRS）产品——Anki（深挖）/ Quizlet / RemNote / Mochi / Brainscape
> - 调研日期：2026-10-01
> - 实际调研轮次：38 轮 WebSearch / WebFetch / webReader 调用（其中成功获得有效内容 28 轮，其余为 404/403/超时/并发限制）
> - 方法：以 Anki 官方手册（docs.ankiweb.net、faqs.ankiweb.net）逐页抓取为主干，配合 GitHub 源码定位与第三方格式逆向文章；Quizlet/RemNote/Mochi/Brainscape 以官方帮助中心与功能页为准，交叉验证搜索摘要。

---

## 一、逐产品深挖

### 1. Anki（重点深挖）

**定位一句话**：开源、本地优先的间隔重复引擎，SRS 行业事实标准，几乎所有算法/格式/交互设计都值得逐项对标。

#### 1.1 调度算法：SM-2 与 FSRS

SM-2（Anki 传统算法，Deck Options 的 Advanced 区）：

| 参数 | 默认值 | 行为 |
|---|---|---|
| Starting ease | 2.50 | Good 后间隔 ×2.5 |
| Easy bonus | 1.30 | Easy = 间隔 × ease × 1.30 |
| Hard interval | 1.20 | Hard = 间隔 × 1.2 |
| Interval modifier | 1.00 | 通用倍率，可按 log(目标保留率)/log(当前保留率) 校准 |
| New interval | 0.00 | 遗忘重置（SuperMemo 观察表明保留部分旧间隔反而有害）；强制新间隔 ≥ 旧+1 天 |
| Maximum interval | 100 年 | 缩短会增加总工作量 |
| Ease 下限 | 1.30 | Again −0.20 / Hard −0.15 / Good ±0 / Easy +0.15，低于 1.3 卡片会"挤成一团" |

- 原版 SM-2 是 0–5 六档质量分，Anki 简化为 4 按钮（1 个失败档 + 3 个成功档），理由是失败占比小、微调用成功档即可。
- 答题用时不影响调度（内部计时上限 60 秒）；fuzz（间隔随机抖动防止同批卡同日到期）**无法关闭**。

FSRS（23.10+ 全局启用，不能按 preset 单独开关，AnkiDroid 2.17+）：

- 三分量记忆模型（Three Component Model）：**R**etrievability（此刻能回忆的概率，随时间每日变化）、**S**tability（R 从 100% 降到 90% 所需天数）、**D**ifficulty（信息固有难度，决定复习后稳定性增长快慢）。每卡独立 DSR，仅复习时更新 D/S。
- **Desired retention（期望记忆保留率）默认 90%**：唯一需要用户设置的参数。>90% 工作量陡增，建议 <97%；可按 deck 设不同值。
- **参数（weights）由机器学习从个人复习历史拟合**（点 Optimize 生成），官方明确警告：勿手改、勿抄他人；约每月优化一次即可，支持 Optimize All Presets。
- 历史数据缺失时默认假设记住 90%（Historical retention）；可设 Ignore cards reviewed before 排除旧数据。
- 内置 **Simulator**（模拟天数/每日新卡/复习上限），可在改 desired retention 前预览工作量。
- 建议所有 (re)learning steps 短于 1 天且当天完成、步骤越少越好；留空则由 FSRS-5 实验性接管短期调度。忘记请按 Again——忘卡按 Hard 会导致全部间隔虚高。
- Reschedule cards on change 默认关（开启会重算 due 并写入复习记录）。
- 排序联动：FSRS 下 Relative overdueness 排序等价为 Ascending retrievability。
- 源码位置：调度状态机在 ankitects/anki 仓库 `rslib/src/scheduler/states`。

#### 1.2 学习步骤与按钮语义

- **Learning steps**（空格分隔，如 `1m 10m 1d`）：Good 前进一步，Again 回第一步。第一步按 Hard = 前两步均值（1m/10m → 6m）；仅一步时为该步 1.5 倍（最多 +1 天）。
- Graduating interval（最后一步按 Good 后的间隔）/ Easy interval（Easy 直接毕业，应 ≥ graduating）。
- Relearning steps + Minimum interval（默认 1 天）；跨日步骤自动换算成天；同会话无其他可学卡时 learning 卡可提前最多 20 分钟出卡。
- 四按钮语义（官方 Studying 页）：

| 按钮 | 语义 | 快捷键 | 健康使用率 |
|---|---|---|---|
| Again | 错/完全想不起（部分对也判失败） | 1 | 5–20% |
| Hard | 对但有疑虑/回忆很慢 | 2 | — |
| Good | 对但费了些力（最常用） | 3 / Space / Enter | 80–95% |
| Easy | 对且毫不费力 | 4 | — |

- 按钮上直接渲染"按下去之后下次间隔"预览；可只用 Again/Good 两按钮极简操作。
- More 菜单：Flag（彩色旗标，可搜索/改名）、Bury（藏到次日，同 note 兄弟卡可设自动 bury）、Suspend、Set Due Date、Reset、Card Info。

#### 1.3 Deck Options 预设组与每日限额

- 选项按 **preset** 组织，多 deck 共享；操作有 Save / Add / Clone / Rename / Delete / Save to All Subdecks；改 preset 不追溯已调度卡片。
- 每日限额三层粒度：**Preset（组级）/ This deck（单 deck）/ Today only（今天临时）**；new/day 与 max reviews/day 分开；"New cards ignore review limit"开关；"Limits start from top"控制父 deck 限额是否约束子 deck。经验值：每天 20 新卡 ≈ 200 张/天复习量。
- Display order 全家桶：新卡收集顺序（deck 序/位置序/随机 note/随机 card…）、新卡排序、新卡与复习卡 mix/before/after、复习卡排序（默认 due+random；大积压推荐 Relative overdueness）。
- Easy Days（按星期降负荷）、Auto Advance（自动翻面/自动评分，双计时器）、Custom Scheduling（全局 JS 钩子，直接改各按钮的 next state）——这是官方给高级用户的"算法插件口"。

#### 1.4 Filtered Deck / Cram（考试场景核心）

- 原理：筛选牌组用**任意搜索语法**临时抓卡（如 `is:due prop:due>-7` 抓一周内到期；`is:due prop:due<=-7` 抓逾期积压），suspended/buried/已在其他筛选牌组的卡抓不到。
- Build 面板：Search + Limit（数量上限）+ Order（Oldest seen / Random / Increasing intervals / Most lapses / Relative overdueness / Order due…）+ **第二过滤器**（两条件拼接，如"到期卡按 due 排 + 10 张新卡按添加序排"）；Rebuild / Empty（卡回原牌组，删筛选牌组不删卡）。
- **Reschedule cards based on my answers 开关**：默认开（在筛选牌组里的作答会改写原调度）；**关掉 = 纯预览模式**，卡返回原牌组时调度原样不动——这是"考前 cram 不污染进度"的关键设计。关调度时 Again/Hard/Good 的延迟可自配，Easy 直接移出。
- Home deck 机制：卡始终保留与原牌组的链接，复习完自动回家。
- Custom Study 快捷入口：Increase today's new/review limit、Review forgotten cards（N 天内按过 Again 的卡）、Review ahead（提前看未来 N 天到期的卡，官方警告不宜反复用）、Preview new cards、Study by card state or tag（new only/due only/all + tag；想全覆盖把数量设大于总卡数）。
- 追积压官方方案：建两个筛选子牌组——"Just Due"每天清零 + "Over Due"当新卡逐步消化，只要 Just Done 清零，逾期数不再增长。
- 提前复习的调度：用滑动比例——越接近到期的卡提前复习后间隔越接近按时复习的结果。

#### 1.5 统计报表维度（对小驴"学情"页最直接的抄写对象）

- 范围切换：Deck / Collection（可叠加任意搜索过滤）/ History（近 12 月 / 全部 / 牌组生命周期），底部可存 PDF。
- **Today**：Again 次数、正确率（未失败卡 ÷ 总卡）、Learn/Review/Relearn/Filtered 分类计数。官方注解：单日波动大，别用单日评估长期。
- **Future Due**：未来到期柱状图 + **Daily Load**（≈ Σ 1/间隔）——"每天大概要复习多少"的单数字指标。
- **Calendar**（GitHub 风格打卡热力图）、**Reviews**（按天/周/月聚合，mature/young/relearn/learn/filtered 分色 + 灰色累计曲线）、**Review Time**（同维度换时间）、**Card Counts**（mature/young/new/suspended 饼图 + 精确数量）。
- **Review Intervals**：间隔分布直方图 + "≤该间隔"累计百分比曲线；**Card Ease**：ease 分布。
- FSRS 专属三图：**Card Stability**（S 分布）、**Card Difficulty**（D 分布）、**Card Retrievability**（R 分布 + "Estimated total knowledge" = 平均 R × 已复习卡数）。
- **Hourly Breakdown**：各小时通过率 vs 复习量（找最佳学习时段）；**Answer Buttons**：Learning/Young/Mature 三档 × 四按钮的使用数与正确率。
- **True Retention 表**：按卡龄（Mature=间隔≥21 天 / Young）× 时间窗（年/季/月/…）统计真实记忆保持率，每天只计首刷，Again=Fail 其余=Pass；FSRS 下应逼近 desired retention，不符则提示你优化参数/拆预设/处理烂卡。
- 底层数据：`revlog` 表（id, cid, ease, ivl, lastIvl, factor, time, type），官方直接鼓励用户用 SQLite 自行分析。

#### 1.6 卡片类型 / 挖空 / Image Occlusion

- 核心抽象：**note（笔记/字段容器）→ 由 card template 派生 1..n 张 card**。内置 Basic、Basic (and reversed card)、Basic (optional reversed)、Basic (type in the answer)、Cloze、Image Occlusion。
- 字段管理：增删改名排序、Sort field（唯一）、RTL、排除出非限定搜索；保留字段名 Tags/Type/Deck/Card/FrontSide 不可用；查重只看**第一个字段**且限同 note type。
- **Cloze 语法**：`{{c1::1913}}`，提示 `{{c1::Canberra::city}}`（显示 `[city]`），嵌套 `{{c1::Canberra {{c2::founded}}}}`（最深约 3 层），多卡共享 `{{c1,2,3,4::feminine}}`，Alt+点击复用编号；每个 c 编号生成一张卡；Cloze 类型不能加额外卡模板。
- **内置 Image Occlusion（23.10+）**：矩形/椭圆/多边形三种遮挡形状，可编组；两种模式——**Hide All, Guess One**（全遮住逐个揭示）与 **Hide One, Guess One**（每次只遮一个）；默认字段 Header / Back Extra / Comments；Toggle Mask Editor 进出；删形状后需 Empty Cards 清理孤儿卡。
- 编辑器：MathJax/LaTeX、录音、粘贴保格式（Shift 粘贴去格式）、固定字段图钉（add 时不清空）、HTML 源码模式。

#### 1.7 导入导出与 apkg 内部结构

文本导入（TSV/CSV/TXT，UTF-8）：

- 文件头声明（2.1.54+，`#key:value`）：`separator` / `html` / `tags` / `columns` / `notetype` / `deck` / `notetype column` / `deck column` / `tags column` / `guid column`。
- 列约定：**第一字段用于查重**；tags 列、deck 列（牌组不存在自动建）、notetype 列（每行可不同类型）、**guid 列**（存在同 guid 则更新而非新建——增量同步题库的钥匙）；重复策略 Update/Skip 可选，match scope 可限"同类型"或"同类型+同牌组"；更新时卡片原地保留调度。
- 引号转义（`""`）、HTML 开关 + `<br>` 换行、媒体先拷 collection.media 再 `<img src>` / `[sound:]` 引用。

apkg/colpkg 三代格式（标准 ZIP，文件全在根目录）：

| 文件 | Legacy 1 | Legacy 2 | Latest |
|---|---|---|---|
| collection.anki2 | 主库 | 兼容占位 | 兼容占位 |
| collection.anki21 | — | 主库（SQLite schema v14–v17） | — |
| collection.anki21b | — | — | 主库（**zstd 压缩**） |
| media | JSON（编号→文件名映射） | JSON | **Protobuf** MediaEntries |
| meta | — | Protobuf（version=2） | Protobuf（version=3） |
| 0,1,2… | 媒体实体 | 媒体实体 | 媒体实体 |

- 数据库演进：schema v11（5 表：col/notes/cards/revlog/graves，配置存 JSON 文本列）→ v14（+deck_config/config/tags）→ v15（+fields/templates/notetypes/decks）→ v18（12 表，配置 Protobuf BLOB）。核心表语义：**notes**=内容（字段 HTML + guid + tags + notetype 引用）、**cards**=调度状态（note↔deck 关联 + due/ivl/ease）、**revlog**=复习流水、**col**=元数据（notetype/deck 配置 JSON）。
- 行为差异：**.apkg = 单牌组包、导入是合并式**（重复笔记按 mtime 保留新版，不覆盖本地修改，可勾选去除调度/marked/leech 得到"干净副本"）；**.colpkg = 全库包、导入整体替换**。勾"Support older Anki versions"得到 JSON 可读的 Legacy 2（利于程序化解析），否则 Latest 格式更快更小但二进制。
- 源码坐标：`rslib/src/storage/sqlite.rs`（建库）、`rslib/src/import_export/package/meta.rs`、`proto/anki/import_export.proto`（gh api 实测确认目录）。

#### 1.8 Addon 生态

- 安装入口 Tools > Add-ons（"Get Add-ons"输入 **数字编号** 从 AnkiWeb 拉取），仓库 ankiweb.net/shared/addons；插件"可修改代码库任意部分"（语言支持、调度控制是官方举的两类）；配置文件顶部含作者邮箱，异常时 Delete 自救；升级 Anki 常致插件失效。第三方开发文档 addon-docs.ankiweb.net。官方提醒：FSRS 勿与改间隔的插件同用。

#### 1.9 值得偷师的具体细节

1. **desired retention 单参数调度**：把"间隔倍率/ease/公式"全部藏进 Optimize，用户只选"想记多牢"。小驴的闪卡设置页就应只有一个"目标保留率"滑杆（85–95%）+ 一个"优化参数"按钮。
2. **Daily Load 单指标 + Future Due 预测图**：给用户一个"接下来每天要背多少"的心理预期。
3. **True Retention 表**：区分"卡片可见保持率"与算法目标，是学情页的高级感来源。
4. **Filtered deck + 关 reschedule = 零污染考前冲刺**：筛 tag/逾期/最常错 + 不改进度，直接对应小驴"考前突击"模式。
5. **apkg 合并式导入 + guid 更新**：题库包发新版本可增量更新用户已有卡片而不动其学习进度——小驴题库包分发机制的范本。
6. **Cloze 编号语法与 image occlusion 两种模式**：法条/图表题的标准卡型。
7. **bury siblings**：同一题干多小题同天不齐刷；**20 分钟提前出卡**、**fuzz**、**Easy Days** 等细节体现"调度即体验"。
8. **文本导入文件头声明**（`#separator:tab` 等）让格式自描述——小驴题库导入模板照抄。
9. **Custom Scheduling JS 钩子**：不锁死算法，给极客留口子。

#### 1.10 明确不借鉴

- SM-2 的 ease/interval modifier 等手动参数面板（对普通考生是灾难，FSRS 已证明可以藏起来）。
- 桌面客户端的全功能编辑器与模板 HTML/CSS 暴露（思源本身是笔记编辑器，模板体系应轻量化）。
- AnkiWeb 数字编号插件分发（思源自带插件市场，不需要）。
- Maximum interval 100 年、原版 0–5 质量分等历史包袱参数。

---

### 2. Quizlet

**定位一句话**：全球最大的大众化学习平台，把"背卡"产品化成 Flashcards/Learn/Test/Match 一组游戏化模式，算法黑箱但交互设计是教科书。

**核心机制清单**：

- **模式矩阵**：Flashcards（翻卡，可自标 Know/Still learning）、**Learn**（个性化路径：按你的目标与对内容的熟悉度排题；从选择题逐步升级到 written 拼写；答错的题换题型反复出现直到答对；有掌握度进度与到期设置；官方现称"AI 驱动"）、Write（拼写）、Spell、**Test**（从学习集自动生成模拟卷：单选/ written / 判断 / 匹配混排，可配题量与题型，即时评分，可打印）、**Match**（限时连连看计时游戏）、Gravity（陨石防御游戏）。
- **掌握度机制**：Learn 按轮次（round）推进，正确率驱动升级；2020 年起 Learn 引入 spaced repetition（官方博客《Introducing the new Quizlet Learn》：同一材料多时间点重现 + 到期提醒）。社区普遍指出其间隔逻辑远不如 Anki 严格（更接近"错的多就多见"的自适应排程而非真 SRS）。
- **Spaced Repetition 模式（2025 年新上线）**：复习时对每张卡自评回忆质量，系统据此重排"该复习哪些词"，可在设置中全局开关——官方把它做成一个**可选模式**而非默认底层，且强调"高频重现 + 提醒"。
- **AI 功能**：Learn 宣传为"powered by AI"；平台另有 AI 辅助生成学习集/摘要/例题的套件；付费墙（Quizlet Plus）逐步把 Learn/Test 等深度功能圈进订阅。
- 内容生态：海量用户共享学习集（题库 UGC 化），一键复制他人集——冷启动内容分发的极强手段。

**值得偷师**：

1. **Test 模式 = 小驴"模考"的直接原型**：从题库自动生成模拟卷、题型混排、即时评分、可打印——完全可迁移。
2. **Match 限时游戏**：把"概念辨析"做成 30 秒小游戏，适合碎片时间，实现成本极低（本质是连线题）。
3. **Learn 的"答错→换题型再现→答对为止"闭环**：比纯 SRS 更像"教学生"，是刷题产品的正确手感。
4. **自评回忆 + 到期提醒的轻量 SRS**：证明 SRS 可以做成可选开关而不是学习负担。
5. 学习集 UGC 共享与"复制到自己"。

**明确不借鉴**：订阅墙与云依赖（小驴本地优先）；算法黑箱无法本地验证；游戏模式堆得过杂（Gravity/Spell 等对成人考试场景价值低）。

---

### 3. RemNote

**定位一句话**：大纲笔记与 SRS 融合的代表——"笔记即卡片"，把闪卡当作知识结构的投影而非独立对象。

**核心机制清单**：

- **笔记即卡片**：大纲文档的每个节点（rem）都可以是卡片；卡片从文档层级中生成，复习上下文永远带着笔记结构。
- **Concept/Descriptor 框架**：Concept = 事物（大写加粗），Descriptor = 事物的属性/问题（小写斜体）；给 Concept 写 Descriptor 就自动生成问答卡，"提示词几乎自动生成"；概念间用 **References（双链）** 与 Tags 连接，复习顺序会参考引用结构以强化概念间关系。建模三步：层级化拆概念 → 找出关键 descriptor → 用引用/标签连接。
- **模板**：Tags 可转 Template——为一类概念固定一组 descriptor（如"所有法条"都固定记"构成要件/法律后果"两栏），保证同类型卡片结构一致。
- **卡片类型**：正反卡、双向卡、填空、多选、列表卡、Image Occlusion；**Card Clusters** 把一组相关卡打包按顺序连着复习（复习时只出其中到期的）。
- **SRS 理论层**：官方把记忆模型讲成 R/S/D 三分量；**desired retention 默认 90%**；提供 **FSRS 与 Anki SM-2 两种可选算法**（可全局或按文件夹切换），并明确"Anki 的 SM-2 对间隔有 1 天下限——为兼容旧卡而非科学选择"。
- **Exam Scheduler（考试调度器，V2）**：对任意文件夹设**考试日期**，系统围绕该日期重塑调度——新卡前置（front-load，含"Anticipated Extra New Cards"缓冲量）保证复习轮次能在考前完成；V2 改为计算 **Exam Daily Goal（每日目标）**而非后台重排卡片；每次增删卡自适应重算；配套 **Exam priority / Folder Priorities**（考试内容永远先出）与 Exam Study Plan 页（显示每天练多少，可编辑）；另有 Exam Study Plan Calculator 网页工具。
- 佐证其产品哲学的官方文档：《Why Anki's 'Max interval' is actually a bug》《RemNote's Scheduling algorithm》——用"讲清楚为什么"建立专业信任。

**值得偷师**：

1. **考试日期驱动的学习计划**：输入考试日 → 反推每日新卡量/复习量，考前正好完成全部学习轮次。这是五个产品里唯一"以考期为第一性原理"的调度，**小驴"备考计划"功能的最佳范本**。
2. **Exam Daily Goal 而非后台偷偷重排**：目标可视化，用户知情可控。
3. **"从笔记生成卡片"与思源块引用天然契合**：小驴可直接以思源块为卡源，不必重建内容层。
4. **R/S/D 记忆模型的对外话术**：把算法讲成"可解释的科学"，提升信任。
5. Card Clusters 的"成组顺序复习"。

**明确不借鉴**：全功能大纲笔记编辑器（思源已做）；Concept/Descriptor 的学习成本与命名体系；卡片与笔记强耦合到难以批量导入第三方题库。

---

### 4. Mochi

**定位一句话**：markdown 笔记驱动的轻量 SRS 工具，本地优先 + 无账号可用，是"极简 Anki"的最佳参照。

**核心机制清单**：

- **Markdown 即卡片**：笔记与卡同对象；支持标题/列表/代码块/`==高亮==`/脚注/图片音频视频（`![alt|800x600](file)` 同一语法通吃媒体）；**行内 `#tag` 自动变成卡片元数据**，支持 `#a/b/c` 层级标签；`[[卡名]]` 双向链接（自动加 backlink）。
- **两阶段流程**：New → **Learn**（人工判断是否掌握到可进调度）→ **Review**（自动调度队列）；卡片状态 New / Learned / Archived（归档保留学习历史，随时撤销）。
- **二元评分**：只有 **Remembered / Forgot** 两个按钮——Remembered 间隔变长、Forgot 变短。
- **re-reviews 缓冲机制**：复习时忘一次，卡进 re-review 队列（而非立即重置）；再忘才重置间隔重新学习——减少误按惩罚。
- **调度算法可选**：默认算法 = 固定倍率上/下调（简单可预测免调参）；**FSRS 为可选**（预置合理 weights，可在 Settings 填自定义参数与 target retention rate；切换即时生效且进度不重置，S/D 从既有历史推导）。**无内置优化器**——需导出 `.mochi`（含完整复习历史）给外部 FSRS 优化器，或走 API `GET /api/cards` 拿 `reviews` 数组。
- 官方复习建议：每日新卡 ≤10；新卡学习与到期复习分开；多个短时段；**明确提供 cramming 应对考前突击**。
- 其他：Filters and saved views、模板（条件渲染/动态字段，配语言学习套件：词典/TTS/图片搜索/自动翻译）、Web Clipper、API；**本地优先 + 在线同步**；免费版永久免费可离线，Pro $5/月（同步/发布牌组/动态字段/AI 集成）。AI 主要是生成文本（例句、学习提示）。

**值得偷师**：

1. **Remembered/Forgot 二元评分**：Mochi 官方指出二元可干净映射 FSRS 的 Good/Again，只损失 Hard/Easy 信息——小驴默认界面应二元起步，四按钮做进设置。
2. **Learn 阶段与 Review 阶段分离**：新题先"过一遍确认会了"再进 SRS，避免新卡污染复习队列——对应小驴"新题首轮"与"错题重练"分离。
3. **re-review 缓冲**：一次忘 ≠ 清零，更符合真实记忆且减少挫败。
4. **本地免费 + 付费同步/发布**的定价结构，与思源本地优先气质吻合。
5. API 暴露完整复习历史（`reviews` 数组）。
6. 行内 `#tag` 即元数据的轻量标注。

**明确不借鉴**：无调度优化器（小驴应内置 FSRS optimize 或引导用户）；生态薄、无统计报表（不能学它砍统计）。

---

### 5. Brainscape

**定位一句话**：以"自信度评分（Confidence-Based Repetition, CBR）"为唯一卖点的闪卡平台，把元认知自评做成了调度输入。

**核心机制清单**：

- **1–5 自信度评分**：翻出答案后自评"你有多确定自己会"：1=完全不会/答错，2=知道但很勉强，3=大概会（有点犹豫），4=会（基本确定），5=非常确定（秒答）。自评动作本身是**元认知训练**（thinking about your thinking），官方称这是 CBR 优于普通 SRS 的核心论据。
- **评分→复现节奏**（官方帮助中心 2026 版表述）：1 = 几分钟内本轮再出现；2 = 10+ 分钟；3 = 几小时后；4 = 几天后；5 = 几周甚至更久（视为 mastery）。低分卡当轮反复出现直到自评升高——"轮内爬梯"。
- **Mastery 度量**：每卡/每牌组的掌握度是累积自信值的函数，以红→橙→黄→绿颜色指标呈现；"Stale cards"（长期没见的已掌握卡）仍会重新浮出校准。
- **轮次结构**：每轮（round）默认抽 10 张（可配置更大），轮末展示该轮掌握度进度——把一次学习切成有反馈闭环的小节。
- **算法黑箱**：闭源自适应，不公开公式，非 SM-2 变体；官方 Academy 文章大量对比 Anki（核心论点：Anki 只知道你对/错/难/易，Brainscape 知道你"多确定"）。订阅制 + 部分官方认证题库付费（MCAT 等）。

**值得偷师**：

1. **1–5 自信度评分**：信息量介于 Anki 四按钮与 Mochi 二元之间，且"答完自评确定度"比"四选一按调度语义"对考生更直觉——**小驴刷题模式可直接采用**：答错自动=1，答对让用户自评 3/4/5（或 2/4/5）。
2. **轮次（round）+ 轮末进度反馈**：把刷题 session 结构化，天然适配"每日 30 题"的目标感。
3. **Mastery 颜色进度**：牌组级红绿地图是最直觉的备考进度仪表盘。
4. **元认知话术**：产品文案可解释"自评为什么让你记得更牢"。

**明确不借鉴**：闭源算法无法本地复现与验证（小驴要本地 FSRS）；订阅墙；内容市集的商业绑定。

---

## 二、本角度综合

### 2.1 功能汇总矩阵

| 维度 | Anki | Quizlet | RemNote | Mochi | Brainscape |
|---|---|---|---|---|---|
| 调度算法 | SM-2 / **FSRS**（开放、可优化权重） | 黑箱自适应 + 2025 可选"Spaced Repetition" | FSRS 或 Anki SM-2 可选 | 固定倍率 / FSRS 可选 | 闭源 CBR |
| 核心参数暴露 | desired retention（默认 90%）+ 优化器 + 模拟器 | 几乎不暴露 | desired retention 90%、考试日期 | target retention、weights | 无（仅 1-5 评分） |
| 评分制 | 4 按钮（Again/Hard/Good/Easy）+ 间隔预览 | Know/Still learning + 自评回忆 | Anki 式评分 | **二元** Remembered/Forgot | **1–5 自信度** |
| 卡片类型 | note→多卡模板、Cloze、Image Occlusion 两种模式、type-in | 翻卡/选择/拼写/匹配 | 概念卡/填空/多选/列表卡/卡簇 | markdown 卡/挖空/图表卡 | 基础正反卡 |
| 新卡处理 | learning steps 序列 + bury siblings | 混入 Learn 路径 | 自动进调度 | **Learn/Review 两阶段** + re-review 缓冲 | 轮内爬梯至自评升高 |
| 考试场景 | **Filtered deck + 关 reschedule 纯预览 cram**；Custom Study 全家桶 | **Test 模拟卷生成** | **Exam Scheduler**（按考期生成每日计划） | cramming 模式 | 官方认证备考牌组 |
| 统计维度 | 最全：Future Due/Daily Load/True Retention/Answer Buttons/Hourly/Stability… | 掌握度进度条 | 掌握度 + 计划页 | 几乎无 | Mastery 颜色地图 |
| 导入导出 | TSV/CSV 文件头声明、apkg/colpkg（SQLite 内核、guid 增量更新） | 学习集 UGC 共享 | .remnote 归档 | .mochi（含完整复习历史）、API | 平台锁定 |
| AI | 无（靠社区插件） | Learn AI 化、AI 生成内容 | AI 助手 | AI 生成例句/提示 | 少 |
| 本地优先 | ✅ 完全本地 + 可选同步 | ❌ 云 | 半（云同步为主） | ✅ 本地 + 可选同步 | ❌ 云 |
| 商业模式 | 免费 + AnkiWeb 捐赠 | 订阅墙 | 订阅 | 免费 + $5 同步 | 订阅 |

### 2.2 对小驴考试的启示（三档）

**必须做（本角度 P0，产品骨架级）**：

1. **FSRS 调度内核**：思源 riff 端点已带 FSRS；小驴只需把"desired retention（默认 0.9，建议范围 0.85–0.97）+ 优化按钮 + 每日新卡上限"暴露出来，其余参数全部隐藏。
2. **默认二元评分，进阶四按钮**：默认 Remembered/Forgot（Mochi 已验证可干净映射 FSRS Good/Again）；设置里切 Anki 式四按钮（带间隔预览文案）。Again 语义 = 答错，与错题本联动。
3. **搜索式筛选 + 考前 cram**：一个"自定义复习"入口：按 tag/错误次数/到期/新卡筛选 + 排序（最常错/最久没见/最可能忘）+ **"不改变原调度（纯预览）"开关**——Anki filtered deck 的 reschedule-off 是考前场景最重要的发明。
4. **文本导入 + 题库包格式**：TSV/CSV 导入带文件头自描述（`#separator` `#notetype column` `#deck column` `#tags column` `#guid column`），guid 驱动增量更新——题库包发新版不动用户进度。
5. **统计三件套**：Future Due + Daily Load（复习量预测）、True Retention（真实记忆率 vs 目标）、Answer Buttons/正确率（错题分布）。数据基础是 revlog 式复习流水表。
6. **Cloze 与错题转卡**：`{{c1::答案::提示}}` 语法 + "把这道错题一键转成闪卡"。
7. **学习步骤与 re-review 缓冲**：短学习步骤（如 1m/10m）+ "忘一次进 re-review 而非清零"。

**改造后做（结合思源/考试特色重设计）**：

1. **考试日期驱动的备考计划**（RemNote Exam Scheduler）：设考试日 → 反推每日新卡/复习目标 + 自适应重算 + "考试内容优先出队"。可再进一步：与小驴模考成绩联动校准 desired retention（越临近考期目标保留率越高）。
2. **1–5 自信度融入刷题模式**（Brainscape）：刷题答错自动记 1；答对请用户自评确定度，映射 FSRS 等级；掌握度 = 累积自信值 → 红绿进度地图（Brainscape mastery）。
3. **模考 = Test 模式**（Quizlet）：从题库按题型/章节/难度抽题生成整卷、计时、即时判分、错题回流错题本与闪卡队列。
4. **image occlusion**（Anki 内置版）：解剖图/地图/电路图类题型的遮挡卡；思源图片块 + 多边形遮罩可实现 Hide All Guess One / Hide One Guess One 两模式。
5. **从思源块生成卡片**（RemNote 思路）：笔记即卡片，块引用做卡片上下文与关联推荐。
6. **Match 式辨析小游戏**（Quizlet）：概念对比题的碎片时间模式，成本低。
7. **AI 讲解/出题**（Quizlet/Mochi）：对错题生成解析、变式题、例句化提示词；用 Mochi 式"AI 生成内容进卡池但标注来源"。

**明确不做（及理由）**：

1. **订阅墙/云依赖**：小驴生于思源，本地优先是身份（Anki/Mochi 证明免费本地可持续）。
2. **SM-2 手动参数面板**（ease/interval modifier 等）：FSRS 时代暴露这些只会吓跑用户。
3. **Gravity/Spell 类边缘游戏模式**：成人考试场景价值低，聚焦刷题+闪卡+模考。
4. **全功能笔记编辑器**：那是思源本职，小驴只做"卡片投影层"。
5. **UGC 内容市集与平台锁定**：闭源云算法（Brainscape 式）与无法导出的复习历史（Quizlet 式）都与小驴"数据归用户"相悖——复习流水必须可导出（学 Mochi API）。

### 2.3 重点提炼：考试场景下"刷题"与"闪卡"如何互补衔接

五个产品共同指向一条流水线，小驴可以直接把它作为核心用户旅程：

1. **刷题 = 诊断（一次性的、带截止压力的）**：答题是"外部给分"的客观判定（对/错），价值在于发现不会的知识点与熟悉真题形态。Quizlet Test 模式与真实考试同构。
2. **闪卡 = 巩固（长期的、以记忆保留率为目标的）**：闪卡是"内部自评"的主观判定（我确定会吗），价值在于把诊断出的薄弱点用 FSRS 排进未来。**桥梁是错题**：刷题答错 → 自动生成/激活对应闪卡（Again 等价）→ 进入 SRS 队列；答对但自评低自信（≤3）→ 以低间隔入队（Brainscape 1–5 的用法）。
3. **衔接的三个机制设计**：
   - **状态互通**：同一知识点在"题目"与"卡片"两种表示间共享掌握度信号（刷题正确率可回写 FSRS 的稳定性估计；闪卡 Again 次数可标记题目为高频错题）。
   - **模式切换而非功能并列**：考前 N 天提供"cram 模式"——filtered deck 逻辑（只抽该科目/高频错题）+ 可选"不写回调度"（Anki reschedule-off），保证突击不打乱长期进度；考后自动恢复正常 FSRS 节奏。
   - **进度语义统一**：对用户只讲一个词"掌握度"（Brainscape 红绿地图），底下由刷题正确率与 FSRS retrievability 融合计算，避免"题库一套进度、闪卡一套进度"的认知分裂。
4. **一条经验参数**：Anki 社区"每天 20 新卡 ≈ 200 复习/天"的换算，可作为备考计划里"输入考试日期 → 建议每日新卡量"的默认估算基础（RemNote Exam Scheduler 的 front-load 思路 + Anki 的工作量经验值）。

---

## 三、来源链接（实际访问）

**Anki 官方手册与 FAQ（docs.ankiweb.net / faqs.ankiweb.net）**

1. https://docs.ankiweb.net/deck-options.html （Deck Options：FSRS、预设组、每日限额、display order、Easy Days、Custom Scheduling）
2. https://docs.ankiweb.net/filtered-decks.html （筛选牌组、cram、reschedule 开关、Custom Study、追赶积压）
3. https://docs.ankiweb.net/studying.html （四按钮语义、快捷键、bury/suspend/flag、fuzz）
4. https://docs.ankiweb.net/stats.html （全部统计图表、True Retention、revlog 表）
5. https://docs.ankiweb.net/exporting.html （apkg/colpkg、调度剥离选项、legacy 格式）
6. https://docs.ankiweb.net/importing/intro.html 与 https://docs.ankiweb.net/importing/text-files.html （文本导入列约定、文件头声明、guid）
7. https://docs.ankiweb.net/editing.html （note types、cloze 语法、内置 Image Occlusion）
8. https://docs.ankiweb.net/addons.html （add-on 安装/生态）
9. https://faqs.ankiweb.net/what-spaced-repetition-algorithm.html （SM-2 参数细节、FSRS DSR 模型）

**Anki 格式逆向与源码**

10. https://eikowagenknecht.com/posts/understanding-the-anki-apkg-format （apkg 三代格式、ZIP 结构、schema v11→v18、源码路径）
11. https://github.com/SergioFacchini/anki-cards-web-browser/blob/master/documentation/Processing%20Anki's%20.apkg%20files.md （搜索摘要引用）
12. https://github.com/ankitects/anki （gh api 验证 rslib/src/storage、import_export 目录结构）

**Quizlet**

13. https://quizlet.com/features/study-modes 与 https://quizlet.com/features/learn （模式矩阵、Learn AI 化）
14. https://quizlet.com/blog/introducing-the-new-quizlet-learn （Learn 重设计：个性化路径、SRS 重现、到期提醒）
15. https://help.quizlet.com/hc/en-us/articles/360030986971-Studying-with-Learn （Learn 机制）
16. https://help.quizlet.com/hc/en-us/articles/48324742264077-Studying-with-Spaced-Repetition （2025 新 SRS 模式：自评回忆驱动重排）
17. https://www.prnewswire.com/news-releases/quizlet-launches-new-study-tools-built-for-the-way-students-learn-302841833.html （Spaced Repetition 上线公告，搜索摘要引用）

**RemNote**

18. https://help.remnote.com/en/articles/9337171-understanding-spaced-repetition （R/S/D 模型、desired retention 90%、FSRS/SM-2 可选）
19. https://help.remnote.com/en/articles/6026154-structuring-knowledge-with-the-concept-descriptor-framework （Concept/Descriptor、模板、References）
20. https://help.remnote.com/en/articles/9101991-preparing-for-an-exam 与 https://help.remnote.com/en/articles/9102040-understanding-the-exam-scheduler （Exam Scheduler：考期反推、front-load、Exam Daily Goal、V2 自适应）
21. https://www.remnote.com/feature/exam-scheduler 、https://www.remnote.com/feature/folder-priorities 、https://www.remnote.com/exam-study-plan-calculator （考试优先级与计划工具）
22. https://help.remnote.com/en/articles/10104223-card-clusters （卡簇）

**Mochi**

23. https://mochi.cards （产品全貌、定价、本地优先、AI）
24. https://mochi.cards/docs/reviewing （Learn/Review 两阶段、re-reviews、二元评分、cramming、每日新卡建议）
25. https://mochi.cards/docs/reviewing/fsrs/ （FSRS 可选、target retention、无内置优化器、.mochi/API 导出复习历史）
26. https://mochi.cards/docs/markdown/basic-formatting/ （markdown 卡片语法、行内 #tag、[[双链]]、媒体语法）

**Brainscape**

27. https://brainscape.zendesk.com/hc/en-us/articles/13103043051149-How-Does-Brainscape-s-Spaced-Repetition-Algorithm-Work （1–5 自评→复现间隔映射、stale cards、轮内爬梯）
28. https://www.brainscape.com/academy/confidence-based-repetition-definition 、https://www.brainscape.com/spaced-repetition 、https://www.brainscape.com/academy/brainscape-cognitive-science （CBR 定义、元认知论据、与 Anki 对比，搜索摘要引用）
