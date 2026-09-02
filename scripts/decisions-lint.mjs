import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Refuse un journal de décisions dont on ne peut pas dire ce qui fait foi.
 *
 * Une décision remplacée qui ne le dit pas est pire qu'une décision absente :
 * un lecteur la suit. Le cas s'est présenté avec 0008, remplacée par 0009 le
 * lendemain — le lien avait été écrit à la main, dans les deux sens, et rien
 * ne l'aurait refusé s'il n'avait été écrit que d'un côté.
 *
 * Ce que ce validateur exige, et rien de plus :
 *   - le titre porte le numéro du fichier ;
 *   - une ligne `- **Statut** :` existe ;
 *   - une décision qui se dit REMPLACÉE nomme un fichier qui existe ;
 *   - ce fichier dit `Remplace` en retour, et nomme le bon numéro.
 *
 * Le lien à double sens est le point : c'est lui qui empêche qu'on marque une
 * décision remplacée sans que la remplaçante l'assume.
 */
const DIRECTORY = "pipeline/decisions";
const REPLACED = /REMPLAC[ÉE]E\s+par\s+`?(\d{4})/i;
const REPLACES = /Remplace\s+`?(\d{4})/i;
const TITLE = /^#\s+(\d{4})\s/;

/**
 * Les décisions du journal, numéro et contenu.
 *
 * @returns une entrée par décision, triée par numéro
 */
function decisions() {
  return readdirSync(DIRECTORY)
    .filter((name) => /^\d{4}-.+\.md$/.test(name))
    .sort()
    .map((name) => ({
      name,
      number: name.slice(0, 4),
      text: readFileSync(join(DIRECTORY, name), "utf8"),
    }));
}

/**
 * Les manquements d'une décision, s'il y en a.
 *
 * @param entry - la décision examinée
 * @param byNumber - toutes les décisions, indexées par numéro
 * @returns les phrases décrivant ce qui manque
 */
function faultsOf(entry, byNumber) {
  const faults = [];
  const title = TITLE.exec(entry.text);
  if (title === null || title[1] !== entry.number) {
    faults.push(`le titre ne porte pas le numéro ${entry.number}`);
  }
  if (!entry.text.includes("- **Statut** :")) {
    faults.push("aucune ligne `- **Statut** :`");
  }
  const replaced = REPLACED.exec(entry.text);
  if (replaced === null) return faults;
  const successor = byNumber.get(replaced[1]);
  if (successor === undefined) {
    faults.push(`se dit remplacée par ${replaced[1]}, qui n'existe pas`);
    return faults;
  }
  const back = REPLACES.exec(successor.text);
  if (back === null || back[1] !== entry.number) {
    faults.push(`${successor.name} ne dit pas qu'elle remplace ${entry.number}`);
  }
  return faults;
}

const entries = decisions();
if (entries.length === 0) {
  console.error("aucune décision lue sous pipeline/decisions. Rien à valider.");
  process.exit(1);
}
const byNumber = new Map(entries.map((entry) => [entry.number, entry]));
const reported = entries.flatMap((entry) =>
  faultsOf(entry, byNumber).map((fault) => `  ${entry.name}: ${fault}`),
);
if (reported.length > 0) {
  console.error(`${reported.length} manquement(s) dans le journal des décisions :`);
  console.error(reported.join("\n"));
  console.error(
    "\nUne décision remplacée qui ne le dit pas est suivie. Le lien se porte des DEUX côtés.",
  );
  process.exit(1);
}
console.log(`${entries.length} décision(s) : statut lisible, remplacements liés des deux côtés.`);
