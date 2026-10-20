// ============================================================
// 模考 CBT 键盘与答题卡盲打导航纯函数引擎（40-06 / 45-03）
// 纯函数领域层：
// 1. 快捷键意图解析（单选/多选/判断快捷键、标旗、草稿纸）
// 2. 焦点与输入法严格守卫（输入框、文本域与 IME 合成期绝不误触）
// 3. 答题卡网格二维键盘穿梭（上下左右、Home/End、PageUp/PageDown）
// 4. CBT 作答流锁（lockout）人机对话顺序作答合规拦截
// 规则：严格无外部宿主依赖（禁 import "siyuan"），严禁类型强转。
// ============================================================

import type { QuestionType } from "./types";
import { guardLockout } from "./cbt";

export type CbtKeyActionType =
  | "ignore"
  | "select_option"
  | "confirm_multiple"
  | "judge_true"
  | "judge_false"
  | "toggle_flag"
  | "toggle_scratchpad"
  | "navigate_prev"
  | "navigate_next"
  | "navigate_first"
  | "navigate_last"
  | "navigate_section_prev"
  | "navigate_section_next";

export interface CbtKeyInput {
  key: string;
  code?: string;
  keyCode?: number;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  isComposing?: boolean;
  targetTagName?: string;
  targetIsContentEditable?: boolean;
}

export interface CbtResolvedAction {
  type: CbtKeyActionType;
  /** 选项字母（大写，如 "A"、"B"） */
  optionLetter?: string;
  /** 选项在列表中的 0-based 下标 */
  optionIndex?: number;
  /** 意图解释 */
  reason: string;
}

export interface CbtNavContext {
  questionType: QuestionType;
  optionCount?: number;
  isLockout?: boolean;
  /** 是否允许快捷回退 */
  canGoBack?: boolean;
}

/** 判定当前焦点是否处于可编辑文本控件中 */
export function isTargetEditable(input: CbtKeyInput): boolean {
  if (input.targetIsContentEditable) return true;
  const tag = (input.targetTagName ?? "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * 将键盘按键事件解析为确定的模考 CBT 动作意图。
 * 纯函数无 IO，支持无头单测与跨平台键盘映射。
 */
export function resolveCbtKeyAction(input: CbtKeyInput, context: CbtNavContext): CbtResolvedAction {
  // 1. 焦点安全守卫：处于输入框、文本框、富文本编辑或中文输入法合成态中，绝对不拦截
  if (isTargetEditable(input)) {
    return { type: "ignore", reason: "目标元素为可编辑输入控件，放行原生键盘事件" };
  }
  if (input.isComposing || input.keyCode === 229) {
    return { type: "ignore", reason: "处于输入法合成期 (IME)，放行输入法选词" };
  }

  // 2. 系统修饰键保护：Ctrl+C/V、Alt+Tab、Meta+K 等原生与全局快捷键不得拦截
  if (input.ctrlKey || input.metaKey || input.altKey) {
    return { type: "ignore", reason: "检测到系统级修饰键 (Ctrl/Alt/Meta)，放行系统与全局快捷键" };
  }

  const upperKey = input.key.toUpperCase();

  // 3. Shift 组合辅助功能：Shift+S 打开/折叠草稿纸
  if (input.shiftKey) {
    if (upperKey === "S") {
      return { type: "toggle_scratchpad", reason: "Shift+S 唤起或折叠演算草稿纸" };
    }
    return { type: "ignore", reason: "未定义的 Shift 组合键" };
  }

  // 4. 辅助标记功能：F 键切换标旗（Flag）
  if (upperKey === "F") {
    // 仅当非判断题或明确不在判断选项意图时，优先作为 Flag
    // 判断题若用户按 F 表示"错（False）"，由题型分流先行判断
    if (context.questionType !== "judge") {
      return { type: "toggle_flag", reason: "F 键切换当前题目标旗" };
    }
  }

  // 5. 判断题专享快速键位（T / Y / 1 为正确；F / N / 2 为错误）
  if (context.questionType === "judge") {
    if (upperKey === "T" || upperKey === "Y" || input.key === "1") {
      return { type: "judge_true", optionLetter: "A", optionIndex: 0, reason: "快捷键判定为正确(True/Yes/1)" };
    }
    if (upperKey === "F" || upperKey === "N" || input.key === "2") {
      return { type: "judge_false", optionLetter: "B", optionIndex: 1, reason: "快捷键判定为错误(False/No/2)" };
    }
  }

  // 6. 多选题回车确认
  if (input.key === "Enter" && context.questionType === "multiple") {
    return { type: "confirm_multiple", reason: "Enter 确认多选作答并前进" };
  }

  // 7. 选项选择（A - J）：单选/多选/判断题选项快捷键
  if (/^[A-J]$/.test(upperKey)) {
    const idx = upperKey.charCodeAt(0) - 65;
    const maxOptions = context.optionCount ?? 10;
    if (idx < maxOptions) {
      return {
        type: "select_option",
        optionLetter: upperKey,
        optionIndex: idx,
        reason: `快捷选择选项 ${upperKey}`,
      };
    }
    return { type: "ignore", reason: `选项 ${upperKey} 超出当前题目有效选项数量范围` };
  }

  // 8. 答题卡与卷面导航穿梭
  if (input.key === "ArrowLeft") {
    if (context.isLockout) {
      return { type: "ignore", reason: "人机对话作答流锁 (lockout) 模式下禁止回退" };
    }
    return { type: "navigate_prev", reason: "左方向键导航至上一题" };
  }

  if (input.key === "ArrowRight") {
    return { type: "navigate_next", reason: "右方向键导航至下一题" };
  }

  if (input.key === "Home") {
    if (context.isLockout) {
      return { type: "ignore", reason: "lockout 模式下禁止跳回卷首" };
    }
    return { type: "navigate_first", reason: "Home 键直接跳转至卷首第一题" };
  }

  if (input.key === "End") {
    return { type: "navigate_last", reason: "End 键跳转至最后一题" };
  }

  if (input.key === "PageUp") {
    if (context.isLockout) {
      return { type: "ignore", reason: "lockout 模式下禁止向前跳段" };
    }
    return { type: "navigate_section_prev", reason: "PageUp 键跳转至上一分段大题" };
  }

  if (input.key === "PageDown") {
    return { type: "navigate_section_next", reason: "PageDown 键跳转至下一分段大题" };
  }

  return { type: "ignore", reason: "未绑定的键盘按键" };
}

/**
 * 答题卡网格二维方向键穿梭计算。
 * 答题卡通常按每行 columns 列排布（默认 5 列网格）；
 * 按 ArrowUp / ArrowDown 时垂直穿梭 ±columns，按 ArrowLeft / ArrowRight 时水平移动 ±1。
 */
export function computeGridNavigation(
  currentCursor: number,
  direction: "left" | "right" | "up" | "down",
  totalQuestions: number,
  options: {
    columns?: number;
    isLockout?: boolean;
    answeredFlags?: readonly boolean[];
  } = {},
): number {
  if (totalQuestions <= 0) return 0;
  const cols = options.columns && options.columns > 0 ? options.columns : 5;
  const lastIndex = totalQuestions - 1;

  let target = currentCursor;

  switch (direction) {
    case "left":
      target = Math.max(0, currentCursor - 1);
      break;
    case "right":
      target = Math.min(lastIndex, currentCursor + 1);
      break;
    case "up":
      target = Math.max(0, currentCursor - cols);
      break;
    case "down":
      target = Math.min(lastIndex, currentCursor + cols);
      break;
  }

  // 作答流锁（lockout）守卫约束
  if (options.isLockout && options.answeredFlags) {
    return guardLockout(target, options.answeredFlags, currentCursor);
  }

  return target;
}

/**
 * 跨分段大题快速跳转计算（PageUp / PageDown）。
 * 寻找当前题所在 section 之前/之后的第一个不同 section 的首道题目索引。
 */
export function computeSectionNavigation(
  currentCursor: number,
  direction: "prev" | "next",
  qids: readonly string[],
  sectionOf: (qid: string) => string,
): number {
  if (!qids.length) return 0;
  const currentQid = qids[currentCursor] ?? qids[0];
  const currentSection = sectionOf(currentQid);

  if (direction === "next") {
    for (let i = currentCursor + 1; i < qids.length; i++) {
      if (sectionOf(qids[i]) !== currentSection) {
        return i;
      }
    }
    // 已经处于最后一个 section，停留在末尾
    return qids.length - 1;
  }

  // direction === "prev"
  // 1. 若当前题不是本 section 首题，跳到本 section 首题
  let sectionFirstIndex = currentCursor;
  for (let i = currentCursor - 1; i >= 0; i--) {
    if (sectionOf(qids[i]) === currentSection) {
      sectionFirstIndex = i;
    } else {
      break;
    }
  }

  if (currentCursor > sectionFirstIndex) {
    return sectionFirstIndex;
  }

  // 2. 若当前题已经是本 section 首题，则寻找上一 section 的首题
  if (sectionFirstIndex > 0) {
    const prevSectionName = sectionOf(qids[sectionFirstIndex - 1]);
    let prevFirst = sectionFirstIndex - 1;
    for (let i = sectionFirstIndex - 1; i >= 0; i--) {
      if (sectionOf(qids[i]) === prevSectionName) {
        prevFirst = i;
      } else {
        break;
      }
    }
    return prevFirst;
  }

  return 0;
}
