import { expect, test } from "@playwright/test";
import { surveyFixture } from "../fixtures/survey.ts";

test("university sign-in enforces workspace authoring and preserves anonymous collection", async ({
  page,
  browser,
}) => {
  const { sql, workspace, retentionPolicy, outside } = surveyFixture();
  const owner = sql(
    "SELECT user_id FROM public.workspace_memberships WHERE workspace_id = '" +
      workspace +
      "'",
  );
  const viewer = sql(
    "SELECT user_id FROM public.workspace_memberships WHERE workspace_id = '" +
      outside +
      "'",
  );
  sql(
    "INSERT INTO public.workspace_memberships (workspace_id, user_id, role) VALUES ('" +
      workspace +
      "', '" +
      viewer +
      "', 'viewer')",
  );
  sql(
    "INSERT INTO public.institutional_principal_bindings (issuer, subject, user_id) VALUES ('http://oidc-simulator:3002', 'owner', '" +
      owner +
      "'), ('http://oidc-simulator:3002', 'viewer', '" +
      viewer +
      "')",
  );

  async function signIn(target: typeof page, subject: string) {
    await target.goto("/");
    await target
      .getByRole("link", { name: "Sign in with University account" })
      .click();
    await expect(target).toHaveTitle("Synthetic University");
    expect(new URL(target.url()).hostname).toBe("oidc.helpinsights.test");
    await target.getByRole("button", { name: subject, exact: true }).click();
    await expect(
      target.getByRole("button", { name: "Sign out" }),
    ).toBeVisible();
  }

  expect(
    sql(
      "SELECT has_function_privilege('helpinsights_app', 'public.issue_university_session(text,text,bytea)', 'EXECUTE'), has_function_privilege('helpinsights_identity_login', 'public.issue_university_session(text,text,bytea)', 'EXECUTE'), has_table_privilege('helpinsights_identity_login', 'public.sessions', 'SELECT')",
    ),
  ).toBe("f|t|f");
  for (const reason of [
    "wrong nonce",
    "wrong issuer",
    "wrong tenant",
    "wrong audience",
    "wrong signature",
    "expired",
    "unbound",
  ]) {
    await page.goto("/");
    await page
      .getByRole("link", { name: "Sign in with University account" })
      .click();
    const rejected = page.waitForResponse((response) =>
      response.url().includes("/auth/university/callback?"),
    );
    await page.getByRole("button", { name: reason, exact: true }).click();
    expect((await rejected).status(), reason).toBe(401);
    expect((await page.request.get("/api/v1/me")).status(), reason).toBe(401);
  }

  await signIn(page, "owner");
  const callSurvey = async (
    target: typeof page,
    path: string,
    method: string,
    body?: object,
    etag?: string,
  ) =>
    target.evaluate(
      async ({ path, method, body, etag }) => {
        const res = await fetch("/api/v1/surveys" + path, {
          method,
          headers: {
            ...(body ? { "Content-Type": "application/json" } : {}),
            ...(etag ? { "If-Match": etag } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
        });
        return { status: res.status, body: await res.json() };
      },
      { path, method, body, etag },
    );
  const payload = {
    workspaceId: workspace,
    title: "University workshop",
    privacyMode: "anonymous",
    retentionPolicyId: retentionPolicy,
  };
  await page.getByLabel("Survey title").fill(payload.title);
  await page.getByLabel("Question").fill("How useful was the workshop?");
  await page.getByLabel("Option 1").fill("Useful");
  await page.getByLabel("Option 2").fill("Not useful");
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/surveys") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Save draft" }).click();
  const result = await created;
  expect(result.status()).toBe(201);
  const draft = await result.json();
  await expect(page.getByRole("status")).toHaveText("Draft saved");

  const viewerContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
  });
  try {
    const viewerPage = await viewerContext.newPage();
    await signIn(viewerPage, "viewer");
    expect((await callSurvey(viewerPage, "", "POST", payload)).status).toBe(
      403,
    );
    expect(
      (await callSurvey(viewerPage, "/" + draft.id + "/publish", "POST"))
        .status,
    ).toBe(403);
  } finally {
    await viewerContext.close();
  }

  await page.getByRole("button", { name: "Publish survey" }).click();
  const respondentLink = page.getByRole("link", {
    name: "Open respondent link",
  });
  await expect(respondentLink).toBeVisible();
  const responseUrl = await respondentLink.getAttribute("href");
  expect(responseUrl).toMatch(/^\/respond\/[A-Za-z0-9_-]{43}$/);
  const respondentContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
  });
  try {
    const respondent = await respondentContext.newPage();
    await respondent.goto(responseUrl!);
    await respondent
      .getByRole("radio", { name: "Useful", exact: true })
      .check();
    await respondent.getByRole("button", { name: "Submit response" }).click();
    await expect(respondent.getByRole("status")).toHaveText(
      "Response submitted",
    );
  } finally {
    await respondentContext.close();
  }
  const anonymous = await page.request.get(
    "/api/v1/public/s/" + responseUrl!.split("/").at(-1),
  );
  const { surveyVersionId } = await anonymous.json();
  const live = await page.request.post("/api/v1/live-sessions", {
    data: { quizVersionId: surveyVersionId, mode: "live_poll" },
    headers: { Origin: new URL(page.url()).origin },
  });
  expect(live.status()).toBe(201);
  const unauthorizedPresenter = await browser.newContext({
    baseURL: new URL(page.url()).origin,
  });
  try {
    const guestRoom = await unauthorizedPresenter.request.post(
      "/api/v1/live-sessions",
      {
        data: { quizVersionId: surveyVersionId, mode: "live_poll" },
      },
    );
    expect(guestRoom.status()).toBe(401);
    const viewerPage = await unauthorizedPresenter.newPage();
    await signIn(viewerPage, "viewer");
    const viewerRoom = await viewerPage.request.post("/api/v1/live-sessions", {
      data: { quizVersionId: surveyVersionId, mode: "live_poll" },
      headers: { Origin: new URL(page.url()).origin },
    });
    expect(viewerRoom.status()).toBe(403);
  } finally {
    await unauthorizedPresenter.close();
  }
  const wrongOrigin = await page.request.post("/api/v1/surveys", {
    data: payload,
    headers: { Origin: "https://other.example.test" },
  });
  expect(wrongOrigin.status()).toBe(403);

  const cookie = (await page.context().cookies()).find(
    (item) => item.name === "__Host-helpinsights-session",
  );
  expect(cookie).toMatchObject({
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
  });
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByRole("link", { name: "Sign in with University account" }),
  ).toBeVisible();
  expect(
    (
      await page.request.get("/api/v1/me", {
        headers: { Authorization: "Bearer " + cookie!.value },
      })
    ).status(),
  ).toBe(401);
  await signIn(page, "owner");
  sql(
    "DELETE FROM public.institutional_principal_bindings WHERE issuer = 'http://oidc-simulator:3002' AND subject IN ('owner', 'viewer')",
  );
  expect((await page.request.get("/api/v1/me")).status()).toBe(401);
});
