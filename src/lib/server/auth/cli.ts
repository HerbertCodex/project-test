/**
 * Logique de la commande locale `npm run libraire:creer`, dont
 * `scripts/libraire-creer.ts` n'est que le point d'entrée.
 *
 * Comme `./index.ts`, ce module est chargé tel quel par Node : aucun import
 * relatif ni alias `$lib` à l'exécution, seulement des `import type`.
 */
import type { AccountCreationResult, AccountInput } from './index';

export const EXIT_OK = 0;
export const EXIT_FAILURE = 1;
export const EXIT_USAGE = 2;

export const USAGE = [
  'Usage : npm run libraire:creer -- --email <e-mail> --nom <nom affiché>',
  "Le mot de passe est lu sur l'entrée standard ou demandé en invite, jamais en argument."
].join('\n');

export const PASSWORD_ARGUMENT_ERROR =
  "Refusé : le mot de passe ne s'accepte jamais en argument de ligne de commande. " +
  "Il est lu sur l'entrée standard ou demandé en invite.";

/** Borne la lecture de l'entrée standard ; la validation refuse au-delà de 256. */
const MAX_PASSWORD_INPUT_LENGTH = 4096;

export type BooksellerArgs = { email: string; displayName: string };

export type ArgsResult = { ok: true; value: BooksellerArgs } | { ok: false; error: string };

const OPTIONS: Readonly<Partial<Record<string, keyof BooksellerArgs>>> = {
  '--email': 'email',
  '--nom': 'displayName'
};

function looksLikePasswordOption(flag: string): boolean {
  const name = flag.replace(/^-+/, '').toLowerCase();
  return name === 'p' || /pass|pwd|mdp|mot-?de-?passe|secret/.test(name);
}

/**
 * Lit `--email` et `--nom` (forme `--opt valeur` ou `--opt=valeur`). Tout autre
 * argument est refusé, sans jamais être recopié dans le message d'erreur.
 */
export function parseBooksellerArgs(argv: readonly string[]): ArgsResult {
  const values: Partial<BooksellerArgs> = {};

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const separator = arg.indexOf('=');
    const flag = arg.startsWith('--') && separator !== -1 ? arg.slice(0, separator) : arg;

    if (flag.startsWith('-') && looksLikePasswordOption(flag)) {
      return { ok: false, error: PASSWORD_ARGUMENT_ERROR };
    }

    const key = OPTIONS[flag];
    if (key === undefined) {
      return { ok: false, error: `Argument non reconnu.\n${USAGE}` };
    }
    if (values[key] !== undefined) {
      return { ok: false, error: `Option ${flag} répétée.\n${USAGE}` };
    }

    const value = flag === arg ? argv[++index] : arg.slice(separator + 1);
    if (value === undefined || value.startsWith('-')) {
      return { ok: false, error: `Valeur manquante pour ${flag}.\n${USAGE}` };
    }
    values[key] = value;
  }

  if (values.email === undefined || values.displayName === undefined) {
    return { ok: false, error: USAGE };
  }
  return { ok: true, value: { email: values.email, displayName: values.displayName } };
}

/** Première ligne d'un flux (sans le saut de ligne final ni `\r`). */
export async function readFirstLine(input: AsyncIterable<string | Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let buffered = '';

  for await (const chunk of input) {
    buffered += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    if (buffered.includes('\n') || buffered.length > MAX_PASSWORD_INPUT_LENGTH) break;
  }
  buffered += decoder.decode();

  const newline = buffered.indexOf('\n');
  const line = newline === -1 ? buffered : buffered.slice(0, newline);
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

export class PasswordInputError extends Error {}

/** Invite masquée sur un terminal : aucun caractère saisi n'est affiché. */
function promptHidden(
  question: string,
  input: NodeJS.ReadStream,
  output: NodeJS.WriteStream
): Promise<string> {
  return new Promise((resolve, reject) => {
    let answer = '';
    const wasRaw = input.isRaw;

    const finish = (error?: Error) => {
      input.off('data', onData);
      input.setRawMode(wasRaw);
      input.pause();
      output.write('\n');
      if (error) reject(error);
      else resolve(answer);
    };

    const onData = (chunk: Buffer | string) => {
      for (const char of chunk.toString()) {
        if (char === '\r' || char === '\n') return finish();
        if (char === '' || char === '') {
          return finish(new PasswordInputError('Saisie interrompue : aucun compte créé.'));
        }
        if (char === '' || char === '\b') {
          answer = Array.from(answer).slice(0, -1).join('');
        } else if (char >= ' ' && answer.length <= MAX_PASSWORD_INPUT_LENGTH) {
          answer += char;
        }
      }
    };

    output.write(question);
    input.setRawMode(true);
    input.on('data', onData);
    input.resume();
  });
}

/**
 * Mot de passe demandé deux fois en invite masquée sur un terminal, ou lu sur
 * la première ligne de l'entrée standard redirigée.
 */
export async function readBooksellerPassword(
  input: NodeJS.ReadStream,
  output: NodeJS.WriteStream
): Promise<string> {
  if (!input.isTTY) return readFirstLine(input);

  const password = await promptHidden('Mot de passe (12 à 256 caractères) : ', input, output);
  const confirmation = await promptHidden('Confirmez le mot de passe : ', input, output);
  if (password !== confirmation) {
    throw new PasswordInputError('Les deux saisies du mot de passe diffèrent : aucun compte créé.');
  }
  return password;
}

export type CreateBooksellerCommand = {
  argv: readonly string[];
  readPassword: () => Promise<string>;
  createBookseller: (input: AccountInput) => Promise<AccountCreationResult>;
  out: (line: string) => void;
  err: (line: string) => void;
};

/**
 * Déroule la commande et renvoie le code de sortie. Les arguments sont vérifiés
 * avant toute lecture du mot de passe ; ni le mot de passe ni son hachage ne
 * sont écrits dans les sorties.
 */
export async function runCreateBookseller(command: CreateBooksellerCommand): Promise<number> {
  const args = parseBooksellerArgs(command.argv);
  if (!args.ok) {
    command.err(args.error);
    return EXIT_USAGE;
  }

  let password: string;
  try {
    password = await command.readPassword();
  } catch (error) {
    command.err(
      error instanceof PasswordInputError ? error.message : 'Lecture du mot de passe impossible.'
    );
    return EXIT_FAILURE;
  }

  const result = await command.createBookseller({ ...args.value, password });
  if (!result.ok) {
    for (const message of Object.values(result.errors)) {
      if (message) command.err(message);
    }
    command.err('Aucun compte créé.');
    return EXIT_FAILURE;
  }

  command.out(`Compte libraire créé : ${result.user.email} (${result.user.displayName}).`);
  return EXIT_OK;
}
