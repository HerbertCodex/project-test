import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { once } from "node:events";

/**
 * The smoke gate: it STARTS the built application and exercises one real path.
 *
 * This is the gate that catches what no static battery can. The framework
 * records the case it exists for: thirteen gates green while every form
 * answered 403 — the origin was never configured, no criterion foresaw it, and
 * it was found by starting the server. Nothing in a unit suite starts
 * anything.
 *
 * So three properties matter more than the coverage of what is exercised:
 *
 *   - it runs `dist/main.js`, the BUILT artefact, not the sources. A gate
 *     passing on TypeScript that never compiled proves the wrong thing;
 *   - it speaks HTTP over a real socket, so the framework's own wiring —
 *     module resolution, the global pipeline, the listener — is what answers;
 *   - it fails on a non-2xx as loudly as on a crash. A server that starts and
 *     refuses everything is the exact failure being looked for.
 *
 * Usage: node scripts/smoke.mjs
 */

const ENTRY = "dist/main.js";
const PORT = Number(process.env.SMOKE_PORT ?? 3111);
const BOOT_TIMEOUT_MS = 30_000;

/**
 * Waits until the application answers, or gives up.
 *
 * Polling beats a fixed sleep in both directions: a slow machine is not
 * failed for being slow, and a fast one does not pay a wait it does not need.
 *
 * @param url - the address to poll
 * @param deadline - the moment to give up, in epoch milliseconds
 * @returns the first response obtained
 */
async function waitForBoot(url, deadline) {
  let last = null;
  while (Date.now() < deadline) {
    try {
      return await fetch(url);
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`${url} never answered within ${BOOT_TIMEOUT_MS} ms (${last?.message ?? "no attempt"})`);
}

/**
 * Starts the built application, exercises one path, and reports.
 */
async function main() {
  if (!existsSync(ENTRY)) {
    console.error(
      `not found: ${ENTRY}\n` +
        "The smoke gate runs the BUILT application, so the build runs first: npm run build.",
    );
    process.exit(1);
  }

  const server = spawn(process.execPath, [ENTRY], {
    env: { ...process.env, PORT: String(PORT), NODE_ENV: "production" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  server.stdout.on("data", (chunk) => (output += chunk));
  server.stderr.on("data", (chunk) => (output += chunk));

  const stop = async () => {
    if (server.exitCode == null) {
      server.kill("SIGTERM");
      await Promise.race([once(server, "exit"), new Promise((resolve) => setTimeout(resolve, 3000))]);
      if (server.exitCode == null) server.kill("SIGKILL");
    }
  };

  try {
    const url = `http://127.0.0.1:${PORT}/`;
    const response = await waitForBoot(url, Date.now() + BOOT_TIMEOUT_MS);
    const body = await response.text();

    if (!response.ok) {
      console.error(`${url} answered ${response.status} ${response.statusText}`);
      console.error(`      body: ${body.slice(0, 300)}`);
      console.error(
        "\nThe application starts and refuses the request. That is the failure this gate exists for: " +
          "every other gate can be green while the product answers nothing.",
      );
      await stop();
      process.exit(1);
    }

    console.log(`${url} → ${response.status}, ${body.length} byte(s): the built application answers.`);
    await stop();
  } catch (error) {
    console.error(`the application did not come up: ${error.message}`);
    if (output.trim().length > 0) console.error(`\n--- server output ---\n${output.trim()}`);
    await stop();
    process.exit(1);
  }
}

await main();
