import assert from "node:assert/strict";
import test from "node:test";
import { runningTestStack } from "../../scripts/test-docker.ts";
import { definition, surveyFixture } from "../fixtures/survey.ts";

test("the survey API requires a session", async () => {
  const response = await fetch(
    runningTestStack().baseUrl() + "/api/v1/surveys",
    { method: "POST" },
  );
  assert.equal(response.status, 401);
});

test("only workspace creators can modify drafts and published versions remain immutable", async () => {
  const { stack, sql, workspace, retentionPolicy, ownerToken, outsiderToken } =
    surveyFixture();
  const base = stack.baseUrl() + "/api/v1";
  const json = (
    token: string,
    method: string,
    body?: object,
    etag?: string,
  ) => ({
    method,
    headers: {
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(etag ? { "If-Match": etag } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const draft = {
    workspaceId: workspace,
    title: definition.title,
    privacyMode: "anonymous",
    retentionPolicyId: retentionPolicy,
  };
  const forbidden = await fetch(
    base + "/surveys",
    json(outsiderToken, "POST", draft),
  );
  assert.equal(forbidden.status, 403);
  const created = await fetch(
    base + "/surveys",
    json(ownerToken, "POST", draft),
  );
  assert.equal(created.status, 201);
  const { id, status } = await created.json();
  assert.equal(status, "draft");
  assert.equal(created.headers.get("etag"), '"1"');
  assert.equal(
    (await fetch(base + "/surveys/" + id, json(outsiderToken, "GET"))).status,
    404,
  );
  assert.equal(
    (
      await fetch(
        base + "/surveys/" + id + "/publish",
        json(ownerToken, "POST"),
      )
    ).status,
    400,
  );

  const draftUrl = base + "/surveys/" + id + "/draft";
  const saved = await fetch(
    draftUrl,
    json(ownerToken, "PUT", definition, '"1"'),
  );
  assert.equal(saved.status, 200);
  assert.equal(saved.headers.get("etag"), '"2"');
  assert.deepEqual(await saved.json(), definition);
  assert.equal(
    (await fetch(draftUrl, json(ownerToken, "PUT", definition, '"1"'))).status,
    409,
  );
  const firstPublish = await fetch(
    base + "/surveys/" + id + "/publish",
    json(ownerToken, "POST"),
  );
  assert.equal(firstPublish.status, 201);
  const first = await firstPublish.json();
  assert.equal(first.version, 1);
  assert.match(first.publicToken, /^[A-Za-z0-9_-]{43}$/);
  assert.match(first.hash, /^[a-f0-9]{64}$/);

  const oldPublicUrl = base + "/public/s/" + first.publicToken;
  const changed = { ...definition, title: "Revised feedback" };
  assert.equal(
    (await fetch(draftUrl, json(ownerToken, "PUT", changed, '"2"'))).status,
    200,
  );
  const secondPublish = await fetch(
    base + "/surveys/" + id + "/publish",
    json(ownerToken, "POST"),
  );
  assert.equal(secondPublish.status, 201);
  const second = await secondPublish.json();
  assert.equal(second.version, 2);
  assert.notEqual(second.hash, first.hash);
  const oldPublic = await fetch(oldPublicUrl);
  assert.equal(oldPublic.status, 200);
  assert.deepEqual(await oldPublic.json(), {
    surveyVersionId: first.id,
    definition,
  });
  assert.equal(
    sql(
      "SELECT definition->>'title' FROM public.survey_versions WHERE survey_id = '" +
        id +
        "' ORDER BY version",
    ),
    "Workshop feedback\nRevised feedback",
  );
  const newer = { ...definition, title: "Edited together" };
  const edits = await Promise.all(
    Array.from({ length: 2 }, () =>
      fetch(draftUrl, json(ownerToken, "PUT", newer, '"3"')),
    ),
  );
  assert.deepEqual(edits.map((edit) => edit.status).sort(), [200, 409]);

  sql(
    "UPDATE public.surveys SET draft = jsonb_set(draft, '{pages,0,questions,0,type}', to_jsonb('unsupported'::text)) WHERE id = '" +
      id +
      "'",
  );
  const corrupt = await fetch(
    base + "/surveys/" + id + "/publish",
    json(ownerToken, "POST"),
  );
  assert.equal(corrupt.status, 400);
  assert.equal(
    sql(
      "SELECT count(*) FROM public.survey_versions WHERE survey_id = '" +
        id +
        "'",
    ),
    "2",
  );
  assert.equal(
    sql(
      "SELECT count(*) FROM public.distributions d JOIN public.survey_versions v ON v.id = d.survey_version_id WHERE v.survey_id = '" +
        id +
        "'",
    ),
    "2",
  );

  assert.equal(
    sql(
      "SET ROLE helpinsights_runtime; SELECT has_any_column_privilege('public.survey_versions', 'UPDATE'), has_table_privilege('public.survey_versions', 'DELETE')",
    ),
    "f|f",
  );
});
