import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { surveyFixture } from "../fixtures/survey.ts";

test("readiness requires the enabled University identity database permissions", async () => {
  const { stack, sql } = surveyFixture();
  const ready = () => fetch(stack.baseUrl() + "/api/v1/health/ready");
  assert.equal((await ready()).status, 200);
  sql(
    "REVOKE EXECUTE ON FUNCTION public.issue_university_session(text, text, bytea) FROM helpinsights_identity",
  );
  try {
    assert.equal((await ready()).status, 503);
  } finally {
    sql(
      "GRANT EXECUTE ON FUNCTION public.issue_university_session(text, text, bytea) TO helpinsights_identity",
    );
  }
  assert.equal((await ready()).status, 200);
});

test("migration 017 preserves legacy sessions and makes deleted bindings revoke their sessions", () => {
  const { stack, sql } = surveyFixture();
  const database = "university_upgrade_" + randomUUID().replaceAll("-", "");
  sql("CREATE DATABASE " + database);
  try {
    const output = stack.compose(
      "run",
      "--rm",
      "--no-deps",
      "-e",
      "UPGRADE_DATABASE=" + database,
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
      url.pathname = '/' + process.env.UPGRADE_DATABASE;
      const pool = new pg.Pool({ connectionString: url.href });
      const client = await pool.connect();
      try {
        const all = await loadMigrations();
        const index = all.findIndex(({ name }) => name === '017-university-sessions.sql');
        assert.equal(all[index - 1].name, '016-institutional-oauth.sql');
        await migrate(pool, all.slice(0, index));
        const legacy = randomBytes(32);
        const institutional = randomBytes(32);
        const { rows: [user] } = await client.query("INSERT INTO public.users (display_name) VALUES ('Legacy session') RETURNING id");
        await client.query("INSERT INTO public.sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')", [legacy, user.id]);
        await client.query("INSERT INTO public.institutional_principal_bindings (issuer, subject, user_id) VALUES ('test-issuer', 'bound-subject', $1)", [user.id]);
        await migrate(pool, all);
        await migrate(pool, all);
        await client.query("SET ROLE helpinsights_app");
        assert.equal((await client.query("SELECT id FROM public.resolve_session($1)", [legacy])).rows[0].id, user.id);
        await client.query("SET ROLE helpinsights_identity");
        assert.equal((await client.query("SELECT public.issue_university_session('test-issuer', 'bound-subject', $1) AS issued", [institutional])).rows[0].issued, true);
        await client.query("SET ROLE helpinsights_app");
        assert.equal((await client.query("SELECT id FROM public.resolve_session($1)", [institutional])).rows[0].id, user.id);
        await client.query("RESET ROLE");
        await client.query("DELETE FROM public.institutional_principal_bindings WHERE issuer = 'test-issuer'");
        await client.query("INSERT INTO public.institutional_principal_bindings (issuer, subject, user_id) VALUES ('test-issuer', 'bound-subject', $1)", [user.id]);
        assert.equal((await client.query("SELECT id FROM public.resolve_session($1)", [institutional])).rowCount, 0);
        assert.equal((await client.query("SELECT id FROM public.resolve_session($1)", [legacy])).rows[0].id, user.id);
        console.log('university session upgrade passed');
      } finally {
        client.release(true);
        await pool.end();
      }
      `,
    );
    assert.match(output, /university session upgrade passed/);
  } finally {
    sql("DROP DATABASE " + database);
  }
});
