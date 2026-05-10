/**
 * tests/project-delete-window.test.ts
 */
import { describe, expect, it } from "vitest";
import {
  formatInstantInTokyo,
  regularMemberMayHardDeleteProject,
  TWENTY_FOUR_HOURS_MS,
} from "../src/domain/project-delete-window.js";

describe("project delete 24h window", () => {
  it("allows member delete just before 24h elapsed", () => {
    const created = Date.UTC(2026, 4, 10, 12, 0, 0, 0);
    const now = created + TWENTY_FOUR_HOURS_MS - 1;
    expect(regularMemberMayHardDeleteProject(created, now)).toBe(true);
  });

  it("denies member delete at exactly 24h elapsed", () => {
    const created = Date.UTC(2026, 4, 10, 12, 0, 0, 0);
    const now = created + TWENTY_FOUR_HOURS_MS;
    expect(regularMemberMayHardDeleteProject(created, now)).toBe(false);
  });

  it("Tokyo formatter uses JST (+09:00) for a known UTC instant", () => {
    const utc = Date.UTC(2026, 0, 15, 14, 30, 0, 0);
    const s = formatInstantInTokyo(utc);
    expect(s.startsWith("2026-01-15")).toBe(true);
    expect(s.includes("23:30:00")).toBe(true);
  });
});
