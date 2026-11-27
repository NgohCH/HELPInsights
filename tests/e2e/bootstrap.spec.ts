import { expect, test } from "@playwright/test";

test("a visitor can open the HELPInsights application", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "HELPInsights", level: 1 }),
  ).toBeVisible();
});
