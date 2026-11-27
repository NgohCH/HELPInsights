import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { runningTestStack } from "../../scripts/test-docker.ts";

test("disposal preview migration protects an existing closed survey and Live Poll room", () => {
  const { compose } = runningTestStack();
  const database = "helpinsights_lifecycle_" + randomBytes(6).toString("hex");
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
      import pg from "pg";
      import { loadMigrations, migrate } from "./packages/database/migrate.ts";
      const [database] = process.argv.slice(1);
      assert.match(database, /^helpinsights_lifecycle_[a-f0-9]{12}$/);
      const url = new URL(process.env.DATABASE_URL);
      url.pathname = "/" + database;
      const pool = new pg.Pool({ connectionString: url.href });
      const ledger = () => pool.query("SELECT name, checksum FROM public.schema_migrations ORDER BY name");
      try {
        const migrations = await loadMigrations();
        const target = migrations.findIndex(({ name }) => name.endsWith("-disposal-preview.sql"));
        assert.ok(target > 0);
        await migrate(pool, migrations.slice(0, target));
        const before = await ledger();
        const { rows: [room] } = await pool.query(\`
          WITH org AS (
              INSERT INTO public.organisations (name) VALUES ('Synthetic lifecycle upgrade') RETURNING id
          ), workspace AS (
              INSERT INTO public.workspaces (organisation_id, name) SELECT id, 'Lifecycle workspace' FROM org RETURNING id
          ), policy AS (
              INSERT INTO public.retention_policies (workspace_id, days_after_close) SELECT id, 90 FROM workspace RETURNING id, workspace_id
          ), survey AS (
              INSERT INTO public.surveys (workspace_id, retention_policy_id, title, privacy_mode, status, expiry_at)
              SELECT workspace_id, id, 'Expired fixture', 'anonymous', 'closed', now() - interval '1 day' FROM policy RETURNING id
          ), version AS (
              INSERT INTO public.survey_versions (survey_id, version, definition, hash)
              SELECT id, 1, '{}'::jsonb, repeat('0', 64) FROM survey RETURNING id, survey_id
          ), host AS (
              INSERT INTO public.users (display_name) VALUES ('Synthetic live host') RETURNING id
          )
          INSERT INTO public.live_sessions (quiz_version_id, host_id, mode, pin_hash)
          SELECT version.id, host.id, 'live_poll', decode(repeat('1', 64), 'hex') FROM version CROSS JOIN host
          RETURNING id, quiz_version_id
        \`);
        await migrate(pool, migrations);
        await migrate(pool, migrations);
        const after = await ledger();
        assert.deepEqual(after.rows.slice(0, target), before.rows);
        assert.equal(after.rows[target].checksum, migrations[target].checksum);
        const persisted = await pool.query("SELECT id, quiz_version_id FROM public.live_sessions WHERE id = $1", [room.id]);
        assert.deepEqual(persisted.rows, [room]);
        const outcome = await pool.query(
          "SELECT d.disposition FROM public.survey_versions v CROSS JOIN LATERAL public.retention_disposal_check(v.survey_id, now()) d WHERE v.id = $1",
          [room.quiz_version_id],
        );
        assert.deepEqual(outcome.rows, [{ disposition: "live_session_present" }]);
        console.log("Seeded room preserved and protected after upgrade");
      } finally {
        await pool.end();
      }
      `,
      database,
    );
    assert.match(output, /Seeded room preserved and protected after upgrade/);
  } finally {
    postgres("dropdb", "-U", "helpinsights", database);
  }
});
