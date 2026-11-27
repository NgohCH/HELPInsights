import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { definition, surveyFixture } from "../fixtures/survey.ts";

test("concurrent anonymous retries produce exactly one valid durable response", async () => {
  const { stack, sql, workspace, retentionPolicy, ownerToken } =
    surveyFixture();
  const api = stack.baseUrl() + "/api/v1";
  const creator = {
    Authorization: "Bearer " + ownerToken,
    "Content-Type": "application/json",
  };
  const create = await fetch(api + "/surveys", {
    method: "POST",
    headers: creator,
    body: JSON.stringify({
      workspaceId: workspace,
      title: definition.title,
      privacyMode: "anonymous",
      retentionPolicyId: retentionPolicy,
    }),
  });
  assert.equal(create.status, 201);
  const draft = await create.json();
  const url = api + "/surveys/" + draft.id;
  assert.equal(
    (
      await fetch(url + "/draft", {
        method: "PUT",
        headers: { ...creator, "If-Match": create.headers.get("etag")! },
        body: JSON.stringify(definition),
      })
    ).status,
    200,
  );
  const publish = await fetch(url + "/publish", {
    method: "POST",
    headers: creator,
  });
  assert.equal(publish.status, 201);
  const version = await publish.json();
  const endpoint = api + "/public/s/" + version.publicToken + "/responses";
  function submit(
    id: string,
    question: unknown,
    key = randomUUID(),
  ): Promise<Response> {
    return fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify({ surveyVersionId: id, answers: question }),
    });
  }

  const answers = [{ questionId: "rating", value: "useful" }];
  assert.equal((await submit(randomUUID(), answers)).status, 400);
  assert.equal((await submit(version.id, [])).status, 400);
  assert.equal(
    (await submit(version.id, [{ questionId: "rating", value: "invalid" }]))
      .status,
    400,
  );

  const key = randomUUID();
  const replies = await Promise.all(
    Array.from({ length: 8 }, () => submit(version.id, answers, key)),
  );
  const receipts = await Promise.all(replies.map((reply) => reply.json()));
  assert.equal(replies.filter((reply) => reply.status === 201).length, 1);
  assert.equal(replies.filter((reply) => reply.status === 200).length, 7);
  assert.ok(
    receipts.every(
      (receipt) =>
        receipt.receiptId && receipt.receiptId === receipts[0].receiptId,
    ),
  );
  assert.equal(
    (
      await submit(
        version.id,
        [{ questionId: "rating", value: "not_useful" }],
        key,
      )
    ).status,
    409,
  );
  assert.equal(
    sql(
      "SELECT count(*) FROM public.responses WHERE survey_version_id = '" +
        version.id +
        "'",
    ),
    "1",
  );
  assert.equal(
    sql(
      "SELECT answers->0->>'value' FROM public.responses WHERE id = '" +
        receipts[0].receiptId +
        "'",
    ),
    "useful",
  );
  assert.equal(
    sql(`
    SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'responses'
      AND column_name IN ('user_id', 'person_id', 'session_id', 'ip_address', 'invitation_id')
  `),
    "0",
  );

  assert.equal(
    (await fetch(url + "/close", { method: "POST", headers: creator })).status,
    200,
  );
  assert.equal((await submit(version.id, answers)).status, 404);
  assert.equal(
    sql(
      "SELECT count(*) FROM public.responses WHERE survey_version_id = '" +
        version.id +
        "'",
    ),
    "1",
  );
});
