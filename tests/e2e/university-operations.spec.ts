import { expect, test, type Page } from "@playwright/test";
import { event, operationsFixture } from "../fixtures/operations.ts";
import { surveyFixture } from "../fixtures/survey.ts";

test("University sign-in respects the existing operations role on the admin page", async ({
  page,
  browser,
}) => {
  const fixture = surveyFixture();
  const ops = operationsFixture(fixture);
  const creator = fixture.sql(
    `SELECT user_id FROM public.workspace_memberships WHERE workspace_id = '${fixture.workspace}'`,
  );
  fixture.sql(`INSERT INTO public.institutional_principal_bindings (issuer, subject, user_id) VALUES
      ('http://oidc-simulator:3002', 'operations-viewer', '${ops.viewer}'),
      ('http://oidc-simulator:3002', 'survey-creator', '${creator}')`);
  const created = await page.request.post("/api/v1/admin/incidents", {
    headers: { Authorization: "Bearer " + ops.operatorToken },
    data: event,
  });
  expect(created.status()).toBe(201);
  const { id, recordedAt } = await created.json();

  async function signIn(target: Page, account: string) {
    await target.goto("/admin");
    await expect(
      target.getByRole("heading", { name: "Service health" }),
    ).toHaveCount(0);
    await target
      .getByRole("link", { name: "Sign in with University account" })
      .click();
    await target.getByRole("button", { name: account, exact: true }).click();
    await expect(target).toHaveURL(/\/admin$/);
  }

  const other = await browser.newContext({
    baseURL: new URL(created.url()).origin,
  });
  try {
    const creatorPage = await other.newPage();
    await signIn(creatorPage, "survey-creator");
    await expect(creatorPage.getByRole("alert")).toHaveText(
      "You do not have permission to access operations",
    );
    await expect(
      creatorPage.getByRole("heading", { name: "Service health" }),
    ).toHaveCount(0);
    expect(
      (await creatorPage.request.get("/api/v1/admin/health")).status(),
    ).toBe(403);
    expect(
      (await creatorPage.request.get("/api/v1/admin/incidents")).status(),
    ).toBe(403);
  } finally {
    await other.close();
  }

  await signIn(page, "operations-viewer");
  await expect(
    page.getByRole("heading", { name: "Service health" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("row", { name: /database\s+detected\s+advisory/i })
      .filter({ has: page.locator('time[datetime="' + recordedAt + '"]') }),
  ).toBeVisible();
  const allowed = await page.request.get("/api/v1/admin/incidents");
  expect(allowed.status()).toBe(200);
  const incidents = (await allowed.json()) as { id: string }[];
  expect(incidents.find((record) => record.id === id)).toEqual({
    id,
    ...event,
    recordedAt,
  });
  const denied = await page.request.post("/api/v1/admin/incidents", {
    headers: { Origin: new URL(page.url()).origin },
    data: event,
  });
  expect(denied.status()).toBe(403);
  const cookie = (await page.context().cookies()).find(
    (item) => item.name === "__Host-helpinsights-session",
  );
  expect(cookie).toBeDefined();
  fixture.sql(
    "DELETE FROM public.platform_operations_memberships WHERE user_id = '" +
      ops.viewer +
      "'",
  );
  expect((await page.request.get("/api/v1/admin/health")).status()).toBe(403);
  await page.reload();
  await expect(page.getByRole("alert")).toHaveText(
    "You do not have permission to access operations",
  );
  await expect(
    page.getByRole("heading", { name: "Service health" }),
  ).toHaveCount(0);
  fixture.sql(
    "INSERT INTO public.platform_operations_memberships (user_id, role) VALUES ('" +
      ops.viewer +
      "', 'viewer')",
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Service health" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(
    page.getByRole("link", { name: "Sign in with University account" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Service health" }),
  ).toHaveCount(0);
  expect((await page.request.get("/api/v1/admin/health")).status()).toBe(401);
  const replay = await page.request.get("/api/v1/admin/health", {
    headers: { Authorization: "Bearer " + cookie!.value },
  });
  expect(replay.status()).toBe(401);
});
