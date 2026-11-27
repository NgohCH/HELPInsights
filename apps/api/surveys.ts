import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool, PoolClient } from "pg";
import {
  InvalidInput,
  label,
  object,
  parseDefinition,
  type SurveyDefinition,
  uuid,
} from "../../packages/survey-runtime/definition.ts";
import { requireSurveyFeatureAccess } from "./feature-entitlements.ts";
import { sendJson } from "./application.ts";
import {
  supportsSyntheticConsent,
  syntheticConsentNotice,
  syntheticStudyKey,
} from "./research-consent.ts";
import { HttpError, readSessionProof, withActor } from "./sessions.ts";

export const digest = (value: string) =>
  createHash("sha256").update(value).digest();
export const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const surveyColumns =
  'id, workspace_id AS "workspaceId", title, privacy_mode AS "privacyMode", status, expiry_at AS "expiryAt"';
const versionColumns =
  'id, survey_id AS "surveyId", version, hash, published_at AS "publishedAt"';

type SurveyRow = {
  id: string;
  workspaceId: string;
  title: string;
  status: "draft" | "published" | "closed";
  draft: SurveyDefinition | null;
  draft_revision: number;
};

export async function jsonBody(request: IncomingMessage): Promise<unknown> {
  if (
    request.headers["content-type"]?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  ) {
    throw new HttpError(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "Send JSON for this request",
    );
  }
  const max = 65_536;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > max)
      throw new HttpError(
        413,
        "PAYLOAD_TOO_LARGE",
        "Request body is too large",
      );
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new InvalidInput("Invalid JSON");
  }
}

export function writeClientError(
  response: ServerResponse,
  error: unknown,
  requestId: string,
) {
  if (error instanceof InvalidInput) {
    return sendJson(response, 400, {
      code: "BAD_REQUEST",
      message: error.message,
      requestId,
    });
  }
  if (!(error instanceof HttpError)) throw error;
  if (error.status === 401)
    response.setHeader("WWW-Authenticate", 'Bearer realm="HELPInsights"');
  if (error.status === 413) response.setHeader("Connection", "close");
  sendJson(response, error.status, {
    code: error.code,
    message: error.message,
    requestId,
  });
}

const missing = () => new HttpError(404, "NOT_FOUND", "Survey not found");
const denied = () =>
  new HttpError(
    403,
    "FORBIDDEN",
    "You do not have permission for this workspace",
  );
const conflict = () =>
  new HttpError(409, "CONFLICT", "The draft or survey state changed");

export async function requireEditor(client: PoolClient, workspaceId: string) {
  const { rows } = await client.query<{ role: string | null }>(
    "SELECT public.workspace_role($1) AS role",
    [workspaceId],
  );
  if (rows[0].role !== "owner" && rows[0].role !== "editor") throw denied();
}

export async function createSurveyDraft(
  client: PoolClient,
  input: {
    workspaceId: string;
    title: string;
    retentionPolicyId?: string;
    draft?: SurveyDefinition;
  },
) {
  const { workspaceId, title, retentionPolicyId = null, draft } = input;
  const {
    rows: [survey],
  } = await client.query(
    `INSERT INTO public.surveys (workspace_id, title, privacy_mode, retention_policy_id)
     SELECT $1, $2, 'anonymous', id FROM public.retention_policies
     WHERE workspace_id = $1 AND ($3::uuid IS NULL OR id = $3)
     RETURNING ${surveyColumns}`,
    [workspaceId, title, retentionPolicyId],
  );
  if (!survey)
    throw new InvalidInput(
      retentionPolicyId
        ? "Retention policy does not belong to this workspace"
        : "Choose a workspace with a retention policy",
    );
  if (draft) {
    const updated = await client.query(
      "UPDATE public.surveys SET draft = $2 WHERE id = $1",
      [survey.id, JSON.stringify(draft)],
    );
    if (updated.rowCount !== 1)
      throw new Error("Initial survey draft was not saved");
  }
  return survey;
}

const draftEtag = (revision: number) => '"' + revision + '"';

function setRevision(response: ServerResponse, revision: number) {
  response.setHeader("ETag", draftEtag(revision));
}

export function surveyRoutes(
  pool: Pool,
  syntheticRegistryEnabled = false,
  syntheticResearchConsent = false,
) {
  return async (
    request: IncomingMessage,
    response: ServerResponse,
    path: string,
    requestId: string,
  ) => {
    const route =
      /^\/api\/v1\/surveys(?:\/([^/]+)(?:\/(draft|publish|versions|close))?)?$/.exec(
        path,
      );
    if (!route) return false;

    try {
      const [, surveyId, action] = route;
      const { method } = request;
      const proof = readSessionProof(request);
      const readsBody =
        (!surveyId && method === "POST") ||
        (action === "draft" && method === "PUT") ||
        (action === "publish" &&
          method === "POST" &&
          (request.headers["transfer-encoding"] !== undefined ||
            Number(request.headers["content-length"] ?? 0) > 0));
      const submitted = readsBody ? await jsonBody(request) : undefined;
      await withActor(pool, proof, async (client) => {
        if (!surveyId) {
          if (method === "POST") {
            const body = object(submitted, [
              "workspaceId",
              "title",
              "privacyMode",
              "retentionPolicyId",
            ]);
            const workspace = uuid(body.workspaceId, "Workspace");
            const policy = uuid(body.retentionPolicyId, "Retention policy");
            await requireEditor(client, workspace);
            if (body.privacyMode !== "anonymous")
              throw new InvalidInput(
                "Only anonymous survey collection is enabled",
              );
            const survey = await createSurveyDraft(client, {
              workspaceId: workspace,
              title: label(body.title, "Title", 200),
              retentionPolicyId: policy,
            });
            return { status: 201, body: survey, revision: 1 };
          }
          if (method === "GET") {
            const url = new URL(request.url!, "http://localhost");
            const workspace = uuid(
              url.searchParams.get("workspaceId"),
              "Workspace",
            );
            const { rows: workspaces } = await client.query(
              "SELECT id FROM public.workspaces WHERE id = $1",
              [workspace],
            );
            if (!workspaces[0]) throw denied();
            const limit = Number(url.searchParams.get("limit") ?? 25);
            if (!Number.isInteger(limit) || limit < 1 || limit > 100)
              throw new InvalidInput("Limit must be 1 to 100");
            const cursorParam = url.searchParams.get("cursor");
            const cursor = cursorParam ? uuid(cursorParam, "Cursor") : null;
            const { rows } = await client.query(
              `SELECT ${surveyColumns} FROM public.surveys
               WHERE workspace_id = $1 AND ($2::uuid IS NULL OR id > $2)
               ORDER BY id LIMIT $3`,
              [workspace, cursor, limit + 1],
            );
            return {
              status: 200,
              body: {
                items: rows.slice(0, limit),
                nextCursor: rows.length > limit ? rows[limit - 1].id : null,
              },
            };
          }
          throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
        }

        const id = uuid(surveyId, "Survey");
        const write = method === "PUT" || method === "POST";
        if (write) {
          const {
            rows: [visible],
          } = await client.query<{ workspace_id: string }>(
            "SELECT workspace_id FROM public.surveys WHERE id = $1",
            [id],
          );
          if (!visible) throw missing();
          await requireEditor(client, visible.workspace_id);
        }
        const {
          rows: [survey],
        } = await client.query<SurveyRow>(
          `SELECT ${surveyColumns}, draft, draft_revision
           FROM public.surveys WHERE id = $1${write ? " FOR UPDATE" : ""}`,
          [id],
        );
        if (!survey) throw missing();
        if (!action && method === "GET") {
          const { draft_revision, ...details } = survey;
          return { status: 200, body: details, revision: draft_revision };
        }
        if (action === "versions" && method === "GET") {
          const { rows } = await client.query(
            `SELECT ${versionColumns} FROM public.survey_versions WHERE survey_id = $1 ORDER BY version DESC`,
            [id],
          );
          return { status: 200, body: rows };
        }

        if (action === "draft" && method === "PUT") {
          if (
            request.headers["if-match"] !== draftEtag(survey.draft_revision) ||
            survey.status === "closed"
          )
            throw conflict();
          const draft = parseDefinition(submitted);
          await requireSurveyFeatureAccess(client, survey.workspaceId, draft);
          await client.query(
            "UPDATE public.surveys SET draft = $2, title = $3, draft_revision = draft_revision + 1 WHERE id = $1",
            [id, JSON.stringify(draft), draft.title],
          );
          return {
            status: 200,
            body: draft,
            revision: survey.draft_revision + 1,
          };
        }
        if (action === "publish" && method === "POST") {
          const revision = request.headers["if-match"];
          if (
            survey.status === "closed" ||
            (revision !== undefined &&
              revision !== draftEtag(survey.draft_revision))
          )
            throw conflict();
          const draft =
            survey.draft === null ? null : parseDefinition(survey.draft);
          if (!draft?.pages.some((page) => page.questions.length))
            throw new InvalidInput("Add a question before publishing");
          await requireSurveyFeatureAccess(client, survey.workspaceId, draft);
          const publishOptions =
            submitted === undefined
              ? {}
              : object(submitted, ["eligibilityMode", "researchConsent"]);
          const eligibilityMode =
            publishOptions.eligibilityMode === undefined
              ? "open"
              : publishOptions.eligibilityMode;
          if (
            eligibilityMode !== "open" &&
            eligibilityMode !== "registry-synthetic"
          )
            throw new InvalidInput("Choose a supported eligibility mode");
          const researchConsent = publishOptions.researchConsent;
          if (
            researchConsent !== undefined &&
            eligibilityMode === "registry-synthetic"
          )
            throw new InvalidInput("Choose one synthetic survey restriction");
          if (
            eligibilityMode === "registry-synthetic" &&
            !syntheticRegistryEnabled
          )
            throw new HttpError(
              503,
              "UNAVAILABLE",
              "The synthetic Registry is unavailable",
            );
          if (researchConsent !== undefined) {
            if (researchConsent !== "synthetic")
              throw new InvalidInput(
                "Choose a supported research consent option",
              );
            if (!syntheticResearchConsent)
              throw new HttpError(
                503,
                "UNAVAILABLE",
                "Synthetic research consent is unavailable",
              );
            if (!supportsSyntheticConsent(draft))
              throw new InvalidInput(
                "Synthetic consent surveys support only single-choice questions",
              );
          }
          const definition = JSON.stringify(draft);
          const {
            rows: [version],
          } = await client.query(
            `INSERT INTO public.survey_versions (survey_id, version, definition, hash)
             SELECT $1, COALESCE(MAX(version), 0) + 1, $2, $3
             FROM public.survey_versions WHERE survey_id = $1 RETURNING ${versionColumns}`,
            [id, definition, digest(definition).toString("hex")],
          );
          const publicToken = randomBytes(32).toString("base64url");
          await client.query(
            "INSERT INTO public.distributions (token_hash, survey_version_id, eligibility_mode) VALUES ($1, $2, $3)",
            [digest(publicToken), version.id, eligibilityMode],
          );
          if (researchConsent === "synthetic") {
            await client.query(
              `INSERT INTO public.research_consent_versions
                (survey_version_id, study_key, revision, notice) VALUES ($1, $2, $3, $4)`,
              [
                version.id,
                syntheticStudyKey,
                version.version,
                syntheticConsentNotice,
              ],
            );
          }
          await client.query(
            "UPDATE public.surveys SET status = 'published' WHERE id = $1",
            [id],
          );
          return { status: 201, body: { ...version, publicToken } };
        }
        if (action === "close" && method === "POST") {
          if (survey.status !== "published") throw conflict();
          const { rows } = await client.query(
            `UPDATE public.surveys SET status = 'closed' WHERE id = $1 RETURNING ${surveyColumns}`,
            [id],
          );
          return { status: 200, body: rows[0] };
        }
        throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
      }).then((result) => {
        if (result.revision) setRevision(response, result.revision);
        sendJson(response, result.status, result.body);
      });
    } catch (error) {
      writeClientError(response, error, requestId);
    }
    return true;
  };
}
