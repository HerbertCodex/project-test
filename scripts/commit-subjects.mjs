import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * Refuse un commit à venir dont le sujet ne dit pas à qui il appartient.
 *
 * `unclaimed.mjs` rattrape le second commit d'une issue — les tests rouges,
 * puis l'implémentation — par son SUJET, parce que le store ne retient qu'un
 * sha. Un sujet qui ne nomme aucune issue et qui ne porte pas de ligne
 * `direct:` sort donc en travail non réclamé.
 *
 * Ce validateur dit la même chose AVANT que le commit parte, là où c'est
 * encore réparable. `unclaimed` le dit après, quand la seule correction est de
 * réécrire l'historique — ce qui a coûté un signalement définitif sur 11a72e7.
 *
 * **Il ne regarde que les commits en avance sur `origin/main`.** Ceux qui y
 * sont déjà ne sont plus corrigeables sans réécrire une branche publiée : les
 * refuser à chaque exécution ferait un gate rouge pour toujours, donc un gate
 * qu'on finit par désactiver.
 */
const STORE = "pipeline/store/issues.jsonl";
const DIRECT = /^direct:/m;

/**
 * Les commits en avance sur la référence, sujet et corps.
 *
 * @param base - la référence de comparaison
 * @returns une entrée par commit, ou une liste vide s'il n'y a pas de base
 */
function commitsAhead(base) {
  let raw;
  try {
    raw = execFileSync("git", ["log", "--format=%h%x1f%s%x1f%b%x1e", `${base}..HEAD`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
  return raw
    .split("\x1e")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const [sha, subject, body] = entry.split("\x1f");
      return { sha, subject, body: body ?? "" };
    });
}

/**
 * Les identifiants d'issue que le store connaît.
 *
 * @returns l'ensemble des identifiants
 */
function knownIssues() {
  return new Set(
    readFileSync(STORE, "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line).id),
  );
}

const base = ["origin/main", "main"].map(commitsAhead).find((found) => found !== null);
if (base === undefined) {
  console.log("ni origin/main ni main : rien à comparer, rien à refuser.");
  process.exit(0);
}
const known = knownIssues();
const offenders = base.filter((commit) => {
  if (DIRECT.test(`${commit.subject}\n${commit.body}`)) return false;
  return ![...known].some((id) => commit.subject.includes(id));
});
if (offenders.length > 0) {
  console.error(`${offenders.length} commit(s) en avance dont le sujet ne nomme aucune issue :`);
  for (const commit of offenders) console.error(`  ${commit.sha}  ${commit.subject}`);
  console.error(
    "\nLe sujet porte l'identifiant — feat(i-xxxx): … — ou le message porte une ligne `direct:`" +
      " disant pourquoi. Corrigé maintenant, c'est un amend ; corrigé plus tard, c'est une" +
      " réécriture d'historique.",
  );
  process.exit(1);
}
console.log(`${base.length} commit(s) en avance : chacun nomme son issue ou se déclare direct.`);
