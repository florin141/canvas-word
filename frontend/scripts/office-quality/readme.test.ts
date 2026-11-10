import { describe, expect, it } from "vitest";
import { BEGIN, END, updateMarkedSection } from "./readme.mjs";

describe("generated Markdown section", () => {
  it("replaces only the marked block and preserves the rest", () => {
    const target = `# Quality\n\nIntro.\n\n${BEGIN}\nOLD CONTENT\n${END}\n\nTail.\n`;
    const updated = updateMarkedSection(target, "NEW CONTENT\n");
    expect(updated).toContain(`# Quality\n\nIntro.\n\n${BEGIN}`);
    expect(updated).toContain("NEW CONTENT");
    expect(updated).not.toContain("OLD CONTENT");
    expect(updated.endsWith(`${END}\n\nTail.\n`)).toBe(true);
  });

  it("refuses a file without markers", () => {
    expect(() => updateMarkedSection("# Quality\n", "NEW")).toThrow(/markers/);
    expect(() => updateMarkedSection(`${END}\n${BEGIN}`, "NEW")).toThrow(/markers/);
  });
});
