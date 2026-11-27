import { readFile } from "node:fs/promises";
import pg from "pg";
import { createApplication } from "./application.ts";
import { createLiveQuiz } from "./live-quiz.ts";
import { sessionRoutes } from "./sessions.ts";
import { surveyRoutes } from "./surveys.ts";
import { respondentRoutes } from "./respond.ts";
import { featureRoutes } from "./features.ts";
import { reportRoutes } from "./reports.ts";
import { templateRoutes } from "./templates.ts";
import { operationsRoutes } from "./operations.ts";
import { retentionRoutes } from "./retention.ts";
import { syntheticRegistry } from "./registry.ts";
import { syntheticConsentEnabled } from "./research-consent.ts";
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
const registryGate = syntheticRegistry(process.env);
const syntheticResearchConsent = syntheticConsentEnabled(process.env);
const surveys = surveyRoutes(
  pool,
  registryGate !== null,
  syntheticResearchConsent,
);
const respondents = respondentRoutes(
  pool,
  registryGate,
  syntheticResearchConsent,
);
const reports = reportRoutes(pool);
const features = featureRoutes(pool);
const templates = templateRoutes(pool);
const retention = retentionRoutes(pool);
const operations = operationsRoutes(pool, (client) =>
  hasCurrentSchema(client, migrations),
);
const gameShowEnabled = process.env.LIVE_GAME_SHOW_ENABLED === "true";
const liveQuiz =
  process.env.LIVE_QUIZ_ENABLED === "true"
    ? createLiveQuiz(
        pool,
        process.env.LIVE_QUIZ_PIN_KEY,
        process.env.LIVE_QUIZ_ORIGIN,
        gameShowEnabled,
      )
    : undefined;
const [javascript, stylesheet, creatorHelp] = await Promise.all([
  readFile(new URL("../../dist/web/main.js", import.meta.url)),
  readFile(new URL("../../dist/web/main.css", import.meta.url)),
  readFile(new URL("../web/content/creator-help.en.json", import.meta.url)),
]);
const server = createApplication(
  () => hasCurrentSchema(pool, migrations),
  async (...args) =>
    (await sessions(...args)) ||
    (await features(...args)) ||
    (await surveys(...args)) ||
    (await templates(...args)) ||
    (await respondents(...args)) ||
    (await reports(...args)) ||
    (await operations(...args)) ||
    (await retention(...args)) ||
    (liveQuiz ? await liveQuiz.route(...args) : false),
  { javascript, stylesheet, creatorHelp },
  Boolean(liveQuiz),
  gameShowEnabled,
);
const closeLiveSockets = liveQuiz?.attachSockets(server);
server.listen(3000, "0.0.0.0", () =>
  console.log("HELPInsights listening on port 3000"),
);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    closeLiveSockets?.();
    server.close(() => void pool.end());
  });
}
