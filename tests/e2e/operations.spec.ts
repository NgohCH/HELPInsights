import { expect, test } from "@playwright/test";
import { event, operationsFixture } from "../fixtures/operations.ts";
import { surveyFixture } from "../fixtures/survey.ts";

test("the administration page lets operations staff see redacted health and incidents", async ({
  page,
}) => {
  const fixture = surveyFixture();
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Operations" })).toBeVisible();

  const token = page.getByLabel("Development session token");
  const open = page.getByRole("button", { name: "Open operations" });
  await token.fill(fixture.ownerToken);
  await open.click();
  await expect(page.getByRole("alert")).toHaveText(
    "You do not have permission to access operations",
  );
  await expect(
    page.getByRole("heading", { name: "Service health" }),
  ).toHaveCount(0);

  const ops = operationsFixture(fixture);
  const written = await page.request.post("/api/v1/admin/incidents", {
    headers: { Authorization: "Bearer " + ops.operatorToken },
    data: event,
  });
  expect(written.status()).toBe(201);
  const { recordedAt } = await written.json();
  await token.fill(ops.viewerToken);
  await open.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Service health" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("row", { name: /database\s+detected\s+advisory/i })
      .filter({ has: page.locator('time[datetime="' + recordedAt + '"]') }),
  ).toBeVisible();
  await expect(page.getByText(ops.operator, { exact: false })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("operations.png") });
});
