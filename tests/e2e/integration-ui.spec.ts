import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { surveyFixture } from "../fixtures/survey.ts";

test("the system administrator registers, renews and revokes a synthetic integration from settings", async ({
  page,
  browser,
  baseURL,
}) => {
  const { sql, workspace, outside } = surveyFixture();
  const admin = randomUUID();
  const creator = sql(
    `SELECT user_id FROM public.workspace_memberships WHERE workspace_id = '${workspace}' AND role = 'owner'`,
  );
  sql(`
    INSERT INTO public.users (id, display_name) VALUES ('${admin}', 'Synthetic integration settings administrator');
    INSERT INTO public.system_administrators VALUES ('${admin}');
    INSERT INTO public.platform_operations_memberships VALUES ('${creator}', 'operator');
    INSERT INTO public.institutional_principal_bindings (issuer, subject, user_id) VALUES
      ('http://oidc-simulator:3002', 'integration-admin', '${admin}'),
      ('http://oidc-simulator:3002', 'integration-creator', '${creator}');
  `);
  async function signIn(target: Page, subject: string) {
    await target.goto("/admin/settings");
    await target
      .getByRole("link", { name: "Sign in with University account" })
      .click();
    await target.getByRole("button", { name: subject, exact: true }).click();
    await expect(target).toHaveURL(/\/admin\/settings$/);
  }
  const creatorContext = await browser.newContext({ baseURL });
  try {
    const creatorPage = await creatorContext.newPage();
    await signIn(creatorPage, "integration-creator");
    await expect(creatorPage.getByRole("alert")).toHaveText(
      "System administrator access is required",
    );
    await expect(
      creatorPage.getByRole("region", { name: "Integration clients" }),
    ).toHaveCount(0);
  } finally {
    await creatorContext.close();
  }
  await signIn(page, "integration-admin");
  const section = page.getByRole("region", { name: "Integration clients" });
  await section
    .getByText("Register an integration client", { exact: true })
    .click();
  await section
    .getByLabel("Client name")
    .fill("Synthetic department dashboard");
  await section.getByLabel("Owning department").fill("Synthetic department");
  await section
    .getByLabel("Integration purpose")
    .fill("Read the assigned workspace name");
  await section.getByLabel("Credential owner").fill("Synthetic service desk");
  await section.getByLabel("Workspace scope ID").fill(workspace);
  await section.getByRole("checkbox", { name: "Read workspace name" }).check();
  await section.getByRole("button", { name: "Register client" }).click();
  await expect(section.getByRole("status")).toHaveText(
    "Integration client registered",
  );
  const credential = section.getByLabel("Integration credential");
  const first = await credential.inputValue();
  expect(first).toMatch(/^hi_client_[A-Za-z0-9_-]{43}$/);
  await page.getByLabel("Creator tool").selectOption("research-consent");
  await expect(page.getByLabel("Tool availability")).toHaveValue("university");
  await expect(credential).toHaveValue(first);
  const read = (token: string, id = workspace) =>
    page.request.get("/api/v1/integrations/workspaces/" + id, {
      headers: { Authorization: "Bearer " + token },
    });
  expect((await read(first)).status()).toBe(401);

  await section.getByRole("button", { name: "Hide credential" }).click();
  await expect(credential).toHaveCount(0);
  await section
    .getByText("Synthetic department dashboard (pending)", { exact: true })
    .click();
  await section.getByRole("button", { name: "Enable client" }).click();
  await expect(section.getByRole("status")).toHaveText(
    "Integration client enabled",
  );
  expect((await read(first)).status()).toBe(200);
  expect((await read(first, outside)).status()).toBe(404);

  await section.getByRole("button", { name: "Renew credential" }).click();
  await expect(section.getByRole("status")).toHaveText(
    "Integration credential replaced",
  );
  const second = await credential.inputValue();
  expect(second).not.toBe(first);
  expect((await read(first)).status()).toBe(401);
  expect((await read(second)).status()).toBe(200);
  await section.getByRole("button", { name: "Revoke client" }).click();
  await expect(section.getByRole("status")).toHaveText(
    "Integration client revoked",
  );
  expect((await read(second)).status()).toBe(401);
  await page.reload();
  await expect(
    section.getByText("Synthetic department dashboard (revoked)", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(credential).toHaveCount(0);
});
