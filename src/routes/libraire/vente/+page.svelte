<script lang="ts">
  import type { SubmitFunction } from '@sveltejs/kit';
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import Pagination from '$lib/components/Pagination.svelte';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  type CounterAction = 'prix' | 'vendre' | 'reassortir';

  const onSaleCount = $derived(data.books.filter((book) => book.saleStatus === 'on-sale').length);
  const noPriceCount = $derived(data.books.filter((book) => book.priceCents === null).length);

  /** Position affichée de la page courante dans le total, par exemple « 26–50 sur 137 ». */
  const firstItem = $derived(data.books.length === 0 ? 0 : (data.page - 1) * data.pageSize + 1);
  const lastItem = $derived((data.page - 1) * data.pageSize + data.books.length);

  const counterError = $derived(form?.counterError ?? null);
  const errorBookId = $derived(counterError?.bookId ?? null);
  const errorBook = $derived(data.books.find((book) => book.id === errorBookId));
  const doneBookId = $derived(
    form?.sold?.bookId ?? form?.priced?.bookId ?? form?.restocked?.bookId ?? null
  );

  const ERROR_TITLES: Record<CounterAction, string> = {
    prix: 'Le prix n’a pas été modifié.',
    vendre: 'La vente n’a pas été enregistrée.',
    reassortir: 'Le stock n’a pas été modifié.'
  };

  /** Erreur de saisie portée par un champ précis d'une ligne. */
  function fieldError(action: CounterAction, bookId: number, field: string): string | undefined {
    if (
      counterError?.action === action &&
      counterError.bookId === bookId &&
      counterError.field === field
    ) {
      return counterError.message;
    }
    return undefined;
  }

  /** Valeur saisie réaffichée sur la ligne en erreur, sinon la valeur par défaut. */
  function fieldValue(action: CounterAction, bookId: number, fallback: string): string {
    if (counterError?.action === action && counterError.bookId === bookId) {
      return counterError.value;
    }
    return fallback;
  }

  function plural(count: number, one: string, many: string): string {
    return count > 1 ? many : one;
  }

  /** Formulaires en cours d'envoi (action et livre) ; un second envoi du même formulaire est ignoré. */
  let pendingForms: string[] = $state([]);

  function submitFor(action: CounterAction, bookId: number): SubmitFunction {
    const key = `${action}-${bookId}`;
    return ({ cancel }) => {
      if (pendingForms.includes(key)) {
        cancel();
        return;
      }
      pendingForms = [...pendingForms, key];
      return async ({ result, update }) => {
        await update();
        // Après un conflit (stock insuffisant, livre supprimé), la liste est rechargée.
        if (result.type === 'failure') await invalidateAll();
        pendingForms = pendingForms.filter((pending) => pending !== key);
      };
    };
  }
</script>

<svelte:head>
  <title>Vente au comptoir — Librairie</title>
</svelte:head>

<h1>Vente au comptoir</h1>
<p class="lead">Prix, ventes et réassort. Le stock n’est affiché qu’ici.</p>

<ul class="tally">
  <li class="tally__item">
    <span class="tally__value">{onSaleCount}</span> en vente
  </li>
  <li class="tally__item">
    <span class="tally__value">{noPriceCount}</span> sans prix
  </li>
</ul>

{#if form?.sold}
  <div class="notice notice--success" role="status">
    <strong class="notice__title">
      Vente enregistrée : {form.sold.quantity} × « {form.sold.title} », <span class="money">{form.sold.totalLabel}</span>.
    </strong>
    <p>Stock restant : {form.sold.remainingStock}.</p>
  </div>
{:else if form?.priced}
  <div class="notice notice--success" role="status">
    {#if form.priced.priceLabel}
      <strong class="notice__title">
        Prix enregistré : « {form.priced.title} », <span class="money">{form.priced.priceLabel}</span>.
      </strong>
    {:else}
      <strong class="notice__title">Prix retiré : « {form.priced.title} » n’est plus en vente.</strong>
    {/if}
  </div>
{:else if form?.restocked}
  <div class="notice notice--success" role="status">
    <strong class="notice__title">
      Stock mis à jour : « {form.restocked.title} », {form.restocked.saleStock}
      {plural(form.restocked.saleStock, 'exemplaire', 'exemplaires')}.
    </strong>
  </div>
{:else if counterError}
  <div class="notice notice--error" role="alert">
    <strong class="notice__title">{ERROR_TITLES[counterError.action]}</strong>
    <p>{#if errorBook}« {errorBook.title} » : {/if}{counterError.message}</p>
  </div>
{/if}

{#if data.books.length === 0}
  <div class="empty">
    <p>Aucun livre au catalogue.</p>
    <p><a href="/libraire/livres/nouveau">Ajouter un livre</a></p>
  </div>
{:else}
  <!-- Rôles explicites : l'affichage en grille sur petit écran peut effacer la sémantique native. -->
  <!-- svelte-ignore a11y_no_redundant_roles -->
  <table class="data ledger" role="table">
    <caption class="vh">Livres du catalogue : prix, stock de vente, vente et réassort</caption>
    <thead role="rowgroup">
      <tr role="row">
        <th class="col-title" scope="col" role="columnheader">Livre</th>
        <th scope="col" role="columnheader">Prix</th>
        <th scope="col" role="columnheader">Stock</th>
        <th scope="col" role="columnheader">Vendre</th>
        <th scope="col" role="columnheader">Réassort</th>
      </tr>
    </thead>
    <tbody role="rowgroup">
      {#each data.books as book (book.id)}
        {@const priceError = fieldError('prix', book.id, 'price')}
        {@const saleError = fieldError('vendre', book.id, 'quantity')}
        {@const stockError = fieldError('reassortir', book.id, 'quantity')}
        {@const pricePending = pendingForms.includes(`prix-${book.id}`)}
        {@const salePending = pendingForms.includes(`vendre-${book.id}`)}
        {@const stockPending = pendingForms.includes(`reassortir-${book.id}`)}
        <tr
          role="row"
          class:is-flagged={errorBookId === book.id}
          class:is-done={doneBookId === book.id}
        >
          <th class="col-title" scope="row" role="rowheader">
            {book.title}<span class="ledger__author">{book.author}</span>
          </th>

          <td role="cell">
            <span class="cell-label" aria-hidden="true">Prix</span>
            <form class="inline-form" method="POST" action="?/prix" use:enhance={submitFor('prix', book.id)}>
              <input type="hidden" name="bookId" value={book.id} />
              <label for="prix-{book.id}">Prix en euros<span class="vh"> de « {book.title} »</span></label>
              {#if priceError}
                <p class="field-error" id="prix-{book.id}-err">{priceError}</p>
              {/if}
              <div class="inline-form__row">
                <input
                  class="input--price"
                  id="prix-{book.id}"
                  name="price"
                  type="text"
                  inputmode="decimal"
                  autocomplete="off"
                  value={fieldValue('prix', book.id, book.priceInput)}
                  aria-invalid={priceError ? 'true' : undefined}
                  aria-describedby={priceError ? `prix-${book.id}-err` : undefined}
                />
                <button
                  class="btn"
                  type="submit"
                  name="intent"
                  value="fixer"
                  aria-busy={pricePending || undefined}
                  aria-disabled={pricePending || undefined}
                >
                  {pricePending ? 'Enregistrement…' : 'Enregistrer'}<span class="vh"> le prix de « {book.title} »</span>
                </button>
              </div>
              {#if book.priceCents !== null}
                <div>
                  <button class="btn-link" type="submit" name="intent" value="retirer">
                    Retirer le prix<span class="vh"> de « {book.title} »</span>
                  </button>
                </div>
              {/if}
            </form>
          </td>

          <td role="cell">
            <span class="cell-label" aria-hidden="true">Stock</span>
            <span class="ledger__stock">{book.saleStock}</span>
            {#if book.saleStock === 0}
              <span class="ledger__stock-note">Épuisé</span>
            {/if}
          </td>

          <td role="cell">
            <span class="cell-label" aria-hidden="true">Vendre</span>
            {#if book.priceCents === null}
              <p class="ledger__hint">Fixez un prix pour le vendre.</p>
            {:else if book.saleStock === 0}
              <p class="ledger__hint">Réassortez pour vendre.</p>
            {:else}
              <form class="inline-form" method="POST" action="?/vendre" use:enhance={submitFor('vendre', book.id)}>
                <input type="hidden" name="bookId" value={book.id} />
                <label for="qte-vente-{book.id}">
                  Quantité<span class="vh"> à vendre de « {book.title} »</span>
                </label>
                {#if saleError}
                  <p class="field-error" id="qte-vente-{book.id}-err">{saleError}</p>
                {/if}
                <div class="inline-form__row">
                  <input
                    id="qte-vente-{book.id}"
                    name="quantity"
                    type="text"
                    inputmode="numeric"
                    autocomplete="off"
                    value={fieldValue('vendre', book.id, '1')}
                    aria-invalid={saleError ? 'true' : undefined}
                    aria-describedby={saleError ? `qte-vente-${book.id}-err` : undefined}
                  />
                  <button
                    class="btn btn--primary"
                    type="submit"
                    aria-busy={salePending || undefined}
                    aria-disabled={salePending || undefined}
                  >
                    {salePending ? 'Vente en cours…' : 'Vendre'}<span class="vh"> « {book.title} »</span>
                  </button>
                </div>
              </form>
            {/if}
          </td>

          <td role="cell">
            <span class="cell-label" aria-hidden="true">Réassort</span>
            <form
              class="inline-form"
              method="POST"
              action="?/reassortir"
              use:enhance={submitFor('reassortir', book.id)}
            >
              <input type="hidden" name="bookId" value={book.id} />
              <label for="qte-stock-{book.id}">
                Exemplaires reçus<span class="vh"> de « {book.title} »</span>
              </label>
              {#if stockError}
                <p class="field-error" id="qte-stock-{book.id}-err">{stockError}</p>
              {/if}
              <div class="inline-form__row">
                <input
                  id="qte-stock-{book.id}"
                  name="quantity"
                  type="text"
                  inputmode="numeric"
                  autocomplete="off"
                  value={fieldValue('reassortir', book.id, '')}
                  aria-invalid={stockError ? 'true' : undefined}
                  aria-describedby={stockError ? `qte-stock-${book.id}-err` : undefined}
                />
                <button
                  class="btn"
                  type="submit"
                  aria-busy={stockPending || undefined}
                  aria-disabled={stockPending || undefined}
                >
                  {stockPending ? 'Enregistrement…' : 'Ajouter au stock'}<span class="vh"> de « {book.title} »</span>
                </button>
              </div>
            </form>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
  <p class="ledger-position">{firstItem}–{lastItem} sur {data.totalItems}</p>
  <Pagination page={data.page} totalPages={data.totalPages} totalItems={data.totalItems} />
{/if}

<style>
  /* Registre du comptoir : cinq colonnes sur la mesure pleine, grille sous 64 rem. */
  .ledger .col-title {
    width: 26%;
  }

  .ledger td {
    vertical-align: top;
  }

  .ledger-position {
    margin-block-start: 1rem;
    color: var(--ink-2);
    text-align: center;
  }

  .ledger tr.is-flagged {
    background: var(--danger-wash);
  }

  .ledger tr.is-done {
    background: var(--success-wash);
  }

  .ledger__author {
    display: block;
    margin-top: 0.25rem;
    color: var(--ink-2);
    font-family: var(--sans);
    font-size: 0.9375rem;
    font-weight: 400;
  }

  .ledger__stock {
    display: block;
    font-family: var(--serif);
    font-size: 2.25rem;
    font-weight: 500;
    font-variant-numeric: lining-nums tabular-nums;
    line-height: 1;
  }

  .ledger__stock-note {
    display: block;
    margin-top: 0.25rem;
    color: var(--ink-2);
    font-size: 0.8125rem;
    font-style: italic;
  }

  .ledger__hint {
    margin: 0;
    color: var(--ink-2);
    font-size: 0.875rem;
    font-style: italic;
  }

  .inline-form {
    display: grid;
    gap: 0.375rem;
    margin: 0;
  }

  .inline-form label {
    font-size: 0.8125rem;
    font-weight: 600;
  }

  .inline-form__row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }

  .inline-form input {
    width: 5.5rem;
    min-height: var(--control-height);
    padding: 0.5rem 0.625rem;
    border: 1px solid var(--rule-strong);
    border-radius: var(--radius);
    background: var(--ivory);
    color: var(--ink);
    font: inherit;
    font-size: 1rem;
    font-variant-numeric: tabular-nums;
  }

  .inline-form input.input--price {
    width: 7rem;
  }

  .inline-form input:hover {
    border-color: var(--ink);
  }

  .inline-form input[aria-invalid='true'] {
    border: 2px solid var(--danger);
  }

  .inline-form .btn {
    padding-inline: 1rem;
    white-space: nowrap;
  }

  @media (max-width: 64rem) {
    .ledger thead {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }

    .ledger,
    .ledger tbody {
      display: block;
    }

    .ledger tr {
      display: grid;
      grid-template-columns: minmax(0, 3fr) minmax(0, 1fr);
      gap: 1rem 1.5rem;
      padding: 1.25rem 0.5rem;
      border-bottom: 1px solid var(--rule);
    }

    .ledger th,
    .ledger td {
      padding: 0;
      border: 0;
    }

    .ledger .col-title {
      grid-column: 1 / -1;
      width: auto;
    }

    .ledger .cell-label {
      display: block;
      color: var(--ink-2);
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }
  }

  @media (max-width: 40rem) {
    .ledger tr {
      grid-template-columns: minmax(0, 1fr);
    }

    .inline-form input,
    .inline-form input.input--price {
      flex: 1 1 6rem;
    }

    .inline-form .btn {
      flex: 1 1 100%;
    }
  }

  @media (forced-colors: active) {
    .inline-form input {
      border: 2px solid CanvasText;
    }

    .ledger tr.is-flagged {
      outline: 2px solid CanvasText;
    }
  }
</style>
