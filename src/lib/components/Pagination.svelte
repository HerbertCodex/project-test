<script lang="ts">
  /**
   * Pagination partagée par les listes paginées (catalogue, vente, retours,
   * mes prêts, journal) : position dans la liste (« 26–50 sur 5 000 ») et
   * liens Précédent/Suivant en <a>, sans JavaScript requis. Tout paramètre de
   * recherche déjà présent dans `searchParams` est conservé dans les liens ;
   * seul `pageParam` y est modifié ou retiré.
   */
  type Props = {
    page: number;
    totalPages: number;
    totalItems: number;
    itemCount: number;
    pageSize?: number;
    searchParams?: URLSearchParams;
    pageParam?: string;
  };

  let {
    page,
    totalPages,
    totalItems,
    itemCount,
    pageSize = 25,
    searchParams = new URLSearchParams(),
    pageParam = 'page'
  }: Props = $props();

  const hasPrevious = $derived(page > 1);
  const hasNext = $derived(page < totalPages);
  const firstItem = $derived(itemCount === 0 ? 0 : (page - 1) * pageSize + 1);
  const lastItem = $derived((page - 1) * pageSize + itemCount);

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

{#if itemCount > 0}
  <p class="pagination__position">{firstItem}–{lastItem} sur {totalItems}</p>
{/if}

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

  .pagination__position {
    margin-block-start: 1rem;
    color: var(--ink-2);
    text-align: center;
  }

  .pagination__link--disabled {
    color: var(--ink-2);
    opacity: 0.5;
  }
</style>
