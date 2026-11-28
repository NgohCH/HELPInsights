import { expect, test, type Locator, type Page } from "@playwright/test";
import type { SurveyDefinition } from "../../packages/survey-runtime/definition.ts";
import { surveyFixture } from "../fixtures/survey.ts";

const definition: SurveyDefinition = {
  schemaVersion: "1",
  title: "Pointer workshop",
  description: "Synthetic workshop notes",
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
          id: "sessions",
          code: "workshop_sessions",
          title: "How many sessions?",
          type: "number",
          required: true,
        },
      ],
    },
    {
      id: "follow_up",
      title: "Follow-up",
      questions: [
        {
          id: "reason",
          code: "workshop_reason",
          title: "Tell us why you chose",
          type: "short_text",
          required: false,
          titleAnswerSourceId: "timing",
        },
      ],
    },
  ],
};

async function openSavedDraft(page: Page) {
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
  const publication = await page.request.post(endpoint + "/publish", {
    headers: { ...headers, "If-Match": original.headers().etag },
  });
  expect(publication.status()).toBe(201);

  await page.goto("/");
  await page.getByLabel("Development session token").fill(ownerToken);
  await page.getByRole("button", { name: "Open workspace" }).click();
  const loaded = page.waitForResponse(
    (response) =>
      response.url().endsWith(endpoint) &&
      response.request().method() === "GET",
  );
  await page
    .getByRole("region", { name: "Workspace surveys" })
    .getByRole("button", { name: "Open Pointer workshop" })
    .click();
  const etag = (await loaded).headers().etag;
  expect(etag).toBe(original.headers().etag);
  expect(etag).toBeTruthy();

  const editor = page.getByRole("region", { name: "Saved survey details" });
  await editor.getByRole("button", { name: "Edit saved draft" }).click();
  return {
    editor,
    endpoint,
    etag,
    stored: () =>
      JSON.parse(
        sql(
          "SELECT json_build_object('draft', draft, 'revision', draft_revision) FROM public.surveys WHERE id = '" +
            id +
            "'",
        ),
      ) as { draft: SurveyDefinition; revision: number },
    published: () =>
      JSON.parse(
        sql(
          "SELECT json_agg(definition ORDER BY version) FROM public.survey_versions WHERE survey_id = '" +
            id +
            "'",
        ),
      ) as SurveyDefinition[],
  };
}

async function drag(page: Page, source: Locator, target: Locator) {
  await source.scrollIntoViewIfNeeded();
  const from = await source.boundingBox();
  if (!from) throw new Error("Drag handle has no visible bounds");
  const x = from.x + from.width / 2;
  const y = from.y + from.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  try {
    // Start the native drag before scrolling a distant drop position into view.
    await page.mouse.move(x + 12, y, { steps: 4 });
    await target.scrollIntoViewIfNeeded();
    const to = await target.boundingBox();
    if (!to) throw new Error("Drop position has no visible bounds");
    const targetX = to.x + to.width / 2;
    const targetY = to.y + to.height / 2;
    await page.mouse.move(targetX, targetY, { steps: 12 });
    await page.mouse.move(targetX + 1, targetY);
    await expect(target).toHaveAttribute("data-active", "true");
  } finally {
    await page.mouse.up();
  }
}

test.describe("desktop pointer editing", () => {
  test.use({ viewport: { width: 1366, height: 1000 } });

  test("dragging pages and questions updates only the explicitly saved draft", async ({
    page,
  }) => {
    const { editor, endpoint, etag, stored, published } =
      await openSavedDraft(page);
    const before = stored();
    expect(before.draft).toEqual(definition);
    const feedback = editor.getByRole("group", {
      name: "Feedback",
      exact: true,
    });
    const attendance = editor.getByRole("group", {
      name: "Attendance",
      exact: true,
    });
    const sessions = attendance.getByRole("group", {
      name: "Question 2",
      exact: true,
    });
    const announcement = editor.locator('[aria-live="polite"]');

    await sessions
      .getByLabel("Question wording")
      .fill("How many sessions joined?");
    const handle = sessions.getByText("Drag question", { exact: true });
    await expect(handle).toBeVisible({ timeout: 3_000 });
    await drag(page, handle, editor.getByTestId("drop-questions-end-feedback"));
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
    await drag(
      page,
      appended.getByText("Drag question", { exact: true }),
      editor.getByTestId("drop-question-before-timing"),
    );
    await expect(announcement).toHaveText(
      "Question moved to Feedback (page 1), position 1.",
    );
    await drag(
      page,
      attendance.getByText("Drag page", { exact: true }),
      editor.getByTestId("drop-pages-end"),
    );
    await expect(announcement).toHaveText(
      "Attendance moved to page position 3.",
    );
    await expect(attendance.getByLabel("Page title")).toBeFocused();
    expect(stored()).toEqual(before);
    expect(published()).toEqual([definition]);

    const saving = page.waitForResponse(
      (response) =>
        response.url().endsWith(endpoint + "/draft") &&
        response.request().method() === "PUT",
    );
    await editor
      .getByRole("button", { name: "Save edits", exact: true })
      .click();
    const saved = await saving;
    expect(saved.status()).toBe(200);
    expect((await saved.request().allHeaders())["if-match"]).toBe(etag);
    const [originalFeedback, originalAttendance, followUp] = definition.pages;
    expect(stored()).toEqual({
      revision: before.revision + 1,
      draft: {
        ...definition,
        pages: [
          {
            ...originalFeedback,
            questions: [
              {
                ...originalAttendance.questions[1],
                title: "How many sessions joined?",
              },
              originalFeedback.questions[0],
            ],
          },
          followUp,
          {
            ...originalAttendance,
            questions: [originalAttendance.questions[0]],
          },
        ],
      },
    });
    expect(published()).toEqual([definition]);

    await editor.getByRole("button", { name: "Reload saved survey" }).click();
    await editor.getByRole("button", { name: "Edit saved draft" }).click();
    await expect(editor.getByLabel("Page title").first()).toHaveValue(
      "Feedback",
    );
    await expect(editor.getByLabel("Page title").nth(1)).toHaveValue(
      "Follow-up",
    );
    await expect(editor.getByLabel("Page title").nth(2)).toHaveValue(
      "Attendance",
    );
    await expect(feedback.getByLabel("Question wording").first()).toHaveValue(
      "How many sessions joined?",
    );
  });

  test("invalid pointer moves preserve visibility and title answer dependencies", async ({
    page,
  }) => {
    const { editor, stored } = await openSavedDraft(page);
    const before = stored();
    const feedback = editor.getByRole("group", {
      name: "Feedback",
      exact: true,
    });
    const followUp = editor.getByRole("group", {
      name: "Follow-up",
      exact: true,
    });
    const handle = feedback.getByText("Drag question", { exact: true });

    await expect(handle).toBeVisible({ timeout: 3_000 });
    await drag(
      page,
      handle,
      editor.getByTestId("drop-questions-end-attendance"),
    );
    await expect(editor.getByRole("alert")).toContainText(
      /Visibility requires an earlier unconditional choice/i,
    );
    await expect(feedback.getByLabel("Question wording")).toHaveValue(
      "How was the timing?",
    );
    await drag(
      page,
      followUp.getByText("Drag page", { exact: true }),
      editor.getByTestId("drop-page-before-feedback"),
    );
    await expect(editor.getByRole("alert")).toContainText(
      /An answer label requires an earlier unconditional single-choice question/i,
    );
    await expect(editor.getByLabel("Page title").first()).toHaveValue(
      "Feedback",
    );
    expect(stored()).toEqual(before);
    await editor
      .getByRole("button", { name: "Save edits", exact: true })
      .click();
    await expect(
      editor.getByRole("button", { name: "Edit saved draft" }),
    ).toBeVisible();
    expect(stored()).toEqual({ ...before, revision: before.revision + 1 });
  });
});

test.describe("touch-equivalent editing", () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 412, height: 915 },
  });

  test("touch users can move a question and a page with the existing controls", async ({
    page,
  }) => {
    const { editor, stored } = await openSavedDraft(page);
    const before = stored();
    const attendance = editor.getByRole("group", {
      name: "Attendance",
      exact: true,
    });
    const sessions = attendance.getByRole("group", {
      name: "Question 2",
      exact: true,
    });
    await sessions.getByLabel("Destination page").selectOption("feedback");
    await sessions
      .getByRole("button", { name: "Move to page", exact: true })
      .tap();
    const feedback = editor.getByRole("group", {
      name: "Feedback",
      exact: true,
    });
    await expect(feedback.getByLabel("Question wording").nth(1)).toHaveValue(
      "How many sessions?",
    );
    await feedback
      .getByRole("group", { name: "Question 2", exact: true })
      .getByRole("button", { name: "Move question up", exact: true })
      .tap();
    await expect(feedback.getByLabel("Question wording").first()).toHaveValue(
      "How many sessions?",
    );
    await attendance
      .getByRole("button", { name: "Move page down", exact: true })
      .tap();
    await expect(editor.getByLabel("Page title").nth(1)).toHaveValue(
      "Follow-up",
    );
    expect(stored()).toEqual(before);
  });
});
