import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import Database from 'better-sqlite3';
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
import { applyMigrations } from '../../../infrastructure/persistence/migrate.js';
import { CirculationController } from './circulation.controller.js';

/**
 * Applique les migrations à une base et y met de quoi exercer le guichet.
 *
 * Réservé aux tests, et le nom du point d'entrée le dit. Le jeu de données est
 * volontairement minuscule : deux adhérents dont un endetté, deux exemplaires.
 * Il suffit à exercer les refus, et un jeu plus riche rendrait les tests
 * dépendants de données que personne ne relit.
 *
 * @param file - le fichier de base à préparer
 */
function prepare(file: string): void {
  applyMigrations(file);
  const raw = new Database(file);
  const copy = raw.prepare('INSERT INTO copies (id, title_id) VALUES (?, ?)');
  copy.run('c1', 't1');
  copy.run('c2', 't1');
  const member = raw.prepare(
    'INSERT INTO members (id, membership_expires_at, outstanding_debt) VALUES (?, ?, ?)',
  );
  member.run('m1', '2099-01-01T00:00:00.000Z', 0);
  member.run('m2', '2099-01-01T00:00:00.000Z', 0);
  member.run(
    'endette',
    '2099-01-01T00:00:00.000Z',
    DEFAULT_POLICY.debtBlockThreshold + 10,
  );
  raw.close();
}

/**
 * Le câblage du guichet : les cas d'usage, leurs ports, et les deux routes.
 *
 * C'est ici et nulle part ailleurs que Nest rencontre le domaine. Les cas
 * d'usage ne sont pas décorés `@Injectable` — ils sont construits à la main
 * par des fabriques — ce qui est exactement ce qui leur permet de ne rien
 * importer de `@nestjs/common`.
 */
@Module({})
export class CirculationModule {
  /**
   * Le module branché sur une base donnée.
   *
   * @param db - la poignée de base
   * @returns le module prêt à être importé
   */
  static withDatabase(db: Db): DynamicModule {
    const notifier = new LoggingNotificationSender((line) =>
      console.info(line),
    );
    return {
      module: CirculationModule,
      controllers: [CirculationController],
      providers: [
        { provide: APP_FILTER, useClass: RefusalFilter },
        {
          provide: BorrowUseCase,
          useValue: new BorrowUseCase(
            new DrizzleBorrowStore(db),
            DEFAULT_POLICY,
          ),
        },
        {
          provide: ReturnUseCase,
          useValue: new ReturnUseCase(
            new DrizzleReturnStore(db),
            DEFAULT_POLICY,
            notifier,
          ),
        },
      ],
    };
  }

  /**
   * Le module sur une base neuve, jetable, avec un jeu d'essai.
   *
   * @returns le module prêt pour un test de bout en bout
   */
  static forTesting(): DynamicModule {
    const file = join(mkdtempSync(join(tmpdir(), 'guichet-')), 'test.db');
    prepare(file);
    return CirculationModule.withDatabase(openDatabase(file));
  }
}
