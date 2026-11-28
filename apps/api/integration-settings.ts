import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import {
  InvalidInput,
  label,
  object,
  uuid,
} from "../../packages/survey-runtime/definition.ts";
import { sendJson } from "./application.ts";
import { HttpError, readUniversitySessionProof } from "./sessions.ts";
import { digest, jsonBody, writeClientError } from "./surveys.ts";

const adminPath = "/api/v1/admin/integrations";
const workloadPath =
  /^\/api\/v1\/integrations\/workspaces\/([^/]+)(?:\/surveys\/([^/]+)\/status)?$/;
const credentialPattern = /^Bearer (hi_client_[A-Za-z0-9_-]{43})$/i;
const operations = ["workspace:read", "survey:read_status"];
const registrationFields = [
  "action",
  "registrationId",
  "name",
  "department",
  "purpose",
  "environment",
  "credentialOwner",
  "workspaceId",
  "operations",
];

type DeploymentEnvironment = "development" | "test" | "production";
type Outcome = {
  status:
    "ok" | "unauthorised" | "forbidden" | "invalid" | "missing" | "conflict";
  client?: object;
  resource?: object;
};

const forbidden = () =>
  new HttpError(403, "FORBIDDEN", "System administrator access is required");

function permissionScope(value: unknown) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > operations.length ||
    value.some((operation) => !operations.includes(operation)) ||
    new Set(value).size !== value.length
  ) {
    throw new InvalidInput("Choose distinct supported integration operations");
  }
  return value.sort();
}

function parseChange(value: unknown, environment: DeploymentEnvironment) {
  const input = object(value, [
    ...registrationFields,
    "clientId",
    "expectedCredentialVersion",
  ]);
  switch (input.action) {
    case "register": {
      object(value, registrationFields);
      if (input.environment !== environment)
        throw new InvalidInput("Choose this deployment's environment");
      return {
        action: input.action,
        clientId: uuid(input.registrationId, "Registration ID"),
        workspaceId: uuid(input.workspaceId, "Workspace"),
        operations: permissionScope(input.operations),
        expectedCredentialVersion: null,
        metadata: {
          name: label(input.name, "Name", 160),
          department: label(input.department, "Owning department", 160),
          purpose: label(input.purpose, "Purpose", 500),
          credentialOwner: label(
            input.credentialOwner,
            "Credential owner",
            160,
          ),
        },
      };
    }
    case "permissions":
      object(value, ["action", "clientId", "workspaceId", "operations"]);
      return {
        action: input.action,
        clientId: uuid(input.clientId, "Client"),
        workspaceId: uuid(input.workspaceId, "Workspace"),
        operations: permissionScope(input.operations),
        expectedCredentialVersion: null,
        metadata: null,
      };
    case "renew": {
      object(value, ["action", "clientId", "expectedCredentialVersion"]);
      const version = input.expectedCredentialVersion;
      if (
        typeof version !== "number" ||
        !Number.isSafeInteger(version) ||
        version < 1
      )
        throw new InvalidInput("Provide the current credential version");
      return {
        action: input.action,
        clientId: uuid(input.clientId, "Client"),
        workspaceId: null,
        operations: null,
        metadata: null,
        expectedCredentialVersion: version,
      };
    }
    case "enable":
    case "revoke":
      object(value, ["action", "clientId"]);
      return {
        action: input.action,
        clientId: uuid(input.clientId, "Client"),
        workspaceId: null,
        operations: null,
        metadata: null,
        expectedCredentialVersion: null,
      };
    default:
      throw new InvalidInput("Choose a supported integration action");
  }
}

export function integrationSettingsRoutes(
  pool: Pool,
  deploymentEnvironment: DeploymentEnvironment,
) {
  return async (
    request: IncomingMessage,
    response: ServerResponse,
    path: string,
    requestId: string,
  ) => {
    const workload = workloadPath.exec(path);
    if (path !== adminPath && !workload) return false;

    try {
      if (workload) {
        if (request.method !== "GET") {
          response.setHeader("Allow", "GET");
          throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
        }
        const credential = credentialPattern.exec(
          request.headers.authorization ?? "",
        )?.[1];
        const unauthorised = () =>
          new HttpError(
            401,
            "UNAUTHORISED",
            "A valid integration credential is required",
          );
        if (!credential) throw unauthorised();
        const { rows } = await pool.query<{ outcome: Outcome }>(
          "SELECT public.read_integration_resource($1, $2, $3, $4) AS outcome",
          [
            digest(credential),
            deploymentEnvironment,
            uuid(workload[1], "Workspace"),
            workload[2] ? uuid(workload[2], "Survey") : null,
          ],
        );
        const outcome = rows[0].outcome;
        if (outcome.status === "unauthorised") throw unauthorised();
        if (outcome.status === "missing")
          throw new HttpError(404, "NOT_FOUND", "Resource not found");
        if (outcome.status !== "ok" || !outcome.resource)
          throw new Error("Unexpected integration resource outcome");
        sendJson(response, 200, outcome.resource);
        return true;
      }

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

      if (request.method === "GET") {
        const { rows } = await pool.query<{ clients: object[] | null }>(
          "SELECT public.read_integration_clients($1, $2) AS clients",
          [proof, deploymentEnvironment],
        );
        const clients = rows[0].clients;
        if (!clients) throw forbidden();
        sendJson(response, 200, {
          clients,
          environment: deploymentEnvironment,
        });
        return true;
      }

      const { rows: accessRows } = await pool.query<{ allowed: boolean }>(
        "SELECT public.integration_admin_allowed($1) AS allowed",
        [proof],
      );
      if (!accessRows[0].allowed) throw forbidden();
      const change = parseChange(
        await jsonBody(request),
        deploymentEnvironment,
      );
      const credential =
        change.action === "register" || change.action === "renew"
          ? "hi_client_" + randomBytes(32).toString("base64url")
          : undefined;
      const { rows } = await pool.query<{ outcome: Outcome }>(
        "SELECT public.change_integration_client($1, $2, $3, $4, $5, $6, $7, $8, $9) AS outcome",
        [
          proof,
          deploymentEnvironment,
          change.action,
          change.clientId,
          change.workspaceId,
          change.operations,
          change.metadata,
          credential ? digest(credential) : null,
          change.expectedCredentialVersion,
        ],
      );
      const outcome = rows[0].outcome;
      if (outcome.status === "forbidden") throw forbidden();
      if (outcome.status === "invalid")
        throw new InvalidInput(
          "Choose an existing workspace and valid permissions",
        );
      if (outcome.status === "missing")
        throw new HttpError(404, "NOT_FOUND", "Integration client not found");
      if (outcome.status === "conflict")
        throw new HttpError(
          409,
          "CONFLICT",
          "The client's current state prevents this change",
        );
      if (outcome.status !== "ok" || !outcome.client)
        throw new Error("Unexpected integration settings outcome");
      sendJson(response, change.action === "register" ? 201 : 200, {
        client: outcome.client,
        ...(credential ? { credential } : {}),
      });
    } catch (error) {
      writeClientError(response, error, requestId);
    }
    return true;
  };
}
