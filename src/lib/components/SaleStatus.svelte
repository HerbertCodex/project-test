<script lang="ts">
  import type { BookSaleStatus } from '$lib/server/catalogue';

  /**
   * Repère de vente, distinct de LoanStatus : autre domaine, autres libellés, et les
   * deux repères se côtoient sur la même ligne. Même structure (texte porteur, forme
   * en ::before), mais un losange au lieu d'une pastille pour ne pas les confondre.
   * N'affiche jamais de stock chiffré : seulement « En vente » ou « Épuisé ».
   */
  let { status }: { status: BookSaleStatus } = $props();
</script>

{#if status === 'on-sale'}
  <span class="sale-status sale-status--on">En vente</span>
{:else}
  <span class="sale-status sale-status--off">Épuisé</span>
{/if}

<style>
  /* Le texte porte l'état ; le losange (plein, vide) le double, jamais la couleur seule. */
  .sale-status {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.9375rem;
  }

  .sale-status::before {
    content: '';
    flex: none;
    width: 0.5625rem;
    height: 0.5625rem;
    border: 2px solid currentColor;
    transform: rotate(45deg);
  }

  .sale-status--on {
    color: var(--ink);
    font-weight: 600;
  }

  .sale-status--on::before {
    background: var(--ink);
  }

  .sale-status--off {
    color: var(--ink-2);
    font-style: italic;
  }

  /* Après les règles ::before : même spécificité une fois scopé, l'ordre fait gagner la forme. */
  @media (forced-colors: active) {
    .sale-status::before {
      border-color: CanvasText;
    }

    .sale-status--on::before {
      forced-color-adjust: none;
      background: CanvasText;
    }
  }
</style>
