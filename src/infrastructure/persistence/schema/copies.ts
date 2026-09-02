import { sql } from 'drizzle-orm';
import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

/**
 * Un exemplaire physique, rattaché à un titre.
 *
 * Aucune colonne de disponibilité : elle se dérive des prêts, et le domaine
 * l'interdit explicitement depuis i-ne4e. La table le respecte.
 */
export const copies = sqliteTable('copies', {
  id: text('id').primaryKey(),
  titleId: text('title_id').notNull(),
});

/**
 * Un adhérent, ses droits et ses dettes.
 */
export const members = sqliteTable('members', {
  id: text('id').primaryKey(),
  membershipExpiresAt: text('membership_expires_at').notNull(),
  outstandingDebt: integer('outstanding_debt').notNull().default(0),
});

/**
 * Un prêt : l'accord daté entre un adhérent et un exemplaire.
 *
 * L'index unique PARTIEL est le cœur de cette table. Il porte sur `copy_id`
 * là où `returned_at` est nul, donc il refuse un second prêt OUVERT sur le
 * même exemplaire tout en laissant passer les prêts successifs.
 *
 * C'est ce qui tient le refus fondateur du produit quel que soit
 * l'entrelacement des requêtes. Un verrou applicatif ne tiendrait que dans un
 * processus ; une contrainte de schéma tient partout, et elle est plus
 * difficile à contourner par accident.
 */
export const loans = sqliteTable(
  'loans',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    copyId: text('copy_id').notNull(),
    memberId: text('member_id').notNull(),
    startedAt: text('started_at').notNull(),
    dueAt: text('due_at').notNull(),
    returnedAt: text('returned_at'),
    lostAt: text('lost_at'),
    renewals: integer('renewals').notNull().default(0),
  },
  (table) => [
    uniqueIndex('loans_one_open_per_copy')
      .on(table.copyId)
      .where(sql`${table.returnedAt} is null`),
  ],
);

/**
 * Une réservation : une place dans la file d'attente d'un TITRE.
 *
 * `set_aside_copy_id` porte la mise de côté nominative, et `pickup_by` le
 * délai de retrait au-delà duquel la réservation expire.
 */
export const holds = sqliteTable('holds', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  titleId: text('title_id').notNull(),
  memberId: text('member_id').notNull(),
  placedAt: text('placed_at').notNull(),
  setAsideCopyId: text('set_aside_copy_id'),
  pickupBy: text('pickup_by'),
  expiredAt: text('expired_at'),
});
