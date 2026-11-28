import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { researchFixture } from "../fixtures/research-consent.ts";

test("only University creators with the scoped research approval can publish with consent", async ({
  page,
  browser,
  baseURL,
}) => {
  const { sql, prepare, workspace } = researchFixture();
  const author = sql(
    `SELECT user_id FROM public.workspace_memberships WHERE workspace_id = '${workspace}' AND role = 'owner'`,
  );
  const admin = randomUUID();
  const policy = randomUUID();
  sql(`
    INSERT INTO public.users (id, display_name) VALUES ('${admin}', 'Synthetic research settings administrator');
    INSERT INTO public.system_administrators VALUES ('${admin}');
    INSERT INTO public.institutional_principal_bindings (issuer, subject, user_id) VALUES
      ('http://oidc-simulator:3002', 'research-admin', '${admin}'),
      ('http://oidc-simulator:3002', 'research-creator', '${author}');
    INSERT INTO public.university_eligibility_policies (id, workspace_id, code, version, approved_at)
      VALUES ('${policy}', '${workspace}', 'research-audience', 1, now());
  `);
  const draft = await prepare();
  const endpoint = "/api/v1/admin/tools/research-consent";
  const origin = new URL(baseURL!).origin;
  await page.goto("/admin/settings");
  await page
    .getByRole("link", { name: "Sign in with University account" })
    .click();
  await page
    .getByRole("button", { name: "research-admin", exact: true })
    .click();
  await page.getByLabel("Creator tool").selectOption("research-consent");
  const availability = page.getByLabel("Tool availability");
  await expect(availability).toHaveValue("university");
  await expect(
    availability.getByRole("option", { name: "All eligible creators" }),
  ).toHaveCount(0);
  const authorContext = await browser.newContext({ baseURL });
  try {
    await availability.selectOption("approved");
    await page.getByRole("button", { name: "Save availability" }).click();
    await expect(page.getByRole("status")).toHaveText("Availability saved");
    expect(
      (
        await page.request.post(endpoint, {
          headers: { Origin: origin },
          data: { action: "mode", mode: "all" },
        })
      ).status(),
    ).toBe(400);

    const creator = await authorContext.newPage();
    await creator.goto("/");
    await creator
      .getByRole("link", { name: "Sign in with University account" })
      .click();
    await creator
      .getByRole("button", { name: "research-creator", exact: true })
      .click();
    const publish = () =>
      creator.request.post("/api/v1/surveys/" + draft.id + "/publish", {
        headers: { Origin: origin },
        data: { researchConsent: "synthetic" },
      });
    expect((await publish()).status()).toBe(403);

    await page.getByLabel("Workspace ID").fill(workspace);
    await page.getByLabel("User or group ID").fill(author);
    await page.getByRole("button", { name: "Add approval" }).click();
    await expect(page.getByRole("status")).toHaveText("Approval saved");
    expect((await draft.request({ researchConsent: "synthetic" })).status).toBe(
      403,
    );

    await creator.reload();
    await creator.getByLabel("Survey title").fill("Synthetic research policy");
    await creator
      .getByLabel("Question", { exact: true })
      .fill("Was the workshop useful?");
    await creator.getByLabel("Option 1", { exact: true }).fill("Useful");
    await creator.getByLabel("Option 2", { exact: true }).fill("Needs changes");
    await creator.getByRole("button", { name: "Save draft" }).click();
    const checkbox = creator.getByRole("checkbox", {
      name: "Include synthetic research consent",
    });
    await checkbox.check();
    const audience = creator.getByRole("combobox", {
      name: "Audience",
      exact: true,
    });
    await expect(audience).toBeVisible();
    await audience.selectOption("university");
    await creator
      .getByRole("combobox", { name: "University eligibility policy" })
      .selectOption(policy);
    await expect(checkbox).toBeChecked();
    await expect(
      creator.getByRole("button", { name: "Publish survey" }),
    ).toBeDisabled();
    await audience.selectOption("open");
    await expect(checkbox).toBeChecked();
    await expect(
      creator.getByRole("button", { name: "Publish survey" }),
    ).toBeEnabled();
    await creator.getByLabel("Show a follow-up when").selectOption("option_1");
    await creator.getByLabel("Follow-up question").fill("What worked well?");
    await creator.getByRole("button", { name: "Save draft" }).click();
    await expect(
      creator.getByText(/Restore a compatible single-choice draft/),
    ).toBeVisible();
    await expect(checkbox).toBeChecked();
    await expect(
      creator.getByRole("button", { name: "Publish survey" }),
    ).toBeDisabled();
    await creator.getByLabel("Show a follow-up when").selectOption("");
    await creator.getByRole("button", { name: "Save draft" }).click();
    await creator.getByRole("button", { name: "Publish survey" }).click();
    const link = creator.getByRole("link", { name: "Open respondent link" });
    await expect(link).toBeVisible();
    const respondent = await browser.newPage({ baseURL });
    await respondent.goto((await link.getAttribute("href"))!);
    await expect(
      respondent.getByRole("region", { name: "Synthetic study consent" }),
    ).toBeVisible();

    await page.getByRole("button", { name: /Revoke user/ }).click();
    await expect(page.getByRole("status")).toHaveText("Approval revoked");
    await respondent.reload();
    await expect(
      respondent.getByRole("region", { name: "Synthetic study consent" }),
    ).toBeVisible();
    await respondent.close();
    expect((await publish()).status()).toBe(403);
    await availability.selectOption("off");
    await page.getByRole("button", { name: "Save availability" }).click();
    await expect(page.getByRole("status")).toHaveText("Availability saved");
    expect((await publish()).status()).toBe(403);
    expect(
      sql(
        `SELECT count(*) FROM public.survey_versions WHERE survey_id = '${draft.id}'`,
      ),
    ).toBe("0");
  } finally {
    await authorContext.close();
    await page.request.post(endpoint, {
      headers: { Origin: origin },
      data: { action: "mode", mode: "university" },
    });
  }
});
