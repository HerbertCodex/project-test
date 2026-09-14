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
  .status {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
  }

  .status::before {
    content: '';
    width: 0.9rem;
    height: 0.9rem;
    border: 2px solid var(--ink);
  }

  .status--available {
    font-weight: 800;
  }

  .status--available::before {
    background: var(--accent);
  }

  .status--borrowed {
    color: var(--ink-2);
  }

  /* Après .status::before : même spécificité une fois scopé, l'ordre fait gagner la bordure. */
  @media (forced-colors: active) {
    .status--available::before {
      border: 2px solid CanvasText;
    }
  }
</style>
