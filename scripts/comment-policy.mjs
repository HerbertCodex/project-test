import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

/**
 * The comment policy for this repository.
 *
 * It forbids narration and accepts contracts. The distinction is not a matter
 * of taste: a line saying « increment the counter » above `counter += 1` goes
 * stale the day the code changes and nothing reports it, while a `/** ... *\/`
 * block stating what an export promises is the only place that promise is
 * written at all.
 *
 * So the rule has two halves:
 *
 *   - a line comment inside a function body must not restate the code. What
 *     is allowed there is a comment saying WHY — and `why`, `because`, a
 *     `TODO`, a `NOTE` or a reference are how that is written;
 *   - a commented-out line of code is refused outright. Version control keeps
 *     what was deleted; a commented block is a claim nobody can test.
 *
 * The syntax scanned is TypeScript's, and the roots come from the
 * configuration: both change with the stack, which is why this script is the
 * project's and not the framework's.
 *
 * Usage: node scripts/comment-policy.mjs
 */

const CONFIG = "pipeline.config.json";

/**
 * A comment that says WHY is kept. These are the markers that say so.
 */
const INTENT = /\b(why|because|parce que|car |sinon|otherwise|beware|attention|TODO|FIXME|NOTE|HACK|see |voir |cf\.|deliberate|volontaire|on purpose|exprès)\b/i;

/**
 * Shapes that are code wearing a comment's clothes.
 */
const COMMENTED_CODE = [
  /^\s*(const|let|var|function|class|import|export|return|await|if|for|while|switch)\b.*[;{)]\s*$/,
  /^\s*\w+\s*\([^)]*\)\s*;\s*$/,
  /^\s*\/\/\s*}/,
];

const REGEX_PREFIX_TOKENS = new Set([
  ts.SyntaxKind.OpenParenToken,
  ts.SyntaxKind.OpenBracketToken,
  ts.SyntaxKind.OpenBraceToken,
  ts.SyntaxKind.CommaToken,
  ts.SyntaxKind.ColonToken,
  ts.SyntaxKind.SemicolonToken,
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.QuestionToken,
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.ExclamationToken,
  ts.SyntaxKind.TildeToken,
  ts.SyntaxKind.ArrowToken,
  ts.SyntaxKind.ReturnKeyword,
  ts.SyntaxKind.ThrowKeyword,
  ts.SyntaxKind.CaseKeyword,
  ts.SyntaxKind.DeleteKeyword,
  ts.SyntaxKind.TypeOfKeyword,
  ts.SyntaxKind.VoidKeyword,
  ts.SyntaxKind.NewKeyword,
  ts.SyntaxKind.InKeyword,
  ts.SyntaxKind.OfKeyword,
  ts.SyntaxKind.YieldKeyword,
  ts.SyntaxKind.AwaitKeyword,
]);

/**
 * Walks a root and returns the TypeScript files it holds.
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
    else if (/\.m?ts$/.test(path) && !path.endsWith(".d.ts")) found.push(path);
  }
  return found;
}

/**
 * Reads the violations out of one file.
 *
 * A doc block — `/** ... *\/` — is never a violation: it is the contract form
 * the policy exists to protect.
 *
 * @param path - the file's path
 * @returns one finding per offending comment
 */
export function findingsOf(path) {
  const text = readFileSync(path, "utf8");
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.ES2023, true);
  const found = [];
  const scanner = ts.createScanner(ts.ScriptTarget.ES2023, false, ts.LanguageVariant.Standard, text);

  let pendingLineComment = null;
  const evaluate = (line, content) => {
    if (content.length === 0) return;
    if (COMMENTED_CODE.some((pattern) => pattern.test(content))) {
      found.push({ line, kind: "commented-out code", text: content });
      return;
    }
    if (!INTENT.test(content) && content.split(/\s+/).length <= 12) {
      found.push({ line, kind: "narration", text: content });
    }
  };
  const flushLineComment = () => {
    if (pendingLineComment == null) return;
    evaluate(pendingLineComment.line, pendingLineComment.content.join(" "));
    pendingLineComment = null;
  };

  let previous = null;
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (token === ts.SyntaxKind.WhitespaceTrivia || token === ts.SyntaxKind.NewLineTrivia) continue;
    if (token === ts.SyntaxKind.SlashToken && REGEX_PREFIX_TOKENS.has(previous)) {
      token = scanner.reScanSlashToken();
    }
    const isComment =
      token === ts.SyntaxKind.SingleLineCommentTrivia || token === ts.SyntaxKind.MultiLineCommentTrivia;
    if (!isComment) {
      flushLineComment();
      previous = token;
      continue;
    }

    const body = scanner.getTokenText();
    if (body.startsWith("/**")) continue;

    const line = source.getLineAndCharacterOfPosition(scanner.getTokenStart()).line + 1;
    const content = body
      .replace(/^\/\//, "")
      .replace(/^\/\*+/, "")
      .replace(/\*+\/$/, "")
      .split("\n")
      .map((entry) => entry.replace(/^\s*\*\s?/, "").trim())
      .join(" ")
      .trim();
    if (token === ts.SyntaxKind.SingleLineCommentTrivia) {
      if (pendingLineComment != null && line === pendingLineComment.lastLine + 1) {
        pendingLineComment.content.push(content);
        pendingLineComment.lastLine = line;
      } else {
        flushLineComment();
        pendingLineComment = { line, lastLine: line, content: [content] };
      }
      continue;
    }
    flushLineComment();
    evaluate(line, content);
  }
  flushLineComment();

  return found;
}

/**
 * Reads every comment of the declared roots, and reports the narration.
 */
function main() {
  if (!existsSync(CONFIG)) {
    console.error(`not found: ${CONFIG} (run it from the project root)`);
    process.exit(1);
  }
  const config = JSON.parse(readFileSync(CONFIG, "utf8"));
  const policy = config.comment_policy ?? {};
  const roots = policy.roots ?? config.project_map?.roots ?? ["src"];
  const skip = typeof policy.skip === "string" ? new RegExp(policy.skip) : null;

  const files = roots.flatMap((root) => walk(root, skip));
  if (files.length === 0) {
    console.error(
      `no file to read under ${roots.join(", ")}: an empty scan is green for the wrong reason. ` +
        "Check comment_policy.roots and comment_policy.skip.",
    );
    process.exit(1);
  }

  let total = 0;
  for (const path of files) {
    for (const finding of findingsOf(path)) {
      total += 1;
      console.error(`${path}:${finding.line}: ${finding.kind} — « ${finding.text} »`);
    }
  }

  if (total > 0) {
    console.error(
      `\n${total} comment(s) refused across ${files.length} file(s).\n` +
        "A comment restating the code goes stale the day the code changes, and nothing reports it. " +
        "Either say WHY — the reason, the trap, the decision — or delete the line. " +
        "A contract on an export belongs in a /** */ block, which this gate never refuses.",
    );
    process.exit(1);
  }

  console.log(`${files.length} files: no narration, no commented-out code.`);
}

if (process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href) main();
