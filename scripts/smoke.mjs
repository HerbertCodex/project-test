import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import Database from "better-sqlite3";
import { applyMigrations } from "../dist/infrastructure/persistence/migrate.js";

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
 * It exercises the BUSINESS path — borrow, return, borrow again — and no longer
 * `GET /`. The scaffold route answered a constant string: it proved the server
 * was listening and nothing about the product. It is also the route i-1a3m is
 * about to delete, so this gate would have started failing for a reason that
 * had nothing to do with a regression.
 *
 * The database is a throwaway FILE, migrated and seeded here, because the
 * built application does not migrate on startup. That is deliberate — running a
 * migration is an operator's act, not a side effect of booting — and it means
 * the smoke gate has to do what an operator does.
 *
 * Usage: node scripts/smoke.mjs
 */

const ENTRY = "dist/main.js";
const PORT = Number(process.env.SMOKE_PORT ?? 3111);
const BOOT_TIMEOUT_MS = 30_000;

/**
 * The journey, and what each step proves.
 *
 * Borrowing twice around a return is the smallest sequence that cannot pass by
 * accident: the second lend only succeeds if the return actually closed the
 * first loan, and the partial unique index on the file is what refuses it
 * otherwise.
 */
const JOURNEY = [
  { path: "/loans", body: { copyId: "c1", memberId: "m1" }, expect: 201, says: "the copy is lent" },
  { path: "/returns", body: { copyId: "c1" }, expect: 200, says: "the copy comes back" },
  { path: "/loans", body: { copyId: "c1", memberId: "m1" }, expect: 201, says: "it is lendable again" },
];

/**
 * Prepares a throwaway database, the way an operator would.
 *
 * @param file - the database file to create
 */
function seed(file) {
  applyMigrations(file);
  const raw = new Database(file);
  raw.prepare("INSERT INTO copies (id, title_id) VALUES (?, ?)").run("c1", "t1");
  raw
    .prepare("INSERT INTO members (id, membership_expires_at, outstanding_debt) VALUES (?, ?, ?)")
    .run("m1", "2099-01-01T00:00:00.000Z", 0);
  raw.close();
}

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

  const directory = mkdtempSync(join(tmpdir(), "smoke-"));
  const file = join(directory, "bibliotheque.db");
  seed(file);

  const server = spawn(process.execPath, [ENTRY], {
    env: { ...process.env, PORT: String(PORT), NODE_ENV: "production", DATABASE_FILE: file },
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
    const base = `http://127.0.0.1:${PORT}`;
    await waitForBoot(`${base}/loans`, Date.now() + BOOT_TIMEOUT_MS);

    for (const step of JOURNEY) {
      const response = await fetch(`${base}${step.path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(step.body),
      });
      const body = await response.text();
      if (response.status !== step.expect) {
        console.error(`POST ${step.path} answered ${response.status}, expected ${step.expect}`);
        console.error(`      body: ${body.slice(0, 300)}`);
        console.error(
          "\nThe application starts and refuses the journey. That is the failure this gate exists " +
            "for: every other gate can be green while the product answers nothing.",
        );
        await stop();
        rmSync(directory, { recursive: true, force: true });
        process.exit(1);
      }
      console.log(`POST ${step.path} → ${response.status}  ${step.says}`);
    }

    console.log("the built application lends, takes back, and lends again.");
    await stop();
    rmSync(directory, { recursive: true, force: true });
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    console.error(`the application did not come up: ${error.message}`);
    if (output.trim().length > 0) console.error(`\n--- server output ---\n${output.trim()}`);
    await stop();
    process.exit(1);
  }
}

await main();
