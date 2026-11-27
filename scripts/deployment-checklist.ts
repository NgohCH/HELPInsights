import { createInterface } from "node:readline";

const terminal = createInterface({ input: process.stdin, crlfDelay: Infinity });
const answers = terminal[Symbol.asyncIterator]();

async function ask<const Choice extends string>(
  prompt: string,
  choices: readonly Choice[],
): Promise<Choice | undefined> {
  console.log(prompt);
  for (;;) {
    const next = await answers.next();
    if (next.done) return undefined;
    const answer = choices.find(
      (choice) => choice === next.value.trim().toLowerCase(),
    );
    if (answer !== undefined) return answer;
    console.log("Enter " + choices.join(" or ") + ".");
  }
}

console.log("HELPInsights deployment readiness checklist");
console.log(
  "Use pass after reviewing evidence for the target environment. Enter only the listed choices.",
);

const audience = await ask("Survey audience (public, university, both)", [
  "public",
  "university",
  "both",
]);
const integrations =
  audience &&
  (await ask("Are approved external API integrations enabled (yes, no)?", [
    "yes",
    "no",
  ]));

const audienceChecks = [
  audience !== "university"
    ? "Submit to a public survey without University sign-in."
    : "",
  audience !== "public"
    ? "Verify the approved eligibility rule. Confirm an eligible University account can submit and an ineligible account is denied."
    : "",
]
  .filter(Boolean)
  .join(" ");

const steps = [
  [
    "host",
    "Verify release digest, supported host and runtime, DNS, HTTPS, database, storage and network readiness.",
  ],
  [
    "configuration",
    "Verify the environment, public URL, database and backup settings, operator ownership and protected secret references.",
  ],
  [
    "identity",
    "Verify the approved Entra tenant and application, redirect URLs, MFA enforcement and the first administrator. Confirm an authorised creator can publish and a signed-in user without authoring authority is denied.",
  ],
  ["audience", audienceChecks],
  [
    "integrations",
    "For each enabled client, verify its owner, permissions, workspace scope, a permitted API call and an out-of-scope denial.",
  ],
  [
    "recovery",
    "Review the migration plan, verify a backup restore and run a synthetic survey through publication, response and export.",
  ],
  [
    "release",
    "Confirm the release owner and record the evidence for review. Check the applicable University research clearance and consent process.",
  ],
] as const;

const checks: {
  id: (typeof steps)[number][0];
  status: "pending" | "passed" | "failed" | "skipped";
}[] = steps.map(([id]) => ({ id, status: "pending" }));

try {
  if (integrations !== undefined) {
    for (const [index, [id, prompt]] of steps.entries()) {
      if (id === "integrations" && integrations === "no") {
        checks[index].status = "skipped";
        continue;
      }
      const answer = await ask(prompt + " (pass, fail)", ["pass", "fail"]);
      if (answer === undefined) break;
      checks[index].status = answer === "pass" ? "passed" : "failed";
    }
  }
} finally {
  terminal.close();
}

const status = checks.some((check) => check.status === "failed")
  ? "BLOCKED"
  : checks.some((check) => check.status === "pending")
    ? "INCOMPLETE"
    : "READY_FOR_REVIEW";

console.log(
  "DEPLOYMENT_CHECKLIST " +
    JSON.stringify({
      status,
      audience: audience ?? null,
      integrations: integrations ?? null,
      evidence: "operator-attestation",
      activation: "not-performed",
      checks,
    }),
);
if (status !== "READY_FOR_REVIEW") process.exitCode = 1;
