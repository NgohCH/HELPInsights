import { expect, test } from "@playwright/test";
import { surveyFixture } from "../fixtures/survey.ts";

test("a creator can answer a saved draft preview without publishing or storing a response", async ({
  page,
}) => {
  const { sql, ownerToken } = surveyFixture();
  await page.goto("/");
  await page.getByLabel("Development session token").fill(ownerToken);
  await page.getByRole("button", { name: "Open workspace" }).click();
  await page.getByLabel("Survey title").fill("Workshop preview fixture");
  await page.getByLabel("Question").fill("Would you attend again?");
  await page.getByLabel("Option 1").fill("Yes");
  await page.getByLabel("Option 2").fill("No");
  await page.getByRole("button", { name: "Save draft" }).click();

  const openPreview = page.getByRole("button", { name: "Preview draft" });
  await expect(openPreview).toBeEnabled();
  await openPreview.click();
  const preview = page.getByRole("region", { name: "Draft preview" });
  await expect(
    preview.getByRole("heading", { name: "Workshop preview fixture" }),
  ).toBeVisible();
  await expect(
    preview.getByRole("heading", { name: "Workshop preview fixture" }),
  ).toBeFocused();
  const yes = preview.getByRole("radio", { name: "Yes" });
  await yes.focus();
  await page.keyboard.press("Space");
  await expect(yes).toBeChecked();
  await preview.getByRole("button", { name: "Check preview answer" }).click();
  await expect(preview.getByRole("status")).toHaveText(
    "Preview answer checked",
  );

  expect(
    sql(`
    SELECT s.status,
      (SELECT count(*) FROM public.survey_versions v WHERE v.survey_id = s.id),
      (SELECT count(*) FROM public.responses r
        JOIN public.survey_versions v ON v.id = r.survey_version_id WHERE v.survey_id = s.id)
    FROM public.surveys s WHERE s.title = 'Workshop preview fixture'
  `),
  ).toBe("draft|0|0");
  await preview.getByRole("button", { name: "Close preview" }).click();
  await expect(openPreview).toBeFocused();
  await expect(preview).toHaveCount(0);
});
