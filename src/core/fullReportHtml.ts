/**
 * 全景学情诊断报告 HTML 导出引擎 (Full Diagnostics Report HTML Generator)
 * 职责：
 * 1. 聚合题库作答流水、艾宾浩斯遗忘风险、五维完备度指标与考点掌握度；
 * 2. 生成出版级 A4 双栏自适应打印与脱机离线浏览的完整学情档案 HTML；
 * 3. 注入小驴生态专属的学院蓝（#0284C7）与朱砂红（#E11D48）美学设计，零外部依赖，安全纯函数。
 */

export interface FullReportHtmlOptions {
  bankName: string;
  rangeDays: number;
  kpi: {
    attempts: number;
    accuracy: number;
    streakDays: number;
  };
  forgettingSummary?: {
    criticalCount: number;
    urgentKps: Array<{ kp: string; retentionPct: number; riskTier: string }>;
  };
  radarDimensions?: Array<{
    label: string;
    score: number;
    fullScore?: number;
    grade?: string;
  }>;
  weakKps?: Array<{ kp: string; accuracy: number; total: number }>;
  generatedAt?: string;
}

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildFullReportHtml(options: FullReportHtmlOptions): string {
  const dateStr = options.generatedAt ?? new Date().toLocaleDateString();
  const rangeLabel = options.rangeDays === 0 ? "全部历史" : `最近 ${options.rangeDays} 天`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(options.bankName)} · 全景学情诊断分析报告</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 12mm 10mm;
    }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
      margin: 0;
      padding: 16px;
      color: #1e293b;
      background: #f8fafc;
      font-size: 10pt;
      line-height: 1.45;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .report-sheet {
      max-width: 210mm;
      margin: 0 auto;
      background: #ffffff;
      padding: 18mm 14mm;
      box-shadow: 0 4px 12px rgba(0,0,0,0.06);
      border-radius: 6px;
    }
    header.report-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      border-bottom: 2.5pt solid #0284c7;
      padding-bottom: 8px;
      margin-bottom: 16px;
    }
    .report-title {
      font-size: 18pt;
      font-weight: 800;
      color: #0f172a;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .report-seal {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 9999px;
      font-size: 9pt;
      font-weight: 700;
      color: #e11d48;
      background: #ffe4e6;
      border: 1px solid #fecdd3;
    }
    .report-meta {
      font-size: 8.5pt;
      color: #64748b;
      text-align: right;
    }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
      margin-bottom: 16px;
    }
    .kpi-card {
      background: #f1f5f9;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 10px 12px;
      text-align: center;
    }
    .kpi-val {
      font-size: 20pt;
      font-weight: 800;
      color: #0284c7;
      font-variant-numeric: tabular-nums;
    }
    .kpi-val.seal { color: #e11d48; }
    .kpi-label {
      font-size: 8.5pt;
      color: #475569;
      margin-top: 2px;
    }
    .section-title {
      font-size: 11pt;
      font-weight: 700;
      color: #0f172a;
      border-left: 3.5pt solid #0284c7;
      padding-left: 8px;
      margin: 16px 0 8px;
    }
    .section-title.seal {
      border-left-color: #e11d48;
    }
    table.data-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 14px;
      font-size: 9pt;
    }
    table.data-table th, table.data-table td {
      border: 1px solid #cbd5e1;
      padding: 6px 8px;
      text-align: left;
    }
    table.data-table th {
      background: #f1f5f9;
      font-weight: 700;
    }
    .pill {
      display: inline-block;
      padding: 1px 6px;
      border-radius: 4px;
      font-size: 8pt;
      font-weight: 600;
    }
    .pill-red { background: #ffe4e6; color: #be123c; }
    .pill-green { background: #dcfce7; color: #15803d; }
    .pill-blue { background: #e0f2fe; color: #0369a1; }
    footer.report-footer {
      border-top: 1px solid #e2e8f0;
      padding-top: 8px;
      margin-top: 24px;
      font-size: 8pt;
      color: #94a3b8;
      display: flex;
      justify-content: space-between;
    }
    @media print {
      body { background: #fff; padding: 0; }
      .report-sheet { box-shadow: none; border-radius: 0; padding: 0; width: 100%; max-width: none; }
    }
  </style>
</head>
<body>
  <div class="report-sheet">
    <header class="report-header">
      <div>
        <div class="report-title">
          <span>${escapeHtml(options.bankName)}</span>
          <span class="report-seal">学情全景诊断</span>
        </div>
        <div style="font-size: 9pt; color: #64748b; margin-top: 4px">小驴考试 · 刻意练习与备考工作台</div>
      </div>
      <div class="report-meta">
        <div>统计窗口：${escapeHtml(rangeLabel)}</div>
        <div>报告生成日期：${escapeHtml(dateStr)}</div>
      </div>
    </header>

    <!-- 核心指标 -->
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-val">${options.kpi.attempts}</div>
        <div class="kpi-label">累计有效作答</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-val">${options.kpi.accuracy}%</div>
        <div class="kpi-label">综合正确率</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-val seal">${options.kpi.streakDays}</div>
        <div class="kpi-label">连续自律打卡(天)</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-val">${options.forgettingSummary?.criticalCount ?? 0}</div>
        <div class="kpi-label">艾宾浩斯临界考点</div>
      </div>
    </div>

    <!-- 艾宾浩斯遗忘风险 -->
    {#if options.forgettingSummary && options.forgettingSummary.urgentKps.length > 0}
      <div class="section-title seal">🚨 艾宾浩斯遗忘临界告警清单</div>
      <table class="data-table">
        <thead>
          <tr>
            <th>考点名称</th>
            <th>记忆留存估值</th>
            <th>风险评级</th>
            <th>抢救处方建议</th>
          </tr>
        </thead>
        <tbody>
          ${(options.forgettingSummary.urgentKps || []).slice(0, 8).map((k) => `
            <tr>
              <td><b>${escapeHtml(k.kp)}</b></td>
              <td>${k.retentionPct}%</td>
              <td><span class="pill ${k.riskTier === "critical" ? "pill-red" : "pill-blue"}">${k.riskTier === "critical" ? "🔴 临界高危" : "🟡 预警"}</span></td>
              <td>建议针对该考点立即进行 5 道变式题定向唤醒</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    {/if}

    <!-- 备考完备度五维雷达 -->
    ${options.radarDimensions && options.radarDimensions.length > 0 ? `
      <div class="section-title">🎯 备考完备度多维体检</div>
      <table class="data-table">
        <thead>
          <tr>
            <th>体检维度</th>
            <th>维度得分</th>
            <th>标准满分</th>
            <th>完备度评价</th>
          </tr>
        </thead>
        <tbody>
          ${options.radarDimensions.map((d) => `
            <tr>
              <td><b>${escapeHtml(d.label)}</b></td>
              <td>${d.score}</td>
              <td>${d.fullScore ?? 100}</td>
              <td><span class="pill pill-green">${escapeHtml(d.grade ?? (d.score >= 80 ? "优秀" : d.score >= 60 ? "良好" : "待提升"))}</span></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    ` : ""}

    <!-- 薄弱考点排查 -->
    ${options.weakKps && options.weakKps.length > 0 ? `
      <div class="section-title">⚠️ 薄弱考点失分排查与攻坚目标</div>
      <table class="data-table">
        <thead>
          <tr>
            <th>知识点大纲</th>
            <th>作答样本量</th>
            <th>实测正确率</th>
            <th>复习建议</th>
          </tr>
        </thead>
        <tbody>
          ${options.weakKps.map((w) => `
            <tr>
              <td><b>${escapeHtml(w.kp)}</b></td>
              <td>${w.total} 次</td>
              <td><span class="pill ${w.accuracy < 60 ? "pill-red" : "pill-blue"}">${w.accuracy}%</span></td>
              <td>${w.accuracy < 60 ? "重点短板，建议先看讲义母题再刷变式" : "基本掌握，注意陷阱与审题细节"}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    ` : ""}

    <footer class="report-footer">
      <span>本报告由思源笔记插件【小驴考试】本地离线演算生成，不经过任何云端服务器，严格保护个人学习隐私。</span>
      <span>Printed via Lv Exam · Local First</span>
    </footer>
  </div>
</body>
</html>`;
}
