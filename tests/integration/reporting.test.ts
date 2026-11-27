import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { unzipSync } from "fflate";
import { definition, surveyFixture } from "../fixtures/survey.ts";

test("analytics suppress small categories and a scoped export preserves coded anonymous data", async () => {
  const { stack, sql, workspace, retentionPolicy, ownerToken, outsiderToken } =
    surveyFixture();
  const api = stack.baseUrl() + "/api/v1";
  const author = {
    Authorization: "Bearer " + ownerToken,
    "Content-Type": "application/json",
  };
  const outsider = {
    Authorization: "Bearer " + outsiderToken,
    "Content-Type": "application/json",
  };
  const create = await fetch(api + "/surveys", {
    method: "POST",
    headers: author,
    body: JSON.stringify({
      workspaceId: workspace,
      title: definition.title,
      privacyMode: "anonymous",
      retentionPolicyId: retentionPolicy,
    }),
  });
  assert.equal(create.status, 201);
  const { id } = await create.json();
  const survey = api + "/surveys/" + id;
  const extended = {
    ...definition,
    pages: [
      {
        ...definition.pages[0],
        questions: [
          ...definition.pages[0].questions,
          {
            id: "notes",
            code: "notes",
            title: "Notes",
            type: "short_text",
            required: false,
          },
        ],
      },
    ],
  };
  assert.equal(
    (
      await fetch(survey + "/draft", {
        method: "PUT",
        headers: { ...author, "If-Match": create.headers.get("etag")! },
        body: JSON.stringify(extended),
      })
    ).status,
    200,
  );
  const published = await fetch(survey + "/publish", {
    method: "POST",
    headers: author,
  });
  assert.equal(published.status, 201);
  const version = await published.json();
  const publicRoute = api + "/public/s/" + version.publicToken + "/responses";

  async function collect(choice: string, notes?: string) {
    const response = await fetch(publicRoute, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": randomUUID(),
      },
      body: JSON.stringify({
        surveyVersionId: version.id,
        answers: [
          { questionId: "rating", value: choice },
          ...(notes === undefined
            ? []
            : [{ questionId: "notes", value: notes }]),
        ],
      }),
    });
    assert.equal(response.status, 201);
  }
  await collect("useful", "=2+3");
  const first = await fetch(survey + "/analytics", { headers: author });
  assert.equal(first.status, 200);
  const small = await first.json();
  assert.equal(small.responseCount, 1);
  assert.equal(small.questions[0].suppressed, true);
  assert.deepEqual(small.questions[0].categories, []);

  for (const [choice, notes] of [
    ["useful", "Terima kasih"],
    ["useful", "谢谢"],
    ["not_useful", "a, b"],
    ["not_useful", "Fine"],
  ])
    await collect(choice, notes);

  const mixedSmall = await fetch(survey + "/analytics", { headers: author });
  assert.equal(mixedSmall.status, 200);
  assert.equal((await mixedSmall.json()).questions[0].suppressed, true);
  let skipped = false;
  for (const choice of [
    "useful",
    "useful",
    "not_useful",
    "not_useful",
    "not_useful",
  ]) {
    await collect(
      choice,
      choice === "useful" && !skipped
        ? ((skipped = true), undefined)
        : "Sample",
    );
  }
  const result = await fetch(survey + "/analytics", { headers: author });
  assert.equal(result.status, 200);
  const report = await result.json();
  assert.equal(report.responseCount, 10);
  assert.equal(report.questions[1].suppressed, true);
  assert.equal(Object.hasOwn(report.questions[1], "count"), false);
  const later = await fetch(survey + "/publish", {
    method: "POST",
    headers: author,
  });
  assert.equal(later.status, 201);
  assert.notEqual((await later.json()).id, version.id);
  assert.deepEqual(report.questions[0].categories, [
    { code: "useful", label: "Useful", count: 5 },
    { code: "not_useful", label: "Not useful", count: 5 },
  ]);
  assert.equal(
    (await fetch(survey + "/analytics", { headers: outsider })).status,
    404,
  );

  const request = {
    method: "POST",
    body: JSON.stringify({
      format: "jasp_csv_bundle",
      includeAttachments: false,
      surveyVersionId: version.id,
    }),
  };
  assert.equal(
    (await fetch(survey + "/exports", { ...request, headers: outsider }))
      .status,
    404,
  );
  stack.compose("stop", "worker");
  let job: { id: string; status: string };
  let failingJobId: string;
  try {
    const queued = await fetch(survey + "/exports", {
      ...request,
      headers: author,
    });
    assert.equal(queued.status, 202);
    const firstJob = await queued.json();
    sql(`
      CREATE FUNCTION public.fail_fixture_export() RETURNS trigger LANGUAGE plpgsql AS $body$
      BEGIN
        IF NEW.id = '${firstJob.id}' AND NEW.status = 'completed' THEN RAISE EXCEPTION 'synthetic export fault'; END IF;
        RETURN NEW;
      END
      $body$;
      CREATE TRIGGER fail_fixture_export BEFORE UPDATE ON public.export_jobs
      FOR EACH ROW EXECUTE FUNCTION public.fail_fixture_export();
    `);
    const next = await fetch(survey + "/exports", {
      ...request,
      headers: author,
    });
    assert.equal(next.status, 202);
    job = await next.json();
    failingJobId = firstJob.id;
    assert.equal(job.status, "queued");
    assert.equal(
      sql("SELECT status FROM public.export_jobs WHERE id = '" + job.id + "'"),
      "queued",
    );
  } finally {
    stack.compose("start", "worker");
  }

  const jobUrl = api + "/exports/" + job.id;
  let complete: { status: string; downloadUrl?: string } = job;
  for (
    let attempt = 0;
    attempt < 40 && complete.status !== "completed";
    attempt++
  ) {
    await delay(150);
    const status = await fetch(jobUrl, { headers: author });
    assert.equal(status.status, 200);
    complete = await status.json();
    assert.notEqual(complete.status, "failed");
  }
  assert.equal(complete.status, "completed");
  for (let attempt = 0; attempt < 40; attempt++) {
    if (
      sql(
        "SELECT status FROM public.export_jobs WHERE id = '" +
          failingJobId +
          "'",
      ) === "failed"
    )
      break;
    await delay(150);
  }
  assert.equal(
    sql(
      "SELECT status, attempts, archive IS NULL FROM public.export_jobs WHERE id = '" +
        failingJobId +
        "'",
    ),
    "failed|3|t",
  );
  assert.ok(complete.downloadUrl);
  assert.equal((await fetch(jobUrl, { headers: outsider })).status, 404);
  const download = new URL(complete.downloadUrl, stack.baseUrl()).href;
  assert.equal((await fetch(download, { headers: outsider })).status, 404);
  const archive = await fetch(download, { headers: author });
  assert.equal(archive.status, 200);
  assert.equal(
    sql(
      "SELECT count(*) FROM public.export_download_audit WHERE export_id = '" +
        job.id +
        "'",
    ),
    "1",
  );
  assert.match(archive.headers.get("content-type") ?? "", /^application\/zip/);
  const files = unzipSync(new Uint8Array(await archive.arrayBuffer()));
  assert.deepEqual(Object.keys(files).sort(), [
    "IMPORT_IN_JASP.md",
    "codebook.csv",
    "manifest.json",
    "responses.csv",
  ]);
  const read = (name: string) =>
    new TextDecoder("utf-8", { fatal: true }).decode(files[name]);
  const responses = read("responses.csv");
  const rows = responses.split("\r\n").slice(0, -1);
  assert.equal(rows[0], "workshop_rating,notes");
  assert.equal(rows.length, 11);
  assert.ok(rows.includes("useful,'=2+3"));
  assert.ok(rows.includes("useful,谢谢"));
  assert.ok(rows.includes('not_useful,"a, b"'));
  const codebook = read("codebook.csv").split("\r\n");
  assert.equal(
    codebook[0],
    "variable_name,question_id,question_text,measurement_level,value_code,value_label,missing_codes,survey_version_id,questionnaire_version,order,transformation",
  );
  assert.ok(
    codebook.includes(
      "workshop_rating,rating,How useful was the workshop?,nominal,useful,Useful,blank," +
        version.id +
        ",1,,coded option",
    ),
  );
  const manifest = JSON.parse(read("manifest.json"));
  assert.equal(manifest.surveyVersionId, version.id);
  assert.equal(manifest.responseCount, 10);
  assert.equal(manifest.privacyMode, "anonymous");
  assert.equal(
    manifest.checksums["responses.csv"],
    createHash("sha256").update(files["responses.csv"]).digest("hex"),
  );
  assert.equal(
    sql(
      "SELECT count(*) FROM public.responses WHERE survey_version_id = '" +
        version.id +
        "'",
    ),
    "10",
  );

  sql(
    "UPDATE public.export_jobs SET expires_at = now() - interval '1 minute' WHERE id = '" +
      job.id +
      "'",
  );
  assert.equal((await fetch(download, { headers: author })).status, 404);
  for (let attempt = 0; attempt < 30; attempt++) {
    if (
      sql(
        "SELECT status FROM public.export_jobs WHERE id = '" + job.id + "'",
      ) === "expired"
    )
      break;
    await delay(100);
  }
  assert.equal(
    sql(
      "SELECT status, archive IS NULL FROM public.export_jobs WHERE id = '" +
        job.id +
        "'",
    ),
    "expired|t",
  );
});
