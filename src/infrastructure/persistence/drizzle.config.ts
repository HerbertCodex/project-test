import type { Config } from 'drizzle-kit';

/**
 * La configuration Drizzle, sous `src/` et non à la racine.
 *
 * Ce n'est pas la convention du paquet, et c'est délibéré : `file_policy`
 * refuse la racine du dépôt à l'implémenteur, ce qui a été vérifié avant que le
 * plan ne soit écrit plutôt que découvert par `verify-scope`. Les commandes
 * `drizzle-kit` reçoivent ce chemin par `--config`.
 */
export default {
  schema: './src/infrastructure/persistence/schema/copies.ts',
  out: './src/infrastructure/persistence/migrations',
  dialect: 'sqlite',
} satisfies Config;
