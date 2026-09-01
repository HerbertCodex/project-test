import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import ts from "typescript";

/**
 * The project map generator for this repository.
 *
 * It is deliberately NOT the generator the framework ships. That one
 * recognises declarations by pattern and would read `AppController` as a
 * class; here the TypeScript compiler already parses the file, so the map can
 * say `AppController — controller — GET /`. The reuse note every addition owes
 * is judged against this document, and a note judged against a map that says
 * `class` is a note nobody can judge.
 *
 * The compiler API is used in its syntactic form only: `createSourceFile`
 * parses one file without resolving its imports. A full type-checking program
 * would answer questions this map never asks, and would make the gate slower
 * than the test suite it runs beside.
 *
 * Usage: node scripts/project-map.mjs [--check]
 */

const CONFIG = "pipeline.config.json";

/**
 * Reads the map settings from the project configuration.
 *
 * The generator owns no path: the configuration decides where the map lives
 * and which roots it covers, so moving either is an edit to one file.
 *
 * @returns the `project_map` block, with its defaults resolved
 */
function settings() {
  if (!existsSync(CONFIG)) {
    console.error(`not found: ${CONFIG} (run it from the project root)`);
    process.exit(1);
  }
  const config = JSON.parse(readFileSync(CONFIG, "utf8"));
  const map = config.project_map ?? {};
  return {
    out: map.out ?? "docs/project-map.md",
    roots: map.roots ?? ["src"],
    skip: typeof map.skip === "string" ? new RegExp(map.skip) : null,
    extensions: map.extensions ?? [".ts", ".mts"],
  };
}

/**
 * Walks a root and returns the files it holds, minus the skipped ones.
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
    else found.push(path);
  }
  return found;
}

/**
 * Returns the first sentence of the documentation attached to a node.
 *
 * The role a declaration gives itself in its own words is the half of the map
 * a reader actually uses: a name says what a thing is called, a sentence says
 * whether it is the one they were about to write again.
 *
 * @param node - the declaration
 * @param text - the full source text
 * @returns the sentence, or an empty string when the declaration documents nothing
 */
function docLine(node, text) {
  const ranges = ts.getLeadingCommentRanges(text, node.pos) ?? [];
  const block = ranges.filter((range) => text.slice(range.pos, range.pos + 3) === "/**").pop();
  if (block == null) return "";
  const body = text
    .slice(block.pos + 3, block.end - 2)
    .split("\n")
    .map((line) => line.replace(/^\s*\*\s?/, "").trim())
    .filter((line) => line.length > 0 && !line.startsWith("@"));
  const sentence = body.join(" ").split(/(?<=\.)\s/)[0] ?? "";
  return sentence.trim();
}

/**
 * Returns the name of a decorator applied to a node, with its first argument.
 *
 * NestJS states the nature of a class and the route of a method in its
 * decorators, and nowhere else. A map that ignored them would describe this
 * codebase as a pile of classes.
 *
 * @param node - the decorated declaration
 * @returns one `{ name, argument }` per decorator
 */
function decorators(node) {
  const list = ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : [];
  return list.map((decorator) => {
    const call = decorator.expression;
    if (ts.isCallExpression(call)) {
      const first = call.arguments[0];
      return {
        name: call.expression.getText?.() ?? String(call.expression.escapedText ?? ""),
        argument: first != null && ts.isStringLiteral(first) ? first.text : "",
      };
    }
    return { name: call.getText?.() ?? "", argument: "" };
  });
}

const HTTP = ["Get", "Post", "Put", "Patch", "Delete", "Head", "Options", "All"];

/**
 * Names the nature of a class from the decorator NestJS put on it.
 *
 * @param applied - the decorators read on the class
 * @returns the nature, and the route prefix when there is one
 */
function classNature(applied) {
  const controller = applied.find((entry) => entry.name === "Controller");
  if (controller != null) return { nature: "controller", prefix: controller.argument };
  if (applied.some((entry) => entry.name === "Module")) return { nature: "module", prefix: "" };
  if (applied.some((entry) => entry.name === "Injectable")) return { nature: "service", prefix: "" };
  return { nature: "class", prefix: "" };
}

/**
 * Reads the routes a controller class declares, method by method.
 *
 * @param node - the class declaration
 * @param prefix - the controller's route prefix
 * @returns the routes, as `VERB /path` strings
 */
function routes(node, prefix) {
  const found = [];
  for (const member of node.members) {
    if (!ts.isMethodDeclaration(member)) continue;
    for (const applied of decorators(member)) {
      if (!HTTP.includes(applied.name)) continue;
      const path = `/${[prefix, applied.argument].filter((part) => part.length > 0).join("/")}`;
      found.push(`${applied.name.toUpperCase()} ${path.replace(/\/+/g, "/")}`);
    }
  }
  return found;
}

/**
 * Says whether a declaration leaves its file.
 *
 * @param node - the declaration
 * @returns true when the node carries the `export` modifier
 */
function exported(node) {
  return (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0;
}

/**
 * Collects the scenarios a test file describes.
 *
 * The framework's guide asks for test harnesses in the map, and it is the
 * request whose omission costs the most: an agent that cannot see the existing
 * harnesses writes a fourth bootstrap of the same application.
 *
 * @param source - the parsed file
 * @returns the titles passed to `describe`
 */
function scenarios(source) {
  const found = [];
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "describe" &&
      node.arguments[0] != null &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      found.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return found;
}

/**
 * Reads one file and returns the entries it contributes to the map.
 *
 * @param path - the file's path, relative to the repository
 * @returns the entries, each with its name, nature and stated role
 */
function entriesOf(path) {
  const text = readFileSync(path, "utf8");
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.ES2023, true);
  const isTest = /\.(spec|e2e-spec)\.[cm]?ts$/.test(path);

  if (isTest) {
    return scenarios(source).map((title) => ({ name: title, nature: "test harness", role: "", extra: [] }));
  }

  const entries = [];
  for (const node of source.statements) {
    if (ts.isClassDeclaration(node) && exported(node) && node.name != null) {
      const { nature, prefix } = classNature(decorators(node));
      entries.push({
        name: node.name.text,
        nature,
        role: docLine(node, text),
        extra: nature === "controller" ? routes(node, prefix) : [],
      });
      continue;
    }
    if (ts.isFunctionDeclaration(node) && exported(node) && node.name != null) {
      entries.push({ name: node.name.text, nature: "function", role: docLine(node, text), extra: [] });
      continue;
    }
    if (ts.isInterfaceDeclaration(node) && exported(node)) {
      entries.push({ name: node.name.text, nature: "interface", role: docLine(node, text), extra: [] });
      continue;
    }
    if (ts.isTypeAliasDeclaration(node) && exported(node)) {
      entries.push({ name: node.name.text, nature: "type", role: docLine(node, text), extra: [] });
      continue;
    }
    if (ts.isEnumDeclaration(node) && exported(node)) {
      entries.push({ name: node.name.text, nature: "enum", role: docLine(node, text), extra: [] });
      continue;
    }
    if (ts.isVariableStatement(node) && exported(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        entries.push({ name: declaration.name.text, nature: "const", role: docLine(node, text), extra: [] });
      }
    }
  }
  return entries;
}

/**
 * Renders the whole map.
 *
 * Every collected file gets a line whether or not it exports anything: a file
 * absent from the map reads as a file that does not exist, and `map-coverage`
 * refuses the document on exactly that ground.
 *
 * @param config - the resolved map settings
 * @returns the map's Markdown
 */
function render(config) {
  const files = config.roots
    .flatMap((root) => walk(root, config.skip))
    .filter((path) => config.extensions.some((extension) => path.endsWith(extension)))
    .sort();

  if (files.length === 0) {
    console.error(
      `no source file under ${config.roots.join(", ")} with extensions ${config.extensions.join(", ")}.\n` +
        "An empty map passes --check against another empty map, which is a green gate asserting nothing. " +
        "Check project_map.roots, project_map.skip and project_map.extensions.",
    );
    process.exit(1);
  }

  const lines = [
    "# Project map",
    "",
    "Generated by `scripts/project-map.mjs` from the TypeScript syntax tree. Never edited by hand:",
    "`node scripts/project-map.mjs --check` refuses a map that drifted from the code.",
    "",
    "It answers one question — **does this already exist?** — and the reuse note owed by every",
    "addition is judged against it. What it does not see: members of a class, names assembled at",
    "runtime, and re-exports through an index.",
    "",
    `${files.length} files, ${config.roots.join(", ")}.`,
    "",
  ];

  let declarations = 0;
  let directory = null;
  for (const path of files) {
    const parent = dirname(path);
    if (parent !== directory) {
      directory = parent;
      lines.push(`## ${parent}/`, "");
    }
    const entries = entriesOf(path);
    declarations += entries.length;
    lines.push(`### ${path}`, "");
    if (entries.length === 0) {
      lines.push("- *no exported declaration*", "");
      continue;
    }
    for (const entry of entries) {
      const role = entry.role.length > 0 ? ` — ${entry.role}` : "";
      const extra = entry.extra.length > 0 ? ` — ${entry.extra.join(", ")}` : "";
      lines.push(`- \`${entry.name}\` — ${entry.nature}${extra}${role}`);
    }
    lines.push("");
  }

  if (declarations === 0) {
    console.error(
      `not one declaration recognised across ${files.length} file(s).\n` +
        "A map with no entry is the failure this generator exists to make loud: --check would compare " +
        "empty with empty and exit 0. Check that the roots really hold this project's TypeScript.",
    );
    process.exit(1);
  }

  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

/**
 * Writes the map, or reports its drift.
 */
function main() {
  const config = settings();
  const rendered = render(config);
  const checkMode = process.argv.includes("--check");

  if (checkMode) {
    if (!existsSync(config.out)) {
      console.error(`not found: ${config.out}. Regenerate it: node scripts/project-map.mjs`);
      process.exit(1);
    }
    if (readFileSync(config.out, "utf8") !== rendered) {
      console.error(
        `${config.out} drifted from the code. Regenerate it: node scripts/project-map.mjs`,
      );
      process.exit(1);
    }
    console.log(`${config.out} is up to date.`);
    return;
  }

  mkdirSync(dirname(config.out), { recursive: true });
  writeFileSync(config.out, rendered);
  console.log(`written: ${relative(process.cwd(), config.out)}`);
}

main();
