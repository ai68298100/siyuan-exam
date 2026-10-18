// ============================================================
// 记忆服务（v0.2）：思源内核 riff 的领域封装
// - 卡包命名空间隔离：小驴考试/<题库名>（与内置闪卡共存，docs/03 #1）
// - 错题转卡：blockIds → addRiffCards；导入/转卡去重由内核按块幂等
// - 自评→FSRS rating 映射：四级自评（墨墨式）→ 0=Again 1=Hard 2=Good 3=Easy
//   （rating 数值语义待真机复核——TODO 27 组真机冒烟项）
// 纯逻辑（映射/挑选）与 IO（riff 调用）分离，测试覆盖纯逻辑
// ============================================================
import type { Question } from "./types";
import { OPTION_LETTERS } from "./answer";

export const DECK_PREFIX = "小驴考试/";

export const deckNameForBank = (bankName: string) => DECK_PREFIX + bankName;

/** 四级自评 → riff rating（1不会 2模糊 3会 4熟知） */
export function selfRatingToRiffRating(selfRating: number): 0 | 1 | 2 | 3 {
  switch (selfRating) {
    case 1:
      return 0; // Again
    case 2:
      return 1; // Hard
    case 3:
      return 2; // Good
    case 4:
      return 3; // Easy
    default:
      return 0;
  }
}

/** 二元自评（记住/忘了）→ rating */
export function binaryToRiffRating(remembered: boolean): 0 | 1 | 2 | 3 {
  return remembered ? 2 : 0;
}

/** 举一反三：完整考点优先 → 同章节（kp 首段）→ 任意；排除已做 */
export function pickSameKp(
  all: Question[],
  seedQuestion: Question,
  n: number,
  excludeIds: Set<string> = new Set(),
  rnd: () => number = Math.random,
): Question[] {
  const pool = all.filter((q) => !excludeIds.has(q.id) && q.id !== seedQuestion.id);
  const sameExact = seedQuestion.kp ? pool.filter((q) => q.kp === seedQuestion.kp) : [];
  const kpRoot = seedQuestion.kp?.split("/")[0];
  const sameRoot = kpRoot ? pool.filter((q) => q.kp?.split("/")[0] === kpRoot && !sameExact.includes(q)) : [];
  const rest = pool.filter((q) => !sameExact.includes(q) && !sameRoot.includes(q));
  const out: Question[] = [];
  const drain = (arr: Question[]) => {
    while (arr.length && out.length < n) out.push(arr.splice(Math.floor(rnd() * arr.length), 1)[0]);
  };
  drain(sameExact);
  drain(sameRoot);
  drain(rest);
  return out;
}

/** 冲刺 cram 队列：错 ≥2 次 ∪ 可选考点池；排除已消灭 */
export function cramQueue(
  questions: Question[],
  wrongCounts: Map<string, number>,
  minWrong = 2,
  limit = 50,
): Question[] {
  const scored = questions
    .filter((q) => (wrongCounts.get(q.id) ?? 0) >= minWrong)
    .sort((a, b) => (wrongCounts.get(b.id) ?? 0) - (wrongCounts.get(a.id) ?? 0));
  return scored.slice(0, limit);
}

/** 每日一练：到期优先（调用方传入）→ 高频错题 → 随机补足到 n */
export function dailySet(
  all: Question[],
  dueFirst: Question[],
  wrongCounts: Map<string, number>,
  n: number,
  rnd: () => number = Math.random,
): Question[] {
  const seen = new Set<string>();
  const out: Question[] = [];
  const push = (q: Question) => {
    if (out.length < n && !seen.has(q.id)) {
      seen.add(q.id);
      out.push(q);
    }
  };
  dueFirst.forEach(push);
  const byWrong = [...all].sort((a, b) => (wrongCounts.get(b.id) ?? 0) - (wrongCounts.get(a.id) ?? 0));
  byWrong.forEach(push);
  const shuffled = [...all];
  while (out.length < n && shuffled.length) {
    push(shuffled.splice(Math.floor(rnd() * shuffled.length), 1)[0]);
  }
  return out;
}

/** 将一道 Question 格式化为思源笔记标准的列表闪卡 Markdown（具有完美的正反面遮挡与复习体验） */
export function questionToFlashCardMarkdown(q: Question): string {
  // 保持题干与选项中多行文本的列表缩进，防止多行内容被解析为列表外部段落
  const indentLines = (text: string, indent = "  ") => text.trim().replace(/\r?\n/g, `\n${indent}`);
  const stem = indentLines(q.stem, "  ");
  let front: string;
  let back: string;

  switch (q.type) {
    case "single": {
      front = `- **【单选题】** ${stem}`;
      if (q.options.length) {
        front += "\n  " + q.options.map((opt, i) => `${OPTION_LETTERS[i]}. ${indentLines(opt, "    ")}`).join("\n  ");
      }
      const ansLetter = q.answer.trim().toUpperCase();
      const ansIdx = OPTION_LETTERS.indexOf(ansLetter);
      const ansText = ansIdx >= 0 && q.options[ansIdx] ? ` (${q.options[ansIdx].trim()})` : "";
      back = `  - **✔ 正确答案**：**${ansLetter}**${ansText}`;
      break;
    }
    case "multiple": {
      front = `- **【多选题】** ${stem} *（多选/少选均不得分）*`;
      if (q.options.length) {
        front += "\n  " + q.options.map((opt, i) => `${OPTION_LETTERS[i]}. ${indentLines(opt, "    ")}`).join("\n  ");
      }
      const letters = [...new Set(q.answer.replace(/[^A-Za-z]/g, "").toUpperCase().split(""))].sort();
      const ansDetail = letters.map((l) => {
        const idx = OPTION_LETTERS.indexOf(l);
        return idx >= 0 && q.options[idx] ? `${l}. ${q.options[idx].trim()}` : l;
      }).join("；");
      back = `  - **✔ 正确答案**：**${letters.join(", ")}**` + (ansDetail ? `\n    > ${ansDetail}` : "");
      break;
    }
    case "judge": {
      front = `- **【判断题】** ${stem}\n  *(A) 正确  |  (B) 错误*`;
      const isTrue = q.answer.includes("对") || q.answer.includes("正确") || q.answer.trim().toUpperCase() === "A";
      back = `  - **✔ 正确判断**：**${isTrue ? "正确 ✔" : "错误 ✕"}**`;
      break;
    }
    case "fill": {
      const isMulti = q.answer.includes(";;") || q.answerSpec?.kind === "multiBlank";
      if (isMulti) {
        front = `- **【多空填空题】** ${stem}`;
        const blanks = q.answer.split(";;").map((b) => b.trim()).filter(Boolean);
        back = `  - **✔ 参考填空**：\n` + blanks.map((b, i) => `    - 空 ${i + 1}：**${b}**`).join("\n");
      } else if (q.answerSpec?.kind === "numeric") {
        const unitTip = q.answerSpec.unit ? ` *(作答单位：${q.answerSpec.unit})*` : "";
        front = `- **【数值计算题】** ${stem}${unitTip}`;
        const tol = q.answerSpec.absTol ? ` *(允许误差 ±${q.answerSpec.absTol})*` : "";
        back = `  - **✔ 正确数值**：**${q.answer.trim()}**${q.answerSpec.unit ? ` ${q.answerSpec.unit}` : ""}${tol}`;
      } else {
        front = `- **【填空题】** ${stem}`;
        back = `  - **✔ 参考答案**：**${q.answer.trim()}**`;
      }
      break;
    }
    case "short": {
      front = `- **【问答/解答题】** ${stem}`;
      back = `  - **✔ 参考得分要点**：\n    ${indentLines(q.answer, "    ")}`;
      break;
    }
    case "material": {
      front = `- **【材料综合题】**\n  > 📎 **背景材料**：${indentLines(stem, "  > ")}`;
      back = `  - **✔ 参考要点**：**${q.answer.trim()}**`;
      break;
    }
    default: {
      front = `- **【习题】** ${stem}`;
      back = `  - **✔ 参考答案**：**${q.answer.trim()}**`;
      break;
    }
  }

  // 拼接解析与考点
  if (q.analysis?.trim()) {
    back += `\n    > 💡 **核心解析**：${indentLines(q.analysis, "    > ")}`;
  }
  if (q.kp?.trim()) {
    back += `\n    > 🏷️ **考点归纳**：${q.kp.trim()}`;
  }
  if (q.source?.trim()) {
    back += `\n    > 📖 **出处来源**：${q.source.trim()}`;
  }

  const ial = `{: custom-exam-card-qid="${q.id}" custom-exam-card-type="${q.type}"}`;
  return `${front}\n${back}\n  ${ial}`;
}
