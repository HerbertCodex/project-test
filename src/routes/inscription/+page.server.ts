import { fail, redirect } from '@sveltejs/kit';
import { EMAIL_TAKEN_MESSAGE, createBorrower } from '$lib/server/auth';
import { getDb } from '$lib/server/db';
import { recordSecurityEvent } from '$lib/server/security-log';
import type { Actions } from './$types';

function textValue(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value.trim() : '';
}

export const actions: Actions = {
  default: async ({ request }) => {
    const db = getDb();
    const form = await request.formData();
    const email = form.get('email');
    const displayName = form.get('displayName');

    const result = await createBorrower(db, {
      email,
      displayName,
      password: form.get('password')
    });

    if (!result.ok) {
      // Le mot de passe n'est jamais renvoyé.
      return fail(400, {
        email: textValue(email),
        displayName: textValue(displayName),
        errors: result.errors,
        emailTaken: result.errors.email === EMAIL_TAKEN_MESSAGE
      });
    }

    // Journalisé ici, après la seule branche qui crée un compte, et non dans
    // createAccount : la commande locale libraire:creer n'écrit ainsi rien dans
    // le journal. Le sujet est l'e-mail normalisé du compte ; ni le mot de
    // passe ni son hachage ne quittent createBorrower.
    recordSecurityEvent(db, {
      type: 'signup',
      userId: result.user.id,
      subject: result.user.email
    });

    // Pas de connexion automatique : aucun cookie de session n'est posé ici.
    redirect(303, '/connexion?inscription=1');
  }
};
