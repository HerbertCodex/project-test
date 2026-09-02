import * as availability from '../../../domain/availability.js';
import * as borrow from '../../../application/borrow/borrow.usecase.js';
import * as hold from '../../../application/hold/place-hold.usecase.js';
import * as renew from '../../../application/renew/renew.usecase.js';
import * as ret from '../../../application/return/return.usecase.js';
import { REFUSAL_STATUS } from './refusal-map.js';

/**
 * Les noms des classes d'erreur qu'un module exporte.
 *
 * C'est ce qui permet au COMPILATEUR de connaître la liste des refus sans que
 * personne ne la maintienne à la main.
 */
type RefusalsOf<Module> = {
  [Name in keyof Module]: Module[Name] extends new (...args: never[]) => Error
    ? Name
    : never;
}[keyof Module];

/**
 * Tous les refus que le domaine et les cas d'usage déclarent.
 */
type EveryRefusal =
  | RefusalsOf<typeof availability>
  | RefusalsOf<typeof borrow>
  | RefusalsOf<typeof hold>
  | RefusalsOf<typeof renew>
  | RefusalsOf<typeof ret>;

/**
 * La preuve d'exhaustivité, tenue par `tsc` et par rien d'autre.
 *
 * Ajouter une classe de refus au domaine ou à un cas d'usage sans lui donner
 * une entrée dans `REFUSAL_STATUS` fait échouer cette affectation, donc le
 * gate `check`, donc le build — chez celui qui écrit le refus.
 *
 * Une vérification au démarrage se découvrirait en production ; une
 * vérification par un test se découvrirait à l'exécution de la suite. Celle-ci
 * se découvre à la frappe, et c'est ce que le critère demandait.
 *
 * La constante n'est jamais lue : elle existe pour que l'affectation soit
 * vérifiée. Le test d'exhaustivité la cite pour que `dead_code` la voie.
 */
export const REFUSAL_MAP_IS_EXHAUSTIVE: Record<EveryRefusal, number> =
  REFUSAL_STATUS;
