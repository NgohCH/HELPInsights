import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import {
  InvalidInput,
  object,
  parseDefinition,
  uuid,
} from "../../packages/survey-runtime/definition.ts";
import type {
  TemplatePreview,
  TemplateSummary,
} from "../../packages/survey-runtime/templates.ts";
import { sendJson } from "./application.ts";
import { HttpError, readSessionProof, withActor } from "./sessions.ts";
import {
  createSurveyDraft,
  jsonBody,
  requireEditor,
  writeClientError,
} from "./surveys.ts";

const summary: TemplateSummary = {
  id: "event-feedback",
  revision: 1,
  title: "Event feedback",
  summary: "Ask attendees how useful an event or training session was.",
  visibility: "global",
  publisher: "HELPInsights",
  usage: "Original starter content included for reuse in your workspace.",
};

const eventFeedback: TemplatePreview = {
  ...summary,
  definition: parseDefinition({
    schemaVersion: "1",
    title: summary.title,
    pages: [
      {
        id: "feedback",
        questions: [
          {
            id: "usefulness",
            code: "event_usefulness",
            type: "single_choice",
            title: "How useful was the event?",
            required: true,
            options: [
              { code: "very_useful", label: "Very useful" },
              { code: "not_useful", label: "Not useful" },
            ],
          },
        ],
      },
    ],
  }),
};

export function templateRoutes(pool: Pool) {
  return async (
    request: IncomingMessage,
    response: ServerResponse,
    path: string,
    requestId: string,
  ) => {
    const route = /^\/api\/v1\/templates(?:\/([^/]+)(\/clone)?)?$/.exec(path);
    if (!route) return false;
    const [, id, clone] = route;
    const method = clone ? "POST" : "GET";

    try {
      if (request.method !== method) {
        response.setHeader("Allow", method);
        throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
      }
      const proof = readSessionProof(request);
      const payload = clone ? await jsonBody(request) : undefined;
      const data = await withActor(pool, proof, async (client) => {
        if (!id) return [summary];
        if (id !== eventFeedback.id)
          throw new HttpError(404, "NOT_FOUND", "Template not found");
        if (!clone) return eventFeedback;
        const body = object(payload, ["workspaceId", "revision"]);
        const workspaceId = uuid(body.workspaceId, "Workspace");
        await requireEditor(client, workspaceId);
        if (
          typeof body.revision !== "number" ||
          !Number.isSafeInteger(body.revision) ||
          body.revision < 1
        )
          throw new InvalidInput(
            "Template revision must be a positive integer",
          );
        if (body.revision !== eventFeedback.revision)
          throw new HttpError(
            409,
            "CONFLICT",
            "Preview the current template revision and try again",
          );
        const draft = await createSurveyDraft(client, {
          workspaceId,
          title: eventFeedback.definition.title,
          draft: eventFeedback.definition,
        });
        return { ...draft, draft: eventFeedback.definition };
      });
      if (clone) response.setHeader("ETag", '"1"');
      sendJson(response, clone ? 201 : 200, data);
    } catch (error) {
      writeClientError(response, error, requestId);
    }
    return true;
  };
}
