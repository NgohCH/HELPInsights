import assert from "node:assert/strict";
import test from "node:test";
import { runningTestStack } from "../../scripts/test-docker.ts";

test("local provisioning blocks reused database roles that could bypass row-level security", () => {
  const { compose } = runningTestStack();
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

  sql("ALTER ROLE helpinsights_runtime BYPASSRLS");
  try {
    assert.throws(() => compose("run", "--rm", "--no-deps", "migrate"), {
      status: 1,
    });
  } finally {
    sql("ALTER ROLE helpinsights_runtime NOBYPASSRLS");
  }

  sql("GRANT pg_read_all_data TO helpinsights_runtime");
  try {
    assert.throws(() => compose("run", "--rm", "--no-deps", "migrate"), {
      status: 1,
    });
  } finally {
    sql("REVOKE pg_read_all_data FROM helpinsights_runtime");
  }

  sql("GRANT SELECT (token_hash) ON public.sessions TO helpinsights_app");
  try {
    assert.throws(() => compose("run", "--rm", "--no-deps", "migrate"), {
      status: 1,
    });
  } finally {
    sql("REVOKE SELECT (token_hash) ON public.sessions FROM helpinsights_app");
  }

  compose("run", "--rm", "--no-deps", "migrate");
});
