// ============================================================
// 挑战码 PK（v1.x 前置纯逻辑层）：题目卷编码/解码 + 答案比对
// 流程：出题人导出挑战码（含答案，自留 judge 用）→ 受邀人导入作答
// → 回传答案串 → 双方用 compareAnswers 出对比成绩单
// 编码用 base64(JSON)，无加密诉求（友谊赛，防手滑改题即可）
// ============================================================
import type { Question } from "./types";

export interface ChallengePaper {
  v: 1;
  title: string;
  durationS: number;
  questions: {
    stem: string;
    options: string[];
    answer: string; // 出题人保留；受卷方版本不含此字段
    type: Question["type"];
    kp?: string;
  }[];
}

/** 受卷方版本：剥掉答案与解析，只留作答所需 */
export function stripForTaker(paper: ChallengePaper): ChallengePaper {
  return {
    ...paper,
    questions: paper.questions.map((q) => ({ stem: q.stem, options: q.options, answer: "", type: q.type, kp: q.kp })),
  };
}

export function encodeChallenge(paper: ChallengePaper): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(stripForTaker(paper)))));
}

/** 友谊赛完整版：含答案一起编码（双方本地均可正常判分练习） */
export function encodeChallengeCopy(paper: ChallengePaper): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(paper))));
}

export function decodeChallenge(code: string): ChallengePaper | null {
  try {
    const json = decodeURIComponent(escape(atob(code.trim())));
    const obj = JSON.parse(json);
    if (obj?.v !== 1 || !Array.isArray(obj.questions) || !obj.questions.length) return null;
    return obj as ChallengePaper;
  } catch {
    return null;
  }
}

/** 受卷方作答串（"AB C?"）→ 逐题比对出成绩单；?/. 为未作答 */
export interface ChallengeScore {
  total: number;
  correct: number;
  wrong: number;
  blank: number;
  percent: number;
  marks: ("✓" | "✕" | "–")[];
}

export function compareAnswers(key: string, mine: string): ChallengeScore {
  const k = key.replace(/\s/g, "").split("");
  const m = mine.replace(/\s/g, "").split("");
  const total = Math.max(k.length, m.length);
  let correct = 0,
    wrong = 0,
    blank = 0;
  const marks: ChallengeScore["marks"] = [];
  for (let i = 0; i < total; i++) {
    const a = (m[i] ?? "?").toUpperCase();
    const b = (k[i] ?? "?").toUpperCase();
    if (a === "?" || a === "." || a === "") {
      blank++;
      marks.push("–");
      continue;
    }
    if (a === b) {
      correct++;
      marks.push("✓");
    } else {
      wrong++;
      marks.push("✕");
    }
  }
  return { total, correct, wrong, blank, percent: total ? Math.round((correct / total) * 100) : 0, marks };
}
