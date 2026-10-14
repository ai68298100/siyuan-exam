import type { Question } from "./types";
import { normalizeAnswer } from "./answer";

export function isChoiceQuestion(q: Pick<Question, "type">): boolean {
  return q.type === "single" || q.type === "multiple" || q.type === "judge";
}

/** 判断题存对/错；字母只是界面与快捷键位置，不应作为判断答案提交。 */
export function answerChoices(q: Pick<Question, "type" | "options">) {
  const options = q.type === "judge" ? ["对", "错"] : q.options;
  return options.map((text, index) => {
    const letter = String.fromCharCode(65 + index);
    return { letter, text, value: q.type === "judge" ? text : letter };
  });
}

export function toggleChoice(type: Question["type"], selected: string, value: string): string {
  if (type !== "multiple") return value;
  const values = new Set(selected.split(""));
  if (values.has(value)) values.delete(value);
  else values.add(value);
  return [...values].sort().join("");
}

/** 删除选项时按原位置迁移答案；被删的正确项需要作者重新指定，不能误指向后续选项。 */
export function removeChoiceOption(type: Question["type"], options: string[], answer: string, removedIndex: number): { options: string[]; answer: string } {
  if (!Number.isInteger(removedIndex) || removedIndex < 0 || removedIndex >= options.length) {
    return { options: [...options], answer };
  }
  const nextOptions = options.filter((_, index) => index !== removedIndex);
  if (type !== "single" && type !== "multiple") return { options: nextOptions, answer };
  const nextAnswer = (normalizeAnswer(type, answer) ?? "").split("").flatMap((letter) => {
    const oldIndex = letter.charCodeAt(0) - 65;
    if (oldIndex === removedIndex || oldIndex >= options.length) return [];
    return [String.fromCharCode(65 + (oldIndex > removedIndex ? oldIndex - 1 : oldIndex))];
  }).join("");
  return { options: nextOptions, answer: nextAnswer };
}
