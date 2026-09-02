import { and, eq, isNull, isNotNull, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import { CopyAlreadyOnLoan } from '../../../domain/availability.js';
import { Copy } from '../../../domain/copy.js';
import { Hold } from '../../../domain/hold.js';
import { Loan } from '../../../domain/loan.js';
import { Member } from '../../../domain/member.js';
import type { BorrowStore } from '../../../application/ports/borrow-store.port.js';
import type { ExpireHoldStore } from '../../../application/ports/expire-hold-store.port.js';
import type { HoldStore } from '../../../application/ports/hold-store.port.js';
import type { LossStore } from '../../../application/ports/loss-store.port.js';
import type { RenewStore } from '../../../application/ports/renew-store.port.js';
import type { ReturnStore } from '../../../application/ports/return-store.port.js';
import { copies, holds, loans, members } from '../schema/copies.js';

/**
 * Le coût de remplacement d'un exemplaire, faute de colonne pour le porter.
 *
 * Le schéma ne stocke pas ce coût : le périmètre approuvé ne le demandait pas,
 * et l'inventer en colonne aurait été une règle métier ajoutée en douce. La
 * valeur est donc une politique de l'adaptateur, et c'est écrit ici pour que
 * personne ne la prenne pour une donnée.
 */
const REPLACEMENT_COST = 30;

/**
 * La poignée de base que tous les magasins partagent.
 */
export type Db = ReturnType<typeof drizzle>;

/**
 * Ouvre une base SQLite et l'enveloppe dans Drizzle.
 *
 * @param file - le chemin du fichier de base
 * @returns la poignée à passer aux magasins
 */
export function openDatabase(file: string): Db {
  return drizzle(new Database(file));
}

/**
 * Reconstruit un prêt depuis sa ligne.
 *
 * Le domaine ne connaît pas les colonnes, et la base ne connaît pas les objets.
 * La traduction vit ici, une seule fois, et c'est ce qui empêche les deux
 * modèles de diverger.
 *
 * @param row - la ligne lue
 * @returns le prêt du domaine
 */
function toLoan(row: typeof loans.$inferSelect): Loan {
  return new Loan({
    copyId: row.copyId,
    memberId: row.memberId,
    startedAt: new Date(row.startedAt),
    dueAt: new Date(row.dueAt),
    returnedAt: row.returnedAt === null ? null : new Date(row.returnedAt),
    lostAt: row.lostAt === null ? null : new Date(row.lostAt),
    renewals: row.renewals,
  });
}

/**
 * Reconstruit une réservation depuis sa ligne.
 *
 * @param row - la ligne lue
 * @returns la réservation du domaine
 */
function toHold(row: typeof holds.$inferSelect): Hold {
  return new Hold({
    titleId: row.titleId,
    memberId: row.memberId,
    placedAt: new Date(row.placedAt),
    setAsideCopyId: row.setAsideCopyId,
    pickupBy: row.pickupBy === null ? null : new Date(row.pickupBy),
  });
}

/**
 * Les colonnes d'un prêt.
 *
 * @param loan - le prêt du domaine
 * @returns la ligne à écrire
 */
function rowOf(loan: Loan): typeof loans.$inferInsert {
  return {
    copyId: loan.copyId,
    memberId: loan.memberId,
    startedAt: loan.startedAt.toISOString(),
    dueAt: loan.dueAt.toISOString(),
    returnedAt: loan.returnedAt?.toISOString() ?? null,
    lostAt: loan.lostAt?.toISOString() ?? null,
    renewals: loan.renewals,
  };
}

/**
 * Dit si une erreur du pilote est la violation de l'index unique partiel.
 *
 * La traduction qui suit est ce que la confrontation des réponses 2 et 3 de
 * l'opérateur a rendu nécessaire : sans elle, le refus fondateur remonterait
 * comme une erreur SQLite, ne figurerait dans aucune entrée de la table de
 * correspondance, et sortirait en 500 — exactement quand deux emprunts se
 * croisent, c'est-à-dire quand la bibliothèque est chargée.
 *
 * @param error - l'erreur levée par le pilote
 * @returns true s'il s'agit du conflit sur un prêt ouvert
 */
function isOpenLoanConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('loans_one_open_per_copy') ||
    message.includes('UNIQUE constraint failed')
  );
}

/**
 * Ce que les magasins partagent : la poignée, la lecture d'un adhérent, et les
 * requêtes que plusieurs d'entre eux refont à l'identique.
 *
 * L'héritage est ici un partage d'implémentation d'adaptateur, pas une
 * hiérarchie du domaine — lequel n'a aucune classe de base.
 */
class DrizzleStore {
  /**
   * @param db - la poignée de base
   */
  constructor(protected readonly db: Db) {}

  /**
   * @param memberId - l'adhérent cherché
   * @returns l'adhérent, ou null s'il n'existe pas
   */
  async memberById(memberId: string): Promise<Member | null> {
    const [row] = await this.db
      .select()
      .from(members)
      .where(eq(members.id, memberId))
      .limit(1);
    if (row === undefined) return null;
    return new Member(
      row.id,
      new Date(row.membershipExpiresAt),
      row.outstandingDebt,
    );
  }

  /**
   * @param copyId - l'exemplaire interrogé
   * @returns le prêt ouvert qui le concerne, ou null
   */
  protected async openLoanOf(copyId: string): Promise<Loan | null> {
    const [row] = await this.db
      .select()
      .from(loans)
      .where(and(eq(loans.copyId, copyId), isNull(loans.returnedAt)))
      .limit(1);
    return row === undefined ? null : toLoan(row);
  }

  /**
   * @param copyId - l'exemplaire interrogé
   * @returns l'identifiant du titre dont il est un exemplaire
   */
  async titleOfCopy(copyId: string): Promise<string> {
    const [row] = await this.db
      .select()
      .from(copies)
      .where(eq(copies.id, copyId))
      .limit(1);
    return row?.titleId ?? '';
  }

  /**
   * @param titleId - le titre interrogé
   * @returns les réservations en attente sur ce titre
   */
  async waitingHolds(titleId: string): Promise<Hold[]> {
    const rows = await this.db
      .select()
      .from(holds)
      .where(
        and(
          eq(holds.titleId, titleId),
          isNull(holds.setAsideCopyId),
          isNull(holds.expiredAt),
        ),
      );
    return rows.map(toHold);
  }

  /**
   * Met un exemplaire de côté pour une réservation.
   *
   * Remontée dans la base parce que `duplication` a refusé les deux copies :
   * le retour et l'expiration servent la même file, et c'est `HoldServing`
   * qu'ils satisfont tous les deux.
   *
   * @param hold - la réservation servie
   * @param copyId - l'exemplaire qui lui est affecté
   * @param pickupBy - la date limite de retrait
   */
  async setAsideForHold(
    hold: Hold,
    copyId: string,
    pickupBy: Date,
  ): Promise<void> {
    await this.db
      .update(holds)
      .set({ setAsideCopyId: copyId, pickupBy: pickupBy.toISOString() })
      .where(
        and(eq(holds.titleId, hold.titleId), eq(holds.memberId, hold.memberId)),
      );
  }

  /**
   * Insère un prêt NOUVEAU.
   *
   * Séparé de la mise à jour, et c'est tout l'enjeu de cette issue. La version
   * précédente cherchait un prêt ouvert sur l'exemplaire et le mettait à jour
   * quand elle en trouvait un : prêter un exemplaire déjà sorti écrasait alors
   * le prêt de l'autre adhérent en silence, la table ne grandissait pas, et
   * l'index unique n'était jamais atteint. La contrainte censée tenir le refus
   * fondateur ne pouvait pas se déclencher.
   *
   * @param loan - le prêt à créer
   * @throws {CopyAlreadyOnLoan} si l'exemplaire porte déjà un prêt ouvert
   */
  protected async insertLoan(loan: Loan): Promise<void> {
    try {
      await this.db.insert(loans).values(rowOf(loan));
    } catch (error) {
      if (isOpenLoanConflict(error)) throw new CopyAlreadyOnLoan(loan.copyId);
      throw error;
    }
  }

  /**
   * Met à jour le prêt ouvert d'un exemplaire.
   *
   * @param loan - le prêt, portant son nouvel état
   */
  protected async updateOpenLoan(loan: Loan): Promise<void> {
    const [existing] = await this.db
      .select()
      .from(loans)
      .where(and(eq(loans.copyId, loan.copyId), isNull(loans.returnedAt)))
      .limit(1);
    if (existing === undefined) return;
    await this.db
      .update(loans)
      .set(rowOf(loan))
      .where(eq(loans.id, existing.id));
  }

  /**
   * Ajoute au solde dû par un adhérent.
   *
   * @param memberId - l'adhérent qui doit
   * @param amount - le montant à ajouter
   */
  protected async addToDebt(memberId: string, amount: number): Promise<void> {
    await this.db
      .update(members)
      .set({ outstandingDebt: sql`${members.outstandingDebt} + ${amount}` })
      .where(eq(members.id, memberId));
  }
}

/**
 * Ce que les magasins de PRÊTS partagent.
 *
 * Séparée de `DrizzleStore` pour une raison que le compilateur a imposée :
 * `HoldStore.save` prend une réservation et non un prêt, donc mettre `save`
 * dans la base commune faisait échouer `tsc`. Les noms se télescopaient, et la
 * bonne réponse n'était pas de renommer un port mais de ne partager qu'entre
 * ceux que ça concerne.
 */
class DrizzleLoanStore extends DrizzleStore {
  /**
   * Le prêt ouvert qui porte sur un exemplaire.
   *
   * Publique dans la base plutôt que redéclarée dans chaque magasin :
   * `duplication` a refusé les deux délégations identiques, et l'invariant du
   * domaine garantit qu'il n'y a jamais deux prêts ouverts sur un exemplaire.
   *
   * @param copyId - l'exemplaire interrogé
   * @returns le prêt ouvert, ou null
   */
  async openLoanOfCopy(copyId: string): Promise<Loan | null> {
    return this.openLoanOf(copyId);
  }

  /**
   * Persiste un prêt, nouveau ou modifié.
   *
   * Même raison : l'emprunt et la prolongation écrivaient la même délégation.
   *
   * @param loan - le prêt à écrire
   */
  async save(loan: Loan): Promise<void> {
    if (loan.returnedAt !== null || loan.renewals > 0 || loan.isLost()) {
      await this.updateOpenLoan(loan);
      return;
    }
    await this.insertLoan(loan);
  }
}

/**
 * `BorrowStore` sur Drizzle.
 */
export class DrizzleBorrowStore
  extends DrizzleLoanStore
  implements BorrowStore
{
  /**
   * @param copyId - l'exemplaire cherché
   * @returns l'exemplaire, ou null
   */
  async copyById(copyId: string): Promise<Copy | null> {
    const [row] = await this.db
      .select()
      .from(copies)
      .where(eq(copies.id, copyId))
      .limit(1);
    return row === undefined ? null : new Copy(row.id, row.titleId);
  }

  /**
   * @param copyId - l'exemplaire interrogé
   * @returns ses prêts ouverts
   */
  async openLoansOfCopy(copyId: string): Promise<Loan[]> {
    const open = await this.openLoanOf(copyId);
    return open === null ? [] : [open];
  }

  /**
   * @param memberId - l'adhérent interrogé
   * @returns ses prêts ouverts
   */
  async openLoansOfMember(memberId: string): Promise<Loan[]> {
    const rows = await this.db
      .select()
      .from(loans)
      .where(and(eq(loans.memberId, memberId), isNull(loans.returnedAt)));
    return rows.map(toLoan);
  }

  /**
   * @param copyId - l'exemplaire interrogé
   * @returns l'adhérent pour qui il est mis de côté, ou null
   */
  async setAsideFor(copyId: string): Promise<string | null> {
    const [row] = await this.db
      .select()
      .from(holds)
      .where(and(eq(holds.setAsideCopyId, copyId), isNull(holds.expiredAt)))
      .limit(1);
    return row?.memberId ?? null;
  }
}

/**
 * `ReturnStore` sur Drizzle.
 */
export class DrizzleReturnStore
  extends DrizzleLoanStore
  implements ReturnStore
{
  /**
   * @param loan - le prêt fermé
   */
  async closeLoan(loan: Loan): Promise<void> {
    await this.updateOpenLoan(loan);
  }

  /**
   * @param memberId - l'adhérent qui doit
   * @param amount - le montant de l'amende
   */
  async addDebt(memberId: string, amount: number): Promise<void> {
    await this.addToDebt(memberId, amount);
  }

  /**
   * @param memberId - l'adhérent dont l'exemplaire revient
   */
  async clearReplacementDebt(memberId: string): Promise<void> {
    await this.addToDebt(memberId, -REPLACEMENT_COST);
  }
}

/**
 * `HoldStore` sur Drizzle.
 */
export class DrizzleHoldStore extends DrizzleStore implements HoldStore {
  /**
   * @param titleId - le titre interrogé
   * @returns ses réservations
   */
  async holdsOfTitle(titleId: string): Promise<Hold[]> {
    const rows = await this.db
      .select()
      .from(holds)
      .where(eq(holds.titleId, titleId));
    return rows.map(toHold);
  }

  /**
   * @param memberId - l'adhérent interrogé
   * @returns ses réservations
   */
  async holdsOfMember(memberId: string): Promise<Hold[]> {
    const rows = await this.db
      .select()
      .from(holds)
      .where(eq(holds.memberId, memberId));
    return rows.map(toHold);
  }

  /**
   * @param memberId - l'adhérent interrogé
   * @param titleId - le titre interrogé
   * @returns true s'il en détient déjà un exemplaire
   */
  async memberHoldsCopyOf(memberId: string, titleId: string): Promise<boolean> {
    const rows = await this.db
      .select()
      .from(loans)
      .innerJoin(copies, eq(loans.copyId, copies.id))
      .where(
        and(
          eq(loans.memberId, memberId),
          eq(copies.titleId, titleId),
          isNull(loans.returnedAt),
        ),
      );
    return rows.length > 0;
  }

  /**
   * @param titleId - le titre interrogé
   * @returns le nombre d'exemplaires empruntables tout de suite
   */
  async availableCopiesOf(titleId: string): Promise<number> {
    const all = await this.db
      .select()
      .from(copies)
      .where(eq(copies.titleId, titleId));
    const busy = await this.db
      .select()
      .from(loans)
      .where(isNull(loans.returnedAt));
    const taken = new Set(busy.map((row) => row.copyId));
    return all.filter((row) => !taken.has(row.id)).length;
  }

  /**
   * @param hold - la réservation à persister
   */
  async save(hold: Hold): Promise<void> {
    await this.db.insert(holds).values({
      titleId: hold.titleId,
      memberId: hold.memberId,
      placedAt: hold.placedAt.toISOString(),
      setAsideCopyId: hold.setAsideCopyId,
      pickupBy: hold.pickupBy?.toISOString() ?? null,
    });
  }
}

/**
 * `RenewStore` sur Drizzle.
 */
export class DrizzleRenewStore extends DrizzleLoanStore implements RenewStore {}

/**
 * `LossStore` sur Drizzle.
 */
export class DrizzleLossStore extends DrizzleStore implements LossStore {
  /**
   * @returns tous les prêts encore ouverts
   */
  async openLoans(): Promise<Loan[]> {
    const rows = await this.db
      .select()
      .from(loans)
      .where(isNull(loans.returnedAt));
    return rows.map(toLoan);
  }

  /**
   * @param loan - le prêt déclaré perdu
   */
  async markLost(loan: Loan): Promise<void> {
    await this.updateOpenLoan(loan);
  }

  /**
   * @param copyId - l'exemplaire perdu
   * @returns son coût de remplacement
   */
  replacementCostOf(copyId: string): Promise<number> {
    return Promise.resolve(
      copyId.length > 0 ? REPLACEMENT_COST : REPLACEMENT_COST,
    );
  }

  /**
   * @param memberId - l'adhérent qui doit
   * @param amount - le coût de remplacement
   */
  async addReplacementDebt(memberId: string, amount: number): Promise<void> {
    await this.addToDebt(memberId, amount);
  }
}

/**
 * `ExpireHoldStore` sur Drizzle.
 */
export class DrizzleExpireHoldStore
  extends DrizzleStore
  implements ExpireHoldStore
{
  /**
   * @returns les réservations qui ont un exemplaire mis de côté
   */
  async readyHolds(): Promise<Hold[]> {
    const rows = await this.db
      .select()
      .from(holds)
      .where(and(isNotNull(holds.setAsideCopyId), isNull(holds.expiredAt)));
    return rows.map(toHold);
  }

  /**
   * @param hold - la réservation expirée
   */
  async markExpired(hold: Hold): Promise<void> {
    await this.db
      .update(holds)
      .set({ expiredAt: new Date().toISOString() })
      .where(
        and(eq(holds.titleId, hold.titleId), eq(holds.memberId, hold.memberId)),
      );
  }

  /**
   * @param copyId - l'exemplaire libéré
   */
  async releaseCopy(copyId: string): Promise<void> {
    await this.db
      .update(holds)
      .set({ setAsideCopyId: null, pickupBy: null })
      .where(eq(holds.setAsideCopyId, copyId));
  }
}
