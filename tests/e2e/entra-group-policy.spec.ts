import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { surveyFixture } from "../fixtures/survey.ts";

const issuer = "http://oidc-simulator:3002";
const objectId = "cccccccc-cccc-cccc-cccc-cccccccccccc";

test("signed Entra group changes refresh creator permissions across sessions", async ({
  browser,
  page,
  baseURL,
}) => {
  test.setTimeout(45000);
  const { sql, workspace, ownerToken } = surveyFixture();
  const group = randomUUID();
  const otherIssuerGroup = randomUUID();
  const owner = sql(
    `SELECT user_id FROM public.workspace_memberships WHERE workspace_id = '${workspace}'`,
  );
  sql(`
    INSERT INTO public.institutional_principal_bindings (issuer, subject, user_id)
      VALUES ('${issuer}', 'creator-policy-member', '${owner}');
    INSERT INTO public.approved_identity_groups (id, label, entra_issuer, entra_object_id)
      VALUES ('${group}', 'Synthetic Entra group', '${issuer}', '${objectId}'),
             ('${otherIssuerGroup}', 'Other issuer group', 'https://other-issuer.example.test', '${objectId}');
    INSERT INTO public.approved_identity_group_members VALUES ('${group}', '${owner}');
    INSERT INTO public.creator_tool_grants (tool, workspace_id, subject_type, subject_id)
      VALUES ('template-copy', '${workspace}', 'group', '${group}'),
             ('template-copy', '${workspace}', 'group', '${otherIssuerGroup}'),
             ('research-consent', '${workspace}', 'group', '${group}');
    UPDATE public.creator_tool_settings SET mode = 'approved' WHERE tool IN ('template-copy', 'research-consent');
  `);
  const clone = (target: Page, token?: string) =>
    target.request.post("/api/v1/templates/event-feedback/clone", {
      data: { workspaceId: workspace, revision: 1 },
      headers: token
        ? { Authorization: `Bearer ${token}` }
        : { Origin: new URL(target.url()).origin },
    });
  async function researchAllowed(target: Page) {
    const response = await target.request.get(
      `/api/v1/workspaces/${workspace}/tools/research-consent`,
    );
    expect(response.status()).toBe(200);
    return (await response.json()).allowed;
  }
  const signIn = async (target: Page, choice: string) => {
    await target.goto("/auth/university/start");
    await expect(target).toHaveTitle("Synthetic University");
    await target.getByRole("button", { name: choice, exact: true }).click();
    await expect(
      target.getByRole("button", { name: "Sign out" }),
    ).toBeVisible();
  };
  const otherContext = await browser.newContext({ baseURL });
  try {
    await signIn(page, "creator group present");
    expect((await clone(page)).status()).toBe(201);
    expect((await clone(page, ownerToken)).status()).toBe(403);
    expect(await researchAllowed(page)).toBe(true);
    expect(
      sql(
        `SELECT count(*) FROM public.university_session_group_memberships WHERE group_id = '${group}'`,
      ),
    ).toBe("1");

    const other = await otherContext.newPage();
    for (const denial of [
      "creator group removed",
      "creator group overage",
      "creator group hasgroups",
      "creator group too large",
      "creator group malformed",
      "creator group missing",
    ]) {
      await signIn(other, denial);
      expect((await clone(other)).status(), denial).toBe(403);
      expect((await clone(page)).status(), denial).toBe(403);
      expect((await page.request.get("/api/v1/me")).status(), denial).toBe(200);
      expect(
        sql(
          `SELECT count(*) FROM public.university_session_group_memberships WHERE group_id = '${group}'`,
        ),
      ).toBe("0");
      if (denial === "creator group removed") {
        expect(await researchAllowed(other)).toBe(false);
        expect(await researchAllowed(page)).toBe(false);
        await signIn(other, "creator group same time");
        expect((await clone(other)).status()).toBe(403);
        expect((await clone(page)).status()).toBe(403);
        await signIn(other, "creator group stale");
        expect((await clone(other)).status()).toBe(403);
        expect((await clone(page)).status()).toBe(403);
      }
      await signIn(page, "creator group present");
      expect((await clone(page)).status()).toBe(201);
    }

    sql(
      `UPDATE public.university_session_group_memberships SET expires_at = now() - interval '1 second' WHERE group_id = '${group}'`,
    );
    expect((await clone(page)).status()).toBe(403);
    expect((await page.request.get("/api/v1/me")).status()).toBe(200);
    await signIn(page, "creator group present");
    expect((await clone(page)).status()).toBe(201);
    sql(
      `UPDATE public.approved_identity_groups SET entra_issuer = NULL, entra_object_id = NULL WHERE id = '${group}'`,
    );
    expect((await clone(page)).status()).toBe(403);
    expect(await researchAllowed(page)).toBe(false);
    sql(
      `UPDATE public.approved_identity_groups SET entra_issuer = '${issuer}', entra_object_id = '${objectId}' WHERE id = '${group}'`,
    );
    expect((await clone(page)).status()).toBe(403);
    await signIn(page, "creator group present");
    expect((await clone(page)).status()).toBe(201);
    sql(
      `UPDATE public.approved_identity_groups SET entra_object_id = '${randomUUID()}' WHERE id = '${group}'`,
    );
    expect((await clone(page)).status()).toBe(403);
    await signIn(page, "creator group present");
    expect((await clone(page)).status()).toBe(403);

    sql(
      `UPDATE public.approved_identity_groups SET entra_object_id = '${objectId}' WHERE id = '${group}'`,
    );
    await signIn(page, "creator group present");
    expect((await clone(page)).status()).toBe(201);
    await page.getByRole("button", { name: "Sign out" }).click();
    expect(
      sql(
        `SELECT count(*) FROM public.university_session_group_memberships WHERE group_id = '${group}'`,
      ),
    ).toBe("0");
    expect((await page.request.get("/api/v1/me")).status()).toBe(401);
  } finally {
    await otherContext.close();
    sql(`
      UPDATE public.creator_tool_settings SET mode = 'all' WHERE tool = 'template-copy';
      UPDATE public.creator_tool_settings SET mode = 'university' WHERE tool = 'research-consent';
    `);
  }
});
