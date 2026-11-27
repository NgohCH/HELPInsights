import assert from "node:assert/strict";
import { definition, surveyFixture } from "./survey.ts";

export const eligibleRegistryProof = "registry_fixture_eligible";
export const ineligibleRegistryProof = "registry_fixture_ineligible";

export function registryFixture() {
  const fixture = surveyFixture();
  const origin = fixture.stack.baseUrl();
  const request = (
    path: string,
    method = "GET",
    options: { headers?: Record<string, string>; body?: unknown } = {},
  ) =>
    fetch(origin + "/api/v1" + path, {
      method,
      headers: {
        ...options.headers,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

  async function createDraft() {
    const headers = { Authorization: "Bearer " + fixture.ownerToken };
    const response = await request("/surveys", "POST", {
      headers,
      body: {
        workspaceId: fixture.workspace,
        title: definition.title,
        privacyMode: "anonymous",
        retentionPolicyId: fixture.retentionPolicy,
      },
    });
    assert.equal(response.status, 201);
    const { id } = await response.json();
    const draft = await request("/surveys/" + id + "/draft", "PUT", {
      headers: { ...headers, "If-Match": response.headers.get("etag")! },
      body: definition,
    });
    assert.equal(draft.status, 200);
    return { id, headers };
  }

  async function publish(mode?: "registry-synthetic") {
    const { id, headers } = await createDraft();
    const published = await request("/surveys/" + id + "/publish", "POST", {
      headers,
      ...(mode ? { body: { eligibilityMode: mode } } : {}),
    });
    assert.equal(published.status, 201);
    const { id: version, publicToken } = await published.json();
    return { version, publicToken, path: "/public/s/" + publicToken };
  }

  return { ...fixture, request, createDraft, publish };
}
