import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { runningTestStack } from "../../scripts/test-docker.ts";

test("creator security migrations preserve policies, scoped grants and published consent from migration 019", () => {
  const { compose } = runningTestStack();
  const database = "creator_policy_upgrade_" + randomUUID().replaceAll("-", "");
  const postgres = (...args: string[]) =>
    compose("exec", "-T", "postgres", ...args);
  postgres("createdb", "-U", "helpinsights", database);
  try {
    const output = compose(
      "run",
      "--rm",
      "--no-deps",
      "-e",
      "UPGRADE_DATABASE=" + database,
      "--entrypoint",
      "node",
      "migrate",
      "--input-type=module",
      "-e",
      `
      import assert from "node:assert/strict";
      import { randomBytes, randomUUID } from "node:crypto";
      import pg from "pg";
      import { loadMigrations, migrate } from "./packages/database/migrate.ts";
      const url = new URL(process.env.DATABASE_URL);
      url.pathname = "/" + process.env.UPGRADE_DATABASE;
      const pool = new pg.Pool({ connectionString: url.href });
      const client = await pool.connect();
      try {
        const all = await loadMigrations();
        const review = all.findIndex(({name}) => name === "020-research-tool-policy.sql");
        assert.equal(all[review - 1].name, "019-tool-settings.sql");
        const [org, workspace, user, survey, version] = Array.from({length: 5}, () => randomUUID());
        const proof = randomBytes(32);
        await migrate(pool, all.slice(0, review));
        await client.query("INSERT INTO public.organisations (id, name) VALUES ($1, 'Synthetic organisation')", [org]);
        await client.query("INSERT INTO public.workspaces (id, organisation_id, name) VALUES ($1, $2, 'Synthetic workspace')", [workspace, org]);
        await client.query("INSERT INTO public.users (id, display_name) VALUES ($1, 'Synthetic owner')", [user]);
        await client.query("INSERT INTO public.system_administrators VALUES ($1)", [user]);
        await client.query("INSERT INTO public.workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')", [workspace, user]);
        await client.query("INSERT INTO public.institutional_principal_bindings (issuer, subject, user_id) VALUES ('fixture', 'owner', $1)", [user]);
        await client.query("SELECT public.issue_university_session('fixture', 'owner', $1)", [proof]);
        await client.query("SELECT public.change_template_copy_settings($1, 'mode', 'approved', NULL, NULL, NULL)", [proof]);
        await client.query("SELECT public.change_template_copy_settings($1, 'grant', NULL, $2, 'user', $3)", [proof, workspace, user]);
        await client.query("INSERT INTO public.retention_policies (workspace_id, days_after_close) VALUES ($1, 90)", [workspace]);
        await client.query("INSERT INTO public.surveys (id, workspace_id, retention_policy_id, title, privacy_mode) SELECT $1, $2, id, 'Synthetic consent', 'anonymous' FROM public.retention_policies WHERE workspace_id = $2", [survey, workspace]);
        await client.query("INSERT INTO public.survey_versions (id, survey_id, version, definition, hash) VALUES ($1, $2, 1, $3, repeat('a', 64))", [version, survey, JSON.stringify({pages:[{questions:[{type:"single_choice"}]}]})]);
        await client.query("INSERT INTO public.distributions (token_hash, survey_version_id) VALUES ($1, $2)", [randomBytes(32), version]);
        await client.query("INSERT INTO public.research_consent_versions (survey_version_id, study_key, revision, notice) VALUES ($1, 'synthetic-consent-study', 1, 'Synthetic historic consent')", [version]);
        const before = (await client.query("SELECT public.read_template_copy_settings($1) AS settings", [proof])).rows[0].settings;
        assert.deepEqual(before, {mode:"approved", grants:[{workspaceId:workspace, subjectType:"user", subjectId:user}]});

        await migrate(pool, all);
        await migrate(pool, all);
        await client.query("SET ROLE helpinsights_app");
        const after = (await client.query("SELECT public.read_template_copy_settings($1) AS legacy, public.read_creator_tool_settings($1, 'template-copy') AS current, public.template_copy_allowed($1, $2) AS access", [proof, workspace])).rows[0];
        assert.deepEqual(after, {legacy:before, current:before, access:true});
        assert.deepEqual((await client.query("SELECT public.read_creator_tool_settings($1, 'research-consent') AS settings", [proof])).rows[0].settings, { mode:"university", grants:[] });
        await client.query("RESET ROLE");
        assert.equal((await client.query("SELECT count(*)::int AS count FROM public.creator_tool_audit")).rows[0].count, 2);
        assert.equal((await client.query("SELECT notice FROM public.research_consent_versions WHERE survey_version_id = $1", [version])).rows[0].notice, "Synthetic historic consent");
        console.log("creator policy upgrade preserved the 019 fixture");
      } finally {
        client.release(true);
        await pool.end();
      }`,
    );
    assert.match(output, /creator policy upgrade preserved the 019 fixture/);
  } finally {
    postgres("dropdb", "-U", "helpinsights", database);
  }
});
