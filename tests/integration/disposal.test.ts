import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { surveyFixture } from "../fixtures/survey.ts";

function seedDisposal() {
  const fixture = surveyFixture();
  const approver = randomUUID();
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  fixture.sql(`
    INSERT INTO public.users (id, display_name) VALUES ('${approver}', 'Synthetic disposal reviewer');
    INSERT INTO public.sessions (token_hash, user_id, expires_at)
      VALUES (decode('${tokenHash}', 'hex'), '${approver}', now() + interval '1 hour');
    INSERT INTO public.workspace_memberships (workspace_id, user_id, role)
      VALUES ('${fixture.workspace}', '${approver}', 'viewer');
    INSERT INTO public.retention_hold_approvers (workspace_id, user_id)
      VALUES ('${fixture.workspace}', '${approver}');
  `);
  function record(
    state:
      | "eligible"
      | "held"
      | "scheduled"
      | "export_pending"
      | "live_session_present",
  ) {
    const survey = randomUUID();
    const version = randomUUID();
    const response = randomUUID();
    const job = randomUUID();
    const distribution = randomBytes(32).toString("hex");
    fixture.sql(`
      INSERT INTO public.surveys (id, workspace_id, title, privacy_mode, status, retention_policy_id, expiry_at)
        VALUES ('${survey}', '${fixture.workspace}', 'Synthetic disposal specimen', 'anonymous', 'closed', '${fixture.retentionPolicy}',
          now() + interval '${state === "scheduled" ? "1 day" : "-1 day"}');
      INSERT INTO public.survey_versions (id, survey_id, version, definition, hash)
        VALUES ('${version}', '${survey}', 1, '{}', repeat('0', 64));
      INSERT INTO public.distributions (token_hash, survey_version_id)
        VALUES (decode('${distribution}', 'hex'), '${version}');
      INSERT INTO public.responses (id, survey_version_id, answers, retry_key_hash, payload_hash)
        VALUES ('${response}', '${version}', '[{"questionId":"q","value":"synthetic"}]',
          decode(repeat('0', 64), 'hex'), decode(repeat('1', 64), 'hex'));
      INSERT INTO public.export_jobs (id, survey_version_id, requested_by, format, status, archive, expires_at, next_attempt_at)
        VALUES ('${job}', '${version}', '${approver}', 'jasp_csv_bundle', '${state === "export_pending" ? "queued" : "completed"}',
          ${state === "export_pending" ? "NULL" : "decode('414243', 'hex')"}, now() + interval '2 days', now() + interval '1 day');
      INSERT INTO public.export_download_audit (export_id, requested_by)
        VALUES ('${job}', '${approver}');
    `);
    if (state === "held")
      fixture.sql(`
        INSERT INTO public.retention_holds (survey_id, approved_by, reason, evidence_reference, applied_at, expires_at)
        VALUES ('${survey}', '${approver}', 'legal', '${randomUUID()}', now(), now() + interval '1 day')
      `);
    if (state === "live_session_present")
      fixture.sql(
        "INSERT INTO public.live_sessions (quiz_version_id, host_id, mode, pin_hash) " +
          "SELECT '" +
          version +
          "', m.user_id, 'live_poll', decode('" +
          randomBytes(32).toString("hex") +
          "', 'hex') " +
          "FROM public.workspace_memberships m WHERE m.workspace_id = '" +
          fixture.workspace +
          "' AND m.role = 'owner'",
      );
    return { survey, version, job, response, distribution, state };
  }
  return { ...fixture, token, record };
}

test("appointed workspace reviewers can preview disposal without seeing survey contents", async () => {
  const fixture = seedDisposal();
  const records = [
    fixture.record("eligible"),
    fixture.record("held"),
    fixture.record("scheduled"),
    fixture.record("export_pending"),
    fixture.record("live_session_present"),
  ];
  function preview(survey: string, token?: string, method = "GET") {
    return fetch(
      fixture.stack.baseUrl() +
        "/api/v1/surveys/" +
        survey +
        "/retention/disposal-preview",
      {
        method,
        headers: token ? { Authorization: "Bearer " + token } : undefined,
      },
    );
  }
  for (const { survey, state } of records) {
    const result = await preview(survey, fixture.token);
    assert.equal(result.status, 200);
    const body = await result.json();
    assert.deepEqual(Object.keys(body).sort(), [
      "disposition",
      "expiryAt",
      "protectedUntil",
    ]);
    assert.equal(body.disposition, state);
    assert.ok(Number.isFinite(Date.parse(body.expiryAt)));
    if (state === "held")
      assert.ok(Number.isFinite(Date.parse(body.protectedUntil)));
  }
  const { survey } = records[0];
  assert.equal((await preview(survey)).status, 401);
  const forbidden = await preview(survey, fixture.ownerToken);
  assert.equal(forbidden.status, 403);
  const error = await forbidden.json();
  assert.equal(error.code, "FORBIDDEN");
  assert.deepEqual(Object.keys(error).sort(), ["code", "message", "requestId"]);
  assert.equal((await preview(survey, fixture.outsiderToken)).status, 404);
  assert.equal((await preview(survey, fixture.token, "POST")).status, 405);
  assert.equal(
    fixture.sql("SELECT count(*) FROM public.survey_disposal_tombstones"),
    "0",
  );
});

test("fixture-only disposal atomically clears archive derivatives and replays a redacted tombstone", () => {
  const fixture = seedDisposal();
  const { stack, workspace } = fixture;
  assert.equal(
    fixture.sql(
      "SELECT to_regclass('public.survey_disposal_tombstones')::text",
    ),
    "survey_disposal_tombstones",
  );
  assert.equal(fixture.sql("SELECT to_regnamespace('disposal_fixture')"), "");
  stack.compose(
    "exec",
    "-T",
    "app",
    "node",
    "-e",
    "if (require('node:fs').existsSync('/app/tests/fixtures/disposal.sql')) process.exitCode = 1",
  );
  assert.equal(
    fixture.sql(`
    SELECT has_table_privilege('helpinsights_app', 'public.survey_disposal_tombstones', 'INSERT')
      OR has_table_privilege('helpinsights_exporter', 'public.survey_disposal_tombstones', 'INSERT')
  `),
    "f",
  );
  const eligible = fixture.record("eligible");
  const held = fixture.record("held");
  const future = fixture.record("scheduled");
  const pending = fixture.record("export_pending");
  const liveRoom = fixture.record("live_session_present");
  const project = process.env.HELPINSIGHTS_TEST_PROJECT!;
  assert.match(project, /^helpinsights-test-[a-f0-9]{12}$/);
  const marker = randomUUID();
  const database = () =>
    "helpinsights_disposal_" + randomBytes(6).toString("hex");
  const active = database();
  const restored = database();
  const postgres = (...args: string[]) =>
    stack.compose("exec", "-T", "postgres", ...args).trim();
  const sql = (db: string, statement: string) =>
    postgres(
      "psql",
      "-XAtq",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "helpinsights",
      "-d",
      db,
      "-c",
      statement,
    );
  const fixtureSql = readFileSync(
    new URL("../fixtures/disposal.sql", import.meta.url),
    "utf8",
  );
  function install(db: string, surveys: string[]) {
    assert.match(db, /^helpinsights_disposal_[a-f0-9]{12}$/);
    sql(db, fixtureSql);
    for (const survey of surveys)
      sql(
        db,
        `INSERT INTO disposal_fixture.run_scope VALUES ('${project}', '${db}', '${marker}', '${survey}')`,
      );
  }
  function rows(db: string, record: ReturnType<typeof fixture.record>) {
    return sql(
      db,
      `
      SELECT concat(
        (SELECT count(*) FROM public.surveys WHERE id = '${record.survey}'),
        (SELECT count(*) FROM public.survey_versions WHERE id = '${record.version}'),
        (SELECT count(*) FROM public.responses WHERE id = '${record.response}'),
        (SELECT count(*) FROM public.distributions WHERE token_hash = decode('${record.distribution}', 'hex')),
        (SELECT count(*) FROM public.export_jobs WHERE id = '${record.job}'),
        (SELECT count(*) FROM public.export_download_audit WHERE export_id = '${record.job}')
      )
    `,
    );
  }
  const call = (
    survey: string,
    guard = marker,
    replay = "NULL",
    scope = "NULL",
  ) =>
    `disposal_fixture.dispose('${project}', '${guard}', '${survey}', ${scope}, ${replay})`;

  postgres("createdb", "-U", "helpinsights", active);
  try {
    postgres("createdb", "-U", "helpinsights", restored);
    try {
      postgres(
        "sh",
        "-ec",
        `
        backup=$(mktemp)
        trap 'rm -f "$backup"' EXIT
        pg_dump -U helpinsights -Fc -f "$backup" helpinsights
        pg_restore -U helpinsights --exit-on-error -d "${active}" "$backup"
        pg_restore -U helpinsights --exit-on-error -d "${restored}" "$backup"
      `,
      );
      install(active, [
        eligible.survey,
        held.survey,
        future.survey,
        pending.survey,
        liveRoom.survey,
      ]);
      for (const expression of [
        call(eligible.survey, randomUUID()),
        call(randomUUID()),
        call(eligible.survey).replace(
          project,
          "helpinsights-test-000000000000",
        ),
      ]) {
        assert.equal(
          sql(
            active,
            `
          DO $negative$
          BEGIN
            PERFORM ${expression};
            RAISE EXCEPTION 'Expected fixture ownership denial';
          EXCEPTION WHEN insufficient_privilege THEN NULL;
          END
          $negative$;
          SELECT 'denied';
        `,
          ),
          "denied",
        );
      }
      for (const record of [held, future, pending, liveRoom]) {
        assert.equal(
          sql(active, `SELECT outcome FROM ${call(record.survey)}`),
          record.state,
        );
        assert.equal(rows(active, record), "111111");
      }

      assert.equal(
        sql(
          active,
          "SELECT (SELECT count(*) FROM public.live_sessions WHERE quiz_version_id = '" +
            liveRoom.version +
            "') || ':' || (SELECT count(*) FROM public.survey_disposal_tombstones WHERE survey_id = '" +
            liveRoom.survey +
            "')",
        ),
        "1:0",
      );

      const lockProof = stack.compose(
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
          const [database, project, marker, survey, job] = process.argv.slice(1);
          assert.match(database, /^helpinsights_disposal_[a-f0-9]{12}$/);
          const url = new URL(process.env.DATABASE_URL);
          url.pathname = '/' + database;
          const pool = new pg.Pool({ connectionString: url.toString() });
          const worker = await pool.connect();
          const disposal = await pool.connect();
          try {
            await worker.query('BEGIN');
            await worker.query('SET LOCAL ROLE helpinsights_exporter');
            const locked = await worker.query(
              "SELECT id FROM public.export_jobs WHERE id = $1 AND status = 'queued' FOR UPDATE SKIP LOCKED",
              [job]
            );
            assert.equal(locked.rows[0]?.id, job);
            await disposal.query('BEGIN');
            await disposal.query("SET LOCAL lock_timeout = '500ms'");
            await assert.rejects(
              disposal.query(
                'SELECT outcome FROM disposal_fixture.dispose($1,$2,$3,NULL,NULL)',
                [project, marker, survey]
              ),
              { code: '55P03' }
            );
            console.log('in-progress export lock blocks disposal');
          } finally {
            await disposal.query('ROLLBACK');
            await worker.query('ROLLBACK');
            disposal.release();
            worker.release();
            await pool.end();
          }
        `,
        active,
        project,
        marker,
        pending.survey,
        pending.job,
      );
      assert.match(lockProof, /in-progress export lock blocks disposal/);
      assert.equal(rows(active, pending), "111111");

      assert.equal(
        sql(
          active,
          `
        BEGIN;
        CREATE FUNCTION disposal_fixture.reject_version() RETURNS trigger LANGUAGE plpgsql AS $fn$
          BEGIN RAISE check_violation USING MESSAGE = 'fixture failure'; END
        $fn$;
        CREATE TRIGGER stop_fixture BEFORE DELETE ON public.survey_versions
          FOR EACH ROW EXECUTE FUNCTION disposal_fixture.reject_version();
        DO $check$
        BEGIN
          PERFORM ${call(eligible.survey)};
          RAISE EXCEPTION 'Expected fixture failure';
        EXCEPTION WHEN check_violation THEN
          IF SQLERRM <> 'fixture failure' THEN RAISE; END IF;
        END
        $check$;
        SELECT (SELECT count(*) FROM public.export_jobs WHERE id = '${eligible.job}')
          || ':' || (SELECT count(*) FROM public.survey_disposal_tombstones WHERE survey_id = '${eligible.survey}');
        ROLLBACK;
      `,
        ),
        "1:0",
      );
      assert.equal(rows(active, eligible), "111111");
      const concurrently = postgres(
        "sh",
        "-ec",
        `
          db=$1
          query=$2
          first=$(mktemp)
          second=$(mktemp)
          trap 'rm -f "$first" "$second"' EXIT
          psql -XAtq -v ON_ERROR_STOP=1 -U helpinsights -d "$db" -c "$query" > "$first" &
          child=$!
          psql -XAtq -v ON_ERROR_STOP=1 -U helpinsights -d "$db" -c "$query" > "$second"
          wait "$child"
          cat "$first" "$second"
        `,
        "disposal-fixture",
        active,
        `SELECT outcome FROM ${call(eligible.survey)}`,
      );
      assert.deepEqual(concurrently.split(/\r?\n/).sort(), [
        "already_disposed",
        "disposed",
      ]);
      assert.equal(rows(active, eligible), "000000");
      const ledger = (db: string) =>
        sql(
          db,
          `
        SELECT jsonb_build_object('surveyId', survey_id, 'workspaceId', workspace_id, 'disposedAt', disposed_at)
        FROM public.survey_disposal_tombstones WHERE survey_id = '${eligible.survey}'
      `,
        );
      const record = JSON.parse(ledger(active));
      assert.deepEqual(Object.keys(record).sort(), [
        "disposedAt",
        "surveyId",
        "workspaceId",
      ]);
      assert.equal(record.workspaceId, workspace);
      assert.equal(
        sql(active, `SELECT outcome FROM ${call(eligible.survey)}`),
        "already_disposed",
      );
      assert.deepEqual(JSON.parse(ledger(active)), record);

      assert.equal(rows(restored, eligible), "111111");
      install(restored, [eligible.survey]);
      const disposedAt = "'" + record.disposedAt + "'::timestamptz";
      assert.equal(
        sql(
          restored,
          `SELECT outcome FROM ${call(eligible.survey, marker, disposedAt, "'" + randomUUID() + "'")}`,
        ),
        "workspace_mismatch",
      );
      assert.equal(rows(restored, eligible), "111111");
      assert.equal(
        sql(
          restored,
          `SELECT outcome FROM ${call(eligible.survey, marker, disposedAt, "'" + workspace + "'")}`,
        ),
        "disposed",
      );
      assert.deepEqual(JSON.parse(ledger(restored)), record);
      assert.equal(rows(restored, eligible), "000000");
    } finally {
      postgres("dropdb", "-U", "helpinsights", restored);
    }
  } finally {
    postgres("dropdb", "-U", "helpinsights", active);
  }
});
