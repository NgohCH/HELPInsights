import { expect, test, type Locator, type Page } from "@playwright/test";
import { surveyFixture } from "../fixtures/survey.ts";
import {
  choiceFollowUpTitle,
  firstLabel,
  followUpTitle,
  pipingDraft,
  secondLabel,
  withPiping,
} from "../fixtures/answer-piping.ts";

async function checkTitlePiping(form: Locator | Page) {
  await expect(form.getByLabel(followUpTitle, { exact: true })).toBeVisible();
  await expect(
    form.getByRole("group", {
      name: choiceFollowUpTitle + " Required",
      exact: true,
    }),
  ).toBeVisible();
  await form.getByRole("radio", { name: firstLabel, exact: true }).check();
  await expect(
    form.getByLabel(followUpTitle + " — " + firstLabel, { exact: true }),
  ).toBeVisible();
  const firstChoiceGroup = form.getByRole("group", {
    name: choiceFollowUpTitle + " — " + firstLabel + " Required",
    exact: true,
  });
  await expect(firstChoiceGroup).toBeVisible();
  await expect(firstChoiceGroup.locator("legend b")).toHaveCount(0);
  await form.getByRole("radio", { name: secondLabel, exact: true }).check();
  await form
    .getByLabel(followUpTitle + " — " + secondLabel, { exact: true })
    .fill("Practice time");
  await form
    .getByRole("group", {
      name: choiceFollowUpTitle + " — " + secondLabel + " Required",
      exact: true,
    })
    .getByRole("radio", { name: "Yes", exact: true })
    .check();
}

test("an authored answer label is plain text in saved preview and public collection", async ({
  page,
  browser,
  baseURL,
}) => {
  const { workspace, ownerToken, retentionPolicy, sql } = surveyFixture();
  const headers = { Authorization: "Bearer " + ownerToken };
  const created = await page.request.post("/api/v1/surveys", {
    headers,
    data: {
      workspaceId: workspace,
      retentionPolicyId: retentionPolicy,
      title: pipingDraft.title,
      privacyMode: "anonymous",
    },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  const endpoint = "/api/v1/surveys/" + id;
  const saved = await page.request.put(endpoint + "/draft", {
    headers: { ...headers, "If-Match": created.headers().etag },
    data: pipingDraft,
  });
  expect(saved.status()).toBe(200);

  await page.goto("/");
  await page.getByLabel("Development session token").fill(ownerToken);
  await page.getByRole("button", { name: "Open workspace" }).click();
  const list = page.getByRole("region", { name: "Workspace surveys" });
  await list.getByRole("button", { name: "Open " + pipingDraft.title }).click();
  const details = list.getByRole("region", { name: "Saved survey details" });
  const edit = details.getByRole("button", { name: "Edit saved draft" });
  await edit.click();
  const feedback = details.getByRole("group", {
    name: "Workshop feedback",
    exact: true,
  });
  const sourceSelect = feedback.getByLabel("Append answer label from");
  const sourceButtons = feedback.getByRole("button", {
    name: "Edit answer label source",
    exact: true,
  });
  const firstSource = sourceButtons.first();
  const secondSource = sourceButtons.nth(1);
  await expect(sourceSelect).toHaveCount(0);
  await firstSource.press("Enter");
  await expect(firstSource).toHaveAttribute("aria-expanded", "true");
  await sourceSelect.selectOption("session", { timeout: 5_000 });
  await secondSource.press("Enter");
  await expect(firstSource).toHaveAttribute("aria-expanded", "false");
  await expect(sourceSelect).toHaveCount(1);
  await expect(
    feedback.getByText("Using Page 1, question 1", { exact: false }),
  ).toBeVisible();
  await sourceSelect.selectOption("session");

  const workshop = details.getByRole("group", {
    name: "Past workshops",
    exact: true,
  });
  await workshop
    .getByRole("button", { name: "Move page down", exact: true })
    .click();
  await expect(details.getByRole("alert")).toContainText(
    /answer label.*earlier unconditional single-choice/i,
  );
  await details.getByRole("button", { name: "Save edits" }).click();
  await expect(edit).toBeVisible();
  const readDraft = () =>
    JSON.parse(sql("SELECT draft FROM public.surveys WHERE id = '" + id + "'"));
  expect(readDraft()).toEqual(withPiping());

  await details.getByRole("button", { name: "Reload saved survey" }).click();
  await edit.click();
  await expect(sourceSelect).toHaveCount(0);
  await expect(
    feedback.getByText("Using Page 1, question 1", { exact: false }),
  ).toHaveCount(2);
  await secondSource.press("Enter");
  await expect(sourceSelect).toHaveValue("session");
  await firstSource.press("Enter");
  await expect(sourceSelect).toHaveValue("session");
  await sourceSelect.selectOption("");
  await details.getByRole("button", { name: "Cancel edits" }).click();

  await details.getByRole("button", { name: "Preview saved draft" }).click();
  const preview = details.getByRole("region", { name: "Draft preview" });
  await checkTitlePiping(preview);
  await preview.getByRole("button", { name: "Check preview answer" }).click();
  await expect(preview.getByRole("status")).toHaveText(
    "Preview answer checked",
  );
  expect(
    sql(
      "SELECT count(*) FROM public.survey_versions WHERE survey_id = '" +
        id +
        "'",
    ),
  ).toBe("0");
  expect(readDraft()).toEqual(withPiping());
  await preview.getByRole("button", { name: "Close preview" }).click();

  await details.getByRole("button", { name: "Publish saved draft" }).click();
  await details
    .getByRole("combobox", { name: "Audience", exact: true })
    .selectOption("open");
  await details.getByRole("button", { name: "Publish version" }).click();
  const link = details.getByRole("link", { name: "Open new respondent link" });
  await expect(link).toBeVisible();
  const respondentPath = (await link.getAttribute("href"))!;
  const respondent = await browser.newPage({
    baseURL,
    viewport: { width: 390, height: 800 },
  });
  try {
    await respondent.goto(respondentPath);
    await checkTitlePiping(respondent);
    await respondent.getByRole("button", { name: "Submit response" }).click();
    await expect(respondent.getByRole("status")).toHaveText(
      "Response submitted",
    );
  } finally {
    await respondent.close();
  }

  expect(
    JSON.parse(
      sql(
        "SELECT definition FROM public.survey_versions WHERE survey_id = '" +
          id +
          "'",
      ),
    ),
  ).toEqual(withPiping());
  const answers = sql(
    "SELECT r.answers FROM public.responses r JOIN public.survey_versions v ON r.survey_version_id = v.id WHERE v.survey_id = '" +
      id +
      "'",
  );
  expect(JSON.parse(answers)).toEqual([
    { questionId: "session", value: "session_c" },
    { questionId: "improvement", value: "Practice time" },
    { questionId: "attend_again", value: "yes" },
  ]);
});

test("hiding a piped question clears its answer from public collection", async ({
  page,
}) => {
  const { workspace, ownerToken, retentionPolicy, sql } = surveyFixture();
  const headers = { Authorization: "Bearer " + ownerToken };
  const piped = withPiping();
  const [workshop, feedback] = piped.pages;
  const [improvement, attendAgain] = feedback.questions;
  const definition = {
    ...piped,
    pages: [
      workshop,
      {
        ...feedback,
        questions: [
          {
            ...improvement,
            visibleWhen: { questionId: "session", optionCode: "session_a" },
          },
          attendAgain,
        ],
      },
    ],
  };
  const created = await page.request.post("/api/v1/surveys", {
    headers,
    data: {
      workspaceId: workspace,
      retentionPolicyId: retentionPolicy,
      title: definition.title,
      privacyMode: "anonymous",
    },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  const endpoint = "/api/v1/surveys/" + id;
  const saved = await page.request.put(endpoint + "/draft", {
    headers: { ...headers, "If-Match": created.headers().etag },
    data: definition,
  });
  expect(saved.status()).toBe(200);
  const published = await page.request.post(endpoint + "/publish", {
    headers: { ...headers, "If-Match": saved.headers().etag },
    data: { eligibilityMode: "open" },
  });
  expect(published.status()).toBe(201);
  const version = await published.json();
  await page.goto("/respond/" + version.publicToken);

  const first = page.getByRole("radio", { name: firstLabel, exact: true });
  const second = page.getByRole("radio", { name: secondLabel, exact: true });
  const improvementField = page.getByRole("textbox", {
    name: /^Which part should we improve\?/,
  });
  await expect(improvementField).toHaveCount(0);
  await first.check();
  await expect(improvementField).toHaveAccessibleName(
    followUpTitle + " — " + firstLabel,
  );
  await improvementField.fill("Discard this when hidden");
  await second.check();
  await expect(improvementField).toHaveCount(0);
  await first.check();
  await expect(improvementField).toHaveValue("");

  await improvementField.fill("Also discard this on submission");
  await second.check();
  await page.getByRole("radio", { name: "Yes", exact: true }).check();
  await page.getByRole("button", { name: "Submit response" }).click();
  await expect(page.getByRole("status")).toHaveText("Response submitted");

  const answers = sql(
    "SELECT answers FROM public.responses WHERE survey_version_id = '" +
      version.id +
      "'",
  );
  expect(JSON.parse(answers)).toEqual([
    { questionId: "session", value: "session_c" },
    { questionId: "attend_again", value: "yes" },
  ]);
});
