import assert from "node:assert/strict";
import test from "node:test";
import { runningTestStack } from "../../scripts/test-docker.ts";

test("the operations migration upgrades a seeded database and its attributed records restore", () => {
  const { compose } = runningTestStack();
  const postgres = (...args: string[]) =>
    compose("exec", "-T", "postgres", ...args).trim();
  const upgraded = "helpinsights_operations_upgrade";
  const restored = "helpinsights_operations_restore";
  postgres("createdb", "-U", "helpinsights", upgraded);
  postgres("createdb", "-U", "helpinsights", restored);
  try {
    assert.match(
      compose(
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
        import { hasCurrentSchema, loadMigrations, migrate } from './packages/database/migrate.ts';
        const url = new URL(process.env.DATABASE_URL);
        url.pathname = '/helpinsights_operations_upgrade';
        const pool = new pg.Pool({ connectionString: url.toString() });
        try {
          const migrations = await loadMigrations();
          const index = migrations.findIndex(migration => migration.name.endsWith('-operations.sql'));
          assert.ok(index > 0);
          await migrate(pool, migrations.slice(0, index));
          const original = await pool.query(
            "INSERT INTO public.organisations (name) VALUES ('Operations upgrade fixture') RETURNING id"
          );
          await migrate(pool, migrations);
          assert.equal(await hasCurrentSchema(pool, migrations), true);
          const preserved = await pool.query("SELECT id FROM public.organisations");
          assert.deepEqual(preserved.rows, original.rows);
          console.log('seeded upgrade preserved organisation');
        } finally {
          await pool.end();
        }
      `,
      ),
      /seeded upgrade preserved organisation/,
    );

    const sql = (database: string, statement: string) =>
      postgres(
        "psql",
        "-XAtq",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "helpinsights",
        "-d",
        database,
        "-c",
        statement,
      );
    const actor = sql(
      upgraded,
      "INSERT INTO public.users (display_name) VALUES ('Restore operator') RETURNING id",
    );
    sql(
      upgraded,
      `
      INSERT INTO public.platform_operations_memberships (user_id, role) VALUES ('${actor}', 'operator');
      BEGIN;
      SET LOCAL ROLE helpinsights_app;
      SET LOCAL helpinsights.actor_id = '${actor}';
      INSERT INTO public.operation_incidents (component, state, severity) VALUES ('schema', 'recovered', 'information');
      COMMIT;
    `,
    );
    postgres(
      "sh",
      "-ec",
      `
      backup=$(mktemp)
      trap 'rm -f "$backup"' EXIT
      pg_dump -U helpinsights -Fc -f "$backup" helpinsights_operations_upgrade
      pg_restore -U helpinsights --exit-on-error -d helpinsights_operations_restore "$backup"
    `,
    );
    const incident =
      "SELECT id || ':' || component || ':' || state || ':' || severity || ':' || actor_id || ':' || recorded_at FROM public.operation_incidents";
    const persisted = sql(upgraded, incident);
    assert.ok(
      persisted.includes(":schema:recovered:information:" + actor + ":"),
    );
    assert.equal(sql(restored, incident), persisted);
  } finally {
    postgres("dropdb", "-U", "helpinsights", upgraded);
    postgres("dropdb", "-U", "helpinsights", restored);
  }
});
