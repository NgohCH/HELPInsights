import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  firstLabel,
  pipingDraft,
  withPiping,
} from "../fixtures/answer-piping.ts";
import { surveyFixture } from "../fixtures/survey.ts";

test("canonical draft and publication persist a pipe while collection accepts answer codes only", async () => {
  const { stack, workspace, retentionPolicy, ownerToken, sql } =
    surveyFixture();
  const api = stack.baseUrl() + "/api/v1";
  const headers = {
    Authorization: "Bearer " + ownerToken,
    "Content-Type": "application/json",
  };
  const created = await fetch(api + "/surveys", {
    method: "POST",
    headers,
    body: JSON.stringify({
      workspaceId: workspace,
      title: pipingDraft.title,
      privacyMode: "anonymous",
      retentionPolicyId: retentionPolicy,
    }),
  });
  assert.equal(created.status, 201);
  const { id } = await created.json();
  const survey = api + "/surveys/" + id;
  const draft = () =>
    JSON.parse(
      sql(
        "SELECT coalesce(draft, 'null'::jsonb) FROM public.surveys WHERE id = '" +
          id +
          "'",
      ),
    );
  const initial = draft();
  for (const source of ["missing", "improvement", "attend_again", null]) {
    const rejected = await fetch(survey + "/draft", {
      method: "PUT",
      headers: { ...headers, "If-Match": created.headers.get("etag")! },
      body: JSON.stringify(withPiping(source)),
    });
    assert.equal(rejected.status, 400);
  }
  assert.deepEqual(draft(), initial);
  const saved = await fetch(survey + "/draft", {
    method: "PUT",
    headers: { ...headers, "If-Match": created.headers.get("etag")! },
    body: JSON.stringify(withPiping()),
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(draft(), withPiping());

  const published = await fetch(survey + "/publish", {
    method: "POST",
    headers: { ...headers, "If-Match": saved.headers.get("etag")! },
    body: JSON.stringify({ eligibilityMode: "open" }),
  });
  assert.equal(published.status, 201);
  const version = await published.json();
  const endpoint = api + "/public/s/" + version.publicToken;
  const publicSurvey = await fetch(endpoint);
  assert.equal(publicSurvey.status, 200);
  assert.deepEqual((await publicSurvey.json()).definition, withPiping());

  const submit = (selection: string) =>
    fetch(endpoint + "/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": randomUUID(),
      },
      body: JSON.stringify({
        surveyVersionId: version.id,
        answers: [
          { questionId: "session", value: selection },
          { questionId: "improvement", value: "Practice time" },
          { questionId: "attend_again", value: "yes" },
        ],
      }),
    });
  assert.equal((await submit(firstLabel)).status, 400);
  assert.equal((await submit("session_a")).status, 201);
  const stored = sql(
    "SELECT answers FROM public.responses WHERE survey_version_id = '" +
      version.id +
      "'",
  );
  assert.deepEqual(JSON.parse(stored), [
    { questionId: "session", value: "session_a" },
    { questionId: "improvement", value: "Practice time" },
    { questionId: "attend_again", value: "yes" },
  ]);
});
