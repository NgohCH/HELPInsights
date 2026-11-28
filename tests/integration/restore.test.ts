import assert from "node:assert/strict";
import test from "node:test";
import { runningTestStack } from "../../scripts/test-docker.ts";

test("the database archive restores organisation data and migration checksums into a fresh database", () => {
  const { compose } = runningTestStack();
  const postgres = (...args: string[]) =>
    compose("exec", "-T", "postgres", ...args).trim();
  postgres(
    "psql",
    "-XAtq",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    "helpinsights",
    "-d",
    "helpinsights",
    "-c",
    "INSERT INTO public.organisations (name) VALUES ('Backup fixture')",
  );
  postgres("createdb", "-U", "helpinsights", "helpinsights_restore");
  try {
    postgres(
      "sh",
      "-ec",
      `
      backup=$(mktemp)
      trap 'rm -f "$backup"' EXIT
      pg_dump -U helpinsights -Fc -f "$backup" helpinsights
      pg_restore -U helpinsights --exit-on-error -d helpinsights_restore "$backup"
    `,
    );
    const records = `
      SELECT 'organisation:' || id || ':' || name FROM public.organisations
      UNION ALL
      SELECT 'migration:' || name || ':' || checksum FROM public.schema_migrations
      UNION ALL
      SELECT 'integration:' || id || ':' || status || ':' || credential_version || ':' || workspace_id
      FROM public.integration_clients
      UNION ALL
      SELECT 'integration-audit:' || client_id || ':' || actor_id || ':' || action FROM public.integration_client_audit
      UNION ALL
      SELECT 'tool:' || tool || ':' || mode FROM public.creator_tool_settings
      UNION ALL
      SELECT 'tool-grant:' || tool || ':' || workspace_id || ':' || subject_type || ':' || subject_id
      FROM public.creator_tool_grants
      ORDER BY 1
    `;
    const rows = (database: string) =>
      postgres(
        "psql",
        "-XAtq",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "helpinsights",
        "-d",
        database,
        "-c",
        records,
      );
    const original = rows("helpinsights");
    assert.match(original, /organisation:[0-9a-f-]+:Backup fixture/);
    assert.match(original, /migration:001-organisations\.sql:[0-9a-f]{64}/);
    assert.equal(rows("helpinsights_restore"), original);
  } finally {
    postgres("dropdb", "-U", "helpinsights", "helpinsights_restore");
  }
});
