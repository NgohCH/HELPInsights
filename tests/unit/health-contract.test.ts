import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import { parse } from "yaml";
import { createApplication } from "../../apps/api/application.ts";

type Reference = { $ref: string };
type Body = { content: { "application/json": { schema: object | Reference } } };
type Contract = {
  paths: Record<
    string,
    { get: { responses: Record<string, Body | Reference> } }
  >;
  components: {
    responses: Record<string, Body>;
    schemas: Record<string, object>;
  };
};
const spec = parse(
  readFileSync(new URL("../../api/openapi.yaml", import.meta.url), "utf8"),
) as Contract;
const validator = new Ajv2020();

test("health responses conform to the published OpenAPI schemas", async (context) => {
  let ready = true;
  const server = createApplication(async () => ready).listen(0, "127.0.0.1");
  context.after(() => server.close());
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = "http://127.0.0.1:" + address.port + "/api/v1";

  for (const [path, status] of [
    ["/health/live", 200],
    ["/health/ready", 200],
    ["/health/ready", 503],
  ] as const) {
    ready = status !== 503;
    const response = await fetch(base + path);
    assert.equal(response.status, status);
    assert.match(
      response.headers.get("content-type") ?? "",
      /^application\/json\b/,
    );

    const declared = spec.paths[path].get.responses[status];
    assert.ok(declared, "OpenAPI must declare " + path + " " + status);
    const body =
      "$ref" in declared
        ? spec.components.responses[declared.$ref.split("/").at(-1)!]
        : declared;
    const mediaType = body.content["application/json"];
    const reference = mediaType.schema as Partial<Reference>;
    const schema = reference.$ref
      ? spec.components.schemas[reference.$ref.split("/").at(-1)!]
      : mediaType.schema;
    const validate = validator.compile(schema);
    assert.ok(
      validate(await response.json()),
      validator.errorsText(validate.errors),
    );
  }
});
