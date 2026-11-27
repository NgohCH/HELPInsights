import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

function runChecklist(lines: string[]) {
  const script = fileURLToPath(
    new URL("../../scripts/deployment-checklist.ts", import.meta.url),
  );
  const result = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    input: lines.join("\n") + "\n",
    timeout: 5_000,
  });
  assert.ifError(result.error);
  const line = result.stdout
    .split(/\r?\n/)
    .find((line) => line.startsWith("DEPLOYMENT_CHECKLIST "));
  assert.ok(line, "Expected a structured deployment checklist receipt");
  return {
    receipt: JSON.parse(line.slice("DEPLOYMENT_CHECKLIST ".length)),
    status: result.status,
    stdout: result.stdout,
  };
}

test("a public deployment can be reviewed when required checks pass and optional integrations are off", () => {
  const { receipt, status, stdout } = runChecklist([
    "public",
    "no",
    "pass",
    "pass",
    "pass",
    "pass",
    "pass",
    "pass",
  ]);
  assert.equal(status, 0);
  assert.equal(receipt.status, "READY_FOR_REVIEW");
  assert.equal(receipt.evidence, "operator-attestation");
  assert.equal(receipt.activation, "not-performed");
  assert.equal(
    receipt.checks.find(({ id }: { id: string }) => id === "integrations")
      .status,
    "skipped",
  );
  assert.match(stdout, /authorised creator/i);
  assert.match(stdout, /approved Entra tenant/i);
  assert.match(stdout, /first administrator/i);
  assert.match(stdout, /without University sign-in/i);
});

test("an enabled integration cannot skip its check and a failed check blocks review", () => {
  const { receipt, status, stdout } = runChecklist([
    "university",
    "yes",
    "pass",
    "pass",
    "pass",
    "pass",
    "skip",
    "fail",
    "pass",
    "pass",
  ]);
  assert.equal(status, 1);
  assert.equal(receipt.status, "BLOCKED");
  assert.equal(
    receipt.checks.find(({ id }: { id: string }) => id === "integrations")
      .status,
    "failed",
  );
  assert.match(stdout, /ineligible account/i);
  assert.match(stdout, /approved eligibility rule/i);
  assert.match(stdout, /Enter pass or fail/i);
});

test("partial input is incomplete and unrecognised values are never echoed in the receipt", () => {
  const { receipt, status, stdout } = runChecklist([
    "SAMPLE_SECRET_VALUE",
    "both",
    "no",
    "pass",
  ]);
  assert.equal(status, 1);
  assert.equal(receipt.status, "INCOMPLETE");
  assert.equal(
    receipt.checks.find(({ id }: { id: string }) => id === "identity").status,
    "pending",
  );
  assert.doesNotMatch(stdout, /SAMPLE_SECRET_VALUE/);
});

test("a combined audience requires both public and University acceptance checks", () => {
  const { receipt, status, stdout } = runChecklist([
    "both",
    "no",
    "pass",
    "pass",
    "pass",
    "pass",
    "pass",
    "pass",
  ]);
  assert.equal(status, 0);
  assert.equal(receipt.audience, "both");
  assert.match(stdout, /without University sign-in/i);
  assert.match(stdout, /ineligible account/i);
  assert.match(stdout, /approved eligibility rule/i);
});
