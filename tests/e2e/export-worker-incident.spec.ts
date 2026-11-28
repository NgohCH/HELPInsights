import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { unzipSync } from "fflate";
import { operationsFixture } from "../fixtures/operations.ts";
import { definition, surveyFixture } from "../fixtures/survey.ts";

type Event = {
  episodeId?: string;
  source?: string;
  state: string;
  observedAt?: string;
};

test("repeated PostgreSQL worker disconnects produce one redacted recovery episode", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const fixture = surveyFixture();
  const { stack, sql, workspace, retentionPolicy } = fixture;
  const ops = operationsFixture(fixture);
  const url = "/api/v1/admin/incidents";
  const authorized = {
    headers: { Authorization: "Bearer " + ops.operatorToken },
  };
  const initial = await page.request.get(url, authorized);
  expect(initial.status()).toBe(200);
  const earlierEpisodes = new Set(
    ((await initial.json()) as Event[]).map((incident) => incident.episodeId),
  );

  const answer = "Synthetic response must stay in the export";
  const exportDefinition = {
    ...definition,
    pages: [
      {
        ...definition.pages[0],
        questions: [
          { id: "notes", code: "notes", title: "Notes", type: "short_text" },
        ],
      },
    ],
  };
  const survey = randomUUID();
  const version = randomUUID();
  const job = randomUUID();
  sql(`
    INSERT INTO public.surveys (id, workspace_id, title, privacy_mode, status, retention_policy_id)
      VALUES ('${survey}', '${workspace}', 'Synthetic worker recovery survey', 'anonymous', 'published', '${retentionPolicy}');
    INSERT INTO public.survey_versions (id, survey_id, version, definition, hash)
      VALUES ('${version}', '${survey}', 1, '${JSON.stringify(exportDefinition)}', repeat('0', 64));
    INSERT INTO public.responses (survey_version_id, answers, retry_key_hash, payload_hash)
      VALUES ('${version}', '${JSON.stringify([{ questionId: "notes", value: answer }])}',
        decode(repeat('01', 32), 'hex'), decode(repeat('02', 32), 'hex'));
  `);
  const workerId = stack.compose("ps", "--quiet", "worker").trim();
  const workerStart = () =>
    stack
      .docker([
        "inspect",
        "--format",
        "{{.State.StartedAt}}/{{.RestartCount}}",
        workerId,
      ])
      .trim();
  const before = workerStart();
  const result = stack.compose(
    "run",
    "--rm",
    "--no-deps",
    "--entrypoint",
    "node",
    "migrate",
    "--input-type=module",
    "-e",
    `
    import assert from 'node:assert/strict';
    import { setTimeout as delay } from 'node:timers/promises';
    import pg from 'pg';
    const [fixture, version, job] = process.argv.slice(1);
    assert.match(fixture, /^helpinsights-test-[a-f0-9]{12}$/);
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const lock = await pool.connect();
    try {
      await lock.query('BEGIN');
      await lock.query("SET LOCAL lock_timeout = '5s'");
      await lock.query('LOCK TABLE public.export_jobs IN ACCESS EXCLUSIVE MODE');
      await lock.query(
        "INSERT INTO public.export_jobs (id, survey_version_id, requested_by, format) " +
          "SELECT $1, v.id, m.user_id, 'jasp_csv_bundle' FROM public.survey_versions v " +
          "JOIN public.surveys s ON s.id = v.survey_id " +
          "JOIN public.workspace_memberships m ON m.workspace_id = s.workspace_id AND m.role = 'owner' WHERE v.id = $2",
        [job, version]
      );
      const terminatedPids = new Set();
      for (let fault = 0; fault < 2; fault++) {
        let pid;
        for (let attempt = 0; attempt < 100; attempt++) {
          const { rows } = await pool.query(
            "SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND usename = 'helpinsights_worker' " +
            "AND wait_event_type = 'Lock' AND query LIKE '%public.export_jobs%'"
          );
          assert.ok(rows.length <= 1, 'fixture must have one export worker');
          if (rows[0] && !terminatedPids.has(rows[0].pid)) {
            pid = rows[0].pid;
            break;
          }
          await delay(50);
        }
        assert.ok(Number.isInteger(pid), 'worker must reconnect and block on the same export table lock');
        const { rows: [terminated] } = await pool.query(
          'SELECT pg_terminate_backend($1, 5000) AS terminated', [pid]
        );
        assert.equal(terminated.terminated, true);
        terminatedPids.add(pid);
      }
      const { rows: [timing] } = await lock.query(
        'SELECT extract(epoch FROM clock_timestamp())::text AS retry_verified_at'
      );
      await lock.query('COMMIT');
      console.log('terminated two worker sessions before releasing the export lock at ' + timing.retry_verified_at);
    } finally {
      await lock.query('ROLLBACK');
      lock.release();
      await pool.end();
    }
    `,
    process.env.HELPINSIGHTS_TEST_PROJECT!,
    version,
    job,
  );
  const faults =
    /terminated two worker sessions before releasing the export lock at ([0-9.]+)/.exec(
      result,
    );
  expect(faults).not.toBeNull();
  const releaseTime = Number(faults![1]) * 1000;
  await expect
    .poll(() =>
      sql(`
    SELECT status || ':' || attempts || ':' || (archive IS NOT NULL)
    FROM public.export_jobs WHERE id = '${job}'
  `),
    )
    .toBe("completed:0:true");
  expect(workerStart()).toBe(before);

  const owner = { headers: { Authorization: "Bearer " + fixture.ownerToken } };
  const completed = await page.request.get("/api/v1/exports/" + job, owner);
  expect(completed.status()).toBe(200);
  const { downloadUrl } = await completed.json();
  const archive = await page.request.get(downloadUrl, owner);
  expect(archive.status()).toBe(200);
  const files = unzipSync(await archive.body());
  expect(new TextDecoder().decode(files["responses.csv"])).toContain(answer);

  let incidents: Event[] = [];
  await expect
    .poll(async () => {
      const response = await page.request.get(url, authorized);
      if (!response.ok()) return [];
      incidents = ((await response.json()) as Event[]).filter(
        (incident) =>
          incident.source === "export_worker" &&
          !earlierEpisodes.has(incident.episodeId),
      );
      return incidents.map(({ state }) => state).sort();
    })
    .toEqual(["detected", "recovered"]);
  const detected = incidents.find(({ state }) => state === "detected")!;
  const recovered = incidents.find(({ state }) => state === "recovered")!;
  expect(detected.episodeId).toMatch(/^[0-9a-f-]{36}$/);
  expect(recovered.episodeId).toBe(detected.episodeId);
  expect(Date.parse(detected.observedAt!)).toBeLessThan(releaseTime);
  expect(Date.parse(recovered.observedAt!)).toBeGreaterThanOrEqual(
    Math.floor(releaseTime),
  );
  for (const event of [detected, recovered]) {
    expect(JSON.stringify(event)).not.toContain(answer);
    expect(Object.keys(event).sort()).toEqual([
      "component",
      "episodeId",
      "id",
      "observedAt",
      "recordedAt",
      "severity",
      "source",
      "state",
    ]);
  }
  expect(
    sql(`
    SELECT string_agg(component || ':' || state || ':' || severity || ':' || (actor_id IS NULL), ',' ORDER BY state)
    FROM public.operation_incidents WHERE episode_id = '${detected.episodeId}'
  `),
  ).toBe("database:detected:advisory:true,database:recovered:information:true");
  expect(
    sql(`
    SELECT has_any_column_privilege('helpinsights_exporter', 'public.operation_incidents', 'INSERT, SELECT, UPDATE')
      OR has_column_privilege('helpinsights_app', 'public.operation_incidents', 'actor_id', 'SELECT')
      OR has_column_privilege('helpinsights_app', 'public.operation_incidents', 'source', 'INSERT')
      OR has_function_privilege('helpinsights_app', 'public.record_export_worker_recovery(uuid,timestamptz)', 'EXECUTE')
      OR EXISTS (
        SELECT 1 FROM pg_proc p
        CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        WHERE p.oid = 'public.record_export_worker_recovery(uuid,timestamptz)'::regprocedure
          AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'
      )
  `),
  ).toBe("f");
  expect(
    (
      await page.request.get(url, {
        headers: { Authorization: "Bearer " + fixture.ownerToken },
      })
    ).status(),
  ).toBe(403);

  expect(
    sql(`
    BEGIN;
    SET LOCAL ROLE helpinsights_exporter;
    SELECT public.record_export_worker_recovery('${detected.episodeId}', '${detected.observedAt}');
    RESET ROLE;
    SELECT count(*) FROM public.operation_incidents WHERE episode_id = '${detected.episodeId}';
    COMMIT
  `),
  ).toBe("2");
  const viewer = { headers: { Authorization: "Bearer " + ops.viewerToken } };
  const viewerHistory = await page.request.get(url, viewer);
  expect(viewerHistory.status()).toBe(200);
  expect(await viewerHistory.json()).toEqual(expect.arrayContaining(incidents));
  expect(
    await page.request.get(url).then((response) => response.status()),
  ).toBe(401);
  const forged = await page.request.post(url, {
    ...authorized,
    data: {
      component: "database",
      state: "detected",
      severity: "advisory",
      source: "export_worker",
    },
  });
  expect(forged.status()).toBe(400);

  const heartbeat = () =>
    Number(
      stack.compose(
        "exec",
        "-T",
        "worker",
        "cat",
        "/tmp/helpinsights-export-worker.ready",
      ),
    );
  let readyAt = heartbeat();
  for (let index = 0; index < 2; index++) {
    const previous = readyAt;
    await expect
      .poll(() => {
        readyAt = heartbeat();
        return readyAt;
      })
      .toBeGreaterThan(previous);
  }
  const workerLog = stack.compose("logs", "--no-color", "worker");
  expect(workerLog).not.toContain(answer);
  expect(workerLog).not.toContain(fixture.ownerToken);
  expect(workerLog).not.toContain(ops.operatorToken);
  const settled = await page.request.get(url, authorized);
  expect(settled.status()).toBe(200);
  const newEpisodes = ((await settled.json()) as Event[]).filter(
    (incident) =>
      incident.source === "export_worker" &&
      !earlierEpisodes.has(incident.episodeId),
  );
  expect(newEpisodes.map(({ episodeId }) => episodeId)).toEqual([
    detected.episodeId,
    detected.episodeId,
  ]);

  await page.goto("/admin");
  await page.getByLabel("Development session token").fill(ops.operatorToken);
  await page.getByRole("button", { name: "Open operations" }).click();
  const history = page.getByRole("table", { name: "Recent incidents" });
  await expect(
    history
      .getByRole("row", {
        name: /database\s+detected\s+advisory\s+Export worker/i,
      })
      .filter({
        has: page.locator('time[datetime="' + detected.observedAt + '"]'),
      }),
  ).toBeVisible();
  await expect(
    history
      .getByRole("row", {
        name: /database\s+recovered\s+information\s+Export worker/i,
      })
      .filter({
        has: page.locator('time[datetime="' + recovered.observedAt + '"]'),
      }),
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("export-worker-recovery.png"),
    fullPage: true,
  });
});
