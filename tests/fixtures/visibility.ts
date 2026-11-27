import assert from "node:assert/strict";
import { definition, surveyFixture } from "./survey.ts";

export const visibilityDefinition = {
  ...definition,
  title: "Conditional feedback",
  pages: [
    definition.pages[0],
    {
      id: "follow_up",
      title: "Your follow-up",
      questions: [
        {
          id: "detail",
          code: "workshop_detail",
          title: "What should we change?",
          type: "short_text",
          required: true,
          visibleWhen: { questionId: "rating", optionCode: "not_useful" },
        },
      ],
    },
  ] as const,
};

export async function visibilityFixture() {
  const { stack, sql, workspace, retentionPolicy, ownerToken } =
    surveyFixture();
  const api = stack.baseUrl() + "/api/v1";
  const headers = {
    Authorization: "Bearer " + ownerToken,
    "Content-Type": "application/json",
  };
  const create = await fetch(api + "/surveys", {
    method: "POST",
    headers,
    body: JSON.stringify({
      workspaceId: workspace,
      title: visibilityDefinition.title,
      privacyMode: "anonymous",
      retentionPolicyId: retentionPolicy,
    }),
  });
  assert.equal(create.status, 201);
  const survey: { id: string } = await create.json();
  const url = api + "/surveys/" + survey.id;
  const save = (next: unknown) =>
    fetch(url + "/draft", {
      method: "PUT",
      headers: { ...headers, "If-Match": create.headers.get("etag")! },
      body: JSON.stringify(next),
    });

  async function publish() {
    const response = await fetch(url + "/publish", { method: "POST", headers });
    assert.equal(response.status, 201);
    const version: { id: string; publicToken: string } = await response.json();
    return { ...version, endpoint: api + "/public/s/" + version.publicToken };
  }

  return { save, publish, sql };
}
