import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { runningTestStack } from "../../scripts/test-docker.ts";

test("the Registry migration preserves existing open distributions and the trusted response path", () => {
  const { compose } = runningTestStack();
  const database = "registry_upgrade_" + randomUUID().replaceAll("-", "");
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
      "HELPINSIGHTS_REGISTRY_UPGRADE_DB=" + database,
      "--entrypoint",
      "node",
      "migrate",
      "--input-type=module",
      "-e",
      `
      import assert from 'node:assert/strict';
      import { randomBytes } from 'node:crypto';
      import pg from 'pg';
      import { migrate, loadMigrations } from './packages/database/migrate.ts';
      const url = new URL(process.env.DATABASE_URL);
      url.pathname = '/' + process.env.HELPINSIGHTS_REGISTRY_UPGRADE_DB;
      const pool = new pg.Pool({ connectionString: url.href });
      const client = await pool.connect();
      try {
        const all = await loadMigrations();
        const index = all.findIndex(({name}) => name.endsWith('-registry-eligibility.sql'));
        assert.ok(index >= 5);
        await migrate(pool, all.slice(0, index));
        const { rows: [org] } = await client.query("INSERT INTO public.organisations (name) VALUES ('Synthetic upgrade') RETURNING id");
        const { rows: [workspace] } = await client.query("INSERT INTO public.workspaces (organisation_id, name) VALUES ($1, 'Synthetic upgrade') RETURNING id", [org.id]);
        const { rows: [policy] } = await client.query("INSERT INTO public.retention_policies (workspace_id, days_after_close) VALUES ($1, 90) RETURNING id", [workspace.id]);
        const { rows: [survey] } = await client.query("INSERT INTO public.surveys (workspace_id, retention_policy_id, title, privacy_mode, status) VALUES ($1, $2, 'Legacy open survey', 'anonymous', 'published') RETURNING id", [workspace.id, policy.id]);
        const { rows: [version] } = await client.query("INSERT INTO public.survey_versions (survey_id, version, definition, hash) VALUES ($1, 1, '{}'::jsonb, repeat('a', 64)) RETURNING id", [survey.id]);
        const tokenHash = randomBytes(32);
        await client.query("INSERT INTO public.distributions (token_hash, survey_version_id) VALUES ($1, $2)", [tokenHash, version.id]);
        await migrate(pool, all);
        await migrate(pool, all);
        const resolved = await client.query("SELECT id, eligibility_mode FROM public.resolve_collection_distribution($1)", [tokenHash]);
        assert.deepEqual(resolved.rows, [{ id: version.id, eligibility_mode: 'open' }]);
        await client.query("SET ROLE helpinsights_runtime");
        const direct = await client.query("SELECT has_function_privilege(current_user, 'public.accept_response_internal(bytea,uuid,bytea,bytea,jsonb)', 'EXECUTE') AS collect, has_function_privilege(current_user, 'public.resolve_distribution(bytea)', 'EXECUTE') AS resolve");
        assert.deepEqual(direct.rows, [{ collect: false, resolve: false }]);
        const response = await client.query("SELECT outcome FROM public.accept_response($1, $2, $3, $4, '[]'::jsonb)", [tokenHash, version.id, randomBytes(32), randomBytes(32)]);
        assert.deepEqual(response.rows, [{ outcome: 'accepted' }]);
        console.log('registry upgrade kept old distributions open');
      } finally {
        client.release(true);
        await pool.end();
      }
      `,
    );
    assert.match(output, /registry upgrade kept old distributions open/);
  } finally {
    sql("DROP DATABASE " + database);
  }
});
