import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import type { Pool } from "pg";

const directory = new URL("./migrations/", import.meta.url);

export async function migrate(pool: Pool) {
  const names = (await readdir(directory)).sort();
  if (
    names.length === 0 ||
    names.some((name) => !/^\d{3}-[a-z-]+\.sql$/.test(name))
  ) {
    throw new Error("Invalid migration directory");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(7249101)");
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const applied = await client.query<{ name: string; checksum: string }>(
      "SELECT name, checksum FROM schema_migrations",
    );
    const checksums = new Map(
      applied.rows.map(({ name, checksum }) => [name, checksum]),
    );
    if (applied.rows.some(({ name }) => !names.includes(name))) {
      throw new Error(
        "Database contains migrations missing from this application",
      );
    }
    for (const name of names) {
      const sql = await readFile(new URL(name, directory), "utf8");
      const checksum = createHash("sha256")
        .update(sql.replaceAll("\r\n", "\n"))
        .digest("hex");
      const previous = checksums.get(name);
      if (previous === checksum) continue;
      if (previous !== undefined) throw new Error("Migration changed: " + name);
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)",
        [name, checksum],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
