import pg, { type PoolClient } from "pg";
import { loadMigrations, migrate } from "./migrate.ts";

const connectionString = process.env.DATABASE_URL;
const localPassword = process.env.LOCAL_RUNTIME_DB_PASSWORD;
if (!connectionString || !localPassword) {
  throw new Error(
    "Local migration connection and runtime password are required",
  );
}

async function validateRole(client: PoolClient, name: string, login: boolean) {
  const { rows } = await client.query<{ safe: boolean }>(
    `SELECT r.rolcanlogin = $2
      AND r.rolinherit AND NOT (r.rolsuper OR r.rolbypassrls OR r.rolcreatedb
        OR r.rolcreaterole OR r.rolreplication)
      AND r.rolconfig IS NULL
      AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relowner = r.oid)
      AND NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspowner = r.oid)
      AND NOT EXISTS (SELECT 1 FROM pg_database WHERE datdba = r.oid)
      AND (SELECT count(*) FROM pg_auth_members WHERE member = r.oid) = CASE WHEN $2 THEN 1 ELSE 0 END
      AND (
        NOT $2 OR EXISTS (
          SELECT 1 FROM pg_auth_members m
          JOIN pg_roles parent ON parent.oid = m.roleid
          WHERE m.member = r.oid AND parent.rolname = 'helpinsights_app'
            AND m.inherit_option AND NOT m.admin_option
        )
      ) AS safe
    FROM pg_roles r WHERE r.rolname = $1`,
    [name, login],
  );
  if (rows[0]?.safe === false)
    throw new Error("Unsafe PostgreSQL role: " + name);
  return rows.length !== 0;
}

const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 2_000 });
try {
  const guard = await pool.connect();
  try {
    await guard.query("BEGIN");
    await guard.query("SET LOCAL lock_timeout = '30s'");
    await guard.query("SELECT pg_advisory_xact_lock(7249102)");
    await validateRole(guard, "helpinsights_app", false);
    const runtimeExists = await validateRole(
      guard,
      "helpinsights_runtime",
      true,
    );
    await migrate(pool, await loadMigrations());
    if (!runtimeExists) {
      const { rows } = await guard.query<{ command: string }>(
        "SELECT format('CREATE ROLE helpinsights_runtime LOGIN NOSUPERUSER NOBYPASSRLS IN ROLE helpinsights_app PASSWORD %L', $1::text) AS command",
        [localPassword],
      );
      await guard.query(rows[0].command);
    }
    await guard.query("COMMIT");
  } finally {
    guard.release(true);
  }
} finally {
  await pool.end();
}
