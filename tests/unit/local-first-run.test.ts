import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("the local first-run and doctor commands have dedicated package entry points", () => {
  const { scripts } = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
  );
  assert.equal(scripts["doctor:local"], "node scripts/local-doctor.ts");
  assert.equal(scripts["install:demo"], "node scripts/local-install.ts");
});

for (const entry of ["local-doctor", "local-install"]) {
  test(
    entry + " rejects a Docker override before any install or Docker work",
    () => {
      const injected = "tcp://192.0.2.99:2375";
      const command = new URL(
        "../../scripts/" + entry + ".ts",
        import.meta.url,
      );
      const result = spawnSync(process.execPath, [fileURLToPath(command)], {
        encoding: "utf8",
        env: { ...process.env, DOCKER_HOST: injected },
      });
      assert.equal(result.status, 1);
      assert.equal(result.signal, null);
      assert.doesNotMatch(result.stdout + result.stderr, /192\.0\.2\.99/);
      assert.doesNotMatch(
        result.stdout + result.stderr,
        /LOCAL_INSTALL_RECEIPT/,
      );
      const report = JSON.parse(result.stdout);
      assert.deepEqual(report, {
        status: "BLOCKED_ENVIRONMENT",
        checks: [
          {
            name: "docker-context",
            status: "FAIL",
            detail: "Unset DOCKER_HOST and select a local Docker context.",
          },
        ],
      });
    },
  );
}
