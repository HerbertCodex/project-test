import { fail, redirect } from '@sveltejs/kit';
import { EMAIL_TAKEN_MESSAGE, createBorrower } from '$lib/server/auth';
import { getDb } from '$lib/server/db';
import type { Actions } from './$types';

function textValue(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value.trim() : '';
}

export const actions: Actions = {
  default: async ({ request }) => {
    const form = await request.formData();
    const email = form.get('email');
    const displayName = form.get('displayName');

    const result = await createBorrower(getDb(), {
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

    // Pas de connexion automatique : aucun cookie de session n'est posé ici.
    redirect(303, '/connexion?inscription=1');
  }
};
