import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { registryFixture } from "../fixtures/registry.ts";

test("system administrators control template copying through scoped user and group approvals", async ({
  page,
  browser,
  baseURL,
}) => {
  const { sql, workspace, outside, ownerToken, publish, request } =
    registryFixture();
  const creator = sql(
    `SELECT user_id FROM public.workspace_memberships WHERE workspace_id = '${workspace}'`,
  );
  const admin = randomUUID();
  const member = randomUUID();
  const group = randomUUID();
  sql(`
    INSERT INTO public.users (id, display_name) VALUES ('${admin}', 'Synthetic system administrator'), ('${member}', 'Synthetic group member');
    INSERT INTO public.system_administrators VALUES ('${admin}');
    INSERT INTO public.platform_operations_memberships VALUES ('${member}', 'operator');
    INSERT INTO public.workspace_memberships (workspace_id, user_id, role) VALUES ('${workspace}', '${member}', 'editor'), ('${outside}', '${creator}', 'editor');
    INSERT INTO public.approved_identity_groups VALUES ('${group}', 'Synthetic department');
    INSERT INTO public.approved_identity_group_members VALUES ('${group}', '${member}');
    INSERT INTO public.institutional_principal_bindings (issuer, subject, user_id) VALUES
      ('http://oidc-simulator:3002', 'settings-admin', '${admin}'), ('http://oidc-simulator:3002', 'settings-member', '${member}');
  `);
  const endpoint = "/api/v1/admin/tools/template-copy";
  const clone = (target: Page, workspaceId: string, token?: string) =>
    target.request.post("/api/v1/templates/event-feedback/clone", {
      data: { workspaceId, revision: 1 },
      headers: token
        ? { Authorization: "Bearer " + token }
        : { Origin: new URL(target.url()).origin },
    });

  expect((await page.request.get(endpoint)).status()).toBe(401);
  expect(
    (
      await page.request.get(endpoint, {
        headers: { Authorization: "Bearer " + ownerToken },
      })
    ).status(),
  ).toBe(401);
  const baseline = await clone(page, workspace, ownerToken);
  expect(baseline.status()).toBe(201);
  const { id: existingDraft } = await baseline.json();
  const openSurvey = await publish();

  async function signIn(target: Page, subject: string) {
    await target.goto("/admin/settings");
    await target
      .getByRole("link", { name: "Sign in with University account" })
      .click();
    await target.getByRole("button", { name: subject, exact: true }).click();
    await expect(target).toHaveURL(/\/admin\/settings$/);
  }
  await signIn(page, "settings-admin");
  const availability = page.getByLabel("Tool availability");
  await expect(availability).toHaveValue("all");
  async function saveMode(mode: string) {
    await availability.selectOption(mode);
    await page.getByRole("button", { name: "Save availability" }).click();
    await expect(page.getByRole("status")).toHaveText("Availability saved");
  }
  const wrongOrigin = await page.request.post(endpoint, {
    data: { action: "mode", mode: "off" },
    headers: { Origin: "https://wrong.example.test" },
  });
  expect(wrongOrigin.status()).toBe(403);
  await saveMode("off");
  expect(
    (
      await request("/surveys/" + existingDraft, "GET", {
        headers: { Authorization: "Bearer " + ownerToken },
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await request(openSurvey.path + "/responses", "POST", {
        headers: { "Idempotency-Key": randomUUID() },
        body: {
          surveyVersionId: openSurvey.version,
          answers: [{ questionId: "rating", value: "useful" }],
        },
      })
    ).status,
  ).toBe(201);
  expect((await clone(page, workspace, ownerToken)).status()).toBe(403);
  await saveMode("university");
  expect((await clone(page, workspace, ownerToken)).status()).toBe(403);

  const memberContext = await browser.newContext({ baseURL });
  try {
    const memberPage = await memberContext.newPage();
    await signIn(memberPage, "settings-member");
    await expect(memberPage.getByRole("alert")).toHaveText(
      "System administrator access is required",
    );
    await expect(
      memberPage.getByRole("heading", { name: "Workspace approvals" }),
    ).toHaveCount(0);
    expect(
      (
        await memberPage.request.post(endpoint, {
          data: { action: "mode", mode: "all" },
          headers: { Origin: new URL(memberPage.url()).origin },
        })
      ).status(),
    ).toBe(403);
    expect((await clone(memberPage, workspace)).status()).toBe(201);

    await saveMode("approved");
    await saveMode("approved");
    expect((await clone(memberPage, workspace)).status()).toBe(403);
    expect((await clone(page, workspace, ownerToken)).status()).toBe(403);

    async function grant(kind: "user" | "group", principal: string) {
      await page.getByLabel("Workspace ID").fill(workspace);
      await page.getByLabel("Approval type").selectOption(kind);
      await page.getByLabel("User or group ID").fill(principal);
      await page.getByRole("button", { name: "Add approval" }).click();
      await expect(
        page.getByRole("button", {
          name:
            "Revoke " + kind + " " + principal + " in workspace " + workspace,
        }),
      ).toBeVisible();
    }
    await grant("user", creator);
    expect((await clone(page, workspace, ownerToken)).status()).toBe(201);
    expect((await clone(page, outside, ownerToken)).status()).toBe(403);
    await grant("group", group);
    expect((await clone(memberPage, workspace)).status()).toBe(201);

    sql(
      `DELETE FROM public.approved_identity_group_members WHERE group_id = '${group}' AND user_id = '${member}'`,
    );
    expect((await clone(memberPage, workspace)).status()).toBe(403);
    sql(
      `INSERT INTO public.approved_identity_group_members VALUES ('${group}', '${member}')`,
    );
    expect((await clone(memberPage, workspace)).status()).toBe(201);
    await page
      .getByRole("button", {
        name: "Revoke group " + group + " in workspace " + workspace,
      })
      .click();
    await expect(page.getByRole("status")).toHaveText("Approval revoked");
    expect((await clone(memberPage, workspace)).status()).toBe(403);
    await grant("group", group);
    sql(`DELETE FROM public.approved_identity_groups WHERE id = '${group}';
         INSERT INTO public.approved_identity_groups VALUES ('${group}', 'Replacement group');
         INSERT INTO public.approved_identity_group_members VALUES ('${group}', '${member}');`);
    expect((await clone(memberPage, workspace)).status()).toBe(403);

    await page
      .getByRole("button", {
        name: "Revoke user " + creator + " in workspace " + workspace,
      })
      .click();
    await expect(page.getByRole("status")).toHaveText("Approval revoked");
    expect((await clone(page, workspace, ownerToken)).status()).toBe(403);
    expect(
      sql(
        `SELECT concat_ws(':', action, mode, workspace_id, subject_type, subject_id) FROM public.creator_tool_audit WHERE actor_id = '${admin}' ORDER BY recorded_at, id`,
      ).split(/\r?\n/),
    ).toEqual([
      "mode:off",
      "mode:university",
      "mode:approved",
      "grant:" + workspace + ":user:" + creator,
      "grant:" + workspace + ":group:" + group,
      "revoke:" + workspace + ":group:" + group,
      "grant:" + workspace + ":group:" + group,
      "revoke:" + workspace + ":user:" + creator,
    ]);
  } finally {
    await memberContext.close();
    sql(
      "UPDATE public.creator_tool_settings SET mode = 'all' WHERE tool = 'template-copy'",
    );
  }
});
