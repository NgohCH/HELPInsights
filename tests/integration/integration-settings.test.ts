import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { registryFixture } from "../fixtures/registry.ts";

test("system administrators manage scoped integration clients and credential lifecycle", async () => {
  const { sql, workspace, outside, ownerToken, createDraft, request, stack } =
    registryFixture();
  const admin = randomUUID();
  const member = randomUUID();
  const adminProof = randomBytes(32).toString("base64url");
  const memberProof = randomBytes(32).toString("base64url");
  const hash = (credential: string) =>
    createHash("sha256").update(credential).digest("hex");

  sql(`
    INSERT INTO public.users (id, display_name) VALUES ('${admin}', 'Synthetic integrations administrator'), ('${member}', 'Synthetic integrations operator');
    INSERT INTO public.system_administrators VALUES ('${admin}');
    INSERT INTO public.platform_operations_memberships VALUES ('${member}', 'operator');
    INSERT INTO public.institutional_principal_bindings (issuer, subject, user_id) VALUES
      ('http://oidc-simulator:3002', '${admin}', '${admin}'), ('http://oidc-simulator:3002', '${member}', '${member}');
    INSERT INTO public.sessions (token_hash, user_id, expires_at, institutional_issuer, institutional_subject) VALUES
      (decode('${hash(adminProof)}', 'hex'), '${admin}', now() + interval '1 hour', 'http://oidc-simulator:3002', '${admin}'),
      (decode('${hash(memberProof)}', 'hex'), '${member}', now() + interval '1 hour', 'http://oidc-simulator:3002', '${member}');
  `);
  const survey = await createDraft();
  const endpoint = "/admin/integrations";
  const workspacePath = "/integrations/workspaces/" + workspace;
  const outsidePath = "/integrations/workspaces/" + outside;
  const surveyPath = workspacePath + "/surveys/" + survey.id + "/status";
  const origin = stack.baseUrl();
  const cookie = (proof: string) => ({
    Cookie: "__Host-helpinsights-session=" + proof,
    Origin: origin,
  });
  const adminHeaders = cookie(adminProof);
  const manage = (body: object, headers = adminHeaders) =>
    request(endpoint, "POST", { body, headers });
  const read = (path: string, credential: string) =>
    request(path, "GET", {
      headers: { Authorization: "Bearer " + credential },
    });
  const registration = {
    action: "register",
    registrationId: randomUUID(),
    name: "Synthetic reporting client",
    department: "Synthetic analytics office",
    purpose: "Monitor availability of synthetic survey resources",
    environment: "test",
    credentialOwner: "Synthetic service desk",
    workspaceId: workspace,
    operations: ["workspace:read"],
  };
  assert.equal((await request(endpoint, "GET")).status, 401);
  assert.equal((await read(endpoint, ownerToken)).status, 401);
  assert.equal(
    (await request(endpoint, "GET", { headers: cookie(memberProof) })).status,
    403,
  );
  assert.equal((await manage(registration, cookie(memberProof))).status, 403);
  assert.equal(
    (
      await manage(registration, {
        ...adminHeaders,
        Origin: "https://other.example",
      })
    ).status,
    403,
  );
  assert.equal(
    (await manage({ ...registration, environment: "production" })).status,
    400,
  );
  assert.equal(
    (await manage({ ...registration, operations: ["response:export"] })).status,
    400,
  );
  assert.equal(
    (await manage({ ...registration, workspaceId: randomUUID() })).status,
    400,
  );

  const registrations = await Promise.all([
    manage(registration),
    manage(registration),
  ]);
  const [registered] = registrations.sort((a, b) => a.status - b.status);
  assert.deepEqual(
    registrations.map(({ status }) => status),
    [201, 409],
  );
  const { client, credential } = await registered.json();
  assert.equal(client.id, registration.registrationId);
  assert.equal(client.credentialVersion, 1);
  assert.equal(client.name, registration.name);
  assert.equal(client.status, "pending");
  assert.equal(client.workspaceId, workspace);
  assert.deepEqual(client.operations, ["workspace:read"]);
  assert.equal(registered.headers.get("cache-control"), "no-store");
  assert.match(credential, /^hi_client_[A-Za-z0-9_-]{43}$/);
  assert.equal(
    sql(
      `SELECT encode(credential_hash, 'hex') FROM public.integration_clients WHERE id = '${client.id}'`,
    ),
    hash(credential),
  );
  const listed = await request(endpoint, "GET", { headers: adminHeaders });
  assert.equal(listed.status, 200);
  const listing = await listed.json();
  assert.equal(listing.environment, "test");
  assert.deepEqual(Object.keys(client).sort(), [
    "credentialOwner",
    "credentialVersion",
    "department",
    "environment",
    "expiresAt",
    "id",
    "name",
    "operations",
    "purpose",
    "status",
    "workspaceId",
  ]);
  assert.deepEqual(
    listing.clients.find((item: { id: string }) => item.id === client.id),
    client,
  );
  assert.equal(
    sql(`SELECT has_table_privilege('helpinsights_app', 'public.integration_clients', 'SELECT')
      OR has_table_privilege('helpinsights_app', 'public.integration_client_audit', 'INSERT')`),
    "f",
  );
  assert.equal((await read(workspacePath, credential)).status, 401);
  assert.equal((await read(workspacePath, ownerToken)).status, 401);
  assert.equal((await read("/workspaces", credential)).status, 401);

  assert.equal(
    (await manage({ action: "enable", clientId: client.id })).status,
    200,
  );
  const allowedWorkspace = await read(workspacePath, credential);
  assert.equal(allowedWorkspace.status, 200);
  assert.deepEqual(await allowedWorkspace.json(), {
    id: workspace,
    name: "Survey workshop",
  });
  assert.equal((await read(outsidePath, credential)).status, 404);
  assert.equal((await read(surveyPath, credential)).status, 404);
  assert.equal((await read("/surveys/" + survey.id, credential)).status, 401);

  sql(
    `UPDATE public.integration_clients SET environment = 'development' WHERE id = '${client.id}'`,
  );
  assert.equal((await read(workspacePath, credential)).status, 401);
  assert.equal(
    (await manage({ action: "revoke", clientId: client.id })).status,
    404,
  );
  sql(
    `UPDATE public.integration_clients SET environment = 'test' WHERE id = '${client.id}'`,
  );

  assert.equal(
    (
      await manage({
        action: "permissions",
        clientId: client.id,
        workspaceId: outside,
        operations: ["workspace:read", "survey:read_status"],
      })
    ).status,
    200,
  );
  assert.equal((await read(workspacePath, credential)).status, 404);
  assert.equal((await read(outsidePath, credential)).status, 200);
  assert.equal(
    (await read(outsidePath + "/surveys/" + survey.id + "/status", credential))
      .status,
    404,
  );
  assert.equal(
    (
      await manage({
        action: "permissions",
        clientId: client.id,
        workspaceId: workspace,
        operations: ["survey:read_status"],
      })
    ).status,
    200,
  );
  assert.equal((await read(outsidePath, credential)).status, 404);
  assert.equal((await read(workspacePath, credential)).status, 404);
  const allowedSurvey = await read(surveyPath, credential);
  assert.equal(allowedSurvey.status, 200);
  assert.deepEqual(await allowedSurvey.json(), {
    id: survey.id,
    status: "draft",
  });
  assert.equal(
    (
      await read(
        workspacePath + "/surveys/" + randomUUID() + "/status",
        credential,
      )
    ).status,
    404,
  );

  sql(
    `UPDATE public.integration_clients SET credential_expires_at = now() WHERE id = '${client.id}'`,
  );
  assert.equal((await read(surveyPath, credential)).status, 401);
  const renewal = {
    action: "renew",
    clientId: client.id,
    expectedCredentialVersion: client.credentialVersion,
  };
  const renewals = await Promise.all([manage(renewal), manage(renewal)]);
  const [renewed, rejectedRenewal] = renewals.sort(
    (a, b) => a.status - b.status,
  );
  assert.deepEqual(
    renewals.map(({ status }) => status),
    [200, 409],
  );
  assert.equal("credential" in (await rejectedRenewal.json()), false);
  const { client: updatedClient, credential: replacement } =
    await renewed.json();
  assert.equal(updatedClient.credentialVersion, 2);
  assert.notEqual(replacement, credential);
  assert.equal((await read(surveyPath, replacement)).status, 200);
  assert.equal((await read(surveyPath, credential)).status, 401);

  assert.equal(
    (await manage({ action: "revoke", clientId: client.id })).status,
    200,
  );
  assert.equal((await read(surveyPath, replacement)).status, 401);
  assert.equal(
    (await manage({ ...renewal, expectedCredentialVersion: 2 })).status,
    409,
  );
  assert.equal(
    (await manage({ action: "enable", clientId: client.id })).status,
    409,
  );
  assert.equal(
    (await manage({ action: "revoke", clientId: client.id })).status,
    200,
  );
  assert.equal(
    sql(
      `SELECT credential_hash IS NULL FROM public.integration_clients WHERE id = '${client.id}'`,
    ),
    "t",
  );
  assert.equal(
    sql(`
    SELECT string_agg(action || ':' || actor_id || ':' || workspace_id, ',' ORDER BY id)
    FROM public.integration_client_audit WHERE client_id = '${client.id}'
  `),
    [
      ["register", workspace],
      ["enable", workspace],
      ["permissions", outside],
      ["permissions", workspace],
      ["renew", workspace],
      ["revoke", workspace],
    ]
      .map(([action, scope]) => action + ":" + admin + ":" + scope)
      .join(","),
  );
  sql(`DELETE FROM public.system_administrators WHERE user_id = '${admin}'`);
  assert.equal(
    (await request(endpoint, "GET", { headers: adminHeaders })).status,
    403,
  );
});
