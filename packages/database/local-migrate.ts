import pg from "pg";
import { loadMigrations, migrate } from "./migrate.ts";

const connectionString = process.env.DATABASE_URL;
const localPassword = process.env.LOCAL_RUNTIME_DB_PASSWORD;
if (!connectionString || !localPassword)
  throw new Error(
    "Local migration connection and runtime password are required",
  );

const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 2_000 });
try {
  await migrate(pool, await loadMigrations());
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'helpinsights_runtime') THEN
        CREATE ROLE helpinsights_runtime LOGIN NOSUPERUSER NOBYPASSRLS IN ROLE helpinsights_app;
      END IF;
    END
    $$
  `);
  const { rows } = await pool.query<{ command: string }>(
    "SELECT format('ALTER ROLE helpinsights_runtime PASSWORD %L', $1::text) AS command",
    [localPassword],
  );
  await pool.query(rows[0].command);
} finally {
  await pool.end();
}
