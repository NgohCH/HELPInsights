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
import type { ResearchConsent } from "./research-consent.ts";
import { HttpError } from "./sessions.ts";
import { digest, jsonBody, tokenPattern, writeClientError } from "./surveys.ts";

type PublishedLink = {
  surveyVersionId: string;
  definition: SurveyDefinition;
  researchConsent: ResearchConsent | null;
};
type Receipt = {
  outcome: "closed" | "accepted" | "retry" | "conflict" | "consent_required";
  receiptId: string;
  acceptedAt: Date;
};
const notFound = () => new HttpError(404, "NOT_FOUND", "Survey not found");

const consentRequired = () =>
  new HttpError(
    403,
    "FORBIDDEN",
    "Agree to the current study consent notice before submitting",
  );

export function respondentRoutes(pool: Pool, syntheticResearchConsent = false) {
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
        `SELECT l.id AS "surveyVersionId", l.definition,
          CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object(
            'id', c.id, 'studyKey', c.study_key, 'revision', c.revision, 'notice', c.notice
          ) END AS "researchConsent"
         FROM public.resolve_distribution($1) l
         LEFT JOIN public.resolve_research_consent($1) c ON true`,
        [tokenHash],
      );
      const link = rows[0];
      if (!link) throw notFound();
      const { surveyVersionId, definition, researchConsent } = link;
      if (researchConsent && !syntheticResearchConsent)
        throw new HttpError(
          503,
          "UNAVAILABLE",
          "Synthetic research consent is unavailable",
        );
      if (!submit) {
        sendJson(response, 200, {
          surveyVersionId,
          definition,
          ...(researchConsent ? { researchConsent } : {}),
        });
        return true;
      }

      const key = request.headers["idempotency-key"];
      if (typeof key !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(key)) {
        throw new InvalidInput("Provide a valid Idempotency-Key header");
      }
      const body = object(await jsonBody(request), [
        "surveyVersionId",
        "answers",
        "consent",
      ]);
      if (researchConsent) {
        if (body.consent === undefined) throw consentRequired();
        const consent = object(body.consent, ["versionId", "accepted"]);
        if (
          consent.versionId !== researchConsent.id ||
          consent.accepted !== true
        )
          throw consentRequired();
      } else if (body.consent !== undefined) {
        throw new InvalidInput("This survey does not request research consent");
      }

      const version = uuid(body.surveyVersionId, "Survey version");
      if (version !== link.surveyVersionId)
        throw new InvalidInput(
          "Survey version does not match the published link",
        );
      const answers = JSON.stringify(
        parseAnswers(link.definition, body.answers),
      );
      const parameters = [
        tokenHash,
        version,
        digest(key),
        digest(answers),
        answers,
      ];
      const columns =
        'outcome, receipt_id AS "receiptId", accepted_at AS "acceptedAt"';
      const {
        rows: [receipt],
      } = researchConsent
        ? await pool.query<Receipt>(
            `SELECT ${columns} FROM public.accept_research_response($1, $2, $3, $4, $5, $6)`,
            [...parameters, researchConsent.id],
          )
        : await pool.query<Receipt>(
            `SELECT ${columns} FROM public.accept_response($1, $2, $3, $4, $5)`,
            parameters,
          );
      if (receipt.outcome === "consent_required") throw consentRequired();
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
