/**
 * tests/folder-tree.test.ts
 */
import { describe, expect, it } from "vitest";
import { folderMoveWouldCycle } from "../src/domain/folder-tree.js";

describe("folderMoveWouldCycle", () => {
  it("detects direct self-parent", () => {
    const m = new Map<string, string | null>([
      ["a", null],
      ["b", "a"],
    ]);
    expect(folderMoveWouldCycle(m, "a", "a")).toBe(true);
  });

  it("detects moving under own descendant", () => {
    const m = new Map<string, string | null>([
      ["a", null],
      ["b", "a"],
      ["c", "b"],
    ]);
    expect(folderMoveWouldCycle(m, "a", "c")).toBe(true);
  });

  it("allows sibling reparent", () => {
    const m = new Map<string, string | null>([
      ["a", null],
      ["b", "a"],
      ["c", "a"],
    ]);
    expect(folderMoveWouldCycle(m, "b", "c")).toBe(false);
  });
});
