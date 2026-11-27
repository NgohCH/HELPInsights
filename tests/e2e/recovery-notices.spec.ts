import { expect, test } from "@playwright/test";
import { recoveryNoticeFixture } from "../fixtures/recovery-notice.ts";

test("operators acknowledge a recovery notice in Operations and see the same receipt after reload", async ({
  page,
}) => {
  const fixture = recoveryNoticeFixture();
  const { first, recoveryId, sql } = fixture;
  async function open(token: string) {
    await page.getByLabel("Development session token").fill(token);
    await page.getByRole("button", { name: "Open operations" }).click();
    await expect(
      page.getByRole("heading", { name: "Service health" }),
    ).toBeVisible();
  }
  await page.goto("/admin");
  await open(first.viewerToken);
  await expect(
    page.getByRole("region", { name: "Recovery notices" }),
  ).toHaveCount(0);
  await open(first.operatorToken);
  const inbox = page.getByRole("region", { name: "Recovery notices" });
  await expect(inbox).toBeVisible();
  const list = await page.request.get("/api/v1/me/notices", {
    headers: { Authorization: "Bearer " + first.operatorToken },
  });
  expect(list.status()).toBe(200);
  const notice = (await list.json()).find(
    ({ id }: { id: string }) => id === recoveryId,
  );
  const entry = inbox.getByRole("listitem").filter({
    has: page.locator('time[datetime="' + notice.createdAt + '"]'),
  });
  await expect(
    entry.getByText("Export worker database connection recovered"),
  ).toBeVisible();
  await entry.getByRole("button", { name: "Acknowledge" }).focus();
  await page.keyboard.press("Enter");
  await expect(entry.getByText("Acknowledged", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Development session token")).toHaveValue("");
  await page.reload();
  await open(first.operatorToken);
  await expect(entry.getByText("Acknowledged", { exact: true })).toBeVisible();
  await expect(entry.getByRole("button", { name: "Acknowledge" })).toHaveCount(
    0,
  );
  expect(
    sql(
      "SELECT count(*) FROM public.worker_recovery_receipts WHERE incident_id = '" +
        recoveryId +
        "'",
    ),
  ).toBe("1");
  await page.screenshot({
    path: test.info().outputPath("recovery-notices.png"),
    fullPage: true,
  });
});
