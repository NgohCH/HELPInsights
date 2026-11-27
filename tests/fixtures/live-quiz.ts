import assert from "node:assert/strict";
import { definition, surveyFixture } from "./survey.ts";

export async function liveQuizFixture() {
  const fixture = surveyFixture();
  const baseUrl = fixture.stack.baseUrl();
  const api = (
    path: string,
    method = "GET",
    body?: object,
    authorization?: string,
    headers?: Record<string, string>,
  ) =>
    fetch(baseUrl + "/api/v1" + path, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(authorization ? { Authorization: authorization } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

  const owner = "Bearer " + fixture.ownerToken;
  const outsider = "Bearer " + fixture.outsiderToken;
  const created = await api(
    "/surveys",
    "POST",
    {
      workspaceId: fixture.workspace,
      title: definition.title,
      privacyMode: "anonymous",
      retentionPolicyId: fixture.retentionPolicy,
    },
    owner,
  );
  assert.equal(created.status, 201);
  const { id } = await created.json();
  assert.equal(
    (
      await api("/surveys/" + id + "/draft", "PUT", definition, owner, {
        "If-Match": '"1"',
      })
    ).status,
    200,
  );
  const published = await api(
    "/surveys/" + id + "/publish",
    "POST",
    undefined,
    owner,
  );
  assert.equal(published.status, 201);
  const { id: quizVersionId } = await published.json();
  return { ...fixture, api, owner, outsider, quizVersionId };
}
