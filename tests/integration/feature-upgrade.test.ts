import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { runningTestStack } from "../../scripts/test-docker.ts";

test("feature request migration upgrades an existing survey database without changing numeric drafts", () => {
  const { compose } = runningTestStack();
  const database = "feature_upgrade_" + randomUUID().replaceAll("-", "");
  const sql = (statement: string) =>
    compose(
      "exec",
      "-T",
      "postgres",
      "psql",
      "-XAtq",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "helpinsights",
      "-d",
      "helpinsights",
      "-c",
      statement,
    );
  sql("CREATE DATABASE " + database);
  try {
    const output = compose(
      "run",
      "--rm",
      "--no-deps",
      "-e",
      "HELPINSIGHTS_UPGRADE_DB=" + database,
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
      url.pathname = '/' + process.env.HELPINSIGHTS_UPGRADE_DB;
      const pool = new pg.Pool({ connectionString: url.href });
      try {
        const all = await loadMigrations();
        const start = all.findIndex(({ name }) => name.endsWith('-feature-requests.sql'));
        assert.ok(start >= 5);
        await migrate(pool, all.slice(0, start));
        const before = await pool.query(
          "SELECT name, checksum FROM public.schema_migrations ORDER BY name",
        );
        const { rows: [organization] } = await pool.query("INSERT INTO public.organisations (name) VALUES ('Synthetic upgrade') RETURNING id");
        const { rows: [workspace] } = await pool.query("INSERT INTO public.workspaces (organisation_id, name) VALUES ($1, 'Synthetic workspace') RETURNING id", [organization.id]);
        const { rows: [policy] } = await pool.query("INSERT INTO public.retention_policies (workspace_id, days_after_close) VALUES ($1, 90) RETURNING id", [workspace.id]);
        const draft = { schemaVersion: '1', title: 'Legacy numeric draft', pages: [{ id: 'one', questions: [{ id: 'number', code: 'number', type: 'number', title: 'Quantity', required: true }] }] };
        const { rows: [survey] } = await pool.query("INSERT INTO public.surveys (workspace_id, retention_policy_id, title, privacy_mode, draft) VALUES ($1, $2, $3, 'anonymous', $4) RETURNING id", [workspace.id, policy.id, draft.title, JSON.stringify(draft)]);

        await migrate(pool, all);
        await migrate(pool, all);
        const after = await pool.query("SELECT name, checksum FROM public.schema_migrations ORDER BY name");
        assert.deepEqual(after.rows.slice(0, start), before.rows);
        assert.equal(after.rows[start].checksum, all[start].checksum);
        const saved = await pool.query("SELECT draft FROM public.surveys WHERE id = $1", [survey.id]);
        assert.deepEqual(saved.rows, [{ draft }]);
        const initial = await pool.query("SELECT count(*)::int AS count FROM public.feature_requests");
        assert.deepEqual(initial.rows, [{ count: 0 }]);
        console.log('feature upgrade preserved existing numeric draft');
      } finally {
        await pool.end();
      }
      `,
    );
    assert.match(output, /feature upgrade preserved existing numeric draft/);
  } finally {
    sql("DROP DATABASE " + database);
  }
});
