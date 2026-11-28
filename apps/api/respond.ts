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
import {
  supportsSyntheticConsent,
  type ResearchConsent,
} from "./research-consent.ts";
import { HttpError, readUniversitySessionProof } from "./sessions.ts";
import { RegistryUnavailable, type RegistryGate } from "./registry.ts";
import { digest, jsonBody, tokenPattern, writeClientError } from "./surveys.ts";

type PublishedLink = {
  surveyVersionId: string;
  definition: SurveyDefinition | null;
  eligibilityMode: "open" | "registry-synthetic" | "university";
  researchConsent: ResearchConsent | null;
};
type Receipt = {
  outcome:
    | "closed"
    | "accepted"
    | "retry"
    | "conflict"
    | "consent_required"
    | "eligibility_required";
  receiptId: string;
  acceptedAt: Date;
};
const notFound = () => new HttpError(404, "NOT_FOUND", "Survey not found");
const universityEligibilityRequired = () =>
  new HttpError(
    403,
    "FORBIDDEN",
    "University eligibility could not be confirmed for this survey",
  );

const consentRequired = () =>
  new HttpError(
    403,
    "FORBIDDEN",
    "Agree to the current study consent notice before submitting",
  );

export function respondentRoutes(
  pool: Pool,
  registryGate: RegistryGate | null = null,
  syntheticResearchConsent = false,
  universityEligibility = false,
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
        `SELECT l.id AS "surveyVersionId", l.definition, l.eligibility_mode AS "eligibilityMode",
          CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object(
            'id', c.id, 'studyKey', c.study_key, 'revision', c.revision, 'notice', c.notice
          ) END AS "researchConsent"
         FROM public.resolve_collection_distribution($1) l
         LEFT JOIN public.resolve_research_consent($1) c ON true`,
        [tokenHash],
      );
      const link = rows[0];
      if (!link) throw notFound();
      const { surveyVersionId, eligibilityMode, researchConsent } = link;
      let { definition } = link;
      if (
        researchConsent &&
        (!syntheticResearchConsent ||
          !definition ||
          !supportsSyntheticConsent(definition))
      )
        throw new HttpError(
          503,
          "UNAVAILABLE",
          "Synthetic research consent is unavailable",
        );
      const restricted = eligibilityMode === "registry-synthetic";
      const university = eligibilityMode === "university";
      if ((restricted || university) && researchConsent)
        throw new HttpError(
          503,
          "UNAVAILABLE",
          "This survey restriction configuration is unavailable",
        );
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

      let universityProof: Buffer | undefined;
      if (university) {
        if (!universityEligibility)
          throw new HttpError(
            503,
            "UNAVAILABLE",
            "University eligibility is unavailable",
          );
        universityProof = readUniversitySessionProof(request);
        if (!action && !universityProof) {
          sendJson(response, 200, {
            eligibilityRequired: true,
            eligibilityMode: "university",
          });
          return true;
        }
        if (!universityProof) throw universityEligibilityRequired();
        const {
          rows: [access],
        } = await pool.query<{ definition: SurveyDefinition | null }>(
          "SELECT public.resolve_university_definition($1, $2, $3) AS definition",
          [tokenHash, surveyVersionId, universityProof],
        );
        if (!access?.definition) throw universityEligibilityRequired();
        definition = access.definition;
      }
      if (!definition) throw notFound();
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
            : {
                surveyVersionId,
                definition,
                ...(researchConsent ? { researchConsent } : {}),
              },
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
      const answers = JSON.stringify(parseAnswers(definition, body.answers));
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
        : universityProof
          ? await pool.query<Receipt>(
              `SELECT ${columns} FROM public.accept_university_response($1, $2, $3, $4, $5, $6)`,
              [...parameters, universityProof],
            )
          : await pool.query<Receipt>(
              `SELECT ${columns} FROM public.accept_response($1, $2, $3, $4, $5, $6)`,
              [...parameters, registryAllowed],
            );
      if (receipt.outcome === "eligibility_required")
        throw universityEligibilityRequired();
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
