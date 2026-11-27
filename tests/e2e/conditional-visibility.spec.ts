import { devices, expect, test } from "@playwright/test";
import {
  visibilityDefinition,
  visibilityFixture,
} from "../fixtures/visibility.ts";
import { surveyFixture } from "../fixtures/survey.ts";

test.use({ ...devices["Pixel 5"] });

test("keyboard selection reveals a follow-up and changing the branch clears it", async ({
  page,
}) => {
  const { save, publish, sql } = await visibilityFixture();
  expect((await save(visibilityDefinition)).status).toBe(200);
  const version = await publish();
  await page.goto("/respond/" + version.publicToken);
  const followUp = page.getByRole("textbox", {
    name: "What should we change?",
  });
  const negative = page.getByRole("radio", { name: "Not useful", exact: true });
  const positive = page.getByRole("radio", { name: "Useful", exact: true });
  await expect(negative).toBeVisible();
  await expect(followUp).toHaveCount(0);
  await negative.focus();
  await page.keyboard.press("Space");
  await followUp.fill("Unsaved value");
  await positive.focus();
  await page.keyboard.press("Space");
  await expect(followUp).toHaveCount(0);
  await negative.focus();
  await page.keyboard.press("Space");
  await expect(followUp).toHaveValue("");
  await positive.focus();
  await page.keyboard.press("Space");
  await page.getByRole("button", { name: "Submit response" }).click();
  await expect(page.getByRole("status")).toHaveText("Response submitted");
  expect(
    sql(
      "SELECT answers::text FROM public.responses WHERE survey_version_id = '" +
        version.id +
        "'",
    ),
  ).toContain('"value": "useful"');
  expect(
    sql(
      "SELECT jsonb_array_length(answers) FROM public.responses WHERE survey_version_id = '" +
        version.id +
        "'",
    ),
  ).toBe("1");
});

test("a creator saves and checks a conditional follow-up in private preview", async ({
  page,
}) => {
  const { sql, ownerToken } = surveyFixture();
  await page.goto("/");
  await page.getByLabel("Development session token").fill(ownerToken);
  await page.getByRole("button", { name: "Open workspace" }).click();
  await page.getByLabel("Survey title").fill("Conditional preview fixture");
  await page
    .getByLabel("Question", { exact: true })
    .fill("Would you attend again?");
  await page.getByLabel("Option 1").fill("Yes");
  await page.getByLabel("Option 2").fill("No");
  await page.getByLabel("Show a follow-up when").selectOption("option_2");
  await page.getByLabel("Follow-up question").fill("What should we change?");
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.getByRole("button", { name: "Preview draft" }).click();

  const preview = page.getByRole("region", { name: "Draft preview" });
  const detail = preview.getByRole("textbox", {
    name: "What should we change?",
  });
  await expect(detail).toHaveCount(0);
  await preview.getByRole("radio", { name: "No" }).check();
  await detail.fill("More examples");
  await preview.getByRole("button", { name: "Check preview answer" }).click();
  await expect(preview.getByRole("status")).toHaveText(
    "Preview answer checked",
  );
  expect(
    sql(
      "SELECT draft->'pages'->0->'questions'->1->'visibleWhen'->>'optionCode' FROM public.surveys WHERE title = 'Conditional preview fixture'",
    ),
  ).toBe("option_2");
  expect(
    sql(
      "SELECT count(*) FROM public.survey_versions v JOIN public.surveys s ON s.id = v.survey_id WHERE s.title = 'Conditional preview fixture'",
    ),
  ).toBe("0");
});
