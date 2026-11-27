import { createHash } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import type { Answer } from "./answers.ts";
import type { SurveyDefinition } from "./definition.ts";

export type ExportSource = {
  version_id: string;
  survey_id: string;
  version: number;
  definition: SurveyDefinition;
  requested_at: Date;
  format: "csv_bundle" | "jasp_csv_bundle";
  over_limit: boolean;
  answers: Answer[][];
};

function csvValue(value: string | number) {
  let field = String(value);
  if (
    typeof value === "string" &&
    (/^[\t\r\n]/.test(field) || /^[\u0000-\u0020]*[=+\-@]/.test(field))
  ) {
    field = "'" + field;
  }
  return /[",\r\n]/.test(field)
    ? '"' + field.replaceAll('"', '""') + '"'
    : field;
}

function csv(rows: (string | number)[][]) {
  return rows.map((row) => row.map(csvValue).join(",")).join("\r\n") + "\r\n";
}

export function createExport(source: ExportSource, now: Date) {
  const questions = source.definition.pages.flatMap(
    ({ questions }) => questions,
  );
  const codebook: (string | number)[][] = [
    [
      "variable_name",
      "question_id",
      "question_text",
      "measurement_level",
      "value_code",
      "value_label",
      "missing_codes",
      "survey_version_id",
      "questionnaire_version",
      "order",
      "transformation",
    ],
  ];
  for (const question of questions) {
    const common = [question.code, question.id, question.title];
    const missingAndVersion = ["blank", source.version_id, source.version, ""];
    if (question.type === "single_choice") {
      for (const option of question.options) {
        codebook.push([
          ...common,
          "nominal",
          option.code,
          option.label,
          ...missingAndVersion,
          "coded option",
        ]);
      }
    } else {
      const kind =
        question.type === "nps"
          ? "ordinal"
          : question.type === "number"
            ? "scale"
            : "text";
      codebook.push([
        ...common,
        kind,
        "",
        "",
        ...missingAndVersion,
        kind === "text"
          ? "spreadsheet formula escaping"
          : question.type === "nps"
            ? "recommendation score (0–10)"
            : "",
      ]);
    }
  }

  const columns = questions.map((question) => question.code);
  const records = source.answers.map((answers) => {
    const byQuestion = new Map(
      answers.map((answer) => [answer.questionId, answer.value]),
    );
    return questions.map((question) => byQuestion.get(question.id) ?? "");
  });
  const files = {
    "responses.csv": strToU8(csv([columns, ...records])),
    "codebook.csv": strToU8(csv(codebook)),
    "IMPORT_IN_JASP.md": strToU8(`# Import the survey data in JASP

1. Extract this ZIP. In JASP choose File, then Open, and select responses.csv.
2. Confirm the header and review the nominal, ordinal and scale levels using codebook.csv.
3. Review the blank missing values and any text transformations before analysis.
4. Save a local JASP analysis file in an approved location.

CSV imports require review of measurement levels and value labels. The codebook supplies this metadata separately.
`),
  };
  const checksums = Object.fromEntries(
    Object.entries(files).map(([name, data]) => [
      name,
      createHash("sha256").update(data).digest("hex"),
    ]),
  );
  const manifest = {
    schemaVersion: 1,
    surveyId: source.survey_id,
    surveyVersionId: source.version_id,
    version: source.version,
    requestedAt: source.requested_at.toISOString(),
    exportedAt: now.toISOString(),
    format: source.format,
    columns,
    responseCount: records.length,
    privacyMode: "anonymous",
    locale: "en",
    filters: {
      publishedVersion: source.version,
      acceptedBy: source.requested_at.toISOString(),
    },
    encoding: "UTF-8 without BOM",
    missingValues: "blank",
    spreadsheetTextEscaping:
      "Leading formula-like text is prefixed with an apostrophe",
    checksums,
  };
  return Buffer.from(
    zipSync({
      ...files,
      "manifest.json": strToU8(JSON.stringify(manifest, null, 2) + "\n"),
    }),
  );
}
