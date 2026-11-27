import assert from "node:assert/strict";
import test from "node:test";
import { runningTestStack } from "../../scripts/test-docker.ts";

test("migration waits for the transaction lock and rolls back an unsuccessful migration", () => {
  const { compose } = runningTestStack();
  const output = compose(
    "exec",
    "-T",
    "app",
    "node",
    "--input-type=module",
    "-e",
    `
    import assert from 'node:assert/strict';
    import { createHash } from 'node:crypto';
    import { setTimeout as delay } from 'node:timers/promises';
    import pg from 'pg';
    import { loadMigrations, migrate } from './packages/database/migrate.ts';
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const initial = await loadMigrations();
    const blocker = await pool.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT pg_advisory_xact_lock(7249101)');
      const queued = migrate(pool, initial);
      await Promise.race([delay(2500), queued.then(() => {
        throw new Error('Migration did not wait for the held transaction lock');
      })]);
      await blocker.query('ROLLBACK');
      await queued;
      const sql = 'CREATE TABLE public.rollback_probe (id integer); SELECT 1 / 0';
      const checksum = createHash('sha256').update(sql).digest('hex');
      await assert.rejects(migrate(pool, [...initial, {
        name: '002-rollback-probe.sql', sql, checksum,
      }]), { code: '22012' });
      const result = await pool.query(
        "SELECT to_regclass('public.rollback_probe') IS NULL AS no_table, " +
        "NOT EXISTS (SELECT 1 FROM public.schema_migrations WHERE name = '002-rollback-probe.sql') AS no_entry"
      );
      assert.deepEqual(result.rows, [{ no_table: true, no_entry: true }]);
      console.log('migration lock and rollback verified');
    } finally {
      blocker.release(true);
      await pool.end();
    }
  `,
  );
  assert.match(output, /migration lock and rollback verified/);
});
