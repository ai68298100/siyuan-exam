import { describe, it, expect } from "vitest";
import {
  isTargetEditable,
  resolveCbtKeyAction,
  computeGridNavigation,
  computeSectionNavigation,
} from "../src/core/cbtKeyboard";

describe("CbtKeyboard 模考 CBT 键盘与答题卡盲打导航引擎 (40-06 / 45-03)", () => {
  describe("可编辑目标与输入法安全守卫 (isTargetEditable)", () => {
    it("准确识别 INPUT、TEXTAREA、SELECT 与 contentEditable 元素", () => {
      expect(isTargetEditable({ key: "a", targetTagName: "INPUT" })).toBe(true);
      expect(isTargetEditable({ key: "a", targetTagName: "textarea" })).toBe(true);
      expect(isTargetEditable({ key: "a", targetTagName: "select" })).toBe(true);
      expect(isTargetEditable({ key: "a", targetIsContentEditable: true })).toBe(true);

      expect(isTargetEditable({ key: "a", targetTagName: "BUTTON" })).toBe(false);
      expect(isTargetEditable({ key: "a", targetTagName: "DIV" })).toBe(false);
      expect(isTargetEditable({ key: "a" })).toBe(false);
    });

    it("输入框焦点与输入法合成期绝对不触发任何快捷键", () => {
      // 1. 在 input 中按 A 键
      const resInput = resolveCbtKeyAction(
        { key: "A", targetTagName: "INPUT" },
        { questionType: "single", optionCount: 4 },
      );
      expect(resInput.type).toBe("ignore");
      expect(resInput.reason).toContain("输入控件");

      // 2. 中文输入法选词期按 1 键
      const resIme = resolveCbtKeyAction(
        { key: "1", isComposing: true },
        { questionType: "judge" },
      );
      expect(resIme.type).toBe("ignore");
      expect(resIme.reason).toContain("输入法合成期");

      // 3. keyCode === 229 (常见拼音键盘)
      const res229 = resolveCbtKeyAction(
        { key: "Process", keyCode: 229 },
        { questionType: "single" },
      );
      expect(res229.type).toBe("ignore");
    });

    it("检测到系统修饰键 (Ctrl/Alt/Meta) 时自动放行，不拦截全局快捷键", () => {
      const resCtrlC = resolveCbtKeyAction(
        { key: "c", ctrlKey: true },
        { questionType: "single", optionCount: 4 },
      );
      expect(resCtrlC.type).toBe("ignore");

      const resMetaK = resolveCbtKeyAction(
        { key: "k", metaKey: true },
        { questionType: "single", optionCount: 4 },
      );
      expect(resMetaK.type).toBe("ignore");
    });
  });

  describe("单选题、多选题与选项按键映射", () => {
    it("按 A-D 快速选中选项，越界选项返回 ignore", () => {
      const resA = resolveCbtKeyAction(
        { key: "a" },
        { questionType: "single", optionCount: 4 },
      );
      expect(resA.type).toBe("select_option");
      expect(resA.optionLetter).toBe("A");
      expect(resA.optionIndex).toBe(0);

      const resD = resolveCbtKeyAction(
        { key: "D" },
        { questionType: "single", optionCount: 4 },
      );
      expect(resD.type).toBe("select_option");
      expect(resD.optionLetter).toBe("D");
      expect(resD.optionIndex).toBe(3);

      // 只有 4 个选项时按 E 越界
      const resE = resolveCbtKeyAction(
        { key: "e" },
        { questionType: "single", optionCount: 4 },
      );
      expect(resE.type).toBe("ignore");
    });

    it("多选题支持 Enter 确认前进", () => {
      const resEnter = resolveCbtKeyAction(
        { key: "Enter" },
        { questionType: "multiple", optionCount: 4 },
      );
      expect(resEnter.type).toBe("confirm_multiple");

      // 单选题按 Enter 不生效
      const resSingleEnter = resolveCbtKeyAction(
        { key: "Enter" },
        { questionType: "single", optionCount: 4 },
      );
      expect(resSingleEnter.type).toBe("ignore");
    });
  });

  describe("判断题快捷盲打键位 (T/F, Y/N, 1/2)", () => {
    it("T / Y / 1 快捷映射为正确 (选项 A)", () => {
      for (const k of ["t", "T", "y", "Y", "1"]) {
        const res = resolveCbtKeyAction({ key: k }, { questionType: "judge", optionCount: 2 });
        expect(res.type).toBe("judge_true");
        expect(res.optionLetter).toBe("A");
        expect(res.optionIndex).toBe(0);
      }
    });

    it("F / N / 2 快捷映射为错误 (选项 B)", () => {
      for (const k of ["f", "F", "n", "N", "2"]) {
        const res = resolveCbtKeyAction({ key: k }, { questionType: "judge", optionCount: 2 });
        expect(res.type).toBe("judge_false");
        expect(res.optionLetter).toBe("B");
        expect(res.optionIndex).toBe(1);
      }
    });
  });

  describe("辅助工具与标记快捷键 (F 标旗与 Shift+S 草稿纸)", () => {
    it("非判断题下按 F 键切换标旗", () => {
      const res = resolveCbtKeyAction({ key: "f" }, { questionType: "single", optionCount: 4 });
      expect(res.type).toBe("toggle_flag");
      expect(res.reason).toContain("切换当前题目标旗");
    });

    it("按 Shift+S 快速唤起或折叠演算草稿纸", () => {
      const res = resolveCbtKeyAction({ key: "S", shiftKey: true }, { questionType: "single" });
      expect(res.type).toBe("toggle_scratchpad");
    });
  });

  describe("卷面导航与人机对话流锁 (Lockout)", () => {
    it("正常模式下左右方向键与 Home/End 自由导航", () => {
      const resL = resolveCbtKeyAction({ key: "ArrowLeft" }, { questionType: "single" });
      expect(resL.type).toBe("navigate_prev");

      const resR = resolveCbtKeyAction({ key: "ArrowRight" }, { questionType: "single" });
      expect(resR.type).toBe("navigate_next");

      const resHome = resolveCbtKeyAction({ key: "Home" }, { questionType: "single" });
      expect(resHome.type).toBe("navigate_first");

      const resEnd = resolveCbtKeyAction({ key: "End" }, { questionType: "single" });
      expect(resEnd.type).toBe("navigate_last");
    });

    it("Lockout 锁定模式下禁止向左回退与跳至卷首", () => {
      const resL = resolveCbtKeyAction({ key: "ArrowLeft" }, { questionType: "single", isLockout: true });
      expect(resL.type).toBe("ignore");
      expect(resL.reason).toContain("禁止回退");

      const resHome = resolveCbtKeyAction({ key: "Home" }, { questionType: "single", isLockout: true });
      expect(resHome.type).toBe("ignore");

      // 但向后前进仍放行
      const resR = resolveCbtKeyAction({ key: "ArrowRight" }, { questionType: "single", isLockout: true });
      expect(resR.type).toBe("navigate_next");
    });
  });

  describe("答题卡网格二维键盘穿梭 (computeGridNavigation)", () => {
    it("在 5 列网格中上下左右精准移动与边界限制", () => {
      // 5 列网格，共 20 题 (索引 0~19)
      const cols = 5;
      const total = 20;

      // 1. 水平右移 / 左移
      expect(computeGridNavigation(0, "right", total, { columns: cols })).toBe(1);
      expect(computeGridNavigation(1, "left", total, { columns: cols })).toBe(0);
      expect(computeGridNavigation(0, "left", total, { columns: cols })).toBe(0); // 边界

      // 2. 垂直下移 / 上移 (步长 = 5)
      expect(computeGridNavigation(2, "down", total, { columns: cols })).toBe(7);
      expect(computeGridNavigation(7, "up", total, { columns: cols })).toBe(2);
      expect(computeGridNavigation(2, "up", total, { columns: cols })).toBe(0); // 上边界
      expect(computeGridNavigation(18, "down", total, { columns: cols })).toBe(19); // 截断到最后一题
    });

    it("结合 lockout 与答题进度守卫，不允许跳过未答边界", () => {
      // 假设只答了第 0 题和第 1 题，答题边界为 1+1=2
      const answered = [true, true, false, false, false];
      const target = computeGridNavigation(1, "down", 5, {
        columns: 5,
        isLockout: true,
        answeredFlags: answered,
      });
      // 试图跳到下排题，但受 lockout 限制，强制停留在边界 2
      expect(target).toBe(2);
    });
  });

  describe("跨分段大题跳转计算 (computeSectionNavigation)", () => {
    it("PageDown 跳转至下一分段首题，PageUp 跳转至上一分段首题", () => {
      const qids = ["q1", "q2", "q3", "q4", "q5", "q6"];
      const sectionOf = (id: string) => {
        if (id === "q1" || id === "q2") return "常识";
        if (id === "q3" || id === "q4") return "言语";
        return "数量";
      };

      // 从常识第 0 题 PageDown -> 跳到言语首题 q3 (索引 2)
      expect(computeSectionNavigation(0, "next", qids, sectionOf)).toBe(2);

      // 从言语第 3 题 (非首题) PageUp -> 跳到言语首题 q3 (索引 2)
      expect(computeSectionNavigation(3, "prev", qids, sectionOf)).toBe(2);

      // 从言语第 2 题 (首题) PageUp -> 跳到上一大题常识首题 q1 (索引 0)
      expect(computeSectionNavigation(2, "prev", qids, sectionOf)).toBe(0);

      // 从最后一段数量题 PageDown -> 停留在末题 (索引 5)
      expect(computeSectionNavigation(5, "next", qids, sectionOf)).toBe(5);
    });
  });
});
