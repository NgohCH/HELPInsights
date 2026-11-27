import assert from "node:assert/strict";
import test from "node:test";
import { runningTestStack } from "../../scripts/test-docker.ts";

test("readiness rejects a modified migration ledger while liveness remains available", async () => {
  const stack = runningTestStack();
  const url = stack.baseUrl();
  function sql(statement: string) {
    return stack
      .compose(
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
      )
      .trim();
  }

  const checksum = sql(
    "SELECT checksum FROM public.schema_migrations WHERE name = '001-organisations.sql'",
  );
  assert.match(checksum, /^[a-f0-9]{64}$/);
  sql(
    "UPDATE public.schema_migrations SET checksum = 'stale' WHERE name = '001-organisations.sql'",
  );
  try {
    assert.equal((await fetch(url + "/api/v1/health/ready")).status, 503);
    assert.equal((await fetch(url + "/api/v1/health/live")).status, 200);
  } finally {
    sql(
      "UPDATE public.schema_migrations SET checksum = '" +
        checksum +
        "' WHERE name = '001-organisations.sql'",
    );
  }
  assert.equal((await fetch(url + "/api/v1/health/ready")).status, 200);
});
