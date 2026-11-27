import assert from "node:assert/strict";
import test from "node:test";
import { localDockerContext } from "../../scripts/test-docker.ts";

test("test Docker commands refuse a DOCKER_HOST override before invoking the client", (context) => {
  const previous = process.env.DOCKER_HOST;
  context.after(() => {
    if (previous === undefined) delete process.env.DOCKER_HOST;
    else process.env.DOCKER_HOST = previous;
  });
  process.env.DOCKER_HOST = "tcp://example.invalid:2375";
  assert.throws(() => localDockerContext(), /DOCKER_HOST must be unset/);
});
