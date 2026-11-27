import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import { parseAnswers } from "../../packages/survey-runtime/answers.ts";
import {
  InvalidInput,
  object,
  type SurveyDefinition,
  uuid,
} from "../../packages/survey-runtime/definition.ts";
import { sendJson } from "./application.ts";
import { HttpError } from "./sessions.ts";
import { RegistryUnavailable, type RegistryGate } from "./registry.ts";
import { digest, jsonBody, tokenPattern, writeClientError } from "./surveys.ts";

type PublishedLink = {
  surveyVersionId: string;
  definition: SurveyDefinition;
  eligibilityMode: "open" | "registry-synthetic";
};
type Receipt = {
  outcome: "closed" | "accepted" | "retry" | "conflict";
  receiptId: string;
  acceptedAt: Date;
};
const notFound = () => new HttpError(404, "NOT_FOUND", "Survey not found");

export function respondentRoutes(
  pool: Pool,
  registryGate: RegistryGate | null = null,
) {
  return async (
    request: IncomingMessage,
    response: ServerResponse,
    path: string,
    requestId: string,
  ) => {
    const route =
      /^\/api\/v1\/public\/s\/([^/]+)(?:\/(responses|eligibility))?$/.exec(
        path,
      );
    if (!route) return false;
    const [, token, action] = route;
    try {
      if (!tokenPattern.test(token)) throw notFound();
      const method = action ? "POST" : "GET";
      if (request.method !== method) {
        response.setHeader("Allow", method);
        throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
      }
      const tokenHash = digest(token);
      const { rows } = await pool.query<PublishedLink>(
        'SELECT id AS "surveyVersionId", definition, eligibility_mode AS "eligibilityMode" FROM public.resolve_collection_distribution($1)',
        [tokenHash],
      );
      const link = rows[0];
      if (!link) throw notFound();
      const { surveyVersionId, definition, eligibilityMode } = link;
      const restricted = eligibilityMode === "registry-synthetic";
      if (action === "eligibility") {
        if (!restricted) throw notFound();
        if (!registryGate) throw new RegistryUnavailable();
        const { proof } = object(await jsonBody(request), ["proof"]);
        if (typeof proof !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(proof))
          throw new InvalidInput("Enter a valid synthetic Registry credential");
        if (!(await registryGate.registry.checkEligibility(proof)))
          throw new HttpError(
            403,
            "FORBIDDEN",
            "You are not eligible for this survey",
          );
        sendJson(response, 200, registryGate.capabilities.issue(tokenHash));
        return true;
      }

      const registryAllowed =
        restricted &&
        registryGate?.capabilities.verify(
          tokenHash,
          request.headers["x-survey-capability"],
        ) === true;
      if (!action) {
        sendJson(
          response,
          200,
          restricted && !registryAllowed
            ? { eligibilityRequired: true }
            : { surveyVersionId, definition },
        );
        return true;
      }
      if (restricted && !registryAllowed)
        throw new HttpError(
          403,
          "FORBIDDEN",
          "Check eligibility before submitting",
        );

      const key = request.headers["idempotency-key"];
      if (typeof key !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(key)) {
        throw new InvalidInput("Provide a valid Idempotency-Key header");
      }
      const body = object(await jsonBody(request), [
        "surveyVersionId",
        "answers",
      ]);
      const version = uuid(body.surveyVersionId, "Survey version");
      if (version !== link.surveyVersionId)
        throw new InvalidInput(
          "Survey version does not match the published link",
        );
      const answers = JSON.stringify(
        parseAnswers(link.definition, body.answers),
      );
      const {
        rows: [receipt],
      } = await pool.query<Receipt>(
        'SELECT outcome, receipt_id AS "receiptId", accepted_at AS "acceptedAt" FROM public.accept_response($1, $2, $3, $4, $5, $6)',
        [
          tokenHash,
          version,
          digest(key),
          digest(answers),
          answers,
          registryAllowed,
        ],
      );
      if (receipt.outcome === "closed") throw notFound();
      if (receipt.outcome === "conflict")
        throw new HttpError(
          409,
          "CONFLICT",
          "This submission key was used with different answers",
        );
      sendJson(response, receipt.outcome === "accepted" ? 201 : 200, {
        receiptId: receipt.receiptId,
        acceptedAt: receipt.acceptedAt,
      });
    } catch (error) {
      writeClientError(
        response,
        error instanceof RegistryUnavailable
          ? new HttpError(
              503,
              "UNAVAILABLE",
              "Eligibility verification is temporarily unavailable",
            )
          : error,
        requestId,
      );
    }
    return true;
  };
}
