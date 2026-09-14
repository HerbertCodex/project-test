// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { AuthUser } from '$lib/server/auth';

declare global {
  namespace App {
    // interface Error {}
    interface Locals {
      /** Utilisateur d'une session valide, chargé par le hook ; null pour un visiteur anonyme. */
      user: AuthUser | null;
    }
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }
}

export {};
