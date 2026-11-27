import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import {
  InvalidInput,
  object,
  uuid,
} from "../../packages/survey-runtime/definition.ts";
import { sendJson } from "./application.ts";
import { HttpError, readSessionProof, withActor } from "./sessions.ts";
import { jsonBody, writeClientError } from "./surveys.ts";

function holdInput(value: unknown) {
  const { reason, evidenceReference, expiresAt } = object(value, [
    "reason",
    "evidenceReference",
    "expiresAt",
  ]);
  if (reason !== "legal" && reason !== "research")
    throw new InvalidInput("Hold reason must be legal or research");
  if (
    typeof expiresAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(expiresAt)
  ) {
    throw new InvalidInput("Hold expiry must be a UTC timestamp");
  }
  const date = new Date(expiresAt);
  const normalized = expiresAt.includes(".")
    ? expiresAt
    : expiresAt.replace("Z", ".000Z");
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== normalized)
    throw new InvalidInput("Hold expiry must be a valid UTC timestamp");
  return [reason, uuid(evidenceReference, "Evidence reference"), date] as const;
}

const missing = () => new HttpError(404, "NOT_FOUND", "Survey not found");

export function retentionRoutes(pool: Pool) {
  return async (
    request: IncomingMessage,
    response: ServerResponse,
    path: string,
    requestId: string,
  ) => {
    const match =
      /^\/api\/v1\/surveys\/([^/]+)\/retention(?:\/(holds|disposal-preview))?$/.exec(
        path,
      );
    if (!match) return false;
    const [, requestedSurvey, action] = match;
    const holds = action === "holds";
    const allowed = holds ? "POST" : "GET";
    if (request.method !== allowed) {
      response.setHeader("Allow", allowed);
      sendJson(response, 405, {
        code: "METHOD_NOT_ALLOWED",
        message: "Method not allowed",
        requestId,
      });
      return true;
    }
    try {
      const proof = readSessionProof(request);
      const survey = uuid(requestedSurvey, "Survey");
      const input = holds ? holdInput(await jsonBody(request)) : null;
      const result = await withActor(pool, proof, async (client) => {
        if (action === "disposal-preview") {
          const {
            rows: [preview],
          } = await client.query(
            'SELECT outcome, disposition, expiry_at AS "expiryAt", protected_until AS "protectedUntil" FROM public.read_disposal_preview($1)',
            [survey],
          );
          if (!preview) throw missing();
          if (preview.outcome === "forbidden") {
            throw new HttpError(
              403,
              "FORBIDDEN",
              "Disposal review is required in this workspace",
            );
          }
          const { outcome, ...summary } = preview;
          return summary;
        }
        if (!input) {
          const {
            rows: [disposition],
          } = await client.query(
            `SELECT disposition, expiry_at AS "expiryAt", protected_until AS "protectedUntil"
             FROM public.read_survey_retention($1)`,
            [survey],
          );
          if (!disposition) throw missing();
          return disposition;
        }
        const {
          rows: [result],
        } = await client.query(
          `SELECT outcome, hold_id AS id, reason, applied_at AS "appliedAt", expires_at AS "expiresAt"
           FROM public.approve_retention_hold($1, $2, $3, $4)`,
          [survey, ...input],
        );
        const { outcome, ...record } = result;
        switch (outcome) {
          case "not_found":
            throw missing();
          case "forbidden":
            throw new HttpError(
              403,
              "FORBIDDEN",
              "Hold approval is required in this workspace",
            );
          case "invalid":
            throw new InvalidInput("Hold expiry must be in the future");
          case "duplicate":
            throw new HttpError(
              409,
              "CONFLICT",
              "A hold already uses this evidence reference",
            );
          case "approved":
            return record;
          default:
            throw new Error("Unexpected retention hold outcome");
        }
      });
      sendJson(response, holds ? 201 : 200, result);
    } catch (error) {
      writeClientError(response, error, requestId);
    }
    return true;
  };
}
