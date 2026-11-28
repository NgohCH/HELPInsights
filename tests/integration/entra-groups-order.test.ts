import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { surveyFixture } from "../fixtures/survey.ts";

test("an equally dated Entra callback cannot restore removed group permissions", () => {
  const { sql, workspace } = surveyFixture();
  const issuer = "https://group-order.synthetic.test";
  const subject = randomUUID();
  const group = randomUUID();
  const objectId = randomUUID();
  const owner = sql(
    `SELECT user_id FROM public.workspace_memberships WHERE workspace_id = '${workspace}'`,
  );
  sql(`
    INSERT INTO public.institutional_principal_bindings (issuer, subject, user_id)
      VALUES ('${issuer}', '${subject}', '${owner}');
    INSERT INTO public.approved_identity_groups (id, label, entra_issuer, entra_object_id)
      VALUES ('${group}', 'Synthetic ordering group', '${issuer}', '${objectId}');
  `);
  const issued = Number(sql("SELECT floor(extract(epoch FROM now()))"));
  function signIn(groups: string[], issuedAt: number) {
    const proof = `decode('${randomBytes(32).toString("hex")}', 'hex')`;
    const listed = `'{${groups.join(",")}}'::uuid[]`;
    assert.equal(
      sql(
        `SELECT public.issue_university_session('${issuer}', '${subject}', ${proof}, ${listed}, ${issuedAt}, ${issued + 300})`,
      ),
      "t",
    );
    return () =>
      sql(`SELECT public.creator_tool_group_member(${proof}, '${group}')`);
  }
  const original = signIn([objectId], issued - 1);
  assert.equal(original(), "t");
  const removed = signIn([], issued);
  assert.equal(removed(), "f");
  assert.equal(original(), "f");

  const delayed = signIn([objectId], issued);
  assert.equal(delayed(), "f");
  assert.equal(original(), "f");

  const newer = signIn([objectId], issued + 1);
  assert.equal(newer(), "t");
  const identical = signIn([objectId], issued + 1);
  assert.equal(identical(), "t");
  assert.equal(newer(), "t");
});

test("clearing an Entra mapping cannot reactivate a stale manual roster", () => {
  const { sql, workspace } = surveyFixture();
  const issuer = "https://group-remapping.synthetic.test";
  const subject = randomUUID();
  const group = randomUUID();
  const objectId = randomUUID();
  const owner = sql(
    `SELECT user_id FROM public.workspace_memberships WHERE workspace_id = '${workspace}'`,
  );
  const proof = `decode('${randomBytes(32).toString("hex")}', 'hex')`;
  const read = () =>
    sql(`SELECT public.creator_tool_group_member(${proof}, '${group}')`);
  sql(`
    INSERT INTO public.institutional_principal_bindings (issuer, subject, user_id)
      VALUES ('${issuer}', '${subject}', '${owner}');
    INSERT INTO public.approved_identity_groups (id, label, entra_issuer, entra_object_id)
      VALUES ('${group}', 'Synthetic remapping group', '${issuer}', '${objectId}');
    INSERT INTO public.approved_identity_group_members VALUES ('${group}', '${owner}');
    SELECT public.issue_university_session('${issuer}', '${subject}', ${proof}, '{${objectId}}',
      floor(extract(epoch FROM now()))::bigint, floor(extract(epoch FROM now()))::bigint + 300);
  `);
  assert.equal(read(), "t");

  sql(
    `UPDATE public.approved_identity_groups SET entra_issuer = NULL, entra_object_id = NULL WHERE id = '${group}'`,
  );
  assert.equal(read(), "f");

  sql(
    `INSERT INTO public.approved_identity_group_members VALUES ('${group}', '${owner}')`,
  );
  assert.equal(read(), "t");
  sql(
    `UPDATE public.approved_identity_groups SET entra_issuer = '${issuer}', entra_object_id = '${objectId}' WHERE id = '${group}'`,
  );
  assert.equal(read(), "f");
  assert.equal(
    sql(
      `SELECT count(*) FROM public.approved_identity_group_members WHERE group_id = '${group}'`,
    ),
    "0",
  );
});
