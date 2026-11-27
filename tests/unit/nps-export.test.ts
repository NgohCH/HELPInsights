import assert from "node:assert/strict";
import test from "node:test";
import { strFromU8, unzipSync } from "fflate";
import { parseDefinition } from "../../packages/survey-runtime/definition.ts";
import { createExport } from "../../packages/survey-runtime/export.ts";

test("NPS exports integer values and an ordinal codebook entry", () => {
  const definition = parseDefinition({
    schemaVersion: "1",
    title: "Recommendation",
    pages: [
      {
        id: "first",
        questions: [
          {
            id: "rating",
            code: "rating",
            title: "How likely are you to recommend the service?",
            type: "nps",
            required: true,
          },
        ],
      },
    ],
  });
  const now = new Date("2026-01-01T00:00:00Z");
  const archive = unzipSync(
    createExport(
      {
        version_id: "version-id",
        survey_id: "survey-id",
        version: 1,
        definition,
        requested_at: now,
        format: "jasp_csv_bundle",
        over_limit: false,
        answers: [
          [{ questionId: "rating", value: 0 }],
          [{ questionId: "rating", value: 10 }],
        ],
      },
      now,
    ),
  );
  assert.equal(strFromU8(archive["responses.csv"]), "rating\r\n0\r\n10\r\n");
  assert.match(
    strFromU8(archive["codebook.csv"]),
    /rating,rating,.*?,ordinal,.*recommendation score \(0–10\)/,
  );
});
