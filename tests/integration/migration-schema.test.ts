import assert from "node:assert/strict";
import test from "node:test";
import { runningTestStack } from "../../scripts/test-docker.ts";

test("migration and readiness use the same schema with a custom database search path", () => {
  const { compose } = runningTestStack();
  compose(
    "exec",
    "-T",
    "postgres",
    "createdb",
    "-U",
    "helpinsights",
    "helpinsights_search_path",
  );
  try {
    compose(
      "exec",
      "-T",
      "postgres",
      "psql",
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "helpinsights",
      "-d",
      "helpinsights_search_path",
      "-c",
      "CREATE SCHEMA preferred",
    );
    const output = compose(
      "exec",
      "-T",
      "app",
      "node",
      "--input-type=module",
      "-e",
      `
      import assert from 'node:assert/strict';
      import pg from 'pg';
      import { hasCurrentSchema, loadMigrations, migrate } from './packages/database/migrate.ts';
      const url = new URL(process.env.DATABASE_URL);
      url.pathname = '/helpinsights_search_path';
      const pool = new pg.Pool({
        connectionString: url.toString(), options: '-c search_path=preferred,public',
      });
      try {
        const { rows } = await pool.query('SELECT current_schema() AS name');
        assert.equal(rows[0].name, 'preferred');
        const migrations = await loadMigrations();
        await migrate(pool, migrations);
        assert.equal(await hasCurrentSchema(pool, migrations), true, 'Expected migration in public');
        console.log('schema match verified');
      } finally {
        await pool.end();
      }
    `,
    );
    assert.match(output, /schema match verified/);
  } finally {
    compose(
      "exec",
      "-T",
      "postgres",
      "dropdb",
      "-U",
      "helpinsights",
      "helpinsights_search_path",
    );
  }
});
