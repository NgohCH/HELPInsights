import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { runningTestStack } from "../../scripts/test-docker.ts";

test("verified sessions and the application database role can see only their memberships", async () => {
  const stack = runningTestStack();
  const owner = randomUUID();
  const operator = randomUUID();
  const organisation = randomUUID();
  const otherOrganisation = randomUUID();
  const workspace = randomUUID();
  const otherWorkspace = randomUUID();
  const ownerToken = randomBytes(32).toString("base64url");
  const operatorToken = randomBytes(32).toString("base64url");
  const expiredToken = randomBytes(32).toString("base64url");
  const hash = (token: string) =>
    createHash("sha256").update(token).digest("hex");
  const sql = (statement: string) =>
    stack
      .compose(
        "exec",
        "-T",
        "postgres",
        "psql",
        "-XAtq",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "helpinsights",
        "-d",
        "helpinsights",
        "-c",
        statement,
      )
      .trim();

  sql(`
    INSERT INTO public.organisations (id, name) VALUES
      ('${organisation}', 'First organisation'), ('${otherOrganisation}', 'Second organisation');
    INSERT INTO public.workspaces (id, organisation_id, name) VALUES
      ('${workspace}', '${organisation}', 'First workspace'),
      ('${otherWorkspace}', '${otherOrganisation}', 'Other workspace');
    INSERT INTO public.users (id, display_name) VALUES
      ('${owner}', 'Survey owner'), ('${operator}', 'Platform operator');
    INSERT INTO public.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${workspace}', '${owner}', 'owner');
  `);
  sql(`
    INSERT INTO public.sessions (token_hash, user_id, expires_at) VALUES
      (decode('${hash(ownerToken)}', 'hex'), '${owner}', now() + interval '1 hour'),
      (decode('${hash(operatorToken)}', 'hex'), '${operator}', now() + interval '1 hour'),
      (decode('${hash(expiredToken)}', 'hex'), '${owner}', now() - interval '1 hour');
  `);

  async function get(path: string, token: string) {
    return fetch(stack.baseUrl() + "/api/v1" + path, {
      headers: { Authorization: "Bearer " + token },
    });
  }

  const me = await get("/me", ownerToken);
  assert.equal(me.status, 200);
  assert.deepEqual(await me.json(), { id: owner, displayName: "Survey owner" });
  const workspaces = await get("/workspaces", ownerToken);
  assert.equal(workspaces.status, 200);
  assert.deepEqual(await workspaces.json(), [
    { id: workspace, organisationId: organisation, name: "First workspace" },
  ]);
  const unassigned = await get("/workspaces", operatorToken);
  assert.equal(unassigned.status, 200);
  assert.deepEqual(await unassigned.json(), []);
  assert.equal((await get("/me", expiredToken)).status, 401);

  assert.equal(
    sql(`
    BEGIN;
    SET LOCAL ROLE helpinsights_runtime;
    SET LOCAL helpinsights.actor_id = '${owner}';
    SELECT id FROM public.workspaces ORDER BY id;
    SELECT workspace_id FROM public.workspace_memberships ORDER BY workspace_id;
    COMMIT;
    SET ROLE helpinsights_runtime;
    SELECT count(*) FROM public.workspaces;
    SELECT has_table_privilege('public.sessions', 'SELECT');
    SELECT has_table_privilege('public.organisations', 'INSERT');
  `),
    [workspace, workspace, "0", "f", "f"].join("\n"),
  );
});
