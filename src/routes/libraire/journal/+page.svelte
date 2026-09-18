<script lang="ts">
  import Pagination from '$lib/components/Pagination.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  /** Position affichée de la page courante dans le total, par exemple « 26–50 sur 137 ». */
  const firstItem = $derived(
    data.events.length === 0 ? 0 : (data.page - 1) * data.pageSize + 1
  );
  const lastItem = $derived((data.page - 1) * data.pageSize + data.events.length);
</script>

<svelte:head>
  <title>Journal — Librairie</title>
</svelte:head>

<h1>Journal de sécurité</h1>

<p class="lead">
  Les événements de connexion et d’accès, du plus récent au plus ancien. Page en lecture seule ;
  les événements de plus d’un an sont effacés.
</p>

{#if data.events.length === 0}
  <div class="empty">
    <p>Aucun événement enregistré.</p>
    <p>
      Les connexions, les échecs, les blocages, les inscriptions et les refus d’accès apparaîtront
      ici dès qu’ils se produiront.
    </p>
  </div>
{:else}
  <!-- Rôles explicites : l'affichage en grille sous 40 rem peut effacer la sémantique native. -->
  <!-- svelte-ignore a11y_no_redundant_roles -->
  <table class="data data--stack journal" role="table">
    <caption class="vh">Événements de sécurité, du plus récent au plus ancien</caption>
    <thead role="rowgroup">
      <tr role="row">
        <th class="col-event" scope="col" role="columnheader">Événement</th>
        <th class="col-when" scope="col" role="columnheader">Date et heure</th>
        <th scope="col" role="columnheader">Compte</th>
        <th class="col-subject" scope="col" role="columnheader">Détail</th>
      </tr>
    </thead>
    <tbody role="rowgroup">
      {#each data.events as event (event.id)}
        <tr role="row">
          <th class="col-event" scope="row" role="rowheader">{event.label}</th>
          <td class="col-when" role="cell">
            <span class="cell-label" aria-hidden="true">Date et heure</span>
            <time datetime={event.when.iso}>{event.when.label}</time>
          </td>
          <td role="cell">
            <span class="cell-label" aria-hidden="true">Compte</span>
            {#if event.userName === null}
              <!-- Tiret doublé d'un texte : une cellule vide disparaîtrait sous 40 rem. -->
              <span aria-hidden="true">—</span><span class="vh">Aucun compte</span>
            {:else}
              {event.userName}
            {/if}
          </td>
          <td class="col-subject" role="cell">
            <span class="cell-label" aria-hidden="true">Détail</span>
            {#if event.subject === null}
              <span aria-hidden="true">—</span><span class="vh">Aucun détail</span>
            {:else}
              {event.subject}
            {/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
  <p class="journal-position">{firstItem}–{lastItem} sur {data.totalItems}</p>
  <Pagination page={data.page} totalPages={data.totalPages} totalItems={data.totalItems} />
{/if}

<style>
  /* Le libellé d'événement est l'en-tête de ligne, mais pas un titre d'ouvrage :
     Inter 600 plutôt que le serif de .col-title. */
  .journal tbody th.col-event {
    font-family: var(--sans);
    font-size: 1rem;
    font-weight: 600;
  }

  /* Horodatage : jamais coupé (chiffres tabulaires déjà portés par <time>). */
  .journal .col-when {
    white-space: nowrap;
  }

  /* Détail (e-mail tenté, chemin) : secondaire, coupé plutôt qu'élargissant. */
  .journal .col-subject {
    color: var(--ink-2);
    overflow-wrap: anywhere;
  }

  @media (max-width: 40rem) {
    /* Même traitement que .col-title : l'en-tête de ligne prend la largeur. */
    .journal.data--stack tbody th.col-event {
      grid-column: 1 / -1;
    }
  }

  .journal-position {
    margin-block-start: 1rem;
    color: var(--ink-2);
    text-align: center;
  }
</style>
