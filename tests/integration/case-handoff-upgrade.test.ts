import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { runningTestStack } from "../../scripts/test-docker.ts";

test("case handoff upgrades migration 022 without changing seeded collection or disposal", () => {
  const { compose } = runningTestStack();
  const database = "helpinsights_case_" + randomBytes(6).toString("hex");
  const postgres = (...args: string[]) =>
    compose("exec", "-T", "postgres", ...args);
  postgres("createdb", "-U", "helpinsights", database);
  try {
    const output = compose(
      "run",
      "--rm",
      "--no-deps",
      "--entrypoint",
      "node",
      "migrate",
      "--input-type=module",
      "-e",
      `
      import assert from "node:assert/strict";
      import { randomBytes, randomUUID } from "node:crypto";
      import pg from "pg";
      import { loadMigrations, migrate } from "./packages/database/migrate.ts";
      const [database] = process.argv.slice(1);
      assert.match(database, /^helpinsights_case_[a-f0-9]{12}$/);
      const url = new URL(process.env.DATABASE_URL);
      url.pathname = "/" + database;
      const pool = new pg.Pool({ connectionString: url.href });
      const client = await pool.connect();
      const query = (text, values) => client.query(text, values);
      const ledger = () => query("SELECT name, checksum FROM public.schema_migrations ORDER BY name");
      const preview = (survey) => query("SELECT disposition FROM public.retention_disposal_check($1, now())", [survey]);
      try {
        const migrations = await loadMigrations();
        const base = migrations.slice(0, 22);
        assert.equal(base.at(-1)?.name, "022-integration-settings.sql");
        await migrate(pool, base);
        const before = await ledger();
        const { rows: [fixture] } = await query(\`
          WITH org AS (
            INSERT INTO public.organisations (name) VALUES ('Synthetic case upgrade') RETURNING id
          ), workspace AS (
            INSERT INTO public.workspaces (organisation_id, name) SELECT id, 'Case workspace' FROM org RETURNING id
          ), policy AS (
            INSERT INTO public.retention_policies (workspace_id, days_after_close) SELECT id, 90 FROM workspace RETURNING id, workspace_id
          ), survey AS (
            INSERT INTO public.surveys (workspace_id, retention_policy_id, title, privacy_mode, status, expiry_at)
            SELECT workspace_id, id, 'Legacy closed survey', 'anonymous', 'closed', now() - interval '1 day' FROM policy RETURNING id, workspace_id
          ), version AS (
            INSERT INTO public.survey_versions (survey_id, version, definition, hash)
            SELECT id, 1, '{}', repeat('a', 64) FROM survey RETURNING id
          ), distribution AS (
            INSERT INTO public.distributions (token_hash, survey_version_id)
            SELECT $1, id FROM version
          ), answer AS (
            INSERT INTO public.responses (survey_version_id, answers, retry_key_hash, payload_hash)
            SELECT id, '[{"questionId":"q","value":"synthetic sample"}]', $2, $3 FROM version RETURNING id
          ), reviewer AS (
            INSERT INTO public.users (display_name) VALUES ('Synthetic case reviewer') RETURNING id
          )
          SELECT survey.id AS survey, workspace.id AS workspace, version.id AS version, answer.id AS answer, reviewer.id AS reviewer
          FROM survey CROSS JOIN workspace CROSS JOIN version CROSS JOIN answer CROSS JOIN reviewer
        \`, [randomBytes(32), randomBytes(32), randomBytes(32)]);
        const { survey, workspace, version, answer, reviewer } = fixture;
        const collection = () => query(\`
          SELECT to_jsonb(s) AS survey, to_jsonb(v) AS version, to_jsonb(d) AS distribution, to_jsonb(r) AS response
          FROM public.surveys s
          JOIN public.survey_versions v ON v.survey_id = s.id
          JOIN public.distributions d ON d.survey_version_id = v.id
          JOIN public.responses r ON r.survey_version_id = v.id
          WHERE s.id = $1 AND r.id = $2
        \`, [survey, answer]);
        const seeded = await collection();
        assert.equal(seeded.rowCount, 1);
        assert.deepEqual((await preview(survey)).rows, [{ disposition: "eligible" }]);
        assert.equal(migrations[22]?.name, "023-case-handoff.sql");
        await migrate(pool, migrations);
        await migrate(pool, migrations);
        const after = await ledger();
        assert.deepEqual(after.rows.slice(0, 22), before.rows);
        assert.equal(after.rows[22].checksum, migrations[22].checksum);
        assert.deepEqual((await collection()).rows, seeded.rows);

        await query("INSERT INTO public.workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'viewer')", [workspace, reviewer]);
        await query("INSERT INTO public.case_handoff_reviewers (workspace_id, user_id) VALUES ($1, $2)", [workspace, reviewer]);
        const { rows: [basis] } = await query(\`
          INSERT INTO public.case_handoff_basis (workspace_id, survey_version_id, kind, approved_at, expires_at)
          VALUES ($1, $2, 'synthetic_fixture', now() - interval '1 hour', now() + interval '1 hour') RETURNING id
        \`, [workspace, version]);
        const queue = async (key) => {
          await query("BEGIN");
          try {
            await query("SET LOCAL ROLE helpinsights_app");
            await query("SELECT set_config('helpinsights.actor_id', $1, true)", [reviewer]);
            const result = await query(
              "SELECT outcome FROM public.queue_synthetic_case_handoff($1, $2, $3, $4, 'campus_facilities', 'normal', true)",
              [survey, version, basis.id, key],
            );
            await query("COMMIT");
            return result.rows;
          } catch (error) {
            await query("ROLLBACK");
            throw error;
          }
        };
        const key = randomUUID();
        assert.deepEqual(await queue(key), [{ outcome: "queued" }]);
        assert.deepEqual((await preview(survey)).rows, [{ disposition: "eligible" }]);

        await query("INSERT INTO public.survey_disposal_tombstones (survey_id, workspace_id, disposed_at) VALUES ($1, $2, now())", [survey, workspace]);
        assert.deepEqual(await queue(key), [{ outcome: "not_found" }]);
        assert.deepEqual(await queue(randomUUID()), [{ outcome: "not_found" }]);

        await query("DELETE FROM public.distributions WHERE survey_version_id = $1", [version]);
        await query("DELETE FROM public.responses WHERE id = $1", [answer]);
        await query("DELETE FROM public.survey_versions WHERE id = $1", [version]);
        await query("DELETE FROM public.surveys WHERE id = $1", [survey]);
        assert.deepEqual((await collection()).rows, []);
        assert.deepEqual((await query(
          "SELECT survey_id, survey_version_id, approved_by, status FROM public.case_handoff_events WHERE idempotency_key = $1",
          [key],
        )).rows, [{ survey_id: survey, survey_version_id: version, approved_by: reviewer, status: "queued" }]);
        console.log("Seeded collection and disposal preserved after migration 023");
      } finally {
        client.release();
        await pool.end();
      }
      `,
      database,
    );
    assert.match(
      output,
      /Seeded collection and disposal preserved after migration 023/,
    );
  } finally {
    postgres("dropdb", "-U", "helpinsights", database);
  }
});
