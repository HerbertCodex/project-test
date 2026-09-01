import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * The secrets scan for this repository.
 *
 * It reads files as text and knows no language, but it is the project's and
 * not the framework's because the roots it sweeps and the shapes it knows are
 * this stack's: a `.env` line, a NestJS `ConfigService` default, a JWT signing
 * key written inline.
 *
 * Two rules of form, and both were learned the same way — a scanner that
 * cries wolf gets switched off:
 *
 *   - a value must LOOK like a secret, not merely sit next to the word
 *     `password`. `password: string` in a type is not a leak;
 *   - a placeholder is not a secret. `changeme`, `xxx`, `<your-key>` and an
 *     `env` lookup are the ways a codebase legitimately writes one.
 *
 * Usage: node scripts/secrets-scan.mjs
 */

const CONFIG = "pipeline.config.json";

/**
 * Shapes worth stopping a commit for.
 *
 * Each carries the reason it is refused: a finding with no reason is read as
 * noise, and noise is what gets a gate disabled.
 */
const PATTERNS = [
  {
    name: "private key block",
    why: "a PEM private key in the tree is compromised the moment it is pushed.",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/,
  },
  {
    name: "AWS access key id",
    why: "an AKIA/ASIA identifier is a live credential, never an example.",
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  },
  {
    name: "GitHub token",
    why: "a ghp_/gho_/ghs_ token grants this repository's own permissions.",
    pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/,
  },
  {
    name: "Slack token",
    why: "an xox token posts as the workspace.",
    pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/,
  },
  {
    name: "JSON web token",
    why: "a signed JWT in the source is a session someone can replay.",
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  },
  {
    name: "connection string with a password",
    why: "the credentials of the database this service owns.",
    pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s:@/]{4,}@/i,
  },
  {
    name: "assigned secret",
    why: "a secret, key or password given a literal value in the source.",
    pattern:
      /\b(?:secret|password|passwd|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key)\b\s*[:=]\s*["'`][^"'`\n]{8,}["'`]/i,
  },
];

/**
 * Ways a codebase legitimately writes a non-secret in a secret's place.
 */
const PLACEHOLDER =
  /(process\.env|import\.meta\.env|configService|\bget\(|\$\{|<[^>]+>|changeme|change_me|placeholder|example|dummy|redacted|xxxx+|\.\.\.|your[_-]?(key|secret|token|password)|test[_-]?(key|secret|token)|foo|bar|baz)/i;

const TEXT = /\.(ts|mts|js|mjs|cjs|json|ya?ml|md|env|sh|toml|ini|conf|html|sql)$/;

/**
 * Walks a root and returns the text files it holds.
 *
 * @param root - directory to walk
 * @param skip - rejection regular expression, or null
 * @param found - accumulator
 * @returns the paths, relative to the repository
 */
function walk(root, skip, found = []) {
  if (!existsSync(root)) return found;
  for (const entry of readdirSync(root).sort()) {
    const path = join(root, entry);
    if (skip != null && skip.test(path)) continue;
    if (statSync(path).isDirectory()) walk(path, skip, found);
    else if (TEXT.test(path) || /(^|\/)\.env/.test(path)) found.push(path);
  }
  return found;
}

/**
 * Sweeps the declared roots and refuses what looks like a live credential.
 */
function main() {
  if (!existsSync(CONFIG)) {
    console.error(`not found: ${CONFIG} (run it from the project root)`);
    process.exit(1);
  }
  const config = JSON.parse(readFileSync(CONFIG, "utf8"));
  const settings = config.secrets_scan ?? {};
  const roots = settings.roots ?? config.project_map?.roots ?? ["src"];
  const skip = typeof settings.skip === "string" ? new RegExp(settings.skip) : null;

  const files = roots.flatMap((root) => walk(root, skip));
  if (files.length === 0) {
    console.error(
      `no file to scan under ${roots.join(", ")}: an empty scan is green for the wrong reason. ` +
        "Check secrets_scan.roots and secrets_scan.skip.",
    );
    process.exit(1);
  }

  const findings = [];
  for (const path of files) {
    const lines = readFileSync(path, "utf8").split("\n");
    lines.forEach((line, index) => {
      if (line.length > 4096) return;
      for (const rule of PATTERNS) {
        if (!rule.pattern.test(line)) continue;
        if (PLACEHOLDER.test(line)) continue;
        findings.push({ path, line: index + 1, rule, text: line.trim().slice(0, 120) });
        return;
      }
    });
  }

  for (const finding of findings) {
    console.error(`${finding.path}:${finding.line}: ${finding.rule.name}`);
    console.error(`      ${finding.rule.why}`);
    console.error(`      ${finding.text}`);
  }

  if (findings.length > 0) {
    console.error(
      `\n${findings.length} probable secret(s) across ${files.length} file(s). ` +
        "Rotate it before anything else: a secret removed by a later commit stays in the history. " +
        "Then read it from the environment.",
    );
    process.exit(1);
  }

  console.log(`${files.length} files scanned under ${roots.join(", ")}: no secret found.`);
}

main();
