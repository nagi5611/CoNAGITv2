import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/auth/password.js";

describe("password", () => {
  it("verify succeeds for hashed password", async () => {
    const h = await hashPassword("correct horse battery staple");
    await expect(verifyPassword("correct horse battery staple", h)).resolves.toBe(
      true,
    );
    await expect(verifyPassword("wrong", h)).resolves.toBe(false);
  });

  it("rejects malformed stored strings", async () => {
    await expect(verifyPassword("x", "not-a-hash")).resolves.toBe(false);
  });
});
