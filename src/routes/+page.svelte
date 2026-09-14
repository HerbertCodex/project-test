<script lang="ts">
  import type { SubmitFunction } from '@sveltejs/kit';
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import CatalogueTable from '$lib/components/CatalogueTable.svelte';
  import type { CatalogueEntry } from '$lib/server/catalogue';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  const isBookseller = $derived(data.user?.role === 'bookseller');
  const isBorrower = $derived(data.user?.role === 'borrower');

  /** Livre dont l'emprunt est en cours d'envoi ; un second envoi est ignoré. */
  let pendingBookId: string | null = $state(null);

  const submit: SubmitFunction = ({ formData, cancel }) => {
    if (pendingBookId !== null) {
      cancel();
      return;
    }
    pendingBookId = String(formData.get('bookId'));
    return async ({ result, update }) => {
      await update();
      // Après un conflit, la liste est rechargée : le livre apparaît « Emprunté ».
      if (result.type === 'failure') await invalidateAll();
      pendingBookId = null;
    };
  };
</script>

<svelte:head>
  <title>Catalogue — Librairie</title>
</svelte:head>

<div class="page-head">
  <h1>Catalogue</h1>
  {#if isBookseller}
    <a class="btn btn--primary" href="/libraire/livres/nouveau">Ajouter un livre</a>
  {/if}
</div>

{#if !data.user}
  <div class="notice">
    <p>
      <strong>Connectez-vous pour emprunter.</strong>
      <a href="/connexion">Se connecter</a> ou <a href="/inscription">créer un compte</a>.
    </p>
  </div>
{/if}

{#if form?.borrowed}
  <div class="notice notice--success" role="status">
    <strong class="notice__title">Livre emprunté.</strong>
    <p>
      « {form.borrowed.title} » est à rendre au plus tard le
      <time datetime={form.borrowed.dueOn.iso}>{form.borrowed.dueOn.label}</time>.
      <a href="/mes-prets">Voir mes prêts</a>
    </p>
  </div>
{:else if form?.borrowError}
  <div class="notice notice--error" role="alert">
    <strong class="notice__title">L’emprunt n’a pas abouti.</strong>
    <p>{form.borrowError}</p>
  </div>
{/if}

{#snippet borrowAction(book: CatalogueEntry)}
  {#if book.status === 'available'}
    {@const pending = pendingBookId === String(book.id)}
    <form method="POST" action="?/emprunter" use:enhance={submit}>
      <input type="hidden" name="bookId" value={book.id} />
      <button
        class="btn btn--primary"
        type="submit"
        aria-busy={pending || undefined}
        aria-disabled={pendingBookId !== null || undefined}
      >
        {pending ? 'Emprunt en cours…' : 'Emprunter'}<span class="vh"> « {book.title} »</span>
      </button>
    </form>
  {/if}
{/snippet}

{#if data.books.length === 0}
  <div class="empty">
    <p>Le catalogue ne contient encore aucun livre.</p>
    {#if isBookseller}
      <p><a href="/libraire/livres/nouveau">Ajouter un livre</a></p>
    {/if}
  </div>
{:else}
  <CatalogueTable books={data.books} action={isBorrower ? borrowAction : undefined} />
{/if}
