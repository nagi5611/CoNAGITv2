import { describe, expect, it } from "vitest";
import { requireCompanyAdmin } from "../src/auth/session.js";
import { HttpError } from "../src/http/errors.js";

describe("authorization helpers", () => {
  it("requireCompanyAdmin throws 403 for non-admin user", () => {
    let err: HttpError | undefined;
    try {
      requireCompanyAdmin({
        id: "u1",
        username: "member",
        isCompanyAdmin: false,
      });
    } catch (e) {
      err = e as HttpError;
    }
    expect(err).toBeInstanceOf(HttpError);
    expect(err?.status).toBe(403);
  });

  it("requireCompanyAdmin passes for admin", () => {
    expect(() =>
      requireCompanyAdmin({
        id: "a1",
        username: "admin",
        isCompanyAdmin: true,
      }),
    ).not.toThrow();
  });
});
