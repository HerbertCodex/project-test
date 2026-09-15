<script lang="ts">
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  const overdueCount = $derived(data.active.filter((loan) => loan.overdue).length);
  // Retards d'abord, puis échéance la plus proche (ordre du serveur conservé).
  const activeLoans = $derived([
    ...data.active.filter((loan) => loan.overdue),
    ...data.active.filter((loan) => !loan.overdue)
  ]);
</script>

<svelte:head>
  <title>Mes prêts — Librairie</title>
</svelte:head>

<div class="page-head">
  <h1>Mes prêts</h1>
</div>

<ul class="tally">
  <li class="tally__item">
    <span class="tally__value">{data.active.length}</span> en cours
  </li>
  <li class="tally__item" class:tally__item--alert={overdueCount > 0}>
    <span class="tally__value">{overdueCount}</span> en retard
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
</style>
