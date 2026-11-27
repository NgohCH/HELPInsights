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
import { digest, jsonBody, tokenPattern, writeClientError } from "./surveys.ts";

type PublishedLink = { surveyVersionId: string; definition: SurveyDefinition };
type Receipt = {
  outcome: "closed" | "accepted" | "retry" | "conflict";
  receiptId: string;
  acceptedAt: Date;
};
const notFound = () => new HttpError(404, "NOT_FOUND", "Survey not found");

export function respondentRoutes(pool: Pool) {
  return async (
    request: IncomingMessage,
    response: ServerResponse,
    path: string,
    requestId: string,
  ) => {
    const route = /^\/api\/v1\/public\/s\/([^/]+)(\/responses)?$/.exec(path);
    if (!route) return false;
    const [, token, submit] = route;
    try {
      if (!tokenPattern.test(token)) throw notFound();
      const method = submit ? "POST" : "GET";
      if (request.method !== method) {
        response.setHeader("Allow", method);
        throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
      }
      const tokenHash = digest(token);
      const { rows } = await pool.query<PublishedLink>(
        'SELECT id AS "surveyVersionId", definition FROM public.resolve_distribution($1)',
        [tokenHash],
      );
      const link = rows[0];
      if (!link) throw notFound();
      if (!submit) {
        sendJson(response, 200, link);
        return true;
      }

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
        'SELECT outcome, receipt_id AS "receiptId", accepted_at AS "acceptedAt" FROM public.accept_response($1, $2, $3, $4, $5)',
        [tokenHash, version, digest(key), digest(answers), answers],
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
      writeClientError(response, error, requestId);
    }
    return true;
  };
}
