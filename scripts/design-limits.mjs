import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import ts from "typescript";

/**
 * The `design_limits` gate for this repository.
 *
 * It runs in two halves, and they are separate on purpose.
 *
 * The four bounds the framework requires — cyclomatic complexity, function
 * length, parameter count, nesting depth — are oxlint's, declared in
 * `oxlint.design-limits.json`. They are kept out of `oxlint.json` so that a
 * function which has become too complex does not read like a formatting
 * fault: confusing the two makes both read inattentively.
 *
 * The second half is two syntactic forms oxlint cannot express, because it
 * ships no `no-restricted-syntax`. They are the cases where a violation of
 * Liskov or of open-closed is written down plainly:
 *
 *   - a method of a derived class that throws unconditionally — a caller
 *     holding the base breaks on the subclass, so the inheritance is a lie;
 *   - a chain of `instanceof` deciding behaviour — adding a case forces
 *     reopening that function.
 *
 * These do not PROVE the principles. A Liskov violation through a narrowed
 * precondition is invisible to any syntax query, and the profile invariants
 * say so rather than let anyone believe this gate covers it.
 *
 * Usage: node scripts/design-limits.mjs
 */

const OX_CONFIG = "oxlint.design-limits.json";
const CONFIG = "pipeline.config.json";

/**
 * Walks a root and returns the TypeScript files it holds.
 *
 * @param root - directory to walk
 * @param found - accumulator
 * @returns the paths, relative to the repository
 */
function walk(root, found = []) {
  if (!existsSync(root)) return found;
  for (const entry of readdirSync(root).sort()) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) walk(path, found);
    else if (/\.m?ts$/.test(path) && !path.endsWith(".d.ts")) found.push(path);
  }
  return found;
}

/**
 * Says whether a function body does nothing but throw.
 *
 * A guard that throws after testing something is not this: the form caught
 * here is the body whose every path throws, which is how a subclass announces
 * that it does not honour the contract it inherited.
 *
 * @param body - the method's body
 * @returns true when the body is a single unconditional throw
 */
function throwsUnconditionally(body) {
  if (body == null) return false;
  const statements = body.statements.filter((node) => !ts.isEmptyStatement(node));
  return statements.length === 1 && ts.isThrowStatement(statements[0]);
}

/**
 * Reads the two syntactic forms out of one file.
 *
 * @param path - the file's path
 * @returns one finding per form observed
 */
function findingsOf(path) {
  const text = readFileSync(path, "utf8");
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.ES2023, true);
  const found = [];
  const at = (node) => source.getLineAndCharacterOfPosition(node.getStart()).line + 1;

  const visit = (node, parent) => {
    if (ts.isClassDeclaration(node)) {
      const extendsBase = (node.heritageClauses ?? []).some(
        (clause) => clause.token === ts.SyntaxKind.ExtendsKeyword,
      );
      if (extendsBase) {
        for (const member of node.members) {
          if (ts.isMethodDeclaration(member) && throwsUnconditionally(member.body)) {
            found.push({
              path,
              line: at(member),
              principle: "Liskov",
              what: `${node.name?.text ?? "(anonymous)"}.${member.name.getText()} throws unconditionally`,
              why: "a caller holding the base type breaks on this subclass: the inheritance is a lie.",
            });
          }
        }
      }
    }

    // Only the head of a chain is examined: an `else if` is itself an
    // IfStatement, so counting from every link would report the same chain
    // once per branch.
    const isChainHead = ts.isIfStatement(node) && !(parent != null && parent.elseStatement === node);
    if (isChainHead && node.elseStatement != null && ts.isIfStatement(node.elseStatement)) {
      let branches = 0;
      for (let link = node; link != null; link = link.elseStatement != null && ts.isIfStatement(link.elseStatement) ? link.elseStatement : null) {
        const test = link.expression;
        if (ts.isBinaryExpression(test) && test.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword) {
          branches += 1;
        }
      }
      if (branches >= 2) {
        found.push({
          path,
          line: at(node),
          principle: "open-closed",
          what: `a chain of ${branches} \`instanceof\` decides behaviour`,
          why: "adding a case forces reopening this function; dispatch on the type instead.",
        });
      }
    }

    ts.forEachChild(node, (child) => visit(child, node));
  };

  ts.forEachChild(source, (child) => visit(child, source));
  return found;
}

/**
 * Runs the four measured bounds, then the two syntactic forms.
 */
function main() {
  if (!existsSync(OX_CONFIG)) {
    console.error(`not found: ${OX_CONFIG}, which carries the four measured bounds.`);
    process.exit(1);
  }
  const config = JSON.parse(readFileSync(CONFIG, "utf8"));
  const roots = config.project_map?.roots ?? ["src"];

  const bounds = spawnSync("npx", ["oxlint", "--deny-warnings", "-c", OX_CONFIG, ...roots], {
    encoding: "utf8",
  });
  if (bounds.stdout) process.stdout.write(bounds.stdout);
  if (bounds.stderr) process.stderr.write(bounds.stderr);

  const files = roots.flatMap((root) => walk(root));
  if (files.length === 0) {
    console.error(`no TypeScript file under ${roots.join(", ")}: an empty scan is a misconfiguration.`);
    process.exit(1);
  }

  const findings = files.flatMap((path) => findingsOf(path));
  for (const finding of findings) {
    console.error(`${finding.path}:${finding.line}: ${finding.principle} — ${finding.what}`);
    console.error(`      ${finding.why}`);
  }

  if (bounds.status !== 0 || findings.length > 0) process.exit(1);

  console.log(`${files.length} files: four bounds held, and neither written-down SOLID violation found.`);
}

main();
