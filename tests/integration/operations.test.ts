import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { event, operationsFixture } from "../fixtures/operations.ts";
import { surveyFixture } from "../fixtures/survey.ts";

test("platform operations require an explicit role and preserve existing workspace boundaries", async () => {
  const fixture = surveyFixture();
  const api = fixture.stack.baseUrl() + "/api/v1";
  const authorize = (token: string) => ({
    Authorization: "Bearer " + token,
    "Content-Type": "application/json",
  });
  const incidentPath = api + "/admin/incidents";
  const healthPath = api + "/admin/health";
  assert.equal((await fetch(healthPath)).status, 401);

  const owner = authorize(fixture.ownerToken);
  for (const path of [healthPath, incidentPath])
    assert.equal((await fetch(path, { headers: owner })).status, 403);
  assert.equal(
    (
      await fetch(incidentPath, {
        method: "POST",
        headers: owner,
        body: JSON.stringify(event),
      })
    ).status,
    403,
  );

  const ops = operationsFixture(fixture);
  const readonly = authorize(ops.viewerToken);
  const checksum = fixture.sql(
    "SELECT checksum FROM public.schema_migrations WHERE name = '001-organisations.sql'",
  );
  assert.match(checksum, /^[a-f0-9]{64}$/);
  fixture.sql(
    "UPDATE public.schema_migrations SET checksum = 'stale' WHERE name = '001-organisations.sql'",
  );
  try {
    const degraded = await fetch(healthPath, { headers: readonly });
    assert.equal(degraded.status, 200);
    assert.deepEqual(await degraded.json(), {
      status: "degraded",
      components: [
        { name: "api", status: "ok" },
        { name: "database", status: "ok" },
        { name: "schema", status: "degraded" },
      ],
    });
  } finally {
    fixture.sql(
      "UPDATE public.schema_migrations SET checksum = '" +
        checksum +
        "' WHERE name = '001-organisations.sql'",
    );
  }
  const health = await fetch(healthPath, { headers: readonly });
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), {
    status: "ok",
    components: [
      { name: "api", status: "ok" },
      { name: "database", status: "ok" },
      { name: "schema", status: "ok" },
    ],
  });
  assert.equal((await fetch(incidentPath, { headers: readonly })).status, 200);
  assert.equal(
    (
      await fetch(incidentPath, {
        method: "POST",
        headers: readonly,
        body: JSON.stringify(event),
      })
    ).status,
    403,
  );

  const operator = authorize(ops.operatorToken);
  const workspaces = await fetch(api + "/workspaces", { headers: operator });
  assert.equal(workspaces.status, 200);
  assert.deepEqual(await workspaces.json(), []);
  const create = await fetch(api + "/surveys", {
    method: "POST",
    headers: owner,
    body: JSON.stringify({
      workspaceId: fixture.workspace,
      title: "Private synthetic survey",
      privacyMode: "anonymous",
      retentionPolicyId: fixture.retentionPolicy,
    }),
  });
  assert.equal(create.status, 201);
  const { id } = await create.json();
  for (const suffix of ["", "/analytics"])
    assert.equal(
      (await fetch(api + "/surveys/" + id + suffix, { headers: operator }))
        .status,
      404,
    );
  fixture.sql(
    "DELETE FROM public.platform_operations_memberships WHERE user_id = '" +
      ops.viewer +
      "'",
  );
  assert.equal((await fetch(healthPath, { headers: readonly })).status, 403);
  assert.equal((await fetch(incidentPath, { headers: readonly })).status, 403);
});

test("only redacted append-only events persist across PostgreSQL and app restarts", async () => {
  const fixture = surveyFixture();
  const incidentPath = fixture.stack.baseUrl() + "/api/v1/admin/incidents";
  assert.equal((await fetch(incidentPath)).status, 401);
  const ops = operationsFixture(fixture);
  const headers = {
    Authorization: "Bearer " + ops.operatorToken,
    "Content-Type": "application/json",
  };
  const writeEvent = (body: object) =>
    fetch(incidentPath, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  const beforeCount = fixture.sql(
    "SELECT count(*) FROM public.operation_incidents",
  );
  for (const body of [
    { ...event, answer: "Synthetic response never stored in incidents" },
    { ...event, component: "Synthetic private survey" },
    { ...event, actorId: ops.viewer },
  ]) {
    const rejected = await writeEvent(body);
    assert.equal(rejected.status, 400);
    assert.doesNotMatch(
      await rejected.text(),
      /Synthetic private survey|Synthetic response|actorId/,
    );
  }
  assert.equal(
    fixture.sql("SELECT count(*) FROM public.operation_incidents"),
    beforeCount,
  );

  const result = await writeEvent(event);
  assert.equal(result.status, 201);
  const record = await result.json();
  assert.match(record.id, /^[0-9a-f-]{36}$/);
  assert.ok(Number.isFinite(Date.parse(record.recordedAt)));
  assert.deepEqual(record, {
    id: record.id,
    component: "database",
    state: "detected",
    severity: "advisory",
    recordedAt: record.recordedAt,
  });

  const setActor = (actor: string) =>
    `SET LOCAL ROLE helpinsights_app; SET LOCAL helpinsights.actor_id = '${actor}';`;
  for (const [actor, statement] of [
    [
      ops.viewer,
      "INSERT INTO public.operation_incidents (component, state, severity) VALUES ('api', 'detected', 'advisory')",
    ],
    [ops.operator, "UPDATE public.operation_incidents SET state = 'recovered'"],
    [ops.operator, "DELETE FROM public.operation_incidents"],
    [ops.operator, "SELECT actor_id FROM public.operation_incidents"],
    [
      ops.operator,
      "INSERT INTO public.operation_incidents (component, state, severity, actor_id) " +
        "VALUES ('api', 'detected', 'advisory', '" +
        ops.viewer +
        "')",
    ],
  ] as const) {
    assert.equal(
      fixture.sql(
        "BEGIN; " +
          setActor(actor) +
          `
        DO $check$
        BEGIN
          EXECUTE $statement$${statement}$statement$;
          RAISE EXCEPTION 'Expected operations privilege to deny the SQL statement';
        EXCEPTION WHEN insufficient_privilege THEN
          NULL;
        END
        $check$;
        SELECT 'denied';
        ROLLBACK;`,
      ),
      "denied",
    );
  }

  fixture.stack.compose("restart", "postgres", "app");
  fixture.stack.compose(
    "up",
    "-d",
    "--wait",
    "--wait-timeout",
    "45",
    "postgres",
    "app",
  );
  const restartedBase = fixture.stack.baseUrl() + "/api/v1";
  const readyPath = restartedBase + "/health/ready";
  for (let attempt = 0; attempt < 20; attempt++) {
    const ready = await fetch(readyPath).catch(() => undefined);
    if (ready?.ok) break;
    await delay(250);
  }
  assert.equal(
    fixture.sql(`
      SELECT component || ':' || state || ':' || severity || ':' || actor_id
      FROM public.operation_incidents WHERE id = '${record.id}'
    `),
    "database:detected:advisory:" + ops.operator,
  );
  const history = await fetch(restartedBase + "/admin/incidents", { headers });
  assert.equal(history.status, 200);
  assert.deepEqual(
    (await history.json()).find(
      (item: { id: string }) => item.id === record.id,
    ),
    record,
  );
});
