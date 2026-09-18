import { requireBookseller } from '$lib/server/catalogue';
import { LIBRARY_TIME_ZONE } from '$lib/server/dates';
import { getDb } from '$lib/server/db';
import { parsePageParam } from '$lib/server/pagination';
import { listRecentSecurityEvents } from '$lib/server/security-log';
import type { PageServerLoad } from './$types';

const parisDateTime = new Intl.DateTimeFormat('fr-FR', {
  timeZone: LIBRARY_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
});

/** Instant affiché et instant lisible par la machine, comme `loanDate` pour une date. */
export type JournalInstant = { iso: string; label: string };

/**
 * Horodatage d'un événement : le libellé est l'heure de Paris (« 18/09/2026 à
 * 14:00 »), `iso` le même instant en UTC pour l'attribut `datetime`. Les parties
 * sont recomposées à la main pour que le séparateur reste « à » quelle que soit
 * la version d'ICU.
 */
function parisInstant(createdAt: number): JournalInstant {
  const instant = new Date(createdAt);
  const parts = Object.fromEntries(
    parisDateTime.formatToParts(instant).map((part) => [part.type, part.value])
  );
  return {
    iso: instant.toISOString(),
    label: `${parts.day}/${parts.month}/${parts.year} à ${parts.hour}:${parts.minute}`
  };
}

/** Ligne du journal telle que la page la rend : aucune date n'est calculée côté composant. */
export type JournalEntry = {
  id: number;
  label: string;
  when: JournalInstant;
  userName: string | null;
  subject: string | null;
};

/**
 * Une page des événements de sécurité, du plus récent au plus ancien. Contrôle
 * refait ici en plus du layout /libraire. La page est en lecture seule : aucune
 * action n'est exportée, donc tout POST est refusé par SvelteKit.
 *
 * `page` est bornée silencieusement : jamais d'erreur pour une valeur invalide
 * ou hors bornes.
 */
export const load: PageServerLoad = ({ locals, url }) => {
  requireBookseller(locals.user);

  const page = parsePageParam(url?.searchParams.get('page') ?? null);
  const eventsPage = listRecentSecurityEvents(getDb(), page);
  const events: JournalEntry[] = eventsPage.items.map((event) => ({
    id: event.id,
    label: event.label,
    when: parisInstant(event.createdAt),
    userName: event.userName,
    subject: event.subject
  }));

  return {
    events,
    page: eventsPage.page,
    pageSize: eventsPage.pageSize,
    totalItems: eventsPage.totalItems,
    totalPages: eventsPage.totalPages
  };
};
