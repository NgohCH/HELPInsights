import { createServer } from "node:http";
import { sendJson } from "../api/application.ts";

if (process.env.NODE_ENV !== "test") {
  throw new Error(
    "The synthetic Registry is available only in the test runtime",
  );
}

const server = createServer(
  { requestTimeout: 3000, headersTimeout: 2000 },
  async (request, response) => {
    if (request.method === "GET" && request.url === "/health")
      return sendJson(response, 200, { status: "ok" });
    if (request.method !== "POST" || request.url !== "/eligibility")
      return sendJson(response, 404, { code: "NOT_FOUND" });

    try {
      let body = "";
      request.setEncoding("utf8");
      for await (const chunk of request.iterator({ destroyOnReturn: false })) {
        body += chunk;
        if (body.length > 512)
          return sendJson(response, 400, { code: "BAD_REQUEST" });
      }
      const proof = JSON.parse(body)?.proof;
      if (typeof proof !== "string")
        return sendJson(response, 400, { code: "BAD_REQUEST" });
      return sendJson(response, 200, {
        eligible: proof === "registry_fixture_eligible",
      });
    } catch {
      return sendJson(response, 400, { code: "BAD_REQUEST" });
    }
  },
);

server.listen(3001, "0.0.0.0");
