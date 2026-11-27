import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool, PoolClient } from "pg";
import {
  InvalidInput,
  label,
  object,
  uuid,
} from "../../packages/survey-runtime/definition.ts";
import { sendJson } from "./application.ts";
import { npsAccessEnabled } from "./feature-entitlements.ts";
import { HttpError, readSessionProof, withActor } from "./sessions.ts";
import { jsonBody, writeClientError } from "./surveys.ts";

const descriptor = {
  featureKey: "nps",
  title: "NPS questions",
  description: "Collect a 0–10 recommendation rating in anonymous surveys.",
};

const requestColumns = `id, purpose, data_classification AS "dataClassification",
  requested_at AS "requestedAt", decided_at AS "decidedAt", rationale,
  expires_at AS "expiresAt",
  CASE
    WHEN decision = 'approve' AND expires_at <= statement_timestamp() THEN 'expired'
    WHEN decision = 'approve' THEN 'approved'
    WHEN decision = 'deny' THEN 'denied'
    ELSE 'pending'
  END AS status`;

const denied = () =>
  new HttpError(
    403,
    "FORBIDDEN",
    "You do not have permission for this feature action",
  );
const conflict = (message: string) => new HttpError(409, "CONFLICT", message);
const missing = () =>
  new HttpError(404, "NOT_FOUND", "Feature request not found");

async function authorisation(client: PoolClient, workspace: string) {
  const {
    rows: [access],
  } = await client.query<{ role: string | null; reviewer: boolean }>(
    `SELECT public.workspace_role($1) AS role,
      EXISTS (SELECT 1 FROM public.feature_reviewers WHERE workspace_id = $1) AS reviewer`,
    [workspace],
  );
  if (!access.role) throw denied();
  return {
    author: access.role === "owner" || access.role === "editor",
    reviewer: access.reviewer,
  };
}

async function submitRequest(
  client: PoolClient,
  workspace: string,
  actor: string,
  body: unknown,
) {
  const payload = object(body, ["purpose", "dataClassification"]);
  if (payload.dataClassification !== "anonymous")
    throw new InvalidInput(
      "Only anonymous survey use is available for NPS questions",
    );
  if (await npsAccessEnabled(client, workspace))
    throw conflict("This workspace already has access");
  const {
    rows: [created],
  } = await client.query(
    `INSERT INTO public.feature_requests (workspace_id, feature_key, requested_by, purpose, data_classification)
     VALUES ($1, 'nps', $2, $3, 'anonymous') ON CONFLICT DO NOTHING RETURNING ${requestColumns}`,
    [workspace, actor, label(payload.purpose, "Purpose", 300)],
  );
  if (!created)
    throw conflict("A request is already pending for this workspace");
  return created;
}

async function decideRequest(
  client: PoolClient,
  workspace: string,
  requestId: string,
  actor: string,
  body: unknown,
) {
  const payload = object(body, ["decision", "rationale", "expiresInDays"]);
  const rationale = label(payload.rationale, "Decision rationale", 300);
  const { decision } = payload;
  const days = payload.expiresInDays;
  if (decision !== "approve" && decision !== "deny")
    throw new InvalidInput("Choose approve or deny");
  if (
    decision === "approve" &&
    (typeof days !== "number" ||
      !Number.isInteger(days) ||
      days < 1 ||
      days > 90)
  )
    throw new InvalidInput(
      "Approved access requires an expiry from 1 to 90 days",
    );
  if (decision === "deny" && days !== undefined)
    throw new InvalidInput("Denied requests have no access expiry");

  const {
    rows: [current],
  } = await client.query(
    `SELECT requested_by, reviewed_by, decision, expires_in_days, ${requestColumns}
     FROM public.feature_requests WHERE workspace_id = $1 AND id = $2 AND feature_key = 'nps'`,
    [workspace, requestId],
  );
  if (!current) throw missing();
  const {
    requested_by,
    reviewed_by,
    decision: stored,
    expires_in_days,
    ...record
  } = current;
  if (requested_by === actor) throw denied();
  if (stored !== null) {
    if (
      reviewed_by === actor &&
      stored === decision &&
      record.rationale === rationale &&
      expires_in_days === (days ?? null)
    )
      return record;
    throw conflict("This request already has a decision");
  }
  const {
    rows: [reviewed],
  } = await client.query(
    `UPDATE public.feature_requests
     SET decision = $3, reviewed_by = $4, rationale = $5, decided_at = statement_timestamp(),
         expires_in_days = $6, expires_at = statement_timestamp() + make_interval(hours => $6::integer * 24)
     WHERE workspace_id = $1 AND id = $2 AND decision IS NULL
     RETURNING ${requestColumns}`,
    [workspace, requestId, decision, actor, rationale, days ?? null],
  );
  if (!reviewed) throw denied();
  return reviewed;
}

export function featureRoutes(pool: Pool) {
  return async (
    request: IncomingMessage,
    response: ServerResponse,
    path: string,
    requestId: string,
  ) => {
    const route =
      /^\/api\/v1\/workspaces\/([^/]+)\/features\/nps(?:(\/requests)(?:\/([^/]+)\/decision)?)?$/.exec(
        path,
      );
    if (!route) return false;
    const [, workspaceId, action, featureRequestId] = route;
    const method = action ? "POST" : "GET";
    try {
      if (request.method !== method) {
        response.setHeader("Allow", method);
        throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
      }
      const proof = readSessionProof(request);
      const workspace = uuid(workspaceId, "Workspace");
      const payload = action ? await jsonBody(request) : undefined;
      const result = await withActor(pool, proof, async (client, actor) => {
        const { author, reviewer } = await authorisation(client, workspace);
        if (!action) {
          const enabled = await npsAccessEnabled(client, workspace);
          const { rows } = await client.query(
            `SELECT ${requestColumns} FROM public.feature_requests
             WHERE workspace_id = $1 AND feature_key = 'nps'
             ORDER BY requested_at DESC, id LIMIT 50`,
            [workspace],
          );
          const hasPendingRequest = rows.some(
            (row) => row.status === "pending",
          );
          return {
            ...descriptor,
            enabled,
            canRequest: author && !enabled && !hasPendingRequest,
            canReview: reviewer,
            requests: rows,
          };
        }
        if (featureRequestId ? !reviewer : !author) throw denied();
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended('feature:nps:' || $1, 0))",
          [workspace],
        );
        return featureRequestId
          ? decideRequest(
              client,
              workspace,
              uuid(featureRequestId, "Feature request"),
              actor.id,
              payload,
            )
          : submitRequest(client, workspace, actor.id, payload);
      });
      sendJson(response, action && !featureRequestId ? 201 : 200, result);
    } catch (error) {
      writeClientError(response, error, requestId);
    }
    return true;
  };
}
