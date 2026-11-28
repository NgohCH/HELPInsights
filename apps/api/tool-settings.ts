import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import {
  InvalidInput,
  object,
  uuid,
} from "../../packages/survey-runtime/definition.ts";
import { sendJson } from "./application.ts";
import { HttpError, readUniversitySessionProof } from "./sessions.ts";
import { jsonBody, writeClientError } from "./surveys.ts";

const forbidden = () =>
  new HttpError(403, "FORBIDDEN", "System administrator access is required");

export function toolSettingsRoutes(pool: Pool) {
  return async (
    request: IncomingMessage,
    response: ServerResponse,
    path: string,
    requestId: string,
  ) => {
    if (path !== "/api/v1/admin/tools/template-copy") return false;
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
          "SELECT public.read_template_copy_settings($1) AS settings",
          [proof],
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
        parameters = [proof, input.action, input.mode, null, null, null];
      } else if (
        (input.action === "grant" || input.action === "revoke") &&
        (input.subjectType === "user" || input.subjectType === "group") &&
        Object.keys(input).length === 4
      ) {
        parameters = [
          proof,
          input.action,
          null,
          uuid(input.workspaceId, "Workspace"),
          input.subjectType,
          uuid(input.subjectId, "User or group"),
        ];
      } else {
        throw new InvalidInput("Choose a valid mode, grant or revocation");
      }
      const { rows } = await pool.query<{ outcome: string }>(
        "SELECT public.change_template_copy_settings($1, $2, $3, $4, $5, $6) AS outcome",
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
