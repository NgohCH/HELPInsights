import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { runningTestStack } from "../../scripts/test-docker.ts";

test("adding synthetic consent preserves a seeded older open distribution", () => {
  const { compose } = runningTestStack();
  const database = "consent_upgrade_" + randomUUID().replaceAll("-", "");
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
      "HELPINSIGHTS_CONSENT_UPGRADE_DB=" + database,
      "--entrypoint",
      "node",
      "migrate",
      "--input-type=module",
      "-e",
      `
      import assert from 'node:assert/strict';
      import { randomBytes } from 'node:crypto';
      import pg from 'pg';
      import { loadMigrations, migrate } from './packages/database/migrate.ts';
      const databaseUrl = new URL(process.env.DATABASE_URL);
      databaseUrl.pathname = '/' + process.env.HELPINSIGHTS_CONSENT_UPGRADE_DB;
      const pool = new pg.Pool({ connectionString: databaseUrl.href });
      const client = await pool.connect();
      try {
        const migrations = await loadMigrations();
        const index = migrations.findIndex(({name}) => name.endsWith('-research-consent.sql'));
        assert.ok(index >= 5);
        await migrate(pool, migrations.slice(0, index));
        const prior = await client.query("SELECT name, checksum FROM public.schema_migrations ORDER BY name");
        const { rows: [org] } = await client.query("INSERT INTO public.organisations (name) VALUES ('Synthetic upgrade') RETURNING id");
        const { rows: [workspace] } = await client.query("INSERT INTO public.workspaces (organisation_id, name) VALUES ($1, 'Synthetic upgrade') RETURNING id", [org.id]);
        const { rows: [policy] } = await client.query("INSERT INTO public.retention_policies (workspace_id, days_after_close) VALUES ($1, 90) RETURNING id", [workspace.id]);
        const { rows: [survey] } = await client.query("INSERT INTO public.surveys (workspace_id, retention_policy_id, title, privacy_mode, status) VALUES ($1, $2, 'Old open survey', 'anonymous', 'published') RETURNING id", [workspace.id, policy.id]);
        const { rows: [version] } = await client.query("INSERT INTO public.survey_versions (survey_id, version, definition, hash) VALUES ($1, 1, '{}'::jsonb, repeat('a', 64)) RETURNING id", [survey.id]);
        const distributionHash = randomBytes(32);
        await client.query("INSERT INTO public.distributions (token_hash, survey_version_id) VALUES ($1, $2)", [distributionHash, version.id]);
        await migrate(pool, migrations);
        await migrate(pool, migrations);
        const updated = await client.query("SELECT name, checksum FROM public.schema_migrations ORDER BY name");
        assert.deepEqual(updated.rows.slice(0, index), prior.rows);
        assert.equal(updated.rows[index].checksum, migrations[index].checksum);
        const consent = await client.query("SELECT * FROM public.resolve_research_consent($1)", [distributionHash]);
        assert.deepEqual(consent.rows, []);
        await client.query("SET ROLE helpinsights_runtime");
        const submitted = await client.query("SELECT outcome FROM public.accept_response($1,$2,$3,$4,'[]'::jsonb)", [distributionHash, version.id, randomBytes(32), randomBytes(32)]);
        assert.deepEqual(submitted.rows, [{ outcome: 'accepted' }]);
        console.log('seeded open collection kept existing behavior');
      } finally {
        client.release(true);
        await pool.end();
      }
      `,
    );
    assert.match(output, /seeded open collection kept existing behavior/);
  } finally {
    sql("DROP DATABASE " + database);
  }
});
