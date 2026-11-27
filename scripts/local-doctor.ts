import {
  inspectChromium,
  inspectHost,
  isReady,
  printChecks,
} from "./local-install-checks.ts";

const { checks } = inspectHost();
if (isReady(checks)) checks.push(await inspectChromium());

printChecks(checks);
if (!isReady(checks)) process.exitCode = 1;
