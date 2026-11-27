import pg from "pg";
import { createApplication } from "./application.ts";
import { sessionRoutes } from "./sessions.ts";
import {
  hasCurrentSchema,
  loadMigrations,
} from "../../packages/database/migrate.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const migrations = await loadMigrations();
const pool = new pg.Pool({
  connectionString,
  connectionTimeoutMillis: 2_000,
  statement_timeout: 2_000,
});
pool.on("error", () => console.error("Idle PostgreSQL connection interrupted"));

const server = createApplication(
  () => hasCurrentSchema(pool, migrations),
  sessionRoutes(pool),
);
server.listen(3000, "0.0.0.0", () =>
  console.log("HELPInsights listening on port 3000"),
);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close(() => void pool.end());
  });
}
