<script lang="ts">
  import type { SubmitFunction } from '@sveltejs/kit';
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import CatalogueTable from '$lib/components/CatalogueTable.svelte';
  import Pagination from '$lib/components/Pagination.svelte';
  import type { CatalogueEntry } from '$lib/server/catalogue';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  const isBookseller = $derived(data.user?.role === 'bookseller');
  const isBorrower = $derived(data.user?.role === 'borrower');

  const filtersActive = $derived(
    data.filters.text !== undefined ||
      data.filters.availableForLoan === true ||
      data.filters.availableForSale === true
  );
  const resultLabel = $derived(
    data.totalItems === 1 ? '1 livre correspond.' : `${data.totalItems} livres correspondent.`
  );

  /** Position affichée de la page courante dans le total, par exemple « 26–50 sur 5 000 ». */
  const firstItem = $derived(data.books.length === 0 ? 0 : (data.page - 1) * data.pageSize + 1);
  const lastItem = $derived((data.page - 1) * data.pageSize + data.books.length);

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
    <form class="borrow" method="POST" action="?/emprunter" use:enhance={submit}>
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

<!-- Formulaire GET sans JavaScript : noms q, pret et vente = CATALOGUE_FILTER_PARAMS. -->
{#snippet filterBand()}
  <form class="filters" method="GET" role="search" aria-label="Filtrer le catalogue">
    <div class="field">
      <label for="catalogue-q">Titre ou auteur</label>
      <input
        id="catalogue-q"
        name="q"
        type="search"
        maxlength={data.searchMaxLength}
        value={data.filters.text ?? ''}
        autocomplete="off"
      />
    </div>
    <fieldset class="filters__group">
      <legend>Disponibilité</legend>
      <div class="filters__checks">
        <label class="check">
          <input type="checkbox" name="pret" value="1" checked={data.filters.availableForLoan === true} />
          Disponible au prêt
        </label>
        <label class="check">
          <input type="checkbox" name="vente" value="1" checked={data.filters.availableForSale === true} />
          En vente
        </label>
      </div>
    </fieldset>
    <div class="filters__actions">
      <button class="btn btn--primary" type="submit">Filtrer</button>
      {#if filtersActive}
        <a href="/">Réinitialiser</a>
      {/if}
    </div>
  </form>
  {#if filtersActive && data.books.length > 0}
    <p class="filters__result">{resultLabel}</p>
  {/if}
{/snippet}

{#snippet noMatch()}
  <div class="empty">
    <p>Aucun livre ne correspond à ces filtres.</p>
    <p>
      Essayez un autre titre ou auteur, ou décochez une disponibilité.
      <a href="/">Afficher tout le catalogue</a>
    </p>
  </div>
{/snippet}

{#if data.books.length === 0 && !filtersActive}
  <div class="empty">
    <p>Le catalogue ne contient encore aucun livre.</p>
    {#if isBookseller}
      <p><a href="/libraire/livres/nouveau">Ajouter un livre</a></p>
    {/if}
  </div>
{:else}
  <CatalogueTable
    books={data.books}
    filters={filterBand}
    empty={noMatch}
    action={isBorrower ? borrowAction : undefined}
  />
  {#if data.books.length > 0}
    <p class="catalogue-position">{firstItem}–{lastItem} sur {data.totalItems}</p>
  {/if}
  <Pagination
    page={data.page}
    totalPages={data.totalPages}
    totalItems={data.totalItems}
    searchParams={new URLSearchParams(data.pageQuery)}
  />
{/if}

<style>
  .borrow {
    margin: 0;
  }

  /* Action principale de la ligne : le libellé reste sur une ligne, pleine largeur sous 40 rem (app.css). */
  .borrow .btn {
    white-space: nowrap;
  }

  .catalogue-position {
    margin-block-start: 1rem;
    color: var(--ink-2);
    text-align: center;
  }
</style>
