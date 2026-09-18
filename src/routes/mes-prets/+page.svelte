<script lang="ts">
  import Pagination from '$lib/components/Pagination.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  // Retards d'abord, puis échéance la plus proche (ordre du serveur conservé).
  const activeLoans = $derived([
    ...data.active.filter((loan) => loan.overdue),
    ...data.active.filter((loan) => !loan.overdue)
  ]);

  /** Position affichée de la page courante dans le total d'une section. */
  function firstItem(page: number, pageSize: number, count: number): number {
    return count === 0 ? 0 : (page - 1) * pageSize + 1;
  }
  function lastItem(page: number, pageSize: number, count: number): number {
    return (page - 1) * pageSize + count;
  }
</script>

<svelte:head>
  <title>Mes prêts — Librairie</title>
</svelte:head>

<div class="page-head">
  <h1>Mes prêts</h1>
</div>

<ul class="tally">
  <li class="tally__item">
    <span class="tally__value">{data.activePageInfo.totalItems}</span> en cours
  </li>
  <li class="tally__item" class:tally__item--alert={data.activeOverdueCount > 0}>
    <span class="tally__value">{data.activeOverdueCount}</span> en retard
  </li>
</ul>

<section aria-labelledby="en-cours">
  <h2 id="en-cours">En cours</h2>
  {#if activeLoans.length === 0}
    <div class="empty">
      <p>Vous n’avez aucun prêt en cours.</p>
      <p><a class="btn btn--primary" href="/">Parcourir le catalogue</a></p>
    </div>
  {:else}
    <!-- Rôles explicites : l'affichage en grille sous 40 rem peut effacer la sémantique native. -->
    <!-- svelte-ignore a11y_no_redundant_roles -->
    <table class="data data--stack" role="table">
      <caption class="vh">Prêts en cours, retards en premier</caption>
      <thead role="rowgroup">
        <tr role="row">
          <th class="col-title" scope="col" role="columnheader">Titre</th>
          <th scope="col" role="columnheader">Emprunté le</th>
          <th scope="col" role="columnheader">À rendre le</th>
          <th scope="col" role="columnheader">État</th>
        </tr>
      </thead>
      <tbody role="rowgroup">
        {#each activeLoans as loan (loan.id)}
          <tr role="row">
            <th class="col-title" scope="row" role="rowheader">{loan.title}</th>
            <td role="cell">
              <span class="cell-label" aria-hidden="true">Emprunté le</span>
              <time datetime={loan.borrowedOn.iso}>{loan.borrowedOn.label}</time>
            </td>
            <td role="cell">
              <span class="cell-label" aria-hidden="true">À rendre le</span>
              <strong><time datetime={loan.dueOn.iso}>{loan.dueOn.label}</time></strong>
            </td>
            <td role="cell">
              {#if loan.overdue}
                <span class="badge-overdue">En retard</span>
              {:else}
                <span class="lead">Dans les temps</span>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
    <p class="section-position">
      {firstItem(data.activePageInfo.page, data.activePageInfo.pageSize, activeLoans.length)}–{lastItem(
        data.activePageInfo.page,
        data.activePageInfo.pageSize,
        activeLoans.length
      )} sur {data.activePageInfo.totalItems}
    </p>
    <Pagination
      page={data.activePageInfo.page}
      totalPages={data.activePageInfo.totalPages}
      totalItems={data.activePageInfo.totalItems}
      searchParams={new URLSearchParams(data.activePageQuery)}
      pageParam="pageActifs"
    />
  {/if}
</section>

<section aria-labelledby="rendus">
  <h2 id="rendus">Rendus</h2>
  {#if data.returned.length === 0}
    <p>Aucun prêt rendu pour le moment.</p>
  {:else}
    <!-- svelte-ignore a11y_no_redundant_roles -->
    <table class="data data--stack" role="table">
      <caption class="vh">Prêts rendus, du plus récent au plus ancien</caption>
      <thead role="rowgroup">
        <tr role="row">
          <th class="col-title" scope="col" role="columnheader">Titre</th>
          <th scope="col" role="columnheader">Emprunté le</th>
          <th scope="col" role="columnheader">Rendu le</th>
        </tr>
      </thead>
      <tbody role="rowgroup">
        {#each data.returned as loan (loan.id)}
          <tr role="row">
            <th class="col-title" scope="row" role="rowheader">{loan.title}</th>
            <td role="cell">
              <span class="cell-label" aria-hidden="true">Emprunté le</span>
              <time datetime={loan.borrowedOn.iso}>{loan.borrowedOn.label}</time>
            </td>
            <td role="cell">
              <span class="cell-label" aria-hidden="true">Rendu le</span>
              <time datetime={loan.returnedOn.iso}>{loan.returnedOn.label}</time>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
    <p class="section-position">
      {firstItem(data.returnedPageInfo.page, data.returnedPageInfo.pageSize, data.returned.length)}–{lastItem(
        data.returnedPageInfo.page,
        data.returnedPageInfo.pageSize,
        data.returned.length
      )} sur {data.returnedPageInfo.totalItems}
    </p>
    <Pagination
      page={data.returnedPageInfo.page}
      totalPages={data.returnedPageInfo.totalPages}
      totalItems={data.returnedPageInfo.totalItems}
      searchParams={new URLSearchParams(data.returnedPageQuery)}
      pageParam="pageRendus"
    />
  {/if}
</section>

<style>
  /* Sections « En cours » et « Rendus » séparées par l'espace, sans carte. */
  section + section {
    margin-top: 3.5rem;
  }

  /* « Dans les temps » : gris bleuté de .lead, au corps du tableau. */
  td .lead {
    font-size: 0.9375rem;
  }

  /* État vide des prêts rendus : phrase simple en gris bleuté. */
  h2 + p {
    color: var(--ink-2);
  }

  .section-position {
    margin-block-start: 1rem;
    color: var(--ink-2);
    text-align: center;
  }
</style>
