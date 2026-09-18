<script lang="ts">
  /**
   * Pagination partagée par les listes paginées (catalogue, vente, retours,
   * mes prêts, journal) : liens Précédent/Suivant en <a>, sans JavaScript
   * requis. Tout paramètre de recherche déjà présent dans `searchParams` est
   * conservé dans les liens ; seul `pageParam` y est modifié ou retiré.
   */
  type Props = {
    page: number;
    totalPages: number;
    totalItems: number;
    searchParams?: URLSearchParams;
    pageParam?: string;
  };

  let {
    page,
    totalPages,
    totalItems,
    searchParams = new URLSearchParams(),
    pageParam = 'page'
  }: Props = $props();

  const hasPrevious = $derived(page > 1);
  const hasNext = $derived(page < totalPages);

  /** Lien vers `target`, filtres conservés ; page 1 omet le paramètre pour une URL plus courte. */
  function hrefFor(target: number): string {
    const params = new URLSearchParams(searchParams);
    if (target <= 1) {
      params.delete(pageParam);
    } else {
      params.set(pageParam, String(target));
    }
    const query = params.toString();
    return query ? `?${query}` : '?';
  }
</script>

{#if totalPages > 1}
  <nav class="pagination" aria-label="Pagination">
    {#if hasPrevious}
      <a class="pagination__link" href={hrefFor(page - 1)}>Précédent</a>
    {:else}
      <span class="pagination__link pagination__link--disabled" aria-disabled="true">Précédent</span>
    {/if}
    <span class="pagination__status">Page {page} sur {totalPages} — {totalItems} résultats</span>
    {#if hasNext}
      <a class="pagination__link" href={hrefFor(page + 1)}>Suivant</a>
    {:else}
      <span class="pagination__link pagination__link--disabled" aria-disabled="true">Suivant</span>
    {/if}
  </nav>
{/if}

<style>
  .pagination {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    margin-block-start: 1.5rem;
  }

  .pagination__status {
    color: var(--ink-2);
  }

  .pagination__link--disabled {
    color: var(--ink-2);
    opacity: 0.5;
  }
</style>
