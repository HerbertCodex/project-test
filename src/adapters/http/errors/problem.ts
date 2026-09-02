/**
 * Le type de média que la RFC 9457 impose aux corps d'erreur.
 *
 * C'est lui qu'un outil tiers regarde pour savoir qu'il tient un problème et
 * non une réponse ordinaire. Le corps seul ne suffirait pas : `application/json`
 * ne dit rien de sa forme.
 */
export const PROBLEM_JSON = 'application/problem+json';

/**
 * Un problème, tel que la RFC 9457 le décrit.
 *
 * `title` résume la CATÉGORIE, `detail` décrit CETTE occurrence-ci. C'est la
 * distinction qui fait tout l'intérêt du format : un client peut afficher l'un
 * et journaliser l'autre.
 */
export interface ProblemDetails {
  /** L'URI qui identifie la catégorie de problème. */
  type: string;
  /** Le libellé stable de la catégorie. */
  title: string;
  /** Le statut HTTP, recopié dans le corps. */
  status: number;
  /** Ce qui s'est passé pour cette requête. */
  detail: string;
  /** Le chemin appelé. */
  instance: string;
  /** Les champs à reprendre, extension propre aux erreurs de saisie. */
  fields?: string[];
}

const WORD_BOUNDARY = new RegExp('([a-z0-9])([A-Z])', 'g');

/**
 * L'URI de catégorie d'un refus, DÉRIVÉE de son nom.
 *
 * Dérivée et non écrite à la main, pour la même raison que les statuts le sont
 * déjà : renommer un refus change son `type` sans que personne y pense, là où
 * une table parallèle attendrait qu'on l'oublie une fois.
 *
 * @param name - le nom du refus
 * @returns l'URI de sa catégorie
 */
export function problemTypeOf(name: string): string {
  return `/problems/${name.replace(WORD_BOUNDARY, '$1-$2').toLowerCase()}`;
}
