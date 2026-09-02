import { NestFactory } from '@nestjs/core';
import { configureApp } from './adapters/http/configure-app.js';
import { AppModule } from './app.module.js';

/**
 * Démarre l'application.
 *
 * Le composition root applique la configuration globale, et il est le seul à
 * le faire : le montage de test appelle la même fonction plutôt que d'en
 * recopier une variante.
 */
async function bootstrap(): Promise<void> {
  const app = configureApp(await NestFactory.create(AppModule));
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
