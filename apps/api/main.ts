import { readFile } from "node:fs/promises";
import pg from "pg";
import { createApplication } from "./application.ts";
import { createLiveQuiz } from "./live-quiz.ts";
import { sessionRoutes } from "./sessions.ts";
import { entraProvider } from "./entra-provider.ts";
import { entraSignInRoutes } from "./entra-sign-in.ts";
import { institutionalOAuth } from "./institutional-oauth.ts";
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

const sessions = sessionRoutes(pool, institutionalOAuth(process.env));
const universityProvider = entraProvider(process.env);
const identityPool = universityProvider
  ? new pg.Pool({
      connectionString: universityProvider.identityDatabase,
      max: 4,
      connectionTimeoutMillis: 2_000,
      statement_timeout: 2_000,
    })
  : null;
identityPool?.on("error", () =>
  console.error("Idle identity database connection interrupted"),
);
const universitySignIn =
  universityProvider && identityPool
    ? entraSignInRoutes(universityProvider, {
        async issue(principal, tokenHash) {
          const { rows } = await identityPool.query<{ issued: boolean }>(
            "SELECT public.issue_university_session($1, $2, $3) AS issued",
            [principal.issuer, principal.subject, tokenHash],
          );
          return rows[0]?.issued === true;
        },
        async revoke(tokenHash) {
          await identityPool.query(
            "SELECT public.revoke_university_session($1)",
            [tokenHash],
          );
        },
      })
    : null;
const registryGate = syntheticRegistry(process.env);
const syntheticResearchConsent = syntheticConsentEnabled(process.env);
const universityEligibility =
  universityProvider !== null &&
  process.env.HELPINSIGHTS_UNIVERSITY_ELIGIBILITY === "true";
const surveys = surveyRoutes(
  pool,
  registryGate !== null,
  syntheticResearchConsent,
  universityEligibility,
);
const respondents = respondentRoutes(
  pool,
  registryGate,
  syntheticResearchConsent,
  universityEligibility,
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
  async () => {
    if (!(await hasCurrentSchema(pool, migrations))) return false;
    if (!identityPool) return true;
    const { rows } = await identityPool.query<{ ready: boolean }>(
      "SELECT pg_has_role(current_user, 'helpinsights_identity', 'USAGE') " +
        "AND has_function_privilege(current_user, 'public.issue_university_session(text,text,bytea)', 'EXECUTE') " +
        "AND has_function_privilege(current_user, 'public.revoke_university_session(bytea)', 'EXECUTE') " +
        "AND NOT has_any_column_privilege(current_user, 'public.sessions', 'SELECT, INSERT, UPDATE') " +
        "AND NOT has_table_privilege(current_user, 'public.sessions', 'DELETE, TRUNCATE') " +
        "AND NOT has_any_column_privilege(current_user, 'public.institutional_principal_bindings', 'SELECT, INSERT, UPDATE') " +
        "AND NOT has_table_privilege(current_user, 'public.institutional_principal_bindings', 'DELETE, TRUNCATE') AS ready",
    );
    return rows[0]?.ready === true;
  },
  async (...args) =>
    (universitySignIn ? await universitySignIn(...args) : false) ||
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
  Boolean(universitySignIn),
  !universitySignIn || process.env.NODE_ENV === "test",
);
const closeLiveSockets = liveQuiz?.attachSockets(server);
server.listen(3000, "0.0.0.0", () =>
  console.log("HELPInsights listening on port 3000"),
);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    closeLiveSockets?.();
    server.close(() => void Promise.all([pool.end(), identityPool?.end()]));
  });
}
