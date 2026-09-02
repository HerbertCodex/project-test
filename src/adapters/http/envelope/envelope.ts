/**
 * Ce que l'API rend quand elle réussit.
 *
 * Décision 0008 : une seule structure pour tout, succès comme erreur. Le client
 * n'a pas deux formes à apprendre selon le statut, ce qui compte d'autant plus
 * ici que les refus sont le cœur du produit et non un cas rare.
 */
export interface Envelope<Payload> {
  /** La charge utile de la route. */
  data: Payload;
}

/**
 * Ce que l'API rend quand elle refuse.
 */
export interface ApiError {
  /** Le nom du refus, sur lequel un client branche. */
  code: string;
  /** Ce qui s'est passé, en clair. */
  message: string;
  /** Les champs à reprendre, pour les seules erreurs de saisie. */
  fields?: string[];
}

/**
 * L'enveloppe d'erreur.
 */
export interface ErrorEnvelope {
  /** Le refus, sous la même forme quel que soit le statut. */
  error: ApiError;
}
