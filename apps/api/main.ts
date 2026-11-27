import pg from "pg";
import { createApplication } from "./application.ts";
import {
  hasCurrentSchema,
  loadMigrations,
  migrate,
} from "../../packages/database/migrate.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const migrations = await loadMigrations();
const migrationPool = new pg.Pool({
  connectionString,
  connectionTimeoutMillis: 2_000,
});
try {
  await migrate(migrationPool, migrations);
} finally {
  await migrationPool.end();
}

const pool = new pg.Pool({
  connectionString,
  connectionTimeoutMillis: 2_000,
  query_timeout: 2_000,
});
pool.on("error", () => console.error("Idle PostgreSQL connection interrupted"));

const server = createApplication(() => hasCurrentSchema(pool, migrations));
server.listen(3000, "0.0.0.0", () =>
  console.log("HELPInsights listening on port 3000"),
);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close(() => void pool.end());
  });
}
