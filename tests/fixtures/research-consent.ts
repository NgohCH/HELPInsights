import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { definition, surveyFixture } from "./survey.ts";

export function universityResearchAuthor(
  fixture: ReturnType<typeof surveyFixture>,
) {
  const subject = randomUUID();
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  fixture.sql(`
    INSERT INTO public.institutional_principal_bindings (issuer, subject, user_id)
    SELECT 'http://oidc-simulator:3002', '${subject}', user_id
    FROM public.workspace_memberships WHERE workspace_id = '${fixture.workspace}' AND role = 'owner';
    SET ROLE helpinsights_identity;
    SELECT public.issue_university_session('http://oidc-simulator:3002', '${subject}', decode('${hash}', 'hex'));
  `);
  return {
    Cookie: "__Host-helpinsights-session=" + token,
    Origin: fixture.stack.baseUrl(),
    "Content-Type": "application/json",
  };
}

export function researchFixture() {
  const fixture = surveyFixture();
  const base = fixture.stack.baseUrl() + "/api/v1";
  const author = {
    Authorization: "Bearer " + fixture.ownerToken,
    "Content-Type": "application/json",
  };

  async function prepare(
    draft: {
      title: string;
      schemaVersion: string;
      pages: unknown[];
    } = definition,
  ) {
    const created = await fetch(base + "/surveys", {
      method: "POST",
      headers: author,
      body: JSON.stringify({
        workspaceId: fixture.workspace,
        title: draft.title,
        privacyMode: "anonymous",
        retentionPolicyId: fixture.retentionPolicy,
      }),
    });
    assert.equal(created.status, 201);
    const { id } = await created.json();
    let university: ReturnType<typeof universityResearchAuthor> | undefined;
    const request = (body?: object, useUniversity = false) =>
      fetch(base + "/surveys/" + id + "/publish", {
        method: "POST",
        headers: useUniversity
          ? (university ??= universityResearchAuthor(fixture))
          : author,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    const saved = await fetch(base + "/surveys/" + id + "/draft", {
      method: "PUT",
      headers: { ...author, "If-Match": created.headers.get("etag")! },
      body: JSON.stringify(draft),
    });
    assert.equal(saved.status, 200);
    return { id, request };
  }

  async function publish(
    request: Awaited<ReturnType<typeof prepare>>["request"],
    consent = true,
  ) {
    const response = await request(
      consent ? { researchConsent: "synthetic" } : undefined,
      consent,
    );
    assert.equal(response.status, 201);
    const version: { id: string; publicToken: string } = await response.json();
    return { ...version, endpoint: base + "/public/s/" + version.publicToken };
  }

  return { ...fixture, prepare, publish };
}
