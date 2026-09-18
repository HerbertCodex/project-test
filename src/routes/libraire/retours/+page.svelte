<script lang="ts">
  import type { SubmitFunction } from '@sveltejs/kit';
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import Pagination from '$lib/components/Pagination.svelte';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  const overdueCount = $derived(data.loans.filter((loan) => loan.overdue).length);

  /** Position affichée de la page courante dans le total, par exemple « 26–50 sur 137 ». */
  const firstItem = $derived(data.loans.length === 0 ? 0 : (data.page - 1) * data.pageSize + 1);
  const lastItem = $derived((data.page - 1) * data.pageSize + data.loans.length);

  /** Prêts dont le retour est en cours d'envoi ; un second envoi de la même ligne est ignoré. */
  let pendingLoanIds: string[] = $state([]);

  const submit: SubmitFunction = ({ formData, cancel }) => {
    const loanId = String(formData.get('loanId'));
    if (pendingLoanIds.includes(loanId)) {
      cancel();
      return;
    }
    pendingLoanIds = [...pendingLoanIds, loanId];
    return async ({ result, update }) => {
      await update();
      // Après une erreur (prêt déjà rendu), la liste est rechargée.
      if (result.type === 'failure') await invalidateAll();
      pendingLoanIds = pendingLoanIds.filter((id) => id !== loanId);
    };
  };
</script>

<svelte:head>
  <title>Retours — Librairie</title>
</svelte:head>

<div class="counter">
  <h1>Retours</h1>

  <ul class="tally">
    <li class="tally__item">
      <span class="tally__value">{data.loans.length}</span> en cours
    </li>
    <li class="tally__item" class:tally__item--alert={overdueCount > 0}>
      <span class="tally__value">{overdueCount}</span> en retard
    </li>
  </ul>

  {#if form?.returned}
    <div class="notice notice--success" role="status">
      <strong class="notice__title">Retour enregistré : « {form.returned.title} », {form.returned.borrowerName}.</strong>
    </div>
  {:else if form?.returnError}
    <div class="notice notice--error" role="alert">
      <strong class="notice__title">Le retour n’a pas été enregistré.</strong>
      <p>{form.returnError}</p>
    </div>
  {/if}

  {#if data.loans.length === 0}
    <div class="empty">
      <p>Aucun prêt en cours.</p>
    </div>
  {:else}
    <!-- Rôles explicites : l'affichage en grille sous 40 rem peut effacer la sémantique native. -->
    <!-- svelte-ignore a11y_no_redundant_roles -->
    <table class="data data--stack" role="table">
      <caption class="vh">Prêts en cours par échéance, retards en tête</caption>
      <thead role="rowgroup">
        <tr role="row">
          <th class="col-title" scope="col" role="columnheader">Titre</th>
          <th scope="col" role="columnheader">Emprunteur</th>
          <th scope="col" role="columnheader">À rendre le</th>
          <th class="col-action" scope="col" role="columnheader">Retour</th>
        </tr>
      </thead>
      <tbody role="rowgroup">
        {#each data.loans as loan (loan.id)}
          {@const pending = pendingLoanIds.includes(String(loan.id))}
          <tr role="row">
            <th class="col-title" scope="row" role="rowheader">{loan.title}</th>
            <td role="cell">
              <span class="cell-label" aria-hidden="true">Emprunteur</span>
              {loan.borrowerName}
            </td>
            <td role="cell">
              <span class="cell-label" aria-hidden="true">À rendre le</span>
              <strong><time datetime={loan.dueOn.iso}>{loan.dueOn.label}</time></strong>
              {#if loan.overdue}
                <span class="badge-overdue">En retard</span>
              {/if}
            </td>
            <td class="col-action" role="cell">
              <form method="POST" use:enhance={submit}>
                <input type="hidden" name="loanId" value={loan.id} />
                <button
                  class="btn btn--primary btn--counter"
                  type="submit"
                  aria-busy={pending || undefined}
                  aria-disabled={pending || undefined}
                >
                  {pending ? 'Enregistrement…' : 'Enregistrer le retour'}<span class="vh"> « {loan.title} »</span>
                </button>
              </form>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
    <p class="counter-position">{firstItem}–{lastItem} sur {data.totalItems}</p>
    <Pagination page={data.page} totalPages={data.totalPages} totalItems={data.totalItems} />
  {/if}
</div>

<style>
  /* Bouton de retour à droite de la ligne, libellé sur une ligne ; pleine largeur sous 40 rem (app.css). */
  .col-action .btn {
    white-space: nowrap;
  }

  .counter-position {
    margin-block-start: 1rem;
    color: var(--ink-2);
    text-align: center;
  }
</style>
