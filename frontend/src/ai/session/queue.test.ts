import { describe, expect, it } from "vitest";
import { buildQueueRepairRequest, buildQueueRequest, parseQueueResults } from "./queue";

const TASKS = [
  { id: "task-a", instruction: "Polish", text: "Hello", before: "Before", after: "After" },
  { id: "task-b", instruction: "Shorten", text: "World", before: "", after: "" },
];

describe("queue request", () => {
  it("puts every task id/instruction and the required JSON shape in one request", () => {
    const request = buildQueueRequest(TASKS);
    const content = request.messages[0]!.content;
    expect(content).toContain('"results"');
    expect(content).toContain("task-a");
    expect(content).toContain("Instruction: Polish");
    expect(content).toContain('"""\nHello\n"""');
    expect(content).toContain("task-b");
    expect(request.messages).toHaveLength(1);
  });

  it("builds a repair request quoting the bad answer", () => {
    const request = buildQueueRepairRequest("not json", TASKS);
    expect(request.messages[1]).toEqual({ role: "assistant", content: "not json" });
    expect(request.messages[2]!.content).toMatch(/corrected JSON/);
  });
});

describe("parseQueueResults", () => {
  const ids = new Set(["task-a", "task-b"]);

  it("accepts plain and fenced JSON", () => {
    expect(parseQueueResults('{"results":[{"id":"task-a","replacement":"A"}]}', ids)).toEqual([
      { id: "task-a", replacement: "A" },
    ]);
    expect(
      parseQueueResults('```json\n{"results":[{"id":"task-b","replacement":"B"}]}\n```', ids),
    ).toEqual([{ id: "task-b", replacement: "B" }]);
  });

  it("drops unknown and duplicate ids, and non-string replacements", () => {
    const results = parseQueueResults(
      JSON.stringify({
        results: [
          { id: "task-a", replacement: "A" },
          { id: "task-a", replacement: "A2" },
          { id: "nope", replacement: "X" },
          { id: "task-b", replacement: 42 },
          { id: "task-b", replacement: "B" },
        ],
      }),
      ids,
    );
    expect(results).toEqual([
      { id: "task-a", replacement: "A" },
      { id: "task-b", replacement: "B" },
    ]);
  });

  it("returns null for invalid JSON or a missing/empty results array", () => {
    expect(parseQueueResults("nope", ids)).toBeNull();
    expect(parseQueueResults("{}", ids)).toBeNull();
    expect(parseQueueResults('{"results":[]}', ids)).toBeNull();
    expect(parseQueueResults('{"results":[{"id":"nope","replacement":"x"}]}', ids)).toBeNull();
  });
});
