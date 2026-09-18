<script lang="ts">
  import '$lib/styles/app.css';
  import { page } from '$app/state';
  import type { LayoutProps } from './$types';

  let { data, children }: LayoutProps = $props();

  const isBookseller = $derived(data.user?.role === 'bookseller');

  function current(href: string): 'page' | undefined {
    return page.url.pathname === href ? 'page' : undefined;
  }
</script>

<a class="skip-link" href="#contenu">Aller au contenu</a>

<header class="site-header" class:site-header--libraire={isBookseller}>
  <div class="site-header__inner">
    <a class="site-brand" href="/">
      <span class="site-brand__name">Librairie</span>
      {#if isBookseller}
        <span class="site-brand__tag">Espace libraire</span>
      {/if}
    </a>

    <nav class="site-nav" aria-label="Navigation principale">
      <ul>
        <li><a href="/" aria-current={current('/')}>Catalogue</a></li>
        {#if !data.user}
          <li><a href="/connexion" aria-current={current('/connexion')}>Se connecter</a></li>
          <li><a href="/inscription" aria-current={current('/inscription')}>Créer un compte</a></li>
        {:else if isBookseller}
          <li>
            <a href="/libraire/livres/nouveau" aria-current={current('/libraire/livres/nouveau')}>
              Ajouter un livre
            </a>
          </li>
          <li><a href="/libraire/vente" aria-current={current('/libraire/vente')}>Vente</a></li>
          <li><a href="/libraire/retours" aria-current={current('/libraire/retours')}>Retours</a></li>
          <li><a href="/libraire/journal" aria-current={current('/libraire/journal')}>Journal</a></li>
        {:else}
          <li><a href="/mes-prets" aria-current={current('/mes-prets')}>Mes prêts</a></li>
        {/if}
      </ul>
    </nav>

    {#if data.user}
      <div class="site-account">
        <span class="site-account__name">
          {#if isBookseller}Libraire : {/if}{data.user.displayName}
        </span>
        <form method="POST" action="/deconnexion">
          <button class="btn-link" type="submit">Se déconnecter</button>
        </form>
      </div>
    {/if}
  </div>
</header>

<main id="contenu" class="page" tabindex="-1">
  {@render children()}
</main>
