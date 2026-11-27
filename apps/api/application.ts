import { randomUUID } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";

export function sendJson(
  response: ServerResponse,
  status: number,
  payload: unknown,
) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

const home = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>HELPInsights</title>
</head>
<body><main><h1>HELPInsights</h1></main></body>
</html>`;

export function createApplication(isReady: () => Promise<boolean>) {
  return createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );

    const requestId = randomUUID();
    const path = request.url?.split("?", 1)[0];
    if (
      path !== "/" &&
      path !== "/api/v1/health/live" &&
      path !== "/api/v1/health/ready"
    ) {
      return sendJson(response, 404, {
        code: "NOT_FOUND",
        message: "Page not found",
        requestId,
      });
    }
    if (request.method !== "GET") {
      response.setHeader("Allow", "GET");
      return sendJson(response, 405, {
        code: "METHOD_NOT_ALLOWED",
        message: "Method not allowed",
        requestId,
      });
    }
    if (path === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return response.end(home);
    }
    if (path === "/api/v1/health/live")
      return sendJson(response, 200, { status: "ok" });
    try {
      if (await isReady()) return sendJson(response, 200, { status: "ok" });
    } catch {
      // Health details are kept out of the public response.
    }
    sendJson(response, 503, {
      code: "UNAVAILABLE",
      message: "Service temporarily unavailable",
      requestId,
    });
  });
}
