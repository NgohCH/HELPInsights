import { createHash, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { registryFixture } from "../fixtures/registry.ts";

test("department policy versions admit only eligible University respondents", async ({
  page,
}) => {
  const { request, createDraft, publish, sql, workspace, outside, ownerToken } =
    registryFixture();
  const actor = sql(
    `SELECT user_id FROM public.workspace_memberships WHERE workspace_id = '${workspace}'`,
  );
  const firstPolicy = randomUUID();
  const secondPolicy = randomUUID();
  const foreignPolicy = randomUUID();
  const pendingPolicy = randomUUID();
  const withdrawnPolicy = randomUUID();
  sql(`
    INSERT INTO public.university_eligibility_policies (id, workspace_id, code, version, approved_at) VALUES
      ('${firstPolicy}', '${workspace}', 'teaching-cohort', 1, now()),
      ('${secondPolicy}', '${workspace}', 'teaching-cohort', 2, now()),
      ('${foreignPolicy}', '${outside}', 'other-department', 1, now()),
      ('${pendingPolicy}', '${workspace}', 'pending-approval', 1, NULL);
    INSERT INTO public.university_eligibility_policies (id, workspace_id, code, version, approved_at, withdrawn_at)
      VALUES ('${withdrawnPolicy}', '${workspace}', 'withdrawn', 1, now() - interval '1 hour', now());
    INSERT INTO public.university_eligibility_grants (policy_id, user_id, expires_at) VALUES
      ('${firstPolicy}', '${actor}', now() + interval '1 hour'),
      ('${secondPolicy}', '${actor}', now() - interval '1 minute');
    INSERT INTO public.institutional_principal_bindings (issuer, subject, user_id) VALUES
      ('http://oidc-simulator:3002', 'eligibility-student', '${actor}');
  `);
  const draft = await createDraft();
  const postPublish = (policy?: string) =>
    request("/surveys/" + draft.id + "/publish", "POST", {
      headers: draft.headers,
      body: { eligibilityMode: "university", universityPolicyId: policy },
    });
  expect((await postPublish(foreignPolicy)).status).toBe(403);
  expect((await postPublish(pendingPolicy)).status).toBe(403);
  expect((await postPublish(withdrawnPolicy)).status).toBe(403);
  expect((await postPublish()).status).toBe(400);
  const first = await postPublish(firstPolicy);
  expect(first.status).toBe(201);
  const { id: firstVersion, publicToken: firstToken } = await first.json();
  const second = await postPublish(secondPolicy);
  expect(second.status).toBe(201);
  const { id: secondVersion, publicToken: secondToken } = await second.json();
  expect(
    sql(
      `SELECT university_policy_id FROM public.distributions WHERE survey_version_id = '${firstVersion}'`,
    ),
  ).toBe(firstPolicy);
  expect(
    sql(
      `SELECT university_policy_id FROM public.distributions WHERE survey_version_id = '${secondVersion}'`,
    ),
  ).toBe(secondPolicy);

  expect(() =>
    sql(
      `UPDATE public.university_eligibility_policies SET version = 3 WHERE id = '${firstPolicy}'`,
    ),
  ).toThrow();
  const route = "/public/s/" + firstToken;
  const answer = {
    surveyVersionId: firstVersion,
    answers: [{ questionId: "rating", value: "useful" }],
  };
  const browserPath = "/respond/" + firstToken;
  const tokenHash = createHash("sha256").update(firstToken).digest("hex");
  expect(
    sql(`SET ROLE helpinsights_runtime; SELECT outcome FROM public.accept_response(
      decode('${tokenHash}', 'hex'), '${firstVersion}', decode(repeat('e', 64), 'hex'),
      decode(repeat('f', 64), 'hex'), '[]'::jsonb, true)`),
  ).toBe("closed");

  expect(
    sql(
      `SET ROLE helpinsights_runtime; SELECT definition IS NULL FROM public.resolve_collection_distribution(decode('${tokenHash}', 'hex'))`,
    ),
  ).toBe("t");
  expect(await (await request(route)).json()).toEqual({
    eligibilityRequired: true,
    eligibilityMode: "university",
  });
  expect(
    (
      await request(route + "/responses", "POST", {
        headers: {
          Authorization: "Bearer " + ownerToken,
          "Idempotency-Key": randomUUID(),
        },
        body: answer,
      })
    ).status,
  ).toBe(403);
  const open = await publish();
  expect(
    (
      await request(open.path + "/responses", "POST", {
        headers: { "Idempotency-Key": randomUUID() },
        body: { ...answer, surveyVersionId: open.version },
      })
    ).status,
  ).toBe(201);

  await page.goto(browserPath);
  const signIn = page.getByRole("link", {
    name: "Sign in with University account",
  });
  await expect(
    page.getByRole("heading", { name: "Workshop feedback" }),
  ).toHaveCount(0);
  await signIn.click();
  await page
    .getByRole("button", { name: "eligibility-student", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(browserPath + "$"));
  await expect(
    page.getByRole("heading", { name: "Workshop feedback" }),
  ).toBeVisible();
  await page.getByRole("radio", { name: "Useful", exact: true }).check();
  await page.getByRole("button", { name: "Submit response" }).click();
  await expect(page.getByRole("status")).toHaveText("Response submitted");

  const stored = sql(
    `SELECT to_jsonb(r)::text FROM public.responses r WHERE survey_version_id = '${firstVersion}'`,
  );
  expect(stored).toContain("useful");
  expect(stored).not.toContain(actor);
  expect(stored).not.toContain(firstPolicy);
  expect(stored).not.toContain("eligibility-student");

  await page.goto("/respond/" + secondToken);
  await expect(page.getByRole("alert")).toHaveText(
    "University eligibility could not be confirmed for this survey",
  );
  await expect(
    page.getByRole("heading", { name: "Workshop feedback" }),
  ).toHaveCount(0);
  const submitWithCookie = (token: string, version: string) =>
    page.request.post("/api/v1/public/s/" + token + "/responses", {
      headers: {
        Origin: new URL(page.url()).origin,
        "Idempotency-Key": randomUUID(),
      },
      data: { ...answer, surveyVersionId: version },
    });
  const malformed = await page.request.post(
    "/api/v1/public/s/" + secondToken + "/responses",
    {
      headers: {
        Origin: new URL(page.url()).origin,
        "Idempotency-Key": randomUUID(),
      },
      data: {
        surveyVersionId: secondVersion,
        answers: [{ questionId: "unknown-question", value: "invalid" }],
      },
    },
  );
  expect(malformed.status()).toBe(403);
  expect(await malformed.json()).toMatchObject({
    code: "FORBIDDEN",
    message: "University eligibility could not be confirmed for this survey",
  });
  expect((await submitWithCookie(secondToken, secondVersion)).status()).toBe(
    403,
  );
  sql(
    `DELETE FROM public.university_eligibility_grants WHERE policy_id = '${firstPolicy}' AND user_id = '${actor}'`,
  );
  expect((await submitWithCookie(firstToken, firstVersion)).status()).toBe(403);
  sql(
    `INSERT INTO public.university_eligibility_grants (policy_id, user_id, expires_at) VALUES ('${firstPolicy}', '${actor}', now() + interval '1 hour')`,
  );
  expect((await page.request.get("/api/v1" + route)).status()).toBe(200);
  sql(
    "DELETE FROM public.institutional_principal_bindings WHERE issuer = 'http://oidc-simulator:3002' AND subject = 'eligibility-student'",
  );
  expect((await submitWithCookie(firstToken, firstVersion)).status()).toBe(403);
  expect(
    sql(
      `SELECT count(*) FROM public.responses WHERE survey_version_id IN ('${firstVersion}', '${secondVersion}')`,
    ),
  ).toBe("1");
});
