import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { surveyFixture } from "../fixtures/survey.ts";

const templateId = "event-feedback";

function templateFixture() {
  const fixture = surveyFixture();
  const api = fixture.stack.baseUrl() + "/api/v1";
  const request = (
    path: string,
    token?: string,
    method = "GET",
    body?: object,
    etag?: string,
  ) =>
    fetch(api + path, {
      method,
      headers: {
        // Synchronous SQL fixture calls can outlast a loopback keep-alive socket.
        Connection: "close",
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(etag ? { "If-Match": etag } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  return { ...fixture, request };
}

test("authenticated template preview is read-only and uses a canonical survey definition", async () => {
  const { request, workspace, sql, ownerToken } = templateFixture();
  const list = await request("/templates", ownerToken);
  assert.equal(list.status, 200);
  const items = await list.json();
  assert.equal(items.length, 1);
  assert.equal(items[0].id, templateId);
  assert.equal(items[0].revision, 1);
  assert.equal(items[0].title, "Event feedback");
  assert.equal(items[0].visibility, "global");
  assert.ok(items[0].usage);

  const preview = await request("/templates/" + templateId, ownerToken);
  assert.equal(preview.status, 200);
  const details = await preview.json();
  assert.equal(details.definition.title, "Event feedback");
  assert.equal(
    details.definition.pages[0].questions[0].code,
    "event_usefulness",
  );
  assert.equal(
    sql(
      "SELECT count(*) FROM public.surveys WHERE workspace_id = '" +
        workspace +
        "'",
    ),
    "0",
  );
});

test("copy-on-use saves independent anonymous drafts with the workspace retention policy", async () => {
  const { request, workspace, sql, ownerToken, retentionPolicy } =
    templateFixture();
  const path = "/templates/" + templateId;
  const original = await (await request(path, ownerToken)).json();
  const clone = () =>
    request(path + "/clone", ownerToken, "POST", {
      workspaceId: workspace,
      revision: 1,
    });

  const first = await clone();
  assert.equal(first.status, 201);
  assert.equal(first.headers.get("etag"), '"1"');
  const copied = await first.json();
  assert.match(copied.id, /^[a-f0-9-]{36}$/);
  assert.equal(copied.status, "draft");
  assert.equal(copied.privacyMode, "anonymous");
  assert.deepEqual(copied.draft, original.definition);
  assert.equal(
    sql(`
      SELECT status, privacy_mode, retention_policy_id,
        draft->'pages'->0->'questions'->0->>'code',
        (SELECT count(*) FROM public.survey_versions v WHERE v.survey_id = s.id)
      FROM public.surveys s WHERE s.id = '${copied.id}' AND s.workspace_id = '${workspace}'
    `),
    "draft|anonymous|" + retentionPolicy + "|event_usefulness|0",
  );

  const edited = { ...copied.draft, title: "Independent survey title" };
  assert.equal(
    (
      await request(
        "/surveys/" + copied.id + "/draft",
        ownerToken,
        "PUT",
        edited,
        '"1"',
      )
    ).status,
    200,
  );
  const second = await clone();
  assert.equal(second.status, 201);
  const fresh = await second.json();
  assert.notEqual(fresh.id, copied.id);
  assert.deepEqual(fresh.draft, original.definition);
  assert.deepEqual(await (await request(path, ownerToken)).json(), original);
  const persisted = await request("/surveys/" + copied.id, ownerToken);
  assert.deepEqual((await persisted.json()).draft, edited);
});

test("template routes enforce authentication, target role, revision and workspace policy", async () => {
  const { request, workspace, sql, ownerToken, outsiderToken } =
    templateFixture();
  const viewer = randomUUID();
  const viewerToken = randomBytes(32).toString("base64url");
  const viewerHash = createHash("sha256").update(viewerToken).digest("hex");
  sql(`
    INSERT INTO public.users (id, display_name) VALUES ('${viewer}', 'Synthetic template viewer');
    INSERT INTO public.workspace_memberships (workspace_id, user_id, role)
      VALUES ('${workspace}', '${viewer}', 'viewer');
    INSERT INTO public.sessions (token_hash, user_id, expires_at)
      VALUES (decode('${viewerHash}', 'hex'), '${viewer}', now() + interval '1 hour');
  `);
  const path = "/templates/" + templateId;
  const payload = { workspaceId: workspace, revision: 1 };

  assert.equal((await request("/templates")).status, 401);
  assert.equal((await request(path)).status, 401);
  assert.equal(
    (await request(path + "/clone", undefined, "POST", payload)).status,
    401,
  );
  assert.equal((await request("/templates/absent", ownerToken)).status, 404);
  assert.equal((await request(path, viewerToken)).status, 200);
  assert.equal(
    (await request(path + "/clone", outsiderToken, "POST", payload)).status,
    403,
  );
  assert.equal(
    (await request(path + "/clone", viewerToken, "POST", payload)).status,
    403,
  );
  assert.equal(
    (
      await request(path + "/clone", ownerToken, "POST", {
        ...payload,
        revision: 2,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request(path + "/clone", ownerToken, "POST", {
        ...payload,
        definition: {},
      })
    ).status,
    400,
  );
  const outside = (
    await (await request("/workspaces", outsiderToken)).json()
  )[0].id;
  assert.equal(
    (
      await request(path + "/clone", outsiderToken, "POST", {
        ...payload,
        workspaceId: outside,
      })
    ).status,
    400,
  );
  assert.equal(
    sql(
      `SELECT count(*) FROM public.surveys WHERE workspace_id IN ('${workspace}', '${outside}')`,
    ),
    "0",
  );
});

test("a failed initial draft update rolls back the template copy", async () => {
  const { request, workspace, sql, ownerToken } = templateFixture();
  const failureName = "skip_update_" + workspace.replaceAll("-", "");
  sql(`
    CREATE FUNCTION public.${failureName}() RETURNS trigger LANGUAGE plpgsql AS
    $$ BEGIN RETURN NULL; END; $$;
    CREATE TRIGGER ${failureName} BEFORE UPDATE ON public.surveys FOR EACH ROW
      WHEN (OLD.workspace_id = '${workspace}') EXECUTE FUNCTION public.${failureName}();
  `);
  try {
    const result = await request(
      "/templates/" + templateId + "/clone",
      ownerToken,
      "POST",
      {
        workspaceId: workspace,
        revision: 1,
      },
    );
    assert.equal(result.status, 503);
    assert.equal(
      sql(
        "SELECT count(*) FROM public.surveys WHERE workspace_id = '" +
          workspace +
          "'",
      ),
      "0",
    );
  } finally {
    sql(
      `DROP TRIGGER ${failureName} ON public.surveys; DROP FUNCTION public.${failureName}();`,
    );
  }
});
