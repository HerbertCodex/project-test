import { listCatalogue } from '$lib/server/catalogue';
import { getDb } from '$lib/server/db';
import type { PageServerLoad } from './$types';

/** Catalogue public : id, titre, auteur et statut, quel que soit le visiteur. */
export const load: PageServerLoad = () => ({
  books: listCatalogue(getDb())
});
