import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import {
  InvalidInput,
  object,
  uuid,
} from "../../packages/survey-runtime/definition.ts";
import { sendJson } from "./application.ts";
import { researchConsentAllowed } from "./research-consent.ts";
import {
  HttpError,
  readSessionProof,
  readUniversitySessionProof,
  withActor,
} from "./sessions.ts";
import { jsonBody, writeClientError } from "./surveys.ts";

const forbidden = () =>
  new HttpError(403, "FORBIDDEN", "System administrator access is required");

export function toolSettingsRoutes(pool: Pool, researchConsentEnabled = false) {
  return async (
    request: IncomingMessage,
    response: ServerResponse,
    path: string,
    requestId: string,
  ) => {
    const workspaceTool =
      /^\/api\/v1\/workspaces\/([^/]+)\/tools\/research-consent$/.exec(path);
    if (workspaceTool) {
      try {
        if (request.method !== "GET") {
          response.setHeader("Allow", "GET");
          throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
        }
        const workspace = uuid(workspaceTool[1], "Workspace");
        const proof = readSessionProof(request);
        const allowed = await withActor(pool, proof, (client) =>
          researchConsentEnabled
            ? researchConsentAllowed(client, proof, workspace)
            : Promise.resolve(false),
        );
        sendJson(response, 200, { allowed });
      } catch (error) {
        writeClientError(response, error, requestId);
      }
      return true;
    }
    const tool =
      /^\/api\/v1\/admin\/tools\/(template-copy|research-consent)$/.exec(
        path,
      )?.[1];
    if (!tool) return false;
    try {
      if (request.method !== "GET" && request.method !== "POST") {
        response.setHeader("Allow", "GET, POST");
        throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
      }
      const proof = readUniversitySessionProof(request);
      if (!proof)
        throw new HttpError(
          401,
          "UNAUTHORISED",
          "University sign-in is required",
        );
      const read = async () => {
        const { rows } = await pool.query<{ settings: object | null }>(
          "SELECT public.read_creator_tool_settings($1, $2) AS settings",
          [proof, tool],
        );
        if (!rows[0]?.settings) throw forbidden();
        return rows[0].settings;
      };

      const current = await read();
      if (request.method === "GET") {
        sendJson(response, 200, current);
        return true;
      }

      const input = object(await jsonBody(request), [
        "action",
        "mode",
        "workspaceId",
        "subjectType",
        "subjectId",
      ]);
      let parameters: unknown[];
      if (
        input.action === "mode" &&
        ["off", "all", "university", "approved"].some(
          (mode) => mode === input.mode,
        ) &&
        Object.keys(input).length === 2
      ) {
        parameters = [proof, tool, input.action, input.mode, null, null, null];
      } else if (
        (input.action === "grant" || input.action === "revoke") &&
        (input.subjectType === "user" || input.subjectType === "group") &&
        Object.keys(input).length === 4
      ) {
        parameters = [
          proof,
          tool,
          input.action,
          null,
          uuid(input.workspaceId, "Workspace"),
          input.subjectType,
          uuid(input.subjectId, "User or group"),
        ];
      } else {
        throw new InvalidInput("Choose a valid mode, grant or revocation");
      }
      if (
        tool === "research-consent" &&
        input.action === "mode" &&
        input.mode === "all"
      )
        throw new InvalidInput("Research tools require University sign-in");
      const { rows } = await pool.query<{ outcome: string }>(
        "SELECT public.change_creator_tool_settings($1, $2, $3, $4, $5, $6, $7) AS outcome",
        parameters,
      );
      if (rows[0]?.outcome === "forbidden") throw forbidden();
      if (rows[0]?.outcome !== "ok")
        throw new InvalidInput(
          "Choose an existing workspace and approved user or group",
        );
      sendJson(response, 200, await read());
    } catch (error) {
      writeClientError(response, error, requestId);
    }
    return true;
  };
}
