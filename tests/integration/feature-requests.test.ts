import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { featureFixture } from "../fixtures/features.ts";

const npsDefinition = {
  schemaVersion: "1",
  title: "Synthetic NPS",
  pages: [
    {
      id: "first",
      questions: [
        {
          id: "recommend",
          code: "recommend",
          type: "nps",
          title: "Would you recommend this synthetic event?",
          required: true,
        },
      ],
    },
  ],
};
const purpose = {
  purpose: "Review a synthetic event feedback process",
  dataClassification: "anonymous",
};
const approve = {
  decision: "approve",
  rationale: "Synthetic review",
  expiresInDays: 1,
};

function setup() {
  const fixture = featureFixture();
  const { workspace, ownerToken, retentionPolicy } = fixture;
  const base = fixture.stack.baseUrl() + "/api/v1";
  const request = (
    path: string,
    token?: string,
    method = "GET",
    body?: object,
    headers?: Record<string, string>,
  ) =>
    fetch(base + path, {
      method,
      headers: {
        // Synchronous SQL fixture calls can outlast a loopback keep-alive socket.
        Connection: "close",
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  const catalog = "/workspaces/" + workspace + "/features/nps";
  const requests = catalog + "/requests";
  const createDraft = async () => {
    const created = await request("/surveys", ownerToken, "POST", {
      workspaceId: workspace,
      privacyMode: "anonymous",
      title: npsDefinition.title,
      retentionPolicyId: retentionPolicy,
    });
    assert.equal(created.status, 201);
    const { id } = await created.json();
    return { id, path: "/surveys/" + id, etag: created.headers.get("etag")! };
  };
  return { ...fixture, request, catalog, requests, createDraft };
}

test("delegated workspace reviewers can decide once, and a replay retains the expiry", async () => {
  const {
    request,
    catalog,
    requests,
    ownerToken,
    outsiderToken,
    reviewerToken,
    delegate,
    reviewer,
    workspace,
    sql,
  } = setup();
  const current = await request(catalog, ownerToken);
  assert.equal(current.status, 200);
  assert.deepEqual(await current.json(), {
    featureKey: "nps",
    title: "NPS questions",
    description: "Collect a 0–10 recommendation rating in anonymous surveys.",
    canRequest: true,
    canReview: false,
    enabled: false,
    requests: [],
  });
  assert.equal((await request(catalog)).status, 401);
  assert.equal((await request(catalog, outsiderToken)).status, 403);
  assert.equal(
    (await request(requests, outsiderToken, "POST", purpose)).status,
    403,
  );
  delegate();
  const created = await request(requests, ownerToken, "POST", purpose);
  assert.equal(created.status, 201);
  const { id } = await created.json();
  assert.equal(
    (await request(requests, ownerToken, "POST", purpose)).status,
    409,
  );
  const decisionPath = requests + "/" + id + "/decision";
  assert.equal(
    (await request(decisionPath, ownerToken, "POST", approve)).status,
    403,
  );
  assert.equal(
    (await request(decisionPath, outsiderToken, "POST", approve)).status,
    403,
  );
  const reviewerCatalog = await (await request(catalog, reviewerToken)).json();
  assert.equal(reviewerCatalog.canReview, true);
  assert.equal(reviewerCatalog.canRequest, false);
  assert.equal(reviewerCatalog.requests[0].id, id);

  const attempts = await Promise.all(
    Array.from({ length: 2 }, () =>
      request(decisionPath, reviewerToken, "POST", approve),
    ),
  );
  assert.deepEqual(
    attempts.map((response) => response.status),
    [200, 200],
  );
  const [first, replay] = await Promise.all(
    attempts.map((response) => response.json()),
  );
  assert.deepEqual(replay, first);
  assert.ok(Date.parse(first.expiresAt) > Date.now());
  assert.equal(
    (
      await request(decisionPath, reviewerToken, "POST", {
        decision: "deny",
        rationale: "Different decision",
      })
    ).status,
    409,
  );
  const allowed = await (await request(catalog, ownerToken)).json();
  assert.equal(allowed.enabled, true);
  assert.equal(allowed.canRequest, false);
  assert.equal(
    (await request(requests, ownerToken, "POST", purpose)).status,
    409,
  );
  assert.equal(
    sql(`
    SELECT decision, reviewed_by, count(*) FROM public.feature_requests
    WHERE workspace_id = '${workspace}' GROUP BY decision, reviewed_by
  `),
    "approve|" + reviewer + "|1",
  );
});

test("NPS use is denied before approval and after expiry while published responses keep working", async () => {
  const {
    request,
    catalog,
    requests,
    createDraft,
    ownerToken,
    reviewerToken,
    delegate,
    sql,
  } = setup();
  const baselineEndpoint = await request(catalog, ownerToken);
  assert.equal(baselineEndpoint.status, 200);
  const draft = await createDraft();
  const save = (body: object, etag = draft.etag) =>
    request(draft.path + "/draft", ownerToken, "PUT", body, {
      "If-Match": etag,
    });
  assert.equal((await save(npsDefinition)).status, 403);

  const existingNumeric = structuredClone(npsDefinition);
  existingNumeric.pages[0].questions[0].type = "number";
  const normal = await save(existingNumeric);
  assert.equal(normal.status, 200);
  delegate();

  const decide = async (decision: object) => {
    const created = await request(requests, ownerToken, "POST", purpose);
    assert.equal(created.status, 201);
    const { id } = await created.json();
    const decided = await request(
      requests + "/" + id + "/decision",
      reviewerToken,
      "POST",
      decision,
    );
    assert.equal(decided.status, 200);
    return id;
  };
  await decide({
    decision: "deny",
    rationale: "Additional synthetic review needed",
  });
  assert.equal(
    (await save(npsDefinition, normal.headers.get("etag")!)).status,
    403,
  );
  const approvedId = await decide(approve);
  const saved = await save(npsDefinition, normal.headers.get("etag")!);
  assert.equal(saved.status, 200);
  const publish = () => request(draft.path + "/publish", ownerToken, "POST");
  const published = await publish();
  assert.equal(published.status, 201);
  const { id: surveyVersionId, publicToken } = await published.json();

  sql(`UPDATE public.feature_requests SET requested_at = now() - interval '3 days',
    decided_at = now() - interval '2 days', expires_at = now() - interval '1 day'
    WHERE id = '${approvedId}'`);
  assert.equal(
    (await (await request(catalog, ownerToken)).json()).enabled,
    false,
  );
  assert.equal(
    (await save(npsDefinition, saved.headers.get("etag")!)).status,
    403,
  );
  assert.equal((await publish()).status, 403);
  const submit = (value: string | number) =>
    request(
      "/public/s/" + publicToken + "/responses",
      undefined,
      "POST",
      {
        surveyVersionId,
        answers: [{ questionId: "recommend", value }],
      },
      { "Idempotency-Key": randomUUID() },
    );
  for (const invalid of [-1, 10.5, 11, "8"])
    assert.equal((await submit(invalid)).status, 400);
  assert.equal((await submit(0)).status, 201);
  assert.equal((await submit(10)).status, 201);
  assert.equal(
    sql(`SELECT string_agg(answers->0->>'value', ',' ORDER BY answers->0->>'value')
    FROM public.responses WHERE survey_version_id = '${surveyVersionId}'`),
    "0,10",
  );
});

test("PostgreSQL rejects inconsistent expiry metadata even for a delegated reviewer", async () => {
  const { request, requests, ownerToken, reviewer, delegate, sql } = setup();
  delegate();
  const created = await request(requests, ownerToken, "POST", purpose);
  assert.equal(created.status, 201);
  const { id } = await created.json();
  sql(`
    SET ROLE helpinsights_runtime;
    SELECT set_config('helpinsights.actor_id', '${reviewer}', false);
    DO $check$
    BEGIN
      UPDATE public.feature_requests
      SET decision = 'approve', reviewed_by = '${reviewer}', rationale = 'Synthetic check',
          decided_at = now(), expires_in_days = 1, expires_at = now() + interval '91 days'
      WHERE id = '${id}';
      IF NOT FOUND THEN RAISE EXCEPTION 'Fixture reviewer could not update the pending request'; END IF;
      RAISE EXCEPTION 'PostgreSQL accepted inconsistent expiry';
    EXCEPTION WHEN check_violation THEN NULL;
    END $check$;
  `);
  assert.equal(
    sql(
      `SELECT decision IS NULL FROM public.feature_requests WHERE id = '${id}'`,
    ),
    "t",
  );
});
