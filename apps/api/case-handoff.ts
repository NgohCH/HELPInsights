import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import {
  InvalidInput,
  object,
  uuid,
} from "../../packages/survey-runtime/definition.ts";
import { caseCategories, casePriorities } from "../case-handoff-policy.ts";
import { sendJson } from "./application.ts";
import { HttpError, readSessionProof, withActor } from "./sessions.ts";
import { jsonBody, writeClientError } from "./surveys.ts";

export function caseHandoffRoutes(pool: Pool) {
  return async (
    request: IncomingMessage,
    response: ServerResponse,
    path: string,
    requestId: string,
  ) => {
    const route =
      /^\/api\/v1\/surveys\/([^/]+)\/versions\/([^/]+)\/case-handoffs$/.exec(
        path,
      );
    if (!route) return false;
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      sendJson(response, 405, {
        code: "METHOD_NOT_ALLOWED",
        message: "Method not allowed",
        requestId,
      });
      return true;
    }

    try {
      const proof = readSessionProof(request);
      const survey = uuid(route[1], "Survey");
      const version = uuid(route[2], "Survey version");
      const key = uuid(request.headers["idempotency-key"], "Idempotency key");
      const { reviewDecision, consentOrLawfulBasisRef, category, priority } =
        object(await jsonBody(request), [
          "reviewDecision",
          "consentOrLawfulBasisRef",
          "category",
          "priority",
        ]);
      if (reviewDecision !== "approved")
        throw new InvalidInput("Explicit approval is required");
      if (
        typeof category !== "string" ||
        !Object.hasOwn(caseCategories, category)
      )
        throw new InvalidInput("Select a supported category");
      if (
        typeof priority !== "string" ||
        !Object.hasOwn(casePriorities, priority)
      )
        throw new InvalidInput("Select a supported priority");
      const basis = uuid(consentOrLawfulBasisRef, "Synthetic basis reference");

      const receipt = await withActor(pool, proof, async (client) => {
        const {
          rows: [record],
        } = await client.query(
          "SELECT outcome, receipt FROM public.queue_synthetic_case_handoff($1, $2, $3, $4, $5, $6, $7)",
          [
            survey,
            version,
            basis,
            key,
            category,
            priority,
            reviewDecision === "approved",
          ],
        );
        switch (record.outcome) {
          case "not_found":
            throw new HttpError(404, "NOT_FOUND", "Survey version not found");
          case "forbidden":
            throw new HttpError(
              403,
              "FORBIDDEN",
              "Case approval is required in this workspace",
            );
          case "basis_required":
            throw new HttpError(
              403,
              "BASIS_REQUIRED",
              "An active synthetic basis is required for this version",
            );
          case "invalid":
            throw new InvalidInput("Invalid case approval");
          case "conflict":
            throw new HttpError(
              409,
              "CONFLICT",
              "The idempotency key already has different approval details",
            );
          case "queued":
            return record.receipt;
          default:
            throw new Error("Unexpected case handoff outcome");
        }
      });
      sendJson(response, 202, receipt);
    } catch (error) {
      writeClientError(response, error, requestId);
    }
    return true;
  };
}
