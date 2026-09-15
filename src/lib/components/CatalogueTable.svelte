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

  /** Palette fixe des couvertures : la teinte vient de l'identifiant, jamais d'un style construit. */
  const COVER_TONES = ['cover--t1', 'cover--t2', 'cover--t3', 'cover--t4', 'cover--t5'] as const;

  function toneClass(id: number): string {
    return COVER_TONES[Math.abs(id) % COVER_TONES.length] ?? COVER_TONES[0];
  }
</script>

{#if filters}
  <div class="catalogue-filters">
    {@render filters()}
  </div>
{/if}

<!-- Rôles explicites : l'affichage en grille sous 40 rem peut effacer la sémantique native. -->
<!-- svelte-ignore a11y_no_redundant_roles -->
<table class="data data--stack catalogue" role="table">
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
        <th class="col-title" scope="row" role="rowheader">
          <span class="book">
            <!-- Couverture décorative : le titre y est interpolé en texte, masqué aux technologies d'assistance. -->
            <span class="cover {toneClass(book.id)}" aria-hidden="true"><span class="cover__title">{book.title}</span></span>
            <span class="book__title">{book.title}</span>
          </span>
        </th>
        <td class="col-author" role="cell">{book.author}</td>
        <td class="col-loan" role="cell"><LoanStatus status={book.status} /></td>
        {#if action}
          <td class="col-action" role="cell">{@render action(book)}</td>
        {/if}
      </tr>
    {/each}
  </tbody>
</table>

<style>
  .catalogue tbody th,
  .catalogue tbody td {
    padding-block: 1.25rem;
  }

  .catalogue .col-title {
    width: 46%;
  }

  .book {
    display: flex;
    align-items: center;
    gap: 1.25rem;
  }

  .book__title {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  /* Couverture typographique : reliure plus sombre à gauche, filet laiton intérieur. */
  .cover {
    position: relative;
    flex: none;
    display: flex;
    align-items: flex-end;
    width: 4.5rem;
    height: 6.5rem;
    padding: 0.625rem 0.5rem 0.625rem 0.875rem;
    overflow: hidden;
    border-radius: var(--radius);
    color: var(--ivory);
  }

  .cover::before {
    content: '';
    position: absolute;
    inset-block: 0;
    left: 0;
    width: 0.3125rem;
    background: rgb(0 0 0 / 0.3);
  }

  .cover::after {
    content: '';
    position: absolute;
    inset: 0.3125rem 0.3125rem 0.3125rem 0.5625rem;
    border: 1px solid var(--brass);
  }

  .cover__title {
    position: relative;
    display: -webkit-box;
    overflow: hidden;
    font-family: var(--serif);
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0;
    line-height: 1.15;
    overflow-wrap: anywhere;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 4;
  }

  /* Teintes profondes ; ratios de l'ivoire sur chacune listés dans app.css. */
  .cover--t1 {
    background: var(--ink);
  }

  .cover--t2 {
    background: #6b1f2a;
  }

  .cover--t3 {
    background: #1f3d2e;
  }

  .cover--t4 {
    background: #6a4318;
  }

  .cover--t5 {
    background: #3d3350;
  }

  .col-author {
    color: var(--ink-2);
  }

  .col-loan {
    white-space: nowrap;
  }

  @media (max-width: 40rem) {
    .catalogue .col-title {
      width: auto;
    }

    .catalogue tr {
      grid-template-columns: minmax(0, 1fr);
      gap: 0.375rem;
    }

    .catalogue tbody th,
    .catalogue tbody td {
      padding-block: 0;
    }

    /* Auteur, statut et action alignés sous le titre : couverture 3,75 rem + écart 1 rem. */
    .catalogue tbody td {
      padding-left: 4.75rem;
    }

    .book {
      gap: 1rem;
    }

    .cover {
      width: 3.75rem;
      height: 5.25rem;
      padding: 0.5rem 0.375rem 0.5rem 0.75rem;
    }
  }

  @media (forced-colors: active) {
    .cover {
      border: 1px solid CanvasText;
    }
  }
</style>
