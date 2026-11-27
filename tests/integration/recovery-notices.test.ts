import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { recoveryNoticeFixture } from "../fixtures/recovery-notice.ts";
import { surveyFixture } from "../fixtures/survey.ts";

test("only appointed operators see recovery notices and receipts are private and repeat-safe", async () => {
  const baseline = surveyFixture();
  const base = baseline.stack.baseUrl() + "/api/v1";
  assert.equal((await fetch(base + "/me/notices")).status, 401);
  const fixture = recoveryNoticeFixture(baseline);
  const headers = (token: string) => ({ Authorization: "Bearer " + token });
  const list = (token: string, path = "/me/notices") =>
    fetch(base + path, { headers: headers(token) });
  const acknowledge = (token: string, id = fixture.recoveryId) =>
    fetch(base + "/me/notices/" + id + "/acknowledge", {
      method: "POST",
      headers: headers(token),
    });

  const { first, second, recoveryId, detectionId, manualId } = fixture;
  for (const denied of [fixture.ownerToken, first.viewerToken]) {
    assert.equal((await list(denied)).status, 403);
    assert.equal((await acknowledge(denied)).status, 403);
  }
  for (const id of [manualId, detectionId, randomUUID()]) {
    assert.equal((await acknowledge(first.operatorToken, id)).status, 404);
  }
  const noSession = await fetch(
    base + "/me/notices/" + recoveryId + "/acknowledge",
    { method: "POST" },
  );
  assert.equal(noSession.status, 401);
  const forged = await fetch(
    base + "/me/notices/" + recoveryId + "/acknowledge",
    {
      method: "POST",
      headers: {
        ...headers(first.operatorToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ operatorId: second.operator }),
    },
  );
  assert.equal(forged.status, 400);
  const notices = await list(first.operatorToken);
  assert.equal(notices.status, 200);
  const listBody = await notices.json();
  assert.deepEqual(
    await (await list(first.operatorToken, "/admin/notices")).json(),
    listBody,
  );
  assert.equal(
    listBody.some(
      ({ id }: { id: string }) => id === manualId || id === detectionId,
    ),
    false,
  );
  const opened = listBody.find(({ id }: { id: string }) => id === recoveryId);
  assert.deepEqual(opened, {
    id: recoveryId,
    category: "export_worker_recovery",
    severity: "information",
    state: "open",
    title: "Export worker database connection recovered",
    createdAt: opened.createdAt,
  });

  const responses = await Promise.all([
    acknowledge(first.operatorToken),
    acknowledge(first.operatorToken),
  ]);
  assert.deepEqual(
    responses.map((response) => response.status),
    [200, 200],
  );
  const [receipt, retry] = await Promise.all(
    responses.map((response) => response.json()),
  );
  assert.deepEqual(receipt, {
    ...opened,
    state: "acknowledged",
    acknowledgedAt: receipt.acknowledgedAt,
  });
  assert.deepEqual(retry, receipt);
  assert.ok(Number.isFinite(Date.parse(receipt.acknowledgedAt)));
  assert.equal(
    fixture.sql(`
    SELECT count(*) || ':' || min(operator_id::text) FROM public.worker_recovery_receipts
    WHERE incident_id = '${recoveryId}'
  `),
    "1:" + first.operator,
  );
  assert.equal(
    fixture.sql(`
    BEGIN;
    SET LOCAL ROLE helpinsights_app;
    SET LOCAL helpinsights.actor_id = '${second.operator}';
    SELECT count(incident_id) FROM public.worker_recovery_receipts WHERE incident_id = '${recoveryId}';
    ROLLBACK
  `),
    "0",
  );
  const peers: { id: string }[] = await (
    await list(second.operatorToken)
  ).json();
  assert.deepEqual(
    peers.find(({ id }) => id === recoveryId),
    opened,
  );
  const own: { id: string }[] = await (await list(first.operatorToken)).json();
  assert.deepEqual(
    own.find(({ id }) => id === recoveryId),
    receipt,
  );
  assert.equal(
    fixture.sql(`
    SELECT has_table_privilege('helpinsights_app', 'public.worker_recovery_receipts', 'INSERT, UPDATE, DELETE')
      OR has_function_privilege('helpinsights_exporter', 'public.acknowledge_worker_recovery(uuid)', 'EXECUTE')
  `),
    "f",
  );
  fixture.sql(
    "DELETE FROM public.platform_operations_memberships WHERE user_id = '" +
      first.operator +
      "'",
  );
  assert.equal((await acknowledge(first.operatorToken)).status, 403);
  assert.equal((await list(first.operatorToken)).status, 403);
  assert.equal(
    fixture.sql(`
    BEGIN;
    SET LOCAL ROLE helpinsights_app;
    SET LOCAL helpinsights.actor_id = '${first.operator}';
    SELECT count(incident_id) FROM public.worker_recovery_receipts WHERE incident_id = '${recoveryId}';
    ROLLBACK
  `),
    "0",
  );
});

test("default-style runtime does not publish the recovery inbox or receipt route", () => {
  const { stack } = surveyFixture();
  const result = stack.compose(
    "run",
    "--rm",
    "--no-deps",
    "-e",
    "HELPINSIGHTS_RECOVERY_NOTICES=0",
    "--entrypoint",
    "node",
    "app",
    "--input-type=module",
    "-e",
    `
      import assert from 'node:assert/strict';
      import { spawn } from 'node:child_process';
      import { setTimeout as delay } from 'node:timers/promises';
      const application = spawn(process.execPath, ['apps/api/main.ts'], { stdio: 'inherit' });
      try {
        const base = 'http://127.0.0.1:3000/api/v1';
        let ready = false;
        for (let step = 0; step < 40; step++) {
          const probe = await fetch(base + '/health/ready').catch(() => undefined);
          if (probe?.ok) { ready = true; break; }
          await delay(250);
        }
        assert.ok(ready);
        assert.equal((await fetch(base + '/me/notices')).status, 404);
        assert.equal((await fetch(base + '/admin/notices')).status, 404);
        const path = base + '/me/notices/00000000-0000-4000-8000-000000000000/acknowledge';
        assert.equal((await fetch(path, {method: 'POST'})).status, 404);
        console.log('recovery inbox disabled');
      } finally {
        application.kill('SIGTERM');
      }
    `,
  );
  assert.match(result, /recovery inbox disabled/);
});
