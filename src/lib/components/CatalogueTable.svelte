<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { CatalogueEntry } from '$lib/server/catalogue';
  import LoanStatus from './LoanStatus.svelte';

  /**
   * Table du catalogue. Les colonnes sont nommées par classe (.col-title,
   * .col-author, .col-loan, .col-action ; à venir : .col-price, .col-sale).
   * - `filters` : emplacement au-dessus de la table (filtres de l'incrément 2) ;
   * - `action` : cellule de la colonne Action, rendue seulement si fournie.
   */
  type Props = {
    books: CatalogueEntry[];
    caption?: string;
    filters?: Snippet;
    action?: Snippet<[CatalogueEntry]>;
  };

  let {
    books,
    caption = 'Livres du catalogue et disponibilité au prêt',
    filters,
    action
  }: Props = $props();
</script>

{#if filters}
  <div class="catalogue-filters">
    {@render filters()}
  </div>
{/if}

<!-- Rôles explicites : l'affichage en grille sous 40 rem peut effacer la sémantique native. -->
<!-- svelte-ignore a11y_no_redundant_roles -->
<table class="data data--stack" role="table">
  <caption class="vh">{caption}</caption>
  <thead role="rowgroup">
    <tr role="row">
      <th class="col-title" scope="col" role="columnheader">Titre</th>
      <th class="col-author" scope="col" role="columnheader">Auteur</th>
      <th class="col-loan" scope="col" role="columnheader">Prêt</th>
      {#if action}
        <th class="col-action" scope="col" role="columnheader">Action</th>
      {/if}
    </tr>
  </thead>
  <tbody role="rowgroup">
    {#each books as book (book.id)}
      <tr role="row">
        <th class="col-title" scope="row" role="rowheader">{book.title}</th>
        <td class="col-author" role="cell">{book.author}</td>
        <td class="col-loan" role="cell"><LoanStatus status={book.status} /></td>
        {#if action}
          <td class="col-action" role="cell">{@render action(book)}</td>
        {/if}
      </tr>
    {/each}
  </tbody>
</table>
