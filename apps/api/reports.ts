import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool, PoolClient } from "pg";
import {
  InvalidInput,
  object,
  type SurveyDefinition,
  uuid,
} from "../../packages/survey-runtime/definition.ts";
import { sendJson } from "./application.ts";
import { HttpError, readSessionProof, withActor } from "./sessions.ts";
import { jsonBody, writeClientError } from "./surveys.ts";

type ReportVersion = { id: string; definition: SurveyDefinition };
type ExportJob = {
  id: string;
  status: string;
  expiry: Date | null;
  archive?: Buffer | null;
};
const reportMissing = () =>
  new HttpError(404, "NOT_FOUND", "Survey results or export not found");
const minimumCell = 5;

async function reportVersion(
  client: PoolClient,
  survey: string,
  requestedVersion: string | null,
) {
  const {
    rows: [access],
  } = await client.query<{ role: string | null }>(
    "SELECT public.workspace_role(workspace_id) AS role FROM public.surveys WHERE id = $1",
    [survey],
  );
  if (!access) throw reportMissing();
  if (access.role !== "owner" && access.role !== "analyst") {
    throw new HttpError(
      403,
      "FORBIDDEN",
      "You do not have permission to view survey results",
    );
  }
  const {
    rows: [version],
  } = await client.query<ReportVersion>(
    "SELECT id, definition FROM public.survey_versions WHERE survey_id = $1 AND ($2::uuid IS NULL OR id = $2) ORDER BY version DESC LIMIT 1",
    [survey, requestedVersion],
  );
  if (!version) throw reportMissing();
  return version;
}

export function reportRoutes(pool: Pool) {
  return async (
    request: IncomingMessage,
    response: ServerResponse,
    path: string,
    requestId: string,
  ) => {
    const survey = /^\/api\/v1\/surveys\/([^/]+)\/(analytics|exports)$/.exec(
      path,
    );
    const exportJob = /^\/api\/v1\/exports\/([^/]+)(\/download)?$/.exec(path);
    if (!survey && !exportJob) return false;
    try {
      const proof = readSessionProof(request);
      const method = survey?.[2] === "exports" ? "POST" : "GET";
      if (request.method !== method) {
        response.setHeader("Allow", method);
        throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
      }
      if (survey) {
        const id = uuid(survey[1], "Survey");
        const body =
          method === "POST"
            ? object(await jsonBody(request), [
                "format",
                "surveyVersionId",
                "includeAttachments",
              ])
            : null;
        const queryVersions = body
          ? []
          : new URL(request.url!, "http://localhost").searchParams.getAll(
              "surveyVersionId",
            );
        if (queryVersions.length > 1)
          throw new InvalidInput("Choose one survey version");
        const versionId = body ? body.surveyVersionId : queryVersions[0];
        const result = await withActor(pool, proof, async (client, actor) => {
          const requestedVersion =
            versionId === undefined ? null : uuid(versionId, "Survey version");
          const version = await reportVersion(client, id, requestedVersion);
          if (body) {
            if (
              body.includeAttachments !== undefined &&
              body.includeAttachments !== false
            )
              throw new InvalidInput("Attachment exports are unavailable");
            if (
              body.format !== "csv_bundle" &&
              body.format !== "jasp_csv_bundle"
            ) {
              throw new InvalidInput("Choose a supported export format");
            }
            const { rows } = await client.query(
              "INSERT INTO public.export_jobs (survey_version_id, requested_by, format) VALUES ($1, $2, $3) RETURNING id, status",
              [version.id, actor.id, body.format],
            );
            return rows[0];
          }
          const choiceIds = version.definition.pages
            .flatMap(({ questions }) => questions)
            .filter((question) => question.type === "single_choice")
            .map((question) => question.id);
          const {
            rows: [summary],
          } = await client.query<{
            total: number;
            cells: {
              question_id: string;
              option_code: string | null;
              count: number;
            }[];
          }>(
            `
            WITH scoped AS MATERIALIZED (
              SELECT answers FROM public.responses WHERE survey_version_id = $1
            ), cells AS (
              SELECT a.entry->>'questionId' AS question_id,
                CASE WHEN a.entry->>'questionId' = ANY($2::text[]) THEN a.entry->>'value' END AS option_code,
                count(*)::integer AS count
              FROM scoped CROSS JOIN LATERAL jsonb_array_elements(scoped.answers) AS a(entry)
              GROUP BY 1, 2
            )
            SELECT (SELECT count(*)::integer FROM scoped) AS total,
              coalesce((SELECT jsonb_agg(to_jsonb(cells)) FROM cells), '[]'::jsonb) AS cells
          `,
            [version.id, choiceIds],
          );
          const questions = version.definition.pages
            .flatMap(({ questions }) => questions)
            .map((question) => {
              const values = summary.cells.filter(
                (cell) => cell.question_id === question.id,
              );
              const count = values.reduce(
                (total, cell) => total + cell.count,
                0,
              );
              const unanswered = summary.total - count;
              const suppressed =
                (unanswered > 0 && unanswered < minimumCell) ||
                summary.total < minimumCell ||
                values.some((cell) => cell.count < minimumCell);
              const categories =
                !suppressed && question.type === "single_choice"
                  ? question.options.map((option) => ({
                      ...option,
                      count:
                        values.find((cell) => cell.option_code === option.code)
                          ?.count ?? 0,
                    }))
                  : [];
              return {
                questionId: question.id,
                title: question.title,
                suppressed,
                categories,
                ...(suppressed ? {} : { count }),
              };
            });
          return {
            surveyId: id,
            surveyVersionId: version.id,
            responseCount: summary.total,
            questions,
          };
        });
        sendJson(response, method === "POST" ? 202 : 200, result);
        return true;
      }

      const id = uuid(exportJob![1], "Export");
      const download = !!exportJob![2];
      const job = await withActor(pool, proof, async (client, actor) => {
        const { rows } = await client.query<ExportJob>(
          `
          SELECT id, CASE WHEN status = 'completed' AND expires_at <= now() THEN 'expired' ELSE status END AS status,
            expires_at AS expiry ${download ? ", CASE WHEN expires_at > now() THEN archive END AS archive" : ""}
          FROM public.export_jobs WHERE id = $1`,
          [id],
        );
        const run = rows[0];
        if (download && run?.status === "completed" && run.archive) {
          await client.query(
            "INSERT INTO public.export_download_audit (export_id, requested_by) VALUES ($1, $2)",
            [id, actor.id],
          );
        }
        return rows[0];
      });
      if (!job) throw reportMissing();
      if (!download) {
        sendJson(response, 200, {
          id: job.id,
          status: job.status,
          expiresAt: job.expiry,
          downloadUrl:
            job.status === "completed"
              ? "/api/v1/exports/" + id + "/download"
              : null,
        });
        return true;
      }
      if (job.status !== "completed" || !job.archive) throw reportMissing();
      response.writeHead(200, {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="helpinsights-data.zip"',
        "Content-Length": job.archive.length,
      });
      response.end(job.archive);
    } catch (error) {
      writeClientError(response, error, requestId);
    }
    return true;
  };
}
