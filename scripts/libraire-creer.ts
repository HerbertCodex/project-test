/**
 * Point d'entrée de `npm run libraire:creer -- --email <e-mail> --nom <nom>`.
 * Le mot de passe est lu sur l'entrée standard ou en invite masquée, jamais en
 * argument. Exécuté directement par Node (suppression des types) : les imports
 * relatifs portent donc leur extension `.ts`.
 */
import { argv, stderr, stdin, stdout } from 'node:process';
import { openDatabase, resolveDatabasePath } from '../src/lib/server/db/index.ts';
import type { Db } from '../src/lib/server/db/index.ts';
import { createBookseller } from '../src/lib/server/auth/index.ts';
import { EXIT_FAILURE, readBooksellerPassword, runCreateBookseller } from '../src/lib/server/auth/cli.ts';

// Ouverte seulement une fois la saisie lue : une commande refusée ne crée pas la base.
let db: Db | undefined;

try {
  process.exitCode = await runCreateBookseller({
    argv: argv.slice(2),
    readPassword: () => readBooksellerPassword(stdin, stdout),
    createBookseller: (input) => {
      db ??= openDatabase(resolveDatabasePath());
      return createBookseller(db, input);
    },
    out: (line) => stdout.write(`${line}\n`),
    err: (line) => stderr.write(`${line}\n`)
  });
} catch {
  // Message générique : ni SQL, ni pile, ni donnée saisie.
  stderr.write("Erreur inattendue : aucun compte libraire n'a été créé.\n");
  process.exitCode = EXIT_FAILURE;
} finally {
  db?.close();
}
