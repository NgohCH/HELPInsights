import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import { uuid } from "../../packages/survey-runtime/definition.ts";
import { sendJson } from "./application.ts";
import { HttpError, readSessionProof, withActor } from "./sessions.ts";
import { writeClientError } from "./surveys.ts";

type NoticeRow = {
  id: string;
  createdAt: Date;
  acknowledgedAt: Date | null;
};

function toNotice({ id, createdAt, acknowledgedAt }: NoticeRow) {
  return {
    id,
    category: "export_worker_recovery",
    severity: "information",
    state: acknowledgedAt ? "acknowledged" : "open",
    title: "Export worker database connection recovered",
    createdAt,
    ...(acknowledgedAt ? { acknowledgedAt } : {}),
  };
}

function denied() {
  return new HttpError(
    403,
    "FORBIDDEN",
    "Recovery notices require an operations operator",
  );
}

export function recoveryNoticeRoutes(pool: Pool) {
  return async (
    request: IncomingMessage,
    response: ServerResponse,
    path: string,
    requestId: string,
  ) => {
    const list =
      path === "/api/v1/me/notices" || path === "/api/v1/admin/notices";
    const acknowledgement =
      /^\/api\/v1\/me\/notices\/([^/]+)\/acknowledge$/.exec(path);
    if (!list && !acknowledgement) return false;
    const allowed = list ? "GET" : "POST";
    if (request.method !== allowed) {
      response.setHeader("Allow", allowed);
      sendJson(response, 405, {
        code: "METHOD_NOT_ALLOWED",
        message: "Method not allowed",
        requestId,
      });
      return true;
    }

    try {
      const proof = readSessionProof(request);
      const id = acknowledgement ? uuid(acknowledgement[1], "Notice") : null;
      if (
        id &&
        (request.headers["transfer-encoding"] ||
          Number(request.headers["content-length"]) > 0)
      ) {
        throw new HttpError(
          400,
          "BAD_REQUEST",
          "Acknowledgement does not accept a request body",
        );
      }
      const result = await withActor(pool, proof, async (client) => {
        if (id) {
          const {
            rows: [receipt],
          } = await client.query<Omit<NoticeRow, "id"> & { outcome: string }>(
            `SELECT outcome, created_at AS "createdAt", acknowledged_at AS "acknowledgedAt"
             FROM public.acknowledge_worker_recovery($1)`,
            [id],
          );
          if (receipt.outcome === "forbidden") throw denied();
          if (receipt.outcome === "not_found")
            throw new HttpError(404, "NOT_FOUND", "Recovery notice not found");
          if (receipt.outcome !== "acknowledged")
            throw new Error("Unexpected receipt outcome");
          return toNotice({ id, ...receipt });
        }

        const {
          rows: [operator],
        } = await client.query(
          "SELECT 1 FROM public.platform_operations_memberships WHERE role = 'operator'",
        );
        if (!operator) throw denied();
        const { rows } = await client.query<NoticeRow>(
          `SELECT i.id, i.observed_at AS "createdAt", r.acknowledged_at AS "acknowledgedAt"
           FROM public.operation_incidents i LEFT JOIN public.worker_recovery_receipts r ON r.incident_id = i.id
           WHERE i.source = 'export_worker' AND i.state = 'recovered'
             AND EXISTS (SELECT 1 FROM public.platform_operations_memberships WHERE role = 'operator')
           ORDER BY i.observed_at DESC, i.id DESC LIMIT 100`,
        );
        return rows.map(toNotice);
      });
      sendJson(response, 200, result);
    } catch (error) {
      writeClientError(response, error, requestId);
    }
    return true;
  };
}
