import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { operationsFixture } from "../fixtures/operations.ts";
import { surveyFixture } from "../fixtures/survey.ts";

function seedRetention() {
  const fixture = surveyFixture();
  const survey = randomUUID();
  const version = randomUUID();
  const response = randomUUID();
  const approver = randomUUID();
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  fixture.sql(`
    INSERT INTO public.users (id, display_name) VALUES ('${approver}', 'Synthetic retention approver');
    INSERT INTO public.sessions (token_hash, user_id, expires_at)
      VALUES (decode('${hash}', 'hex'), '${approver}', now() + interval '1 hour');
    INSERT INTO public.workspace_memberships (workspace_id, user_id, role)
      VALUES ('${fixture.workspace}', '${approver}', 'viewer');
    INSERT INTO public.surveys (id, workspace_id, title, privacy_mode, status, retention_policy_id)
      VALUES ('${survey}', '${fixture.workspace}', 'Synthetic retained survey', 'anonymous', 'published', '${fixture.retentionPolicy}');
    INSERT INTO public.survey_versions (id, survey_id, version, definition, hash)
      VALUES ('${version}', '${survey}', 1, '{}', repeat('0', 64));
    INSERT INTO public.responses (id, survey_version_id, answers, retry_key_hash, payload_hash)
      VALUES ('${response}', '${version}', '[{"questionId":"q","value":"synthetic"}]', decode(repeat('0', 64), 'hex'), decode(repeat('1', 64), 'hex'));
  `);
  const url = fixture.stack.baseUrl() + "/api/v1/surveys/" + survey;
  const headers = (key: string) => ({
    Authorization: "Bearer " + key,
    "Content-Type": "application/json",
  });
  const hold = {
    reason: "legal",
    evidenceReference: randomUUID(),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  };
  function grant() {
    fixture.sql(`
      INSERT INTO public.retention_hold_approvers (workspace_id, user_id)
      VALUES ('${fixture.workspace}', '${approver}')
    `);
  }
  function approval(key: string, body: object = hold) {
    return fetch(url + "/retention/holds", {
      method: "POST",
      headers: headers(key),
      body: JSON.stringify(body),
    });
  }
  function status(key: string) {
    return fetch(url + "/retention", { headers: headers(key) });
  }
  return {
    ...fixture,
    survey,
    version,
    response,
    approver,
    token,
    url,
    headers,
    hold,
    grant,
    approval,
    status,
  };
}

test("closure stamps workspace expiry and hold approval is separately scoped and audited", async () => {
  const fixture = seedRetention();
  const {
    survey,
    url,
    sql,
    ownerToken,
    outsiderToken,
    token,
    approver,
    hold,
    headers,
    status,
    approval,
  } = fixture;
  const initial = await status(ownerToken);
  assert.equal(initial.status, 200);
  assert.deepEqual(await initial.json(), {
    disposition: "not_closed",
    expiryAt: null,
    protectedUntil: null,
  });
  assert.equal((await status(outsiderToken)).status, 404);
  assert.equal((await fetch(url + "/retention")).status, 401);
  assert.equal((await approval(ownerToken)).status, 403);
  assert.equal((await approval(token)).status, 403);
  assert.equal((await approval(outsiderToken)).status, 404);
  assert.equal(
    (await approval(operationsFixture(fixture).operatorToken)).status,
    404,
  );

  const closed = await fetch(url + "/close", {
    method: "POST",
    headers: headers(ownerToken),
  });
  assert.equal(closed.status, 200);
  const { expiryAt } = await closed.json();
  assert.ok(Number.isFinite(Date.parse(expiryAt)));
  assert.deepEqual(await (await status(ownerToken)).json(), {
    disposition: "scheduled",
    expiryAt,
    protectedUntil: null,
  });
  assert.equal(
    sql(
      `SELECT extract(epoch FROM expiry_at - closed_at)::integer FROM public.surveys WHERE id = '${survey}'`,
    ),
    String(90 * 24 * 60 * 60),
  );
  assert.equal(
    sql(
      "SELECT has_column_privilege('helpinsights_app','public.surveys','expiry_at','UPDATE')",
    ),
    "f",
  );

  fixture.grant();
  for (const input of [
    { ...hold, reason: "synthetic confidential details" },
    { ...hold, expiresAt: "2026-02-30T00:00:00Z" },
    { ...hold, expiresAt: "2000-01-01T00:00:00Z" },
    { ...hold, approvedBy: approver },
  ]) {
    const denied = await approval(token, input);
    assert.equal(denied.status, 400);
    assert.doesNotMatch(await denied.text(), /synthetic confidential details/);
  }
  const approved = await approval(token);
  assert.equal(approved.status, 201);
  const record = await approved.json();
  assert.deepEqual(record, {
    id: record.id,
    appliedAt: record.appliedAt,
    expiresAt: hold.expiresAt,
    reason: "legal",
  });
  assert.equal((await approval(token)).status, 409);
  assert.deepEqual(await (await status(ownerToken)).json(), {
    disposition: "held",
    expiryAt,
    protectedUntil: hold.expiresAt,
  });
  assert.equal(
    sql(
      `SELECT approved_by || ':' || evidence_reference || ':' || reason FROM public.retention_holds WHERE id = '${record.id}'`,
    ),
    approver + ":" + hold.evidenceReference + ":legal",
  );
});

test("active holds protect core survey data from disposal and survive PostgreSQL archive restore", async () => {
  const fixture = seedRetention();
  const {
    survey,
    version,
    response,
    stack,
    sql,
    url,
    headers,
    ownerToken,
    token,
    hold,
    status,
    approval,
  } = fixture;
  assert.equal((await status(ownerToken)).status, 200);
  assert.equal(
    (
      await fetch(url + "/close", {
        method: "POST",
        headers: headers(ownerToken),
      })
    ).status,
    200,
  );

  const statements = [
    `DELETE FROM public.responses WHERE id = '${response}'`,
    `DELETE FROM public.survey_versions WHERE id = '${version}'`,
    `DELETE FROM public.surveys WHERE id = '${survey}'`,
  ];
  function assertGuard(
    query: (statement: string) => string,
    statement: string,
  ) {
    assert.equal(
      query(`
      BEGIN;
      DO $check$
      BEGIN
        EXECUTE $operation$${statement}$operation$;
        RAISE EXCEPTION 'Expected retention guard to block disposal';
      EXCEPTION WHEN check_violation THEN
        IF SQLERRM <> 'Survey retention prevents deletion' THEN RAISE; END IF;
      END
      $check$;
      SELECT 'blocked';
      ROLLBACK
    `),
      "blocked",
    );
  }
  assertGuard(sql, statements[0]);
  const at = (clock: string) =>
    sql(`
    SELECT disposition FROM public.retention_disposition('${survey}', ${clock})
  `);
  const expiryClock = `(SELECT expiry_at FROM public.surveys WHERE id = '${survey}')`;
  assert.equal(at(expiryClock + " - interval '1 microsecond'"), "scheduled");
  assert.equal(at(expiryClock), "eligible");
  sql(
    `UPDATE public.surveys SET expiry_at = now() - interval '1 hour' WHERE id = '${survey}'`,
  );
  assert.equal(at("now()"), "eligible");
  fixture.grant();
  assert.equal((await approval(token)).status, 201);
  const holdClock = "'" + hold.expiresAt + "'::timestamptz";
  assert.equal(at(holdClock + " - interval '1 microsecond'"), "held");
  assert.equal(at(holdClock), "eligible");
  for (const statement of statements) assertGuard(sql, statement);

  const postgres = (...args: string[]) =>
    stack.compose("exec", "-T", "postgres", ...args).trim();
  const restored = "helpinsights_retention_" + randomBytes(5).toString("hex");
  postgres("createdb", "-U", "helpinsights", restored);
  try {
    postgres(
      "sh",
      "-ec",
      `
      backup=$(mktemp)
      trap 'rm -f "$backup"' EXIT
      pg_dump -U helpinsights -Fc -f "$backup" helpinsights
      pg_restore -U helpinsights --exit-on-error -d "${restored}" "$backup"
    `,
    );
    const restoredSql = (statement: string) =>
      postgres(
        "psql",
        "-XAtq",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "helpinsights",
        "-d",
        restored,
        "-c",
        statement,
      );
    assert.equal(
      restoredSql(`
      SELECT r.answers->0->>'value' FROM public.responses r WHERE r.id = '${response}'
    `),
      "synthetic",
    );
    assert.equal(
      restoredSql(`
      SELECT disposition FROM public.retention_disposition('${survey}', now())
    `),
      "held",
    );
    assertGuard(restoredSql, statements[0]);
  } finally {
    postgres("dropdb", "-U", "helpinsights", restored);
  }
});

test("a disposal transaction with an older repeatable-read snapshot cannot miss a committed hold", () => {
  const fixture = seedRetention();
  const { stack, sql, workspace, survey, response, approver, hold } = fixture;
  sql(`UPDATE public.surveys SET status = 'closed' WHERE id = '${survey}'`);
  sql(
    `UPDATE public.surveys SET expiry_at = now() - interval '1 day' WHERE id = '${survey}'`,
  );
  fixture.grant();
  const result = stack.compose(
    "run",
    "--rm",
    "--no-deps",
    "--entrypoint",
    "node",
    "migrate",
    "--input-type=module",
    "-e",
    `
      import assert from 'node:assert/strict';
      import { setTimeout as delay } from 'node:timers/promises';
      import pg from 'pg';
      const [survey, response, workspace, approver, evidence, expiry] = process.argv.slice(1);
      const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
      const disposal = await pool.connect();
      const approval = await pool.connect();
      const revoke = await pool.connect();
      try {
        await disposal.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
        await disposal.query("SET LOCAL statement_timeout = '10s'");
        assert.equal(
          (await disposal.query(
            'SELECT disposition FROM public.retention_disposition($1, clock_timestamp())',
            [survey]
          )).rows[0].disposition,
          'eligible'
        );
        const pid = (await disposal.query('SELECT pg_backend_pid() AS id')).rows[0].id;
        await approval.query('BEGIN');
        await approval.query('SET LOCAL ROLE helpinsights_app');
        await approval.query("SELECT set_config('helpinsights.actor_id', $1, true)", [approver]);
        const approved = await approval.query(
          "SELECT outcome FROM public.approve_retention_hold($1, 'legal', $2, $3)",
          [survey, evidence, expiry]
        );
        assert.equal(approved.rows[0].outcome, 'approved');
        for (const statement of [
          "UPDATE public.workspace_memberships SET role = 'analyst' WHERE workspace_id = $1 AND user_id = $2",
          "DELETE FROM public.retention_hold_approvers WHERE workspace_id = $1 AND user_id = $2",
        ]) {
          await revoke.query('BEGIN');
          await revoke.query("SET LOCAL lock_timeout = '500ms'");
          await assert.rejects(revoke.query(statement, [workspace, approver]), { code: '55P03' });
          await revoke.query('ROLLBACK');
        }
        const deleting = disposal.query('DELETE FROM public.responses WHERE id = $1', [response])
          .then(() => 'deleted', (error) => error.code);
        let waited = false;
        for (let retry = 0; retry < 120; retry++) {
          const { rows } = await pool.query(
            'SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1', [pid]
          );
          if (rows[0].wait_event_type === 'Lock') {
            waited = true;
            break;
          }
          await delay(25);
        }
        await approval.query('COMMIT');
        const outcome = await deleting;
        assert.equal(waited, true, 'disposal must wait for the hold transaction');
        assert.equal(outcome, '40001', 'stale disposal snapshots must fail closed');
        await disposal.query('ROLLBACK');
        assert.equal((await pool.query(
          'SELECT count(*)::int AS count FROM public.responses WHERE id = $1', [response]
        )).rows[0].count, 1);
        console.log('concurrent stale disposal rejected; response preserved');
      } finally {
        await approval.query('ROLLBACK');
        await disposal.query('ROLLBACK');
        await revoke.query('ROLLBACK');
        revoke.release();
        approval.release();
        disposal.release();
        await pool.end();
      }
    `,
    survey,
    response,
    workspace,
    approver,
    hold.evidenceReference,
    hold.expiresAt,
  );
  assert.match(
    result,
    /concurrent stale disposal rejected; response preserved/,
  );
});

test("retention migration preserves legacy closure deadlines and fails closed on missing deadlines", () => {
  const { stack } = surveyFixture();
  const postgres = (...args: string[]) =>
    stack.compose("exec", "-T", "postgres", ...args).trim();
  const upgraded = "helpinsights_legacy_" + randomBytes(5).toString("hex");
  postgres("createdb", "-U", "helpinsights", upgraded);
  try {
    const result = stack.compose(
      "run",
      "--rm",
      "--no-deps",
      "--entrypoint",
      "node",
      "migrate",
      "--input-type=module",
      "-e",
      `
        import assert from 'node:assert/strict';
        import pg from 'pg';
        import { loadMigrations, migrate } from './packages/database/migrate.ts';
        const url = new URL(process.env.DATABASE_URL);
        url.pathname = '/' + process.argv[1];
        const pool = new pg.Pool({ connectionString: url.toString() });
        try {
          const migrations = await loadMigrations();
          const index = migrations.findIndex((item) => item.name.endsWith('-retention.sql'));
          assert.ok(index > 0);
          await migrate(pool, migrations.slice(0, index));
          const { rows: [organisation] } = await pool.query(
            "INSERT INTO public.organisations (name) VALUES ('Legacy retention fixture') RETURNING id"
          );
          const { rows: [workspace] } = await pool.query(
            "INSERT INTO public.workspaces (organisation_id, name) VALUES ($1, 'Legacy workspace') RETURNING id",
            [organisation.id]
          );
          const { rows: [policy] } = await pool.query(
            'INSERT INTO public.retention_policies (workspace_id, days_after_close) VALUES ($1, 90) RETURNING id',
            [workspace.id]
          );
          const deadline = new Date('2001-07-01T10:00:00Z');
          await pool.query(
            "INSERT INTO public.surveys (workspace_id, retention_policy_id, title, status, privacy_mode, expiry_at) " +
              "VALUES ($1, $2, 'Stored', 'closed', 'anonymous', $3), ($1, $2, 'Unstamped', 'closed', 'anonymous', NULL)",
            [workspace.id, policy.id, deadline]
          );
          await migrate(pool, migrations);
          const { rows } = await pool.query(
            'SELECT s.title, s.closed_at, d.expiry_at, d.disposition ' +
              'FROM public.surveys s CROSS JOIN LATERAL public.retention_disposition(s.id, now()) d ORDER BY s.title'
          );
          assert.deepEqual(rows, [
            { title: 'Stored', closed_at: null, expiry_at: deadline, disposition: 'eligible' },
            { title: 'Unstamped', closed_at: null, expiry_at: null, disposition: 'missing_deadline' },
          ]);
          console.log('legacy retention deadlines preserved; missing deadline fails closed');
        } finally {
          await pool.end();
        }
      `,
      upgraded,
    );
    assert.match(
      result,
      /legacy retention deadlines preserved; missing deadline fails closed/,
    );
  } finally {
    postgres("dropdb", "-U", "helpinsights", upgraded);
  }
});
