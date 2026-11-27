import { expect, test } from "@playwright/test";
import { caseFixture } from "../fixtures/case-handoff.ts";

test("a reviewer explicitly approves a redacted synthetic handoff in the browser", async ({
  page,
}) => {
  await page.goto("/case-handoff");
  await expect(
    page.getByRole("heading", { name: "Case handoff" }),
  ).toBeVisible();
  const fixture = caseFixture();
  await page.getByLabel("Development session token").fill(fixture.token);
  await page.getByLabel("Survey ID", { exact: true }).fill(fixture.survey);
  await page.getByLabel("Survey version ID").fill(fixture.version);
  await page.getByLabel("Synthetic basis reference").fill(fixture.basisRef);
  await page.getByLabel("Category").selectOption("campus_facilities");
  await page.getByLabel("Priority").selectOption("normal");
  const queue = page.getByRole("button", { name: "Approve and queue" });
  await expect(queue).toBeDisabled();
  const approval = page.getByRole("checkbox", {
    name: "I approve this synthetic handoff",
  });
  await approval.check();
  await page.getByLabel("Priority").selectOption("high");
  await expect(queue).toBeDisabled();
  await page.getByLabel("Priority").selectOption("normal");
  await approval.check();
  await queue.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("Handoff queued");
  await expect(
    page.getByText(
      "Review a campus facilities concern identified in the synthetic exercise.",
    ),
  ).toBeVisible();
  await expect(page.getByText(fixture.rawFixture)).toHaveCount(0);
  await expect(page.getByLabel("Development session token")).toHaveValue("");
  expect(
    fixture.sql(
      "SELECT count(*) FROM public.case_handoff_events WHERE survey_id = '" +
        fixture.survey +
        "'",
    ),
  ).toBe("1");
  await page.screenshot({
    path: test.info().outputPath("case-handoff.png"),
    fullPage: true,
  });
});
