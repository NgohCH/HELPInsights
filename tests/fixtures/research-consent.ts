import assert from "node:assert/strict";
import { definition, surveyFixture } from "./survey.ts";

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
    const request = (body?: object) =>
      fetch(base + "/surveys/" + id + "/publish", {
        method: "POST",
        headers: author,
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
    );
    assert.equal(response.status, 201);
    const version: { id: string; publicToken: string } = await response.json();
    return { ...version, endpoint: base + "/public/s/" + version.publicToken };
  }

  return { ...fixture, prepare, publish };
}
