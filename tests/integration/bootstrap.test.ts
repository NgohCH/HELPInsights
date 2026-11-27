import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

let baseUrl = process.env.APP_BASE_URL;
const project = process.env.HELPINSIGHTS_TEST_PROJECT;

function compose(...args: string[]) {
  assert.match(project ?? "", /^helpinsights-test-[a-f0-9]{12}$/);
  return execFileSync(
    "docker",
    [
      "compose",
      "-f",
      "compose.yaml",
      "-f",
      "compose.test.yaml",
      "-p",
      project!,
      ...args,
    ],
    {
      encoding: "utf8",
      timeout: 60_000,
    },
  );
}

function sql(statement: string) {
  return compose(
    "exec",
    "-T",
    "postgres",
    "psql",
    "-XAtq",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    "helpinsights",
    "-d",
    "helpinsights",
    "-c",
    statement,
  ).trim();
}

async function health(name: "live" | "ready") {
  assert.ok(baseUrl, "APP_BASE_URL is required");
  return fetch(new URL("/api/v1/health/" + name, baseUrl), {
    signal: AbortSignal.timeout(4_000),
  });
}

test("readiness depends on migrated PostgreSQL and boot preserves data after a database interruption", async () => {
  const ready = await health("ready");
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), { status: "ok" });
  const migrations = sql(
    "SELECT name || ':' || checksum FROM schema_migrations ORDER BY name",
  );
  assert.match(migrations, /^001-organisations\.sql:[a-f0-9]{64}$/m);
  const organisation = sql(
    "INSERT INTO organisations (name) VALUES ('Recovery fixture') RETURNING id",
  );

  compose("stop", "postgres");
  try {
    const unavailable = await health("ready");
    assert.equal(unavailable.status, 503);
    assert.equal((await unavailable.json()).code, "UNAVAILABLE");
    assert.equal((await health("live")).status, 200);
  } finally {
    compose("up", "-d", "--wait", "--wait-timeout", "45", "postgres");
  }

  compose("restart", "app");
  const port = compose("port", "app", "3000").trim();
  assert.match(port, /^127\.0\.0\.1:\d+$/);
  baseUrl = "http://" + port;
  for (let attempt = 0; attempt < 20; attempt++) {
    const status = await health("ready").then(
      (response) => response.status,
      () => 0,
    );
    if (status === 200) break;
    await delay(250);
  }
  assert.equal((await health("ready")).status, 200);
  assert.equal(
    sql("SELECT name || ':' || checksum FROM schema_migrations ORDER BY name"),
    migrations,
  );
  assert.equal(
    sql("SELECT name FROM organisations WHERE id = '" + organisation + "'"),
    "Recovery fixture",
  );
});
