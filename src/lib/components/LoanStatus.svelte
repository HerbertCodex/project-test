<script lang="ts">
  import type { BookLoanStatus } from '$lib/server/catalogue';

  let { status }: { status: BookLoanStatus } = $props();
</script>

{#if status === 'available'}
  <span class="status status--available">Disponible</span>
{:else}
  <span class="status status--borrowed">Emprunté</span>
{/if}
