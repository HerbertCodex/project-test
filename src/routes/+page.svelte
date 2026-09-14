<script lang="ts">
  import CatalogueTable from '$lib/components/CatalogueTable.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  const isBookseller = $derived(data.user?.role === 'bookseller');
</script>

<svelte:head>
  <title>Catalogue — Librairie</title>
</svelte:head>

<div class="page-head">
  <h1>Catalogue</h1>
  {#if isBookseller}
    <a class="btn btn--primary" href="/libraire/livres/nouveau">Ajouter un livre</a>
  {/if}
</div>

{#if !data.user}
  <div class="notice">
    <p>
      <strong>Connectez-vous pour emprunter.</strong>
      <a href="/connexion">Se connecter</a> ou <a href="/inscription">créer un compte</a>.
    </p>
  </div>
{/if}

{#if data.books.length === 0}
  <div class="empty">
    <p>Le catalogue ne contient encore aucun livre.</p>
    {#if isBookseller}
      <p><a href="/libraire/livres/nouveau">Ajouter un livre</a></p>
    {/if}
  </div>
{:else}
  <CatalogueTable books={data.books} />
{/if}
