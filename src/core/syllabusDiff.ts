// ============================================================
// 考纲大纲换版差异比对与影响评估引擎（51-07 / 51-01 / 53-03）
// 纯函数领域层：
// 1. 新旧两版考纲大纲树全路径深度比对（保留/移动/新增/废除）
// 2. 影响面精准评估：受波及题目、受影响蓝图配额、新版未映射节点
// 3. 结构化迁移向导计划生成（保留旧版映射 / 自动平移至新版 / 待人工确认）
// 4. 换版影响评估报告与 CSV/Markdown 导出
// 规则：严格无外部宿主依赖（禁 import "siyuan"），严禁类型强转。
// ============================================================

import type { Question } from "./types";
import type { SyllabusNode, SyllabusDoc } from "./syllabus";
import type { Blueprint } from "./mock";

export type SyllabusNodeDiffKind = "retained" | "moved" | "added" | "removed";

export interface NodePathInfo {
  title: string;
  path: string;
  level: number;
  kpPrefix: string;
}

export interface SyllabusNodeDiffItem {
  title: string;
  kind: SyllabusNodeDiffKind;
  oldPath?: string;
  newPath?: string;
  oldKpPrefix?: string;
  newKpPrefix?: string;
}

export interface SyllabusDiffReport {
  oldMeta: SyllabusDoc["meta"];
  newMeta: SyllabusDoc["meta"];
  totalOldNodes: number;
  totalNewNodes: number;
  retainedCount: number;
  movedCount: number;
  addedCount: number;
  removedCount: number;
  diffItems: SyllabusNodeDiffItem[];
}

export interface AffectedQuestionItem {
  qid: string;
  stemSnippet: string;
  currentKp: string;
  impactReason: "removed" | "moved";
  targetNewKp?: string;
}

export interface AffectedBlueprintItem {
  blueprintId: string;
  blueprintName: string;
  sectionName: string;
  sectionKp: string;
  impactReason: "removed" | "moved";
  suggestedNewKp?: string;
}

export interface SyllabusChangeImpact {
  diff: SyllabusDiffReport;
  totalQuestions: number;
  affectedQuestions: AffectedQuestionItem[];
  affectedBlueprints: AffectedBlueprintItem[];
  unmappedNewNodes: Array<{ path: string; title: string }>;
  receipt: string;
}

export type MigrationAction = "keep_old" | "remap_to_new" | "mark_unmapped";

export interface MigrationPlanItem {
  qid: string;
  stemSnippet: string;
  currentKp: string;
  action: MigrationAction;
  targetKp?: string;
}

export interface SyllabusMigrationPlan {
  planId: string;
  createdAt: number;
  totalItems: number;
  remapCount: number;
  keepCount: number;
  unmappedCount: number;
  items: MigrationPlanItem[];
}

/** 递归展开大纲树节点为全路径平铺字典 */
export function extractSyllabusNodePaths(roots: readonly SyllabusNode[]): Map<string, NodePathInfo> {
  const map = new Map<string, NodePathInfo>();

  const traverse = (nodes: readonly SyllabusNode[], parentPath: string, level: number) => {
    for (const node of nodes) {
      const path = parentPath ? `${parentPath}/${node.title}` : node.title;
      // 以 title 为键，记录首个出现的路径信息
      if (!map.has(node.title)) {
        map.set(node.title, {
          title: node.title,
          path,
          level,
          kpPrefix: node.kpPrefix || node.title,
        });
      }
      if (node.children?.length) {
        traverse(node.children, path, level + 1);
      }
    }
  };

  traverse(roots, "", 1);
  return map;
}

function isSyllabusDoc(input: SyllabusDoc | readonly SyllabusNode[]): input is SyllabusDoc {
  return !Array.isArray(input) && "roots" in input;
}

/**
 * 对比新旧两版考纲大纲树，检测保留、移动、新增与删除节点。
 */
export function diffSyllabusTrees(
  oldDoc: SyllabusDoc | readonly SyllabusNode[],
  newDoc: SyllabusDoc | readonly SyllabusNode[],
): SyllabusDiffReport {
  const oldRoots = isSyllabusDoc(oldDoc) ? oldDoc.roots : oldDoc;
  const newRoots = isSyllabusDoc(newDoc) ? newDoc.roots : newDoc;
  const oldMeta = isSyllabusDoc(oldDoc) ? oldDoc.meta : {};
  const newMeta = isSyllabusDoc(newDoc) ? newDoc.meta : {};

  const oldMap = extractSyllabusNodePaths(oldRoots);
  const newMap = extractSyllabusNodePaths(newRoots);

  const diffItems: SyllabusNodeDiffItem[] = [];
  let retainedCount = 0;
  let movedCount = 0;
  let addedCount = 0;
  let removedCount = 0;

  for (const [title, newInfo] of newMap) {
    const oldInfo = oldMap.get(title);
    if (!oldInfo) {
      addedCount++;
      diffItems.push({
        title,
        kind: "added",
        newPath: newInfo.path,
        newKpPrefix: newInfo.kpPrefix,
      });
    } else if (oldInfo.path === newInfo.path) {
      retainedCount++;
      diffItems.push({
        title,
        kind: "retained",
        oldPath: oldInfo.path,
        newPath: newInfo.path,
        oldKpPrefix: oldInfo.kpPrefix,
        newKpPrefix: newInfo.kpPrefix,
      });
    } else {
      movedCount++;
      diffItems.push({
        title,
        kind: "moved",
        oldPath: oldInfo.path,
        newPath: newInfo.path,
        oldKpPrefix: oldInfo.kpPrefix,
        newKpPrefix: newInfo.kpPrefix,
      });
    }
  }

  for (const [title, oldInfo] of oldMap) {
    if (!newMap.has(title)) {
      removedCount++;
      diffItems.push({
        title,
        kind: "removed",
        oldPath: oldInfo.path,
        oldKpPrefix: oldInfo.kpPrefix,
      });
    }
  }

  return {
    oldMeta,
    newMeta,
    totalOldNodes: oldMap.size,
    totalNewNodes: newMap.size,
    retainedCount,
    movedCount,
    addedCount,
    removedCount,
    diffItems,
  };
}

/**
 * 评估大纲换版对题库题目与模考蓝图配额的实际波及影响（51-07 验收核心）。
 */
export function assessSyllabusImpact(options: {
  diff: SyllabusDiffReport;
  questions: readonly Question[];
  blueprints?: readonly Blueprint[];
}): SyllabusChangeImpact {
  const { diff, questions, blueprints = [] } = options;

  // 1. 建立已移除考点前缀与移动前缀的映射
  const removedPrefixes = new Set<string>();
  const moveMap = new Map<string, string>(); // oldKpPrefix -> newKpPrefix

  for (const item of diff.diffItems) {
    if (item.kind === "removed" && item.oldKpPrefix) {
      removedPrefixes.add(item.oldKpPrefix);
    } else if (item.kind === "moved" && item.oldKpPrefix && item.newKpPrefix) {
      moveMap.set(item.oldKpPrefix, item.newKpPrefix);
    }
  }

  // 2. 检查受影响的题目
  const affectedQuestions: AffectedQuestionItem[] = [];
  const coveredNewNodes = new Set<string>();

  for (const q of questions) {
    const qKp = (q.kp ?? "").trim();
    if (!qKp) continue;

    const stemSnippet = q.stem.trim().split("\n")[0].slice(0, 30) || "未命名题干";

    // 检查是否命中已删除考点
    let isRemoved = false;
    for (const rem of removedPrefixes) {
      if (qKp === rem || qKp.startsWith(rem + "/")) {
        affectedQuestions.push({
          qid: q.id,
          stemSnippet,
          currentKp: qKp,
          impactReason: "removed",
        });
        isRemoved = true;
        break;
      }
    }

    if (isRemoved) continue;

    // 检查是否命中迁移考点
    for (const [oldPrefix, newPrefix] of moveMap) {
      if (qKp === oldPrefix || qKp.startsWith(oldPrefix + "/")) {
        const targetNewKp = qKp.replace(oldPrefix, newPrefix);
        affectedQuestions.push({
          qid: q.id,
          stemSnippet,
          currentKp: qKp,
          impactReason: "moved",
          targetNewKp,
        });
        break;
      }
    }

    // 记录在新版考纲中已覆盖的节点
    for (const item of diff.diffItems) {
      if (item.newKpPrefix && (qKp === item.newKpPrefix || qKp.startsWith(item.newKpPrefix + "/"))) {
        coveredNewNodes.add(item.title);
      }
    }
  }

  // 3. 检查受影响的模考蓝图配额
  const affectedBlueprints: AffectedBlueprintItem[] = [];
  for (const bp of blueprints) {
    for (const sec of bp.sections) {
      const secKp = (sec.kp ?? "").trim();
      if (!secKp) continue;

      if (removedPrefixes.has(secKp)) {
        affectedBlueprints.push({
          blueprintId: bp.id,
          blueprintName: bp.name,
          sectionName: sec.name,
          sectionKp: secKp,
          impactReason: "removed",
        });
      } else if (moveMap.has(secKp)) {
        affectedBlueprints.push({
          blueprintId: bp.id,
          blueprintName: bp.name,
          sectionName: sec.name,
          sectionKp: secKp,
          impactReason: "moved",
          suggestedNewKp: moveMap.get(secKp),
        });
      }
    }
  }

  // 4. 统计新版大纲中完全未被任何题目覆盖的新增/在册节点
  const unmappedNewNodes: Array<{ path: string; title: string }> = [];
  for (const item of diff.diffItems) {
    if (item.kind !== "removed" && item.newPath) {
      if (!coveredNewNodes.has(item.title)) {
        unmappedNewNodes.push({ path: item.newPath, title: item.title });
      }
    }
  }

  const receipt = `考纲换版影响评估完成：新旧对比共变动 ${diff.movedCount + diff.addedCount + diff.removedCount} 处节点；题库共 ${affectedQuestions.length} 道题目受影响（迁移 ${affectedQuestions.filter((q) => q.impactReason === "moved").length} 题，废除 ${affectedQuestions.filter((q) => q.impactReason === "removed").length} 题）；${affectedBlueprints.length} 个蓝图分段需调整；新版大纲尚有 ${unmappedNewNodes.length} 个节点缺题覆盖。`;

  return {
    diff,
    totalQuestions: questions.length,
    affectedQuestions,
    affectedBlueprints,
    unmappedNewNodes,
    receipt,
  };
}

/** 生成结构化平滑迁移向导计划 */
export function generateMigrationPlan(
  impact: SyllabusChangeImpact,
  options: { defaultForMoved?: MigrationAction; defaultForRemoved?: MigrationAction } = {},
): SyllabusMigrationPlan {
  const defaultMoved = options.defaultForMoved ?? "remap_to_new";
  const defaultRemoved = options.defaultForRemoved ?? "keep_old";

  const items: MigrationPlanItem[] = impact.affectedQuestions.map((q) => {
    if (q.impactReason === "moved") {
      return {
        qid: q.qid,
        stemSnippet: q.stemSnippet,
        currentKp: q.currentKp,
        action: defaultMoved,
        targetKp: defaultMoved === "remap_to_new" ? q.targetNewKp : undefined,
      };
    }
    // removed
    return {
      qid: q.qid,
      stemSnippet: q.stemSnippet,
      currentKp: q.currentKp,
      action: defaultRemoved,
    };
  });

  const remapCount = items.filter((it) => it.action === "remap_to_new").length;
  const keepCount = items.filter((it) => it.action === "keep_old").length;
  const unmappedCount = items.filter((it) => it.action === "mark_unmapped").length;

  return {
    planId: `mig-${Date.now().toString(36)}`,
    createdAt: Date.now(),
    totalItems: items.length,
    remapCount,
    keepCount,
    unmappedCount,
    items,
  };
}

/** 导出考纲换版影响评估报告 Markdown */
export function exportSyllabusDiffMarkdown(impact: SyllabusChangeImpact): string {
  const { diff } = impact;
  const lines: string[] = [];

  lines.push(`# 考纲大纲换版影响评估报告`);
  lines.push("");
  lines.push(`> 📅 评估生成时间: ${new Date().toLocaleDateString("zh-CN")} · 小驴考试大纲治理引擎`);
  lines.push(`> 📊 节点统计: 旧版 ${diff.totalOldNodes} 项 ➔ 新版 ${diff.totalNewNodes} 项 (保留 ${diff.retainedCount} · 迁移 ${diff.movedCount} · 新增 ${diff.addedCount} · 废除 ${diff.removedCount})`);
  lines.push("");
  lines.push("---");
  lines.push("");

  // 1. 节点变动明细
  lines.push(`## 一、考纲节点层级变动`);
  lines.push("");
  lines.push(`| 考点名称 | 变动类型 | 旧版路径 | 新版路径 |`);
  lines.push(`| :--- | :--- | :--- | :--- |`);
  for (const item of diff.diffItems) {
    if (item.kind === "retained") continue;
    const typeLabel = item.kind === "moved" ? "🔀 层级迁移" : item.kind === "added" ? "✨ 新增大纲" : "🗑️ 废除删除";
    lines.push(`| ${item.title} | ${typeLabel} | ${item.oldPath || "—"} | ${item.newPath || "—"} |`);
  }
  lines.push("");

  // 2. 题库题目受波及影响
  lines.push(`## 二、题库题目受影响明细 (共 ${impact.affectedQuestions.length} 题)`);
  lines.push("");
  if (impact.affectedQuestions.length > 0) {
    lines.push(`| 题目ID | 题干摘要 | 当前考点 | 影响原因 | 建议平移考点 |`);
    lines.push(`| :--- | :--- | :--- | :--- | :--- |`);
    for (const q of impact.affectedQuestions.slice(0, 30)) {
      const reasonLabel = q.impactReason === "moved" ? "所属考点层级平移" : "所属考点已被新考纲删除";
      lines.push(`| \`${q.qid}\` | ${q.stemSnippet.replace(/\|/g, "\\|")} | ${q.currentKp} | ${reasonLabel} | ${q.targetNewKp || "保持原样"} |`);
    }
    if (impact.affectedQuestions.length > 30) {
      lines.push(`> *(注：受影响题目超过 30 题，其余题目略去；请通过迁移向导批量确认)*`);
    }
  } else {
    lines.push(`> ✓ 题库中无题目受到本次大纲变动波及。`);
  }
  lines.push("");

  // 3. 模考蓝图配额受影响明细
  if (impact.affectedBlueprints.length > 0) {
    lines.push(`## 三、受影响模考蓝图配额 (共 ${impact.affectedBlueprints.length} 处)`);
    lines.push("");
    lines.push(`| 模考卷名称 | 分段名称 | 绑定考点 | 影响原因 | 建议新考点 |`);
    lines.push(`| :--- | :--- | :--- | :--- | :--- |`);
    for (const bp of impact.affectedBlueprints) {
      const r = bp.impactReason === "moved" ? "考点平移" : "考点废除";
      lines.push(`| ${bp.blueprintName} | ${bp.sectionName} | ${bp.sectionKp} | ${r} | ${bp.suggestedNewKp || "—"} |`);
    }
    lines.push("");
  }

  // 4. 新版未覆盖缺口
  if (impact.unmappedNewNodes.length > 0) {
    lines.push(`## 四、新版考纲缺题待补节点 (共 ${impact.unmappedNewNodes.length} 个)`);
    lines.push("");
    for (const un of impact.unmappedNewNodes.slice(0, 20)) {
      lines.push(`- ⚠️ \`${un.path}\``);
    }
    lines.push("");
  }

  return lines.join("\n");
}
