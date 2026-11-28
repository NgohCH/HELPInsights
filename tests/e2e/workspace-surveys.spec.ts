import { expect, test } from "@playwright/test";
import { surveyFixture } from "../fixtures/survey.ts";

const savedDraft = {
  schemaVersion: "1",
  title: "Saved workshop draft",
  description: "Workshop notes for the next facilitator.",
  pages: [
    {
      id: "feedback",
      title: "Workshop feedback",
      questions: [
        {
          id: "timing",
          code: "workshop_timing",
          type: "single_choice",
          title: "How was the timing?",
          required: true,
          options: [
            { code: "too_short", label: "Too short" },
            { code: "about_right", label: "About right" },
            { code: "too_long", label: "Too long" },
          ],
        },
        {
          id: "adjustment",
          code: "suggested_adjustment",
          type: "short_text",
          title: "What would you change?",
          required: false,
          visibleWhen: { questionId: "timing", optionCode: "too_short" },
        },
      ],
    },
    {
      id: "attendance",
      title: "Workshop attendance",
      questions: [
        {
          id: "session_count",
          code: "workshop_sessions",
          type: "number",
          title: "How many sessions did you attend?",
          required: false,
        },
      ],
    },
  ],
};

test("a reopened survey edits saved wording without changing its schema or published versions", async ({
  page,
}) => {
  const { workspace, ownerToken, retentionPolicy, sql } = surveyFixture();
  const headers = { Authorization: "Bearer " + ownerToken };
  const created = await page.request.post("/api/v1/surveys", {
    headers,
    data: {
      workspaceId: workspace,
      retentionPolicyId: retentionPolicy,
      title: savedDraft.title,
      privacyMode: "anonymous",
    },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  const endpoint = "/api/v1/surveys/" + id;
  const saved = await page.request.put(endpoint + "/draft", {
    headers: { ...headers, "If-Match": created.headers().etag },
    data: savedDraft,
  });
  expect(saved.status()).toBe(200);
  const published = await page.request.post(endpoint + "/publish", {
    headers: { ...headers, "If-Match": saved.headers().etag },
  });
  expect(published.status()).toBe(201);

  await page.goto("/");
  await page.getByLabel("Development session token").fill(ownerToken);
  await page.getByRole("button", { name: "Open workspace" }).click();
  const list = page.getByRole("region", { name: "Workspace surveys" });
  await list
    .getByRole("button", { name: "Open Saved workshop draft" })
    .click({ timeout: 5_000 });
  const details = list.getByRole("region", { name: "Saved survey details" });
  await expect(details.getByText("Version 1")).toBeVisible();
  await details.getByRole("button", { name: "View results" }).click();
  await expect(details.getByText("0 responses", { exact: true })).toBeVisible();

  await details.getByRole("button", { name: "Preview saved draft" }).click();
  const preview = list.getByRole("region", { name: "Draft preview" });
  const adjustment = preview.getByRole("textbox", {
    name: "What would you change?",
  });
  await expect(adjustment).toHaveCount(0);
  await preview.getByRole("radio", { name: "Too short" }).check();
  await expect(adjustment).toBeVisible();
  await expect(
    preview.getByText("How many sessions did you attend?"),
  ).toBeVisible();
  await preview.getByRole("button", { name: "Close preview" }).click();
  await expect(
    details.getByRole("button", { name: "Preview saved draft" }),
  ).toBeFocused();

  await details.getByRole("button", { name: "Edit saved draft" }).click();
  await details
    .getByLabel("Saved survey title")
    .fill("Updated workshop survey");
  await details.getByLabel("Option 3 wording").fill("Ran long");
  await details.getByRole("button", { name: "Save edits" }).click();
  await expect(
    list.getByRole("button", { name: "Open Updated workshop survey" }),
  ).toBeVisible();
  expect(
    JSON.parse(sql("SELECT draft FROM public.surveys WHERE id = '" + id + "'")),
  ).toEqual({
    ...savedDraft,
    title: "Updated workshop survey",
    pages: [
      {
        ...savedDraft.pages[0],
        questions: [
          {
            ...savedDraft.pages[0].questions[0],
            options: [
              { code: "too_short", label: "Too short" },
              { code: "about_right", label: "About right" },
              { code: "too_long", label: "Ran long" },
            ],
          },
          savedDraft.pages[0].questions[1],
        ],
      },
      savedDraft.pages[1],
    ],
  });
  expect(
    JSON.parse(
      sql(
        "SELECT definition FROM public.survey_versions WHERE survey_id = '" +
          id +
          "'",
      ),
    ),
  ).toEqual(savedDraft);

  await details.getByRole("button", { name: "Edit saved draft" }).click();
  await details.getByLabel("Saved survey title").fill("Stale local title");
  const latest = await page.request.get(endpoint, { headers });
  const concurrent = await page.request.put(endpoint + "/draft", {
    headers: { ...headers, "If-Match": latest.headers().etag },
    data: { ...savedDraft, title: "Concurrent editor title" },
  });
  expect(concurrent.status()).toBe(200);
  await details.getByRole("button", { name: "Save edits" }).click();
  await expect(details.getByRole("alert")).toBeVisible();
  await expect(details.getByLabel("Saved survey title")).toHaveValue(
    "Stale local title",
  );
  expect(sql("SELECT title FROM public.surveys WHERE id = '" + id + "'")).toBe(
    "Concurrent editor title",
  );
});

test("survey details capabilities reflect tenant membership, role, and closure", async ({
  request,
}) => {
  const {
    workspace,
    outside,
    retentionPolicy,
    ownerToken,
    outsiderToken,
    sql,
  } = surveyFixture();
  const owner = { Authorization: "Bearer " + ownerToken };
  const outsider = { Authorization: "Bearer " + outsiderToken };
  const created = await request.post("/api/v1/surveys", {
    headers: owner,
    data: {
      workspaceId: workspace,
      retentionPolicyId: retentionPolicy,
      title: savedDraft.title,
      privacyMode: "anonymous",
    },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  const endpoint = "/api/v1/surveys/" + id;
  expect((await request.get(endpoint, { headers: outsider })).status()).toBe(
    404,
  );

  sql(`
    INSERT INTO public.workspace_memberships (workspace_id, user_id, role)
    SELECT '${workspace}', user_id, 'analyst'
    FROM public.workspace_memberships WHERE workspace_id = '${outside}'
  `);
  const analyst = await request.get(endpoint, { headers: outsider });
  expect(analyst.status()).toBe(200);
  expect(await analyst.json()).toMatchObject({
    canEdit: false,
    canViewResults: true,
  });
  const analystWrite = await request.put(endpoint + "/draft", {
    headers: { ...outsider, "If-Match": analyst.headers().etag },
    data: savedDraft,
  });
  expect(analystWrite.status()).toBe(403);

  sql(`
    UPDATE public.workspace_memberships SET role = 'editor'
    WHERE workspace_id = '${workspace}' AND role = 'analyst'
  `);
  const editor = await request.get(endpoint, { headers: outsider });
  expect(await editor.json()).toMatchObject({
    canEdit: true,
    canViewResults: false,
  });
  const saved = await request.put(endpoint + "/draft", {
    headers: { ...owner, "If-Match": created.headers().etag },
    data: savedDraft,
  });
  expect(saved.status()).toBe(200);
  const published = await request.post(endpoint + "/publish", {
    headers: { ...owner, "If-Match": saved.headers().etag },
  });
  expect(published.status()).toBe(201);
  expect(
    (await request.post(endpoint + "/close", { headers: owner })).status(),
  ).toBe(200);
  const closed = await request.get(endpoint, { headers: owner });
  expect(await closed.json()).toMatchObject({
    status: "closed",
    canEdit: false,
    canViewResults: true,
  });
});
