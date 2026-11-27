import { expect, test, type Locator, type Page } from "@playwright/test";
import { surveyFixture } from "../fixtures/survey.ts";

async function reach(page: Page, locator: Locator) {
  for (let count = 0; count < 50; count++) {
    if (await locator.evaluate((element) => element === document.activeElement))
      return;
    await page.keyboard.press("Tab");
  }
  await expect(locator).toBeFocused();
}

async function openWorkspace(page: Page, token: string) {
  await page.goto("/");
  await page.getByLabel("Development session token").fill(token);
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Create survey" }),
  ).toBeVisible();
}

async function keyboardActivate(page: Page, locator: Locator) {
  await reach(page, locator);
  await page.keyboard.press("Enter");
}

test("a keyboard creator publishes five guided feedback questions without saving preview answers", async ({
  page,
  browser,
}) => {
  const { sql, workspace, retentionPolicy, ownerToken } = surveyFixture();
  await openWorkspace(page, ownerToken);
  const guided = page.getByRole("button", { name: "After-class feedback" });
  await expect(guided).toBeVisible();
  const simpleTitle = page.getByLabel("Survey title", { exact: true });
  await reach(page, simpleTitle);
  await page.keyboard.insertText("Unsaved simple fixture");
  await keyboardActivate(page, guided);

  const title = page.getByLabel("Feedback survey title", { exact: true });
  await expect(title).toBeFocused();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText("Guided after-class fixture");
  const prompt = page.getByLabel("Prompt 1", { exact: true });
  await page.keyboard.press("Tab");
  await expect(prompt).toBeFocused();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText("How clear was the synthetic class?");
  await page.keyboard.press("Tab");
  await expect(
    page.getByLabel("Choice 1", { exact: true }).first(),
  ).toBeFocused();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText("Very clear");
  await keyboardActivate(
    page,
    page.getByRole("button", { name: "Back to simple creation" }),
  );
  await expect(guided).toBeFocused();
  await expect(simpleTitle).toHaveValue("Unsaved simple fixture");
  await page.keyboard.press("Enter");
  await expect(title).toHaveValue("Guided after-class fixture");
  await expect(prompt).toHaveValue("How clear was the synthetic class?");
  await expect(
    page.getByText("Anyone with the link can answer anonymously."),
  ).toBeVisible();
  await expect(
    page.getByText("Responses follow this workspace’s retention policy."),
  ).toBeVisible();

  const save = page.getByRole("button", { name: "Save draft" });
  const publish = page.getByRole("button", { name: "Publish survey" });
  const previewButton = page.getByRole("button", { name: "Preview draft" });
  await expect(publish).toBeDisabled();
  await keyboardActivate(page, save);
  await expect(page.getByRole("status")).toHaveText("Draft saved");
  await expect(
    page.getByRole("button", { name: "Back to simple creation" }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Workspace")).toBeDisabled();

  await keyboardActivate(page, previewButton);
  const preview = page.getByRole("region", { name: "Draft preview" });
  await expect(
    preview.getByRole("heading", { name: "Guided after-class fixture" }),
  ).toBeFocused();
  await expect(preview.getByRole("group")).toHaveCount(3);
  await expect(preview.getByRole("textbox")).toHaveCount(2);
  for (const answer of ["Very clear", "About right", "Enough practice"]) {
    const radio = preview.getByRole("radio", { name: answer, exact: true });
    await reach(page, radio);
    await page.keyboard.press("Space");
    await expect(radio).toBeChecked();
  }
  await keyboardActivate(
    page,
    preview.getByRole("button", { name: "Check preview answer" }),
  );
  await expect(preview.getByRole("status")).toHaveText(
    "Preview answer checked",
  );
  expect(
    sql(`
    SELECT s.status, s.privacy_mode, s.workspace_id, s.retention_policy_id,
      jsonb_array_length(s.draft->'pages'->0->'questions'),
      (SELECT count(*) FROM public.survey_versions v WHERE v.survey_id = s.id),
      (SELECT count(*) FROM public.responses r JOIN public.survey_versions v
        ON v.id = r.survey_version_id WHERE v.survey_id = s.id)
    FROM public.surveys s WHERE s.title = 'Guided after-class fixture'
  `),
  ).toBe(`draft|anonymous|${workspace}|${retentionPolicy}|5|0|0`);
  await keyboardActivate(
    page,
    preview.getByRole("button", { name: "Close preview" }),
  );
  await expect(previewButton).toBeFocused();

  await keyboardActivate(page, publish);
  const link = page.getByRole("link", { name: "Open respondent link" });
  await expect(link).toBeVisible();
  const href = new URL((await link.getAttribute("href"))!, page.url()).href;
  const anonymous = await browser.newContext();
  try {
    const respondent = await anonymous.newPage();
    await respondent.goto(href);
    await expect(
      respondent.getByRole("heading", { name: "Guided after-class fixture" }),
    ).toBeVisible();
    for (const answer of ["Very clear", "About right", "Enough practice"]) {
      await respondent
        .getByRole("radio", { name: answer, exact: true })
        .check();
    }
    await respondent.getByLabel("What helped you learn?").fill("The example.");
    await respondent
      .getByLabel("What could we improve next class?")
      .fill("More time.");
    await respondent.getByRole("button", { name: "Submit response" }).click();
    await expect(respondent.getByRole("status")).toHaveText(
      "Response submitted",
    );

    await prompt.fill("A private draft change after publication");
    await expect(publish).toBeDisabled();
    await save.click();
    await expect(page.getByRole("status")).toHaveText("Draft saved");
    await respondent.reload();
    await expect(
      respondent.getByText("How clear was the synthetic class?", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(
      respondent.getByText("A private draft change after publication"),
    ).toHaveCount(0);
  } finally {
    await anonymous.close();
  }

  expect(
    sql(`
    SELECT v.version, jsonb_array_length(r.answers),
      r.answers->0->>'value', r.answers->1->>'value', r.answers->2->>'value',
      r.answers->3->>'value', r.answers->4->>'value'
    FROM public.responses r JOIN public.survey_versions v ON v.id = r.survey_version_id
    JOIN public.surveys s ON s.id = v.survey_id
    WHERE s.title = 'Guided after-class fixture'
  `),
  ).toBe("1|5|clear|about_right|enough|The example.|More time.");
});

test("guided publication refuses a superseded preview revision", async ({
  page,
}) => {
  const { sql, ownerToken } = surveyFixture();
  await openWorkspace(page, ownerToken);
  const guided = page.getByRole("button", { name: "After-class feedback" });
  await expect(guided).toBeVisible();
  await guided.click();
  await page
    .getByLabel("Feedback survey title")
    .fill("Guided revision fixture");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("status")).toHaveText("Draft saved");

  const previewButton = page.getByRole("button", { name: "Preview draft" });
  const publish = page.getByRole("button", { name: "Publish survey" });
  await page
    .getByLabel("Prompt 1", { exact: true })
    .fill("Local unsaved prompt");
  await expect(publish).toBeDisabled();
  await previewButton.click();
  const preview = page.getByRole("region", { name: "Draft preview" });
  await expect(preview.getByText("Local unsaved prompt")).toHaveCount(0);
  await preview.getByRole("button", { name: "Close preview" }).click();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(publish).toBeEnabled();

  const id = sql(
    "SELECT id FROM public.surveys WHERE title = 'Guided revision fixture'",
  );
  const path = "/api/v1/surveys/" + id;
  const auth = { Authorization: "Bearer " + ownerToken };
  const draft = await page.request.get(path, { headers: auth });
  expect(draft.ok()).toBeTruthy();
  const { draft: definition } = await draft.json();
  definition.pages[0].questions[0].title = "A concurrent creator change";
  const updated = await page.request.put(path + "/draft", {
    headers: { ...auth, "If-Match": draft.headers().etag },
    data: definition,
  });
  expect(updated.ok()).toBeTruthy();
  await publish.click();
  await expect(page.getByRole("alert")).toHaveText(
    "The draft or survey state changed",
  );
  await expect(
    page.getByRole("link", { name: "Open respondent link" }),
  ).toHaveCount(0);
  await expect(previewButton).toBeEnabled();
  expect(
    sql(`
    SELECT s.status, s.draft->'pages'->0->'questions'->0->>'title',
      (SELECT count(*) FROM public.survey_versions v WHERE v.survey_id = s.id),
      (SELECT count(*) FROM public.distributions d JOIN public.survey_versions v
        ON v.id = d.survey_version_id WHERE v.survey_id = s.id)
    FROM public.surveys s WHERE s.id = '${id}'
  `),
  ).toBe("draft|A concurrent creator change|0|0");
});
