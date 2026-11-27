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
          const workerIndex = migrations.findIndex(migration => migration.name.endsWith('-worker-incidents.sql'));
          assert.ok(workerIndex > index);
          await migrate(pool, migrations.slice(0, workerIndex));
          const { rows: [operator] } = await pool.query(
            "INSERT INTO public.users (display_name) VALUES ('Legacy operator fixture') RETURNING id"
          );
          const { rows: [legacy] } = await pool.query(
            "INSERT INTO public.operation_incidents (component, state, severity, actor_id) " +
              "VALUES ('api', 'detected', 'advisory', $1) RETURNING id",
            [operator.id]
          );
          const noticeIndex = migrations.findIndex(migration => migration.name.endsWith('-worker-recovery-notices.sql'));
          assert.ok(noticeIndex > workerIndex);
          await migrate(pool, migrations.slice(0, noticeIndex));
          await pool.query(
            "INSERT INTO public.platform_operations_memberships (user_id, role) VALUES ($1, 'operator')",
            [operator.id]
          );
          const { rows: [{ episode }] } = await pool.query('SELECT gen_random_uuid() AS episode');
          await pool.query(
            "SELECT public.record_export_worker_recovery($1, now() - interval '1 minute')",
            [episode]
          );
          const { rows: [recovered] } = await pool.query(
            "SELECT id FROM public.operation_incidents WHERE episode_id = $1 AND state = 'recovered'",
            [episode]
          );
          await migrate(pool, migrations);
          assert.equal(await hasCurrentSchema(pool, migrations), true);
          const client = await pool.connect();
          try {
            await client.query('BEGIN');
            await client.query('SET LOCAL ROLE helpinsights_app');
            await client.query("SELECT set_config('helpinsights.actor_id', $1, true)", [operator.id]);
            const { rows: [receipt] } = await client.query(
              'SELECT * FROM public.acknowledge_worker_recovery($1)', [recovered.id]
            );
            assert.equal(receipt.outcome, 'acknowledged');
            assert.ok(receipt.acknowledged_at instanceof Date);
            await client.query('COMMIT');
          } finally {
            client.release();
          }
          const { rows: [manual] } = await pool.query(
            "SELECT source, actor_id, episode_id, observed_at FROM public.operation_incidents WHERE id = $1",
            [legacy.id]
          );
          assert.deepEqual(manual, {
            source: 'operator', actor_id: operator.id, episode_id: null, observed_at: null,
          });
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
      "SELECT id || ':' || component || ':' || state || ':' || severity || ':' || actor_id || ':' || recorded_at FROM public.operation_incidents ORDER BY id";
    const persisted = sql(upgraded, incident);
    assert.ok(
      persisted.includes(":schema:recovered:information:" + actor + ":"),
    );
    assert.equal(sql(restored, incident), persisted);
    const receipts =
      "SELECT incident_id || ':' || operator_id || ':' || acknowledged_at FROM public.worker_recovery_receipts";
    const originalReceipt = sql(upgraded, receipts);
    assert.ok(originalReceipt);
    assert.equal(sql(restored, receipts), originalReceipt);
  } finally {
    postgres("dropdb", "-U", "helpinsights", upgraded);
    postgres("dropdb", "-U", "helpinsights", restored);
  }
});
