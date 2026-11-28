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
          const recoveryIndex = migrations.findIndex(
            migration => migration.name === '024-worker-recovery-incidents.sql'
          );
          assert.ok(recoveryIndex > index, 'worker recovery migration must follow operations');
          assert.match(migrations[recoveryIndex - 1].name, /^023-/);
          await migrate(pool, migrations.slice(0, recoveryIndex));
          const { rows: [operator] } = await pool.query(
            "INSERT INTO public.users (display_name) VALUES ('Legacy operator fixture') RETURNING id"
          );
          const { rows: [legacy] } = await pool.query(
            "INSERT INTO public.operation_incidents (component, state, severity, actor_id) " +
              "VALUES ('api', 'detected', 'advisory', $1) RETURNING id, recorded_at",
            [operator.id]
          );
          await migrate(pool, migrations);
          const { rows: [manual] } = await pool.query(
            "SELECT source, actor_id, recorded_at, episode_id, observed_at FROM public.operation_incidents WHERE id = $1",
            [legacy.id]
          );
          assert.deepEqual(manual, {
            source: 'operator', actor_id: operator.id, recorded_at: legacy.recorded_at,
            episode_id: null, observed_at: null,
          });
          assert.equal(await hasCurrentSchema(pool, migrations), true);
          const preserved = await pool.query("SELECT id FROM public.organisations");
          assert.deepEqual(preserved.rows, original.rows);
          console.log('seeded upgrade preserved organisation and legacy operator incident');
        } finally {
          await pool.end();
        }
      `,
      ),
      /seeded upgrade preserved organisation and legacy operator incident/,
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
    const episode = "346bdce0-4d64-4f29-a5d5-941880ea83ba";
    sql(
      upgraded,
      `
        BEGIN;
        SET LOCAL ROLE helpinsights_exporter;
        SELECT public.record_export_worker_recovery('${episode}', clock_timestamp() - interval '1 second');
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
      "SELECT id || ':' || component || ':' || state || ':' || severity || ':' " +
      "|| coalesce(actor_id::text, '') || ':' || recorded_at || ':' || source || ':' " +
      "|| coalesce(episode_id::text, '') || ':' || coalesce(observed_at::text, '') " +
      "FROM public.operation_incidents ORDER BY id";
    const persisted = sql(upgraded, incident);
    assert.ok(
      persisted.includes(":schema:recovered:information:" + actor + ":"),
    );
    assert.equal(
      persisted
        .split("\n")
        .filter((row) => row.includes(":export_worker:" + episode + ":"))
        .length,
      2,
    );
    assert.equal(sql(restored, incident), persisted);
  } finally {
    postgres("dropdb", "-U", "helpinsights", upgraded);
    postgres("dropdb", "-U", "helpinsights", restored);
  }
});
