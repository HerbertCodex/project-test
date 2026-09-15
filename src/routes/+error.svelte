<script lang="ts">
  import { page } from '$app/state';

  /**
   * Seuls le statut et, pour un 403, le message sont lus. Un message 403 est
   * toujours une chaîne française fixe passée à error(403, …) par le serveur ;
   * pour les autres statuts, le texte est fixe et page.error n'est jamais affiché.
   */
  const FORBIDDEN_FALLBACK = 'Vous n’avez pas accès à cette page.';

  const status = $derived(page.status);
  const content = $derived.by(() => {
    if (status === 403) {
      return { title: 'Accès refusé', message: page.error?.message || FORBIDDEN_FALLBACK };
    }
    if (status === 404) {
      return { title: 'Page introuvable', message: 'Cette page n’existe pas ou a été déplacée.' };
    }
    if (status >= 500) {
      return {
        title: 'Une erreur est survenue',
        message: 'La page n’a pas pu être affichée. Réessayez dans quelques instants.'
      };
    }
    return { title: 'Requête impossible', message: 'La demande n’a pas pu être traitée.' };
  });
</script>

<svelte:head>
  <title>{content.title} — Librairie</title>
</svelte:head>

<section class="error-page" aria-labelledby="error-title">
  <p class="error-page__code" aria-hidden="true">{status}</p>
  <h1 id="error-title">{content.title}</h1>
  <p class="error-page__message">{content.message}</p>
  <p><a class="btn btn--primary" href="/">Retour au catalogue</a></p>
</section>

<style>
  .error-page {
    max-width: 44rem;
    padding-top: 1rem;
  }

  /* Grand numéro serif décoratif, souligné d'un filet laiton. */
  .error-page__code {
    margin: 0 0 1.5rem;
    color: var(--ink);
    font-family: var(--serif);
    font-size: clamp(5rem, 2.5rem + 12vw, 10rem);
    font-weight: 500;
    font-variant-numeric: lining-nums tabular-nums;
    letter-spacing: -0.02em;
    line-height: 0.85;
  }

  .error-page__code::after {
    content: '';
    display: block;
    width: 4rem;
    height: 2px;
    margin-top: 1.25rem;
    background: var(--brass);
  }

  /* Le filet est déjà porté par le numéro : pas de second filet sous le titre. */
  .error-page h1::after {
    content: none;
  }

  .error-page__message {
    max-width: 38rem;
    color: var(--ink-2);
    font-size: 1.125rem;
  }

  @media (max-width: 40rem) {
    .error-page .btn {
      width: 100%;
    }
  }
</style>
