import { readFile } from "node:fs/promises";
import pg from "pg";
import { createApplication } from "./application.ts";
import { sessionRoutes } from "./sessions.ts";
import { surveyRoutes } from "./surveys.ts";
import { respondentRoutes } from "./respond.ts";
import { reportRoutes } from "./reports.ts";
import { operationsRoutes } from "./operations.ts";
import { retentionRoutes } from "./retention.ts";
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

const sessions = sessionRoutes(pool);
const surveys = surveyRoutes(pool);
const respondents = respondentRoutes(pool);
const reports = reportRoutes(pool);
const retention = retentionRoutes(pool);
const operations = operationsRoutes(pool, (client) =>
  hasCurrentSchema(client, migrations),
);
const [javascript, stylesheet] = await Promise.all([
  readFile(new URL("../../dist/web/main.js", import.meta.url)),
  readFile(new URL("../../dist/web/main.css", import.meta.url)),
]);
const server = createApplication(
  () => hasCurrentSchema(pool, migrations),
  async (...args) =>
    (await sessions(...args)) ||
    (await surveys(...args)) ||
    (await respondents(...args)) ||
    (await reports(...args)) ||
    (await operations(...args)) ||
    (await retention(...args)),
  { javascript, stylesheet },
);
server.listen(3000, "0.0.0.0", () =>
  console.log("HELPInsights listening on port 3000"),
);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close(() => void pool.end());
  });
}
