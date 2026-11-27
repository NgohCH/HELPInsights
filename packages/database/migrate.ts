import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import type { Pool } from "pg";

type Migration = { name: string; sql: string; checksum: string };
type AppliedMigration = Pick<Migration, "name" | "checksum">;

export async function loadMigrations() {
  const directory = new URL("./migrations/", import.meta.url);
  const names = (await readdir(directory)).sort();
  if (
    names.length === 0 ||
    names.some((name, index) => {
      const match = /^(\d{3})-[a-z-]+\.sql$/.exec(name);
      return !match || Number(match[1]) !== index + 1;
    })
  ) {
    throw new Error("Migration files must have consecutive revision numbers");
  }
  return Promise.all(
    names.map(async (name): Promise<Migration> => {
      const sql = (await readFile(new URL(name, directory), "utf8")).replaceAll(
        "\r\n",
        "\n",
      );
      return {
        name,
        sql,
        checksum: createHash("sha256").update(sql).digest("hex"),
      };
    }),
  );
}

export async function migrate(pool: Pool, migrations: Migration[]) {
  const client = await pool.connect();
  let discardConnection = false;
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '30s'");
    await client.query("SET LOCAL statement_timeout = '120s'");
    await client.query("SELECT pg_advisory_xact_lock(7249101)");
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.schema_migrations (
        name text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const { rows: applied } = await client.query<AppliedMigration>(
      "SELECT name, checksum FROM public.schema_migrations ORDER BY name",
    );
    for (const [index, migration] of applied.entries()) {
      const expected = migrations[index];
      if (
        expected?.name !== migration.name ||
        expected.checksum !== migration.checksum
      ) {
        throw new Error("Migration history mismatch: " + migration.name);
      }
    }
    for (const { name, sql, checksum } of migrations.slice(applied.length)) {
      await client.query(sql);
      await client.query(
        "INSERT INTO public.schema_migrations (name, checksum) VALUES ($1, $2)",
        [name, checksum],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      discardConnection = true;
    }
    throw error;
  } finally {
    client.release(discardConnection);
  }
}

export async function hasCurrentSchema(pool: Pool, migrations: Migration[]) {
  const { rows } = await pool.query<
    AppliedMigration & { base_table_exists: boolean }
  >(
    `SELECT name, checksum,
      EXISTS (
        SELECT 1 FROM pg_catalog.pg_class
        WHERE oid = to_regclass('public.organisations') AND relkind = 'r'
      ) AS base_table_exists
     FROM public.schema_migrations ORDER BY name`,
  );
  return (
    rows.length === migrations.length &&
    rows.every(
      (row, index) =>
        row.base_table_exists &&
        row.name === migrations[index].name &&
        row.checksum === migrations[index].checksum,
    )
  );
}
