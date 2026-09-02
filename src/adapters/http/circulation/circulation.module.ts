import { Module, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { BorrowUseCase } from '../../../application/borrow/borrow.usecase.js';
import { ReturnUseCase } from '../../../application/return/return.usecase.js';
import { DEFAULT_POLICY } from '../../../infrastructure/config/circulation-policy.js';
import { LoggingNotificationSender } from '../../../infrastructure/notification/logging-notification-sender.js';
import {
  openDatabase,
  DrizzleBorrowStore,
  DrizzleReturnStore,
  type Db,
} from '../../../infrastructure/persistence/repositories/drizzle-stores.js';
import { RefusalFilter } from '../errors/refusal.filter.js';
import { CirculationController } from './circulation.controller.js';

/**
 * Le jeton par lequel on fournit la base.
 *
 * Un jeton nommé plutôt qu'une fabrique statique : c'est ce qui permet à un
 * test de remplacer la base par `overrideProvider`, l'outil que NestJS donne
 * exactement pour ça. La version précédente exposait un `forTesting()` en
 * production — un point d'entrée que le produit offrait à son banc d'essai,
 * accompagné d'un jeu de données en dur. L'opérateur l'a vu en relisant le
 * diff, et aucun gate ne l'avait vu.
 */
export const DATABASE = Symbol('DATABASE');

/**
 * Le chemin du fichier de base, lu dans l'environnement.
 *
 * @returns le chemin configuré, ou la base locale par défaut
 */
function databaseFile(): string {
  return process.env.DATABASE_FILE ?? 'bibliotheque.db';
}

/**
 * Le câblage du guichet : les cas d'usage, leurs ports, et les deux routes.
 *
 * Un `@Module` ordinaire, déclaré une seule fois dans son décorateur. C'est
 * ici et nulle part ailleurs que Nest rencontre le domaine.
 *
 * Les cas d'usage ne sont pas décorés `@Injectable` — ils sont construits par
 * des fabriques — et c'est exactement ce qui leur permet de n'importer rien de
 * `@nestjs/common`. Nest ne peut donc pas les instancier lui-même, ce qui rend
 * les fabriques nécessaires et non pas commodes.
 *
 * `ValidationPipe` est global et refuse ce que les DTO ne déclarent pas.
 * `whitelist` écarte les champs inconnus plutôt que de les laisser filer
 * jusqu'au domaine.
 */
@Module({
  controllers: [CirculationController],
  providers: [
    { provide: APP_FILTER, useClass: RefusalFilter },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    },
    { provide: DATABASE, useFactory: (): Db => openDatabase(databaseFile()) },
    {
      provide: BorrowUseCase,
      useFactory: (db: Db): BorrowUseCase =>
        new BorrowUseCase(new DrizzleBorrowStore(db), DEFAULT_POLICY),
      inject: [DATABASE],
    },
    {
      provide: ReturnUseCase,
      useFactory: (db: Db): ReturnUseCase =>
        new ReturnUseCase(
          new DrizzleReturnStore(db),
          DEFAULT_POLICY,
          new LoggingNotificationSender((line) => console.info(line)),
        ),
      inject: [DATABASE],
    },
  ],
})
export class CirculationModule {}
