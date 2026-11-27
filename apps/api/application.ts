import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

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
  <link rel="stylesheet" href="/assets/main.css">
  <script type="module" src="/assets/main.js"></script>
</head>
<body><div id="app"><h1>HELPInsights</h1></div></body>
</html>`;

type Route = (
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  requestId: string,
) => Promise<boolean>;

export function createApplication(
  isReady: () => Promise<boolean>,
  route?: Route,
  assets?: { javascript: Buffer; stylesheet: Buffer; creatorHelp: Buffer },
  liveQuiz = false,
) {
  return createServer(
    { requestTimeout: 15000, headersTimeout: 10000 },
    async (request, response) => {
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Referrer-Policy", "no-referrer");
      response.setHeader(
        "Content-Security-Policy",
        "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      );

      const requestId = randomUUID();
      const path = request.url?.split("?", 1)[0] ?? "";
      const publicPage =
        /^\/respond\/[A-Za-z0-9_-]{43}$/.test(path) ||
        (liveQuiz && (path === "/live/host" || path === "/live/join"));
      if (assets && request.method === "GET") {
        if (path === "/assets/main.js") {
          response.writeHead(200, {
            "Content-Type": "text/javascript; charset=utf-8",
          });
          return response.end(assets.javascript);
        }
        if (path === "/assets/creator-help.en.json") {
          response.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8",
          });
          return response.end(assets.creatorHelp);
        }
        if (path === "/assets/main.css") {
          response.writeHead(200, {
            "Content-Type": "text/css; charset=utf-8",
          });
          return response.end(assets.stylesheet);
        }
      }
      if (route) {
        try {
          if (await route(request, response, path, requestId)) return;
        } catch (error) {
          const code = (error as { code?: unknown })?.code;
          console.error(
            "Request failed",
            requestId,
            typeof code === "string" && /^[A-Z0-9]{5}$/.test(code)
              ? code
              : "internal",
          );
          return sendJson(response, 503, {
            code: "UNAVAILABLE",
            message: "Request temporarily unavailable",
            requestId,
          });
        }
      }
      if (
        !publicPage &&
        path !== "/" &&
        path !== "/admin" &&
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
      if (path === "/" || path === "/admin" || publicPage) {
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
    },
  );
}
