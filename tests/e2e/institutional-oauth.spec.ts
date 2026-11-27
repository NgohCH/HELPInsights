import { expect, test } from "@playwright/test";
import { SignJWT, importJWK } from "jose";
import { surveyFixture } from "../fixtures/survey.ts";

test("an institutional access token only sees its explicitly bound workspace actor", async ({
  page,
}) => {
  const { sql, ownerToken, workspace, outside } = surveyFixture();
  const owner = sql(
    `SELECT user_id FROM public.workspace_memberships WHERE workspace_id = '${workspace}'`,
  );
  const fixture = process.env.HELPINSIGHTS_TEST_OAUTH_SIGNING_JWK;
  if (!fixture)
    throw new Error("Run this test through the disposable test stack");
  const key = await importJWK(JSON.parse(fixture), "RS256");
  const issuer = "https://issuer.synthetic.test/oauth/v2.0";
  const subject = "explicitly-bound-subject";
  sql(
    `INSERT INTO public.institutional_principal_bindings (issuer, subject, user_id) VALUES ('${issuer}', '${subject}', '${owner}')`,
  );
  const token = (sub: string) =>
    new SignJWT({
      scp: "workspace.read",
      roles: ["platform-admin"],
      groups: [outside],
    })
      .setProtectedHeader({ alg: "RS256", kid: "disposable-rsa" })
      .setIssuer(issuer)
      .setAudience("helpinsights.test.api")
      .setSubject(sub)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(key);

  expect(
    sql(`
    SELECT relrowsecurity,
      has_table_privilege('helpinsights_app', 'public.institutional_principal_bindings', 'SELECT'),
      has_table_privilege('helpinsights_app', 'public.institutional_principal_bindings', 'INSERT')
    FROM pg_class WHERE oid = 'public.institutional_principal_bindings'::regclass
  `),
  ).toBe("t|f|f");

  await page.goto("/");
  const sameOriginGet = (path: string, bearer: string) =>
    page.evaluate(
      async ({ path, bearer }) => {
        const response = await fetch("/api/v1" + path, {
          credentials: "omit",
          headers: { Authorization: "Bearer " + bearer },
        });
        return { status: response.status, body: await response.json() };
      },
      { path, bearer },
    );

  const verified = await token(subject);
  const measured = await sameOriginGet("/me", verified);
  expect(measured).toEqual({
    status: 200,
    body: { id: owner, displayName: "Workshop creator" },
  });
  const scoped = await sameOriginGet("/workspaces", verified);
  expect(scoped.status).toBe(200);
  expect(scoped.body.map((item: { id: string }) => item.id)).toEqual([
    workspace,
  ]);
  expect((await sameOriginGet("/me", await token("unbound"))).status).toBe(401);
  expect(
    (await sameOriginGet("/surveys?workspaceId=" + workspace, verified)).status,
  ).toBe(401);
  expect((await sameOriginGet("/me", ownerToken)).status).toBe(200);
  sql(
    `DELETE FROM public.institutional_principal_bindings WHERE issuer = '${issuer}' AND subject = '${subject}'`,
  );
  expect((await sameOriginGet("/workspaces", verified)).status).toBe(401);
});
