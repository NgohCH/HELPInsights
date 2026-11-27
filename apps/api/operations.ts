import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import { sendJson } from "./application.ts";
import { HttpError, readSessionProof, withActor } from "./sessions.ts";
import { jsonBody, writeClientError } from "./surveys.ts";

const components = ["api", "database", "schema"] as const;
const states = ["detected", "recovered"] as const;
const severities = [
  "information",
  "advisory",
  "action_required",
  "critical",
] as const;
const incidentColumns =
  'id, component, state, severity, recorded_at AS "recordedAt"';

function incidentInput(body: unknown) {
  const input = body as Record<string, unknown> | null;
  if (
    !input ||
    typeof input !== "object" ||
    Object.keys(input).length !== 3 ||
    !components.some((component) => component === input.component) ||
    !states.some((state) => state === input.state) ||
    !severities.some((severity) => severity === input.severity)
  ) {
    throw new HttpError(
      400,
      "BAD_REQUEST",
      "Provide a supported component, state and severity",
    );
  }
  return [input.component, input.state, input.severity];
}

export function operationsRoutes(
  pool: Pool,
  schemaReady: (client: Pick<Pool, "query">) => Promise<boolean>,
) {
  return async (
    request: IncomingMessage,
    response: ServerResponse,
    path: string,
    requestId: string,
  ) => {
    const health = path === "/api/v1/admin/health";
    if (!health && path !== "/api/v1/admin/incidents") return false;

    const writing = !health && request.method === "POST";
    if (!writing && request.method !== "GET") {
      response.setHeader("Allow", health ? "GET" : "GET, POST");
      sendJson(response, 405, {
        code: "METHOD_NOT_ALLOWED",
        message: "Method not allowed",
        requestId,
      });
      return true;
    }

    try {
      const proof = readSessionProof(request);
      const values = writing ? incidentInput(await jsonBody(request)) : null;
      const result = await withActor(pool, proof, async (client) => {
        const { rows: memberships } = await client.query<{
          role: "viewer" | "operator";
        }>("SELECT role FROM public.platform_operations_memberships");
        const role = memberships[0]?.role;
        if (!role || (writing && role !== "operator")) {
          throw new HttpError(
            403,
            "FORBIDDEN",
            "You do not have permission to access operations",
          );
        }

        if (health) {
          // Resolving the session and membership proves the database answered.
          const ready = await schemaReady(client);
          return {
            status: ready ? "ok" : "degraded",
            components: [
              { name: "api", status: "ok" },
              { name: "database", status: "ok" },
              { name: "schema", status: ready ? "ok" : "degraded" },
            ],
          };
        }

        if (values) {
          const { rows } = await client.query(
            `INSERT INTO public.operation_incidents (component, state, severity)
              VALUES ($1, $2, $3) RETURNING ${incidentColumns}`,
            values,
          );
          return rows[0];
        }

        const { rows } = await client.query(
          `SELECT ${incidentColumns} FROM public.operation_incidents
            ORDER BY recorded_at DESC, id DESC LIMIT 100`,
        );
        return rows;
      });
      sendJson(response, writing ? 201 : 200, result);
    } catch (error) {
      writeClientError(response, error, requestId);
    }
    return true;
  };
}
