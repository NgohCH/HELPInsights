import { expect, test } from "@playwright/test";
import { surveyFixture } from "../fixtures/survey.ts";
import type { SurveyDefinition } from "../../packages/survey-runtime/definition.ts";

const definition: SurveyDefinition = {
  schemaVersion: "1",
  title: "Multipage workshop",
  description: "Preserve these workshop notes.",
  pages: [
    {
      id: "feedback",
      title: "Feedback",
      questions: [
        {
          id: "timing",
          code: "workshop_timing",
          title: "How was the timing?",
          type: "single_choice",
          required: true,
          options: [
            { code: "too_short", label: "Too short" },
            { code: "long_enough", label: "Long enough" },
          ],
        },
      ],
    },
    {
      id: "attendance",
      title: "Attendance",
      questions: [
        {
          id: "adjustment",
          code: "workshop_adjustment",
          title: "What would you change?",
          type: "short_text",
          required: false,
          visibleWhen: { questionId: "timing", optionCode: "too_short" },
        },
        {
          id: "attendance_count",
          code: "workshop_attendance",
          title: "How many workshops?",
          type: "number",
          required: true,
        },
      ],
    },
  ],
};

test("a saved draft supports keyboard reordering without breaking its rules or published version", async ({
  page,
}) => {
  const { workspace, ownerToken, retentionPolicy, sql } = surveyFixture();
  const headers = { Authorization: "Bearer " + ownerToken };
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
  const original = await page.request.put(endpoint + "/draft", {
    headers: { ...headers, "If-Match": created.headers().etag },
    data: definition,
  });
  expect(original.status()).toBe(200);
  expect(
    (
      await page.request.post(endpoint + "/publish", {
        headers: { ...headers, "If-Match": original.headers().etag },
      })
    ).status(),
  ).toBe(201);

  await page.goto("/");
  await page.getByLabel("Development session token").fill(ownerToken);
  await page.getByRole("button", { name: "Open workspace" }).click();
  const workspacePanel = page.getByRole("region", {
    name: "Workspace surveys",
  });
  await workspacePanel
    .getByRole("button", { name: "Open Multipage workshop" })
    .click();
  const editor = workspacePanel.getByRole("region", {
    name: "Saved survey details",
  });
  await editor.getByRole("button", { name: "Edit saved draft" }).click();

  const feedback = editor.getByRole("group", { name: "Feedback", exact: true });
  await feedback
    .getByRole("button", { name: "Move page down", exact: true })
    .press("Enter", { timeout: 5_000 });
  await expect(editor.getByRole("alert")).toContainText(/earlier.*choice/i);
  await feedback
    .getByRole("group", { name: "Question 1", exact: true })
    .getByRole("button", { name: "Remove question", exact: true })
    .press("Enter");
  await expect(editor.getByRole("alert")).toContainText(/earlier.*choice/i);
  await expect(feedback.getByLabel("Question wording")).toHaveValue(
    "How was the timing?",
  );

  const attendance = editor.getByRole("group", {
    name: "Attendance",
    exact: true,
  });
  const count = attendance.getByRole("group", {
    name: "Question 2",
    exact: true,
  });
  await count.getByLabel("Question wording").fill("How many sessions joined?");
  await count.getByLabel("Destination page").selectOption("feedback");
  await count
    .getByRole("button", { name: "Move to page", exact: true })
    .press("Enter");
  const announcement = editor.locator('[aria-live="polite"]');
  await expect(announcement).toHaveText(
    "Question moved to Feedback (page 1), position 2.",
  );
  const appended = feedback.getByRole("group", {
    name: "Question 2",
    exact: true,
  });
  await expect(appended.getByLabel("Question wording")).toHaveValue(
    "How many sessions joined?",
  );
  await expect(appended.getByLabel("Question wording")).toBeFocused();
  await appended
    .getByRole("button", { name: "Move question up", exact: true })
    .press("Enter");
  await expect(announcement).toHaveText(
    "Question moved to Feedback (page 1), position 1.",
  );
  const reorderedQuestion = feedback
    .getByRole("group", { name: "Question 1", exact: true })
    .getByLabel("Question wording");
  await expect(reorderedQuestion).toHaveValue("How many sessions joined?");
  await expect(reorderedQuestion).toBeFocused();

  const addPage = editor.getByRole("button", { name: "Add page", exact: true });
  await addPage.press("Enter");
  await editor
    .getByRole("group", { name: "Page 3", exact: true })
    .getByLabel("Page title")
    .fill("Summary");
  const summary = editor.getByRole("group", { name: "Summary", exact: true });
  await summary.getByLabel("Question type to add").selectOption("short_text");
  await summary
    .getByRole("button", { name: "Add question", exact: true })
    .press("Enter");
  await summary.getByLabel("Question wording").fill("Additional notes?");
  await summary
    .getByLabel("Question type to add")
    .selectOption("single_choice");
  await summary
    .getByRole("button", { name: "Add question", exact: true })
    .press("Enter");
  await summary
    .getByRole("group", { name: "Question 2", exact: true })
    .getByRole("button", { name: "Remove question", exact: true })
    .press("Enter");
  await summary
    .getByRole("button", { name: "Move page up", exact: true })
    .press("Enter");
  await expect(announcement).toHaveText("Summary moved to page position 2.");
  await expect(summary.getByLabel("Page title")).toBeFocused();
  await summary
    .getByRole("button", { name: "Move page up", exact: true })
    .press("Enter");
  await expect(announcement).toHaveText("Summary moved to page position 1.");
  await expect(summary.getByLabel("Page title")).toBeFocused();
  await addPage.press("Enter");
  const extra = editor.getByRole("group", { name: "Page 4", exact: true });
  await extra
    .getByRole("button", { name: "Remove page", exact: true })
    .press("Enter");
  await expect(extra).toHaveCount(0);

  await editor
    .getByRole("button", { name: "Save edits", exact: true })
    .press("Enter");
  await expect(
    editor.getByRole("button", { name: "Edit saved draft" }),
  ).toBeVisible();
  const draft: SurveyDefinition = JSON.parse(
    sql("SELECT draft FROM public.surveys WHERE id = '" + id + "'"),
  );
  expect(draft.description).toBe(definition.description);
  expect(draft.pages.map(({ title }) => title)).toEqual([
    "Summary",
    "Feedback",
    "Attendance",
  ]);
  expect(draft.pages[0].questions).toEqual([
    expect.objectContaining({ type: "short_text", title: "Additional notes?" }),
  ]);
  expect(draft.pages[1]).toEqual({
    ...definition.pages[0],
    questions: [
      {
        ...definition.pages[1].questions[1],
        title: "How many sessions joined?",
      },
      definition.pages[0].questions[0],
    ],
  });
  expect(draft.pages[2]).toEqual({
    ...definition.pages[1],
    questions: [definition.pages[1].questions[0]],
  });
  expect(
    JSON.parse(
      sql(
        "SELECT definition FROM public.survey_versions WHERE survey_id = '" +
          id +
          "'",
      ),
    ),
  ).toEqual(definition);

  await editor.getByRole("button", { name: "Reload saved survey" }).click();
  await editor.getByRole("button", { name: "Edit saved draft" }).click();
  await expect(
    editor
      .getByRole("group", { name: "Summary", exact: true })
      .getByLabel("Question wording"),
  ).toHaveValue("Additional notes?");
});
