import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/smoke-e2e.mjs", import.meta.url));
const workspaces: string[] = [];

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "lv-exam-e2e-fixture-"));
  workspaces.push(root);
  return {
    write(path: string, value: unknown, raw = false) {
      const target = join(root, "data/storage/petal", path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, raw ? String(value) : JSON.stringify(value), "utf8");
    },
    run() {
      const result = spawnSync(process.execPath, [script, root], {
        encoding: "utf8",
        env: { ...process.env, SIYUAN_WORKSPACE: root },
        timeout: 10_000,
      });
      expect(result.error).toBeUndefined();
      expect(result.stderr).toBe("");
      return result;
    },
  };
}

afterEach(() => {
  for (const root of workspaces.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("真机只读走查 CLI", () => {
  it("从实际 data/storage 路径读取带 .json 的数据与打卡桥", () => {
    const fixture = workspace();
    fixture.write("siyuan-exam/attempts/log.json", { v: 2, events: [{ kind: "practice", confidence: "sure" }] });
    fixture.write("siyuan-exam/actions/items.json", []);
    fixture.write("siyuan-exam/ai/explain-history.json", { "q-1": [] });
    fixture.write("siyuan-checkin/bridge/events.ndjson", '{"externalRef":"exam:item:2026-10-16"}\n', true);
    const result = fixture.run();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("✓  37 下一步行动 schema  — 0 条");
    expect(result.stdout).toContain("✓  38 AI 讲解记录  — 1 题有记录");
    expect(result.stdout).toContain("✓  48-03 打卡侧 exam: 事件  — 1 条 exam: 引用");
    expect(result.stdout).toContain("失败 0");
  });

  it("练习完成或模考交卷后正常写入 null 不误报损坏", () => {
    const fixture = workspace();
    fixture.write("siyuan-exam/mock/run.json", null);
    fixture.write("siyuan-exam/session/active.json", null);
    const result = fixture.run();
    expect(result.status).toBe(0);
    expect(result.stdout.match(/已正常清空/g)).toHaveLength(2);
    expect(result.stdout).toContain("失败 0");
    expect(result.stdout).not.toContain("非合法 JSON");
  });

  it("非法 JSON 仍以非零退出，不当作正常空快照", () => {
    const fixture = workspace();
    fixture.write("siyuan-exam/mock/run.json", "{broken", true);
    const result = fixture.run();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("✗ FAIL  27 模考运行快照 schema  — 文件存在但非合法 JSON");
  });

  it("存在但 schema 错误的 .json 数据失败，不误报待数据", () => {
    const fixture = workspace();
    fixture.write("siyuan-exam/actions/items.json", { unexpected: true });
    fixture.write("siyuan-exam/ai/explain-history.json", []);
    fixture.write("siyuan-exam/mock/run.json", 42);
    const result = fixture.run();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("✗ FAIL  37 下一步行动 schema  — 非数组");
    expect(result.stdout).toContain("✗ FAIL  38 AI 讲解记录");
    expect(result.stdout).toContain("✗ FAIL  27 模考运行快照 schema  — 快照非对象");
  });
});
