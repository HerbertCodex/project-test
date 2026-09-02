import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { RefusalFilter } from './errors/refusal.filter.js';

/**
 * Applique la configuration globale de l'application HTTP.
 *
 * **Elle vit au composition root et pas dans un module de fonctionnalité**, et
 * la raison est celle qui a fait relever le défaut : `APP_PIPE` et
 * `APP_FILTER` enregistrent GLOBALEMENT. Déclarés dans le module du guichet,
 * ils voulaient dire « importer le guichet change le comportement de toute
 * l'application » — ce qu'un module de fonctionnalité ne doit pas faire.
 * Aucun des deux n'a besoin d'injection, donc rien ne justifiait ce détour.
 *
 * **Une seule fonction, appelée des deux côtés.** `main.ts` et le montage de
 * test l'appellent tous les deux. Dupliquer la configuration ferait passer la
 * suite sur une application que le point d'entrée ne construit pas, et un test
 * lit les sources pour refuser cette dérive.
 *
 * `whitelist` écarte les champs inconnus au lieu de les porter jusqu'au
 * domaine ; `forbidNonWhitelisted` les refuse au lieu de les taire.
 *
 * @param app - l'application à configurer
 * @returns la même application, configurée
 */
export function configureApp<App extends INestApplication>(app: App): App {
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
  );
  app.useGlobalFilters(new RefusalFilter());
  return app;
}
