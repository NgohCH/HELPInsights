import { expect, test } from "@playwright/test";
import { surveyFixture } from "../fixtures/survey.ts";

test("on mobile a keyboard user previews a starter and edits its private copy", async ({
  page,
}) => {
  const { workspace, ownerToken, sql } = surveyFixture();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByLabel("Development session token").fill(ownerToken);
  await page.getByRole("button", { name: "Open workspace" }).click();

  const catalog = page.getByRole("button", { name: "Browse templates" });
  await catalog.focus();
  await page.keyboard.press("Enter");
  const openPreview = page.getByRole("button", {
    name: "Preview Event feedback",
  });
  await openPreview.focus();
  await page.keyboard.press("Enter");
  const preview = page.getByRole("region", { name: "Template preview" });
  await expect(preview.getByText("How useful was the event?")).toBeVisible();
  await expect(preview.getByText("Very useful")).toBeVisible();
  const selectDrafts = `SELECT count(*) FROM public.surveys WHERE workspace_id = '${workspace}'`;
  expect(sql(selectDrafts)).toBe("0");
  await expect(
    page.getByRole("link", { name: "Open respondent link" }),
  ).toHaveCount(0);
  const screenshot = test.info().outputPath("event-feedback-preview.png");
  await preview.screenshot({ path: screenshot });
  await test.info().attach("Mobile template preview", {
    path: screenshot,
    contentType: "image/png",
  });

  await preview.getByRole("button", { name: "Use this template" }).focus();
  await page.keyboard.press("Enter");
  const title = page.getByLabel("Survey title");
  await expect(title).toHaveValue("Event feedback");
  await expect(page.getByLabel("Question")).toHaveValue(
    "How useful was the event?",
  );
  await expect(page.getByRole("status")).toHaveText(
    "Template copied to a draft",
  );
  await expect(
    page.getByRole("link", { name: "Open respondent link" }),
  ).toHaveCount(0);

  const draftPreview = page.getByRole("button", { name: "Preview draft" });
  await expect(draftPreview).toBeEnabled();
  await draftPreview.click();
  const savedPreview = page.getByRole("region", { name: "Draft preview" });
  await expect(
    savedPreview.getByRole("radio", { name: "Very useful" }),
  ).toBeVisible();
  await savedPreview.getByRole("button", { name: "Close preview" }).click();
  await expect(draftPreview).toBeFocused();

  await title.fill("My event survey");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("status")).toHaveText("Draft saved");
  expect(sql(selectDrafts)).toBe("1");
  expect(
    sql(`
    SELECT title, status, draft->'pages'->0->'questions'->0->>'code',
      draft->'pages'->0->'questions'->0->'options'->0->>'code'
    FROM public.surveys WHERE workspace_id = '${workspace}'
  `),
  ).toBe("My event survey|draft|event_usefulness|very_useful");
});
