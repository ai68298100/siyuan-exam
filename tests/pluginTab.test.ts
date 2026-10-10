import { describe, expect, it } from "vitest";
import { createExamTabDescriptor } from "../src/core/pluginTab";

describe("自定义页签持久化数据", () => {
  it("不会把与思源 app 构成循环引用的插件实例写入 custom.data", () => {
    const hostApp: { plugins: unknown[] } = { plugins: [] };
    const plugin: { name: string; app: typeof hostApp } = { name: "siyuan-exam", app: hostApp };
    hostApp.plugins.push(plugin);
    const examApp = { plugin };

    // 复现宿主保存 custom.data 时遇到的 Plugin -> app -> plugins -> Plugin 环。
    expect(() => JSON.stringify({ plugin, examApp })).toThrow(/circular/i);

    const descriptor = createExamTabDescriptor(plugin.name, "exam-practice", "iconExam", "练习台");
    expect(JSON.parse(JSON.stringify(descriptor))).toEqual({
      id: "siyuan-examexam-practice",
      icon: "iconExam",
      title: "练习台",
    });
    expect(descriptor).not.toHaveProperty("data");
  });
});
