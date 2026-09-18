import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import Layout from '../../+layout.svelte';
import SupprimePage from './+page.svelte';

// `page` de $app/state lit le contexte de requête que SvelteKit pose pendant le
// rendu d'une vraie requête. Hors serveur, le test fournit l'URL courante, seule
// entrée dont dépend `current()` dans la mise en page.
const currentPage = vi.hoisted(() => ({ url: new URL('http://localhost/') }));

vi.mock('$app/state', () => ({
  page: {
    get url() {
      return currentPage.url;
    }
  }
}));

type NavUser = { displayName: string; role: 'borrower' | 'bookseller' } | null;

const here = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

const pageSource = readFileSync(here('./+page.svelte'), 'utf8');

function renderConfirmation(): string {
  return render(SupprimePage).body;
}

/** Rend la mise en page avec un contenu factice, à l'URL demandée. */
function renderLayout(user: NavUser, pathname = '/compte'): string {
  currentPage.url = new URL(pathname, 'http://localhost');
  const children = createRawSnippet(() => ({ render: () => '<p>Contenu de test</p>' }));
  return render(Layout, { props: { data: { user }, children } as never }).body;
}

/** Extrait la navigation principale, pour ne pas confondre un lien du contenu. */
function nav(body: string): string {
  const match = /<nav class="site-nav"[\s\S]*?<\/nav>/.exec(body);
  if (!match) throw new Error('Navigation principale absente du rendu.');
  return match[0];
}

describe('rendu de /compte/supprime', () => {
  it('confirme la suppression et énonce ce qui reste, sans rien du compte disparu', () => {
    const body = renderConfirmation();

    expect(body).toContain('Votre compte est supprimé.');
    expect(body).toContain('Votre session a été fermée sur tous vos appareils.');
    expect(body).toContain('Ce qui a été effacé');
    expect(body).toContain('Ce qui reste, sans votre nom');
    expect(body).toContain('Votre adresse e-mail est de nouveau libre.');
    expect(body).toMatch(/class="empty[\s"]/);
    expect(body).toContain('href="/"');
    expect(body).toContain('href="/inscription"');
  });

  it('n’offre aucun formulaire, aucune soumission ni aucun champ à forger', () => {
    const body = renderConfirmation();

    expect(body).not.toContain('<form');
    expect(body).not.toContain('<button');
    expect(body).not.toContain('<input');
    expect(body).not.toContain('method="POST"');
    expect(body).not.toContain('action=');
  });

  it('n’expose aucun module serveur : la route ne peut porter aucune action', () => {
    const entries = readdirSync(here('.'));

    // Sans +page.server.ts ni +server.ts, SvelteKit refuse tout POST vers la route.
    expect(entries).toContain('+page.svelte');
    expect(entries.filter((name) => name.endsWith('.server.ts'))).toEqual([]);
    expect(entries).not.toContain('+server.ts');
  });

  it('ne lit rien de l’URL ni du chargement de page', () => {
    // Sans bloc <script>, la page n'a ni props, ni état, ni accès au routeur.
    expect(pageSource).not.toContain('<script');
    expect(pageSource).not.toContain('$app/state');
    expect(pageSource).not.toContain('$app/stores');
    expect(pageSource).not.toContain('$props()');
    expect(pageSource).not.toMatch(/\bsearchParams\b/);
    expect(pageSource).not.toMatch(/\bdata\./);
  });

  it('prolonge la direction existante sans {@html}, ni police ni jeton nouveau', () => {
    expect(pageSource).not.toContain('{@html');
    expect(pageSource).not.toContain('@font-face');
    expect(pageSource).not.toMatch(/font-family:/);
    // Aucune déclaration de jeton : les couleurs viennent d'app.css.
    expect(pageSource).not.toMatch(/^\s*--[\w-]+:/m);
  });
});

describe('lien « Mon compte » dans la navigation principale', () => {
  it('l’affiche à un emprunteur connecté, en dernière position', () => {
    const menu = nav(renderLayout({ displayName: 'Lecteur', role: 'borrower' }, '/mes-prets'));

    expect(menu).toContain('Mon compte');
    expect(menu).toContain('href="/compte"');
    expect(menu.indexOf('/mes-prets')).toBeLessThan(menu.indexOf('/compte'));
  });

  it('l’affiche aussi à un libraire connecté, après « Journal »', () => {
    const menu = nav(renderLayout({ displayName: 'Jeanne', role: 'bookseller' }, '/libraire/vente'));

    expect(menu).toContain('Mon compte');
    expect(menu).toContain('href="/compte"');
    expect(menu.indexOf('/libraire/journal')).toBeLessThan(menu.indexOf('href="/compte"'));
  });

  it('marque aria-current="page" sur /compte, pour les deux rôles', () => {
    for (const user of [
      { displayName: 'Lecteur', role: 'borrower' },
      { displayName: 'Jeanne', role: 'bookseller' }
    ] as const) {
      const menu = nav(renderLayout(user, '/compte'));

      expect(menu).toMatch(/<a href="\/compte"[^>]*aria-current="page"/);
      // La page courante est la seule marquée : le catalogue ne l'est pas.
      expect(menu.match(/aria-current="page"/g)).toHaveLength(1);
    }
  });

  it('ne le marque pas sur une autre page, sans le retirer de la navigation', () => {
    const menu = nav(renderLayout({ displayName: 'Lecteur', role: 'borrower' }, '/mes-prets'));

    expect(menu).toContain('href="/compte"');
    expect(menu).not.toMatch(/<a href="\/compte"[^>]*aria-current/);
  });

  it('ne l’affiche pas à un visiteur anonyme, y compris sur /compte/supprime', () => {
    const anonymous = nav(renderLayout(null, '/compte/supprime'));

    expect(anonymous).not.toContain('Mon compte');
    expect(anonymous).not.toContain('href="/compte"');
    expect(anonymous).toContain('href="/connexion"');
    expect(anonymous).toContain('href="/inscription"');
  });
});
