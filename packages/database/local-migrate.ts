import pg, { type PoolClient } from "pg";
import { loadMigrations, migrate } from "./migrate.ts";

const connectionString = process.env.DATABASE_URL;
const localPassword = process.env.LOCAL_RUNTIME_DB_PASSWORD;
const workerPassword = process.env.LOCAL_WORKER_DB_PASSWORD;
const identityPassword = process.env.LOCAL_IDENTITY_DB_PASSWORD;
if (!connectionString || !localPassword || !workerPassword) {
  throw new Error(
    "Local migration connection and runtime password are required",
  );
}

async function validateRole(
  client: PoolClient,
  name: string,
  login: boolean,
  group: string | null = null,
) {
  const { rows } = await client.query<{ safe: boolean }>(
    `SELECT r.rolcanlogin = $2
      AND r.rolinherit AND NOT (r.rolsuper OR r.rolbypassrls OR r.rolcreatedb
        OR r.rolcreaterole OR r.rolreplication)
      AND r.rolconfig IS NULL
      AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relowner = r.oid)
      AND NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspowner = r.oid)
      AND NOT EXISTS (SELECT 1 FROM pg_database WHERE datdba = r.oid)
      AND NOT EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND (
          (c.relname IN ('sessions', 'distributions') AND (
            has_any_column_privilege(r.oid, c.oid, 'SELECT, UPDATE')
            OR has_table_privilege(r.oid, c.oid, 'DELETE, TRUNCATE')
          ))
          OR (c.relname IN ('survey_versions', 'responses') AND (
            has_any_column_privilege(r.oid, c.oid, 'UPDATE')
            OR has_table_privilege(r.oid, c.oid, 'DELETE, TRUNCATE')
          ))
        )
      )
      AND (SELECT count(*) FROM pg_auth_members WHERE member = r.oid) = CASE WHEN $2 THEN 1 ELSE 0 END
      AND (
        NOT $2 OR EXISTS (
          SELECT 1 FROM pg_auth_members m
          JOIN pg_roles parent ON parent.oid = m.roleid
          WHERE m.member = r.oid AND parent.rolname = $3
            AND m.inherit_option AND NOT m.admin_option
        )
      ) AS safe
    FROM pg_roles r WHERE r.rolname = $1`,
    [name, login, group],
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
    await validateRole(guard, "helpinsights_exporter", false);
    if (identityPassword)
      await validateRole(guard, "helpinsights_identity", false);
    const roles = [
      {
        name: "helpinsights_runtime",
        group: "helpinsights_app",
        password: localPassword,
      },
      {
        name: "helpinsights_worker",
        group: "helpinsights_exporter",
        password: workerPassword,
      },
    ];
    if (identityPassword)
      roles.push({
        name: "helpinsights_identity_login",
        group: "helpinsights_identity",
        password: identityPassword,
      });
    const existing = await Promise.all(
      roles.map(({ name, group }) => validateRole(guard, name, true, group)),
    );
    await migrate(pool, await loadMigrations());
    for (const [index, { name, group, password }] of roles.entries()) {
      if (existing[index]) continue;
      const { rows } = await guard.query<{ command: string }>(
        "SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS IN ROLE %I PASSWORD %L', $1::text, $2::text, $3::text) AS command",
        [name, group, password],
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
