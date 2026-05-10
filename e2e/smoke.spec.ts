import { expect, test } from "@playwright/test";

test.describe("スモーク（Vite のみで可・secrets 不要）", () => {
  test("ログインフォームが表示される", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "ログイン" })).toBeVisible();
  });

  test("ログインフォームにユーザー名・パスワード欄がある", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("textbox", { name: "ユーザー名" })).toBeVisible();
    await expect(page.getByLabel("パスワード")).toBeVisible();
  });

  test("ルートでタイトル・ヘッダが読み込める", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/CoNAGITv2/);
    await expect(page.getByRole("heading", { name: "CoNAGITv2" }).first()).toBeVisible();
  });
});
