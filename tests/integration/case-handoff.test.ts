import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { caseFixture } from "../fixtures/case-handoff.ts";
import { surveyFixture } from "../fixtures/survey.ts";

test("only an appointed workspace reviewer with an active exact-version basis can queue a redacted event", async () => {
  const baseline = surveyFixture();
  const base = baseline.stack.baseUrl();
  assert.equal(
    (
      await fetch(
        base +
          "/api/v1/surveys/" +
          randomUUID() +
          "/versions/" +
          randomUUID() +
          "/case-handoffs",
        { method: "POST" },
      )
    ).status,
    401,
  );

  const fixture = caseFixture(baseline);
  const submit = (
    token: string,
    body: object = fixture.approval,
    key = randomUUID(),
  ) =>
    fetch(base + fixture.path, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
        "Idempotency-Key": key,
      },
      body: JSON.stringify(body),
    });

  assert.equal((await submit(fixture.ownerToken)).status, 403);
  assert.equal((await submit(fixture.outsiderToken)).status, 404);
  const wrongVersion = await fetch(
    base + fixture.path.replace(fixture.version, randomUUID()),
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + fixture.token,
        "Content-Type": "application/json",
        "Idempotency-Key": randomUUID(),
      },
      body: JSON.stringify(fixture.approval),
    },
  );
  assert.equal(wrongVersion.status, 404);
  for (const consentOrLawfulBasisRef of [
    randomUUID(),
    fixture.basis("expired"),
    fixture.basis("future"),
    fixture.basis("revoked"),
    fixture.basis("wrong_version"),
  ]) {
    const denied = await submit(fixture.token, {
      ...fixture.approval,
      consentOrLawfulBasisRef,
    });
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).code, "BASIS_REQUIRED");
  }
  for (const body of [
    { ...fixture.approval, reviewDecision: "pending" },
    { ...fixture.approval, category: "welfare" },
    { ...fixture.approval, priority: "urgent" },
    { ...fixture.approval, sanitisedSummary: fixture.rawFixture },
    { ...fixture.approval, respondentId: randomUUID() },
  ]) {
    const rejected = await submit(fixture.token, body);
    assert.equal(rejected.status, 400);
    assert.ok(!(await rejected.text()).includes(fixture.rawFixture));
  }
  assert.equal(
    fixture.sql(
      "SELECT count(*) FROM public.case_handoff_events WHERE survey_id = '" +
        fixture.survey +
        "'",
    ),
    "0",
  );

  assert.equal(
    fixture.sql(`
      SELECT has_table_privilege('helpinsights_app', 'public.case_handoff_events', 'INSERT')
        OR has_table_privilege('helpinsights_app', 'public.case_handoff_basis', 'UPDATE')
        OR has_table_privilege('helpinsights_exporter', 'public.case_handoff_events', 'SELECT')
    `),
    "f",
  );

  const key = randomUUID();
  const queued = await Promise.all([
    submit(fixture.token, fixture.approval, key),
    submit(fixture.token, fixture.approval, key),
  ]);
  assert.deepEqual(
    queued.map((result) => result.status),
    [202, 202],
  );
  const [first, second] = await Promise.all(
    queued.map((result) => result.json()),
  );
  assert.deepEqual(first, second);
  const organisation = fixture.sql(
    "SELECT organisation_id FROM public.workspaces WHERE id = '" +
      fixture.workspace +
      "'",
  );
  assert.deepEqual(first, {
    eventId: first.eventId,
    eventType: "survey.action.requested.v1",
    organisationId: organisation,
    surveyId: fixture.survey,
    surveyVersionId: fixture.version,
    createdAt: first.createdAt,
    category: "campus_facilities",
    priority: "normal",
    sanitisedSummary:
      "Review a campus facilities concern identified in the synthetic exercise.",
    consentOrLawfulBasisRef: fixture.basisRef,
    originMode: "anonymous_aggregate",
    idempotencyKey: key,
    status: "queued",
  });
  assert.match(first.eventId, /^[a-f0-9-]{36}$/);
  assert.ok(Number.isFinite(Date.parse(first.createdAt)));
  assert.equal(
    (
      await submit(
        fixture.token,
        { ...fixture.approval, priority: "high" },
        key,
      )
    ).status,
    409,
  );
  fixture.sql(
    "UPDATE public.case_handoff_basis SET revoked_at = now() WHERE id = '" +
      fixture.basisRef +
      "'",
  );
  const lostReceiptRetry = await submit(fixture.token, fixture.approval, key);
  assert.equal(lostReceiptRetry.status, 403);
  assert.equal((await lostReceiptRetry.json()).code, "BASIS_REQUIRED");
  assert.equal(
    fixture.sql(`
    SELECT event_id || ':' || approved_by || ':' || status FROM public.case_handoff_events
    WHERE survey_id = '${fixture.survey}'
  `),
    first.eventId + ":" + fixture.reviewer + ":queued",
  );
});

for (const mode of [
  {
    name: "production with the synthetic flag",
    nodeEnv: "production",
    flag: "synthetic",
  },
  { name: "test without the synthetic flag", nodeEnv: "test", flag: "" },
]) {
  test(
    mode.name + " hides the synthetic entry and denies the page and endpoint",
    () => {
      const { stack } = surveyFixture();
      const report = stack.compose(
        "run",
        "--rm",
        "--no-deps",
        "-e",
        "NODE_ENV=" + mode.nodeEnv,
        "-e",
        "HELPINSIGHTS_DEV_CASE_HANDOFF=" + mode.flag,
        "--entrypoint",
        "node",
        "app",
        "--input-type=module",
        "-e",
        `
      import assert from 'node:assert/strict';
      import { spawn } from 'node:child_process';
      import { setTimeout as delay } from 'node:timers/promises';
      const env = { ...process.env };
      if (env.NODE_ENV === 'production') {
        for (const key of Object.keys(env)) {
          if (key.startsWith('HELPINSIGHTS_ENTRA_') || key.startsWith('HELPINSIGHTS_OAUTH_') || key.startsWith('LIVE_QUIZ_'))
            delete env[key];
        }
      }
      const server = spawn(process.execPath, ['apps/api/main.ts'], { stdio: 'inherit', env });
      try {
        const origin = 'http://127.0.0.1:3000';
        let ready = false;
        for (let step = 0; step < 40; step++) {
          const probe = await fetch(origin + '/api/v1/health/ready').catch(() => undefined);
          if (probe?.ok) { ready = true; break; }
          await delay(250);
        }
        assert.equal(ready, true);
        const home = await fetch(origin);
        assert.equal(home.status, 200);
        assert.doesNotMatch(await home.text(), /data-synthetic-case-handoff="true"/);
        assert.equal((await fetch(origin + '/case-handoff')).status, 404);
        const uuid = '00000000-0000-4000-8000-000000000000';
        assert.equal((await fetch(origin + '/api/v1/surveys/' + uuid + '/versions/' + uuid + '/case-handoffs', { method: 'POST' })).status, 404);
        console.log('synthetic handoff unavailable in normal runtime');
      } finally {
        server.kill('SIGTERM');
      }
    `,
      );
      assert.match(report, /synthetic handoff unavailable in normal runtime/);
    },
  );
}
