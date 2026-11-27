import { spawnSync } from "node:child_process";
import {
  inspectChromium,
  inspectHost,
  isReady,
  printChecks,
  repository,
} from "./local-install-checks.ts";

async function install() {
  const { checks, context, pnpmCli } = inspectHost();
  if (!isReady(checks)) {
    printChecks(checks);
    return false;
  }

  const run = (stage: string, args: string[], timeout?: number) => {
    console.log("Local install demo: " + stage);
    const processResult = spawnSync(process.execPath, [pnpmCli, ...args], {
      cwd: repository,
      env: { ...process.env, DOCKER_CONTEXT: context, NODE_ENV: "development" },
      stdio: "inherit",
      timeout,
    });
    if (processResult.status === 0) return true;
    console.error(
      JSON.stringify({
        status: "FAILED",
        stage,
        detail: "Review the stage output and retry the local install demo.",
      }),
    );
    return false;
  };

  if (!run("locked dependencies", ["install", "--frozen-lockfile"], 300_000))
    return false;
  if (
    !run(
      "Chromium download",
      ["exec", "playwright", "install", "chromium"],
      600_000,
    )
  )
    return false;
  checks.push(await inspectChromium());
  if (!isReady(checks)) {
    printChecks(checks);
    return false;
  }
  if (!run("disposable survey verification", ["test:stack"])) return false;

  console.log(
    "LOCAL_INSTALL_RECEIPT " +
      JSON.stringify({
        status: "PASS",
        mode: "disposable-development",
        checks,
        verification: [
          "migration-readiness",
          "postgresql",
          "security",
          "chromium",
        ],
        cleanup: "confirmed",
      }),
  );
  return true;
}

if (!(await install())) process.exitCode = 1;
