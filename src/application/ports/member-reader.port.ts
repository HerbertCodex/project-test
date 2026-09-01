import type { Member } from '../../domain/member.js';

/**
 * Lire un adhérent.
 *
 * Extrait parce que `duplication` a refusé la déclaration identique dans
 * `BorrowStore` et `HoldStore` — six lignes significatives dans deux endroits.
 * C'est la bonne réponse plutôt qu'un magasin gras : deux ports composent une
 * capacité commune sans que l'un ait à connaître l'autre.
 */
export interface MemberReader {
  /**
   * @param memberId - l'adhérent cherché
   * @returns l'adhérent, ou null s'il n'existe pas
   */
  memberById(memberId: string): Promise<Member | null>;
}
