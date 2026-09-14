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
  <p class="error-page__code num" aria-hidden="true">{status}</p>
  <h1 id="error-title">{content.title}</h1>
  <p class="error-page__message">{content.message}</p>
  <p><a class="btn btn--primary" href="/">Retour au catalogue</a></p>
</section>

<style>
  .error-page {
    max-width: 48rem;
    padding-top: 1rem;
  }

  .error-page__code {
    display: block;
    margin: 0 0 0.5rem;
    font-size: clamp(4rem, 2rem + 10vw, 9rem);
    font-weight: 900;
    letter-spacing: -0.05em;
    line-height: 0.9;
    font-variant-numeric: tabular-nums;
    border-bottom: 6px solid var(--ink);
  }

  .error-page__code::after {
    content: '';
    display: block;
    width: 4rem;
    height: 0.5rem;
    margin-top: 0.5rem;
    background: var(--accent);
  }

  .error-page__message {
    font-size: 1.25rem;
  }

  @media (max-width: 40rem) {
    .error-page .btn {
      width: 100%;
    }
  }
</style>
