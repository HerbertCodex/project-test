<script lang="ts">
  import type { BookLoanStatus } from '$lib/server/catalogue';

  let { status }: { status: BookLoanStatus } = $props();
</script>

{#if status === 'available'}
  <span class="status status--available">Disponible</span>
{:else}
  <span class="status status--borrowed">Emprunté</span>
{/if}

<style>
  /* Le texte porte le statut ; la forme (pastille pleine, anneau vide) le double, jamais la couleur seule. */
  .status {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.9375rem;
  }

  .status::before {
    content: '';
    flex: none;
    width: 0.625rem;
    height: 0.625rem;
    border: 2px solid currentColor;
    border-radius: 50%;
  }

  .status--available {
    color: var(--ink);
    font-weight: 600;
  }

  .status--available::before {
    border-color: var(--success);
    background: var(--success);
  }

  .status--borrowed {
    color: var(--ink-2);
    font-style: italic;
  }

  /* Après les règles ::before : même spécificité une fois scopé, l'ordre fait gagner la forme. */
  @media (forced-colors: active) {
    .status::before {
      border-color: CanvasText;
    }

    .status--available::before {
      forced-color-adjust: none;
      background: CanvasText;
    }
  }
</style>
