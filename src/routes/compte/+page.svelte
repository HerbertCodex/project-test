<script lang="ts">
  import type { SubmitFunction } from '@sveltejs/kit';
  import { enhance } from '$app/forms';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  let password = $state('');
  let submitting = $state(false);

  const isBookseller = $derived(data.role === 'bookseller');
  // Seul le refus de mot de passe vient de la saisie : un prêt en cours ou un
  // blocage ne doivent pas marquer le champ en erreur.
  const passwordError = $derived(form?.passwordError ? form.message : undefined);

  function focusOnMount(node: HTMLElement) {
    node.focus();
  }

  function describedBy(...ids: (string | false | undefined)[]): string | undefined {
    const value = ids.filter(Boolean).join(' ');
    return value.length > 0 ? value : undefined;
  }

  const submit: SubmitFunction = ({ cancel }) => {
    if (submitting) {
      cancel();
      return;
    }
    submitting = true;
    return async ({ result, update }) => {
      if (result.type === 'failure' || result.type === 'error') password = '';
      await update({ reset: false });
      submitting = false;
    };
  };
</script>

<svelte:head>
  <title>Mon compte — Librairie</title>
</svelte:head>

<div class="page-head">
  <h1>Mon compte</h1>
</div>

<div class="account">
  {#if isBookseller}
    <p class="lead">
      Ce compte de libraire donne accès au comptoir de vente, aux retours et au journal de sécurité.
    </p>
  {:else}
    <p class="lead">
      Votre compte vous permet d’emprunter un livre du catalogue pendant 30 jours et de suivre vos
      prêts.
    </p>
  {/if}

  <dl class="account__facts">
    <div>
      <dt>Nom affiché</dt>
      <dd>{data.displayName}</dd>
    </div>
    {#if isBookseller}
      <div>
        <dt>Rôle</dt>
        <dd>Libraire</dd>
      </div>
    {/if}
    <div>
      <dt>Prêts en cours</dt>
      <dd>
        {#if data.hasActiveLoan}
          Au moins un — <a href="/mes-prets">voir mes prêts</a>
        {:else}
          Aucun
        {/if}
      </dd>
    </div>
  </dl>

  <section class="danger-zone" aria-labelledby="suppression">
    <p class="danger-zone__kicker">Action irréversible</p>
    <h2 id="suppression">Supprimer mon compte</h2>
    {#if isBookseller}
      <p>
        La suppression est définitive. Un nouveau compte de libraire ne peut être créé que par la
        commande locale d’administration.
      </p>
    {:else}
      <p>
        La suppression est définitive. Elle ne peut pas être annulée, et le libraire ne peut pas
        rétablir le compte.
      </p>
    {/if}

    {#if form?.message}
      {#key form}
        <div class="notice notice--error" role="alert" tabindex="-1" use:focusOnMount>
          <strong class="notice__title">Le compte n’a pas été supprimé.</strong>
          {#if passwordError}
            <p><a href="#password">{form.message}</a></p>
          {:else}
            <p>{form.message}</p>
          {/if}
          {#if data.hasActiveLoan}
            <p><a href="/mes-prets">Voir mes prêts en cours</a></p>
          {/if}
        </div>
      {/key}
    {:else if data.hasActiveLoan}
      <div class="notice">
        <strong class="notice__title">Suppression impossible pour l’instant.</strong>
        <p>
          Rendez vos livres à la librairie : le compte ne peut pas être supprimé tant qu’un prêt
          n’est pas rendu.
        </p>
      </div>
    {/if}

    <ul class="danger-zone__effects">
      <li><strong>Effacés :</strong> votre adresse e-mail et votre nom affiché.</li>
      {#if isBookseller}
        <li>
          <strong>Conservées sans votre nom :</strong> les ventes que vous avez enregistrées, qui
          restent au registre de la librairie sous une forme anonyme.
        </li>
        <li><strong>Perdu :</strong> votre accès au comptoir de vente, aux retours et au journal.</li>
      {:else}
        <li>
          <strong>Conservés sans votre nom :</strong> l’historique de vos prêts, qui reste dans les
          registres de la librairie sous une forme anonyme.
        </li>
      {/if}
      <li><strong>Fermées :</strong> toutes vos sessions, sur cet appareil comme sur les autres.</li>
      <li>
        <strong>Libérée :</strong> votre adresse e-mail, que vous pourrez réutiliser pour une
        nouvelle inscription.
      </li>
    </ul>

    <form class="form" method="POST" action="?/supprimer" use:enhance={submit}>
      <div class="field">
        <label for="password">Mot de passe</label>
        <p class="hint" id="password-hint">
          Saisissez votre mot de passe pour confirmer la suppression.
        </p>
        {#if passwordError}
          <p class="field-error" id="password-error">{passwordError}</p>
        {/if}
        <input
          id="password"
          name="password"
          type="password"
          autocomplete="current-password"
          required
          maxlength="256"
          bind:value={password}
          aria-invalid={passwordError ? 'true' : undefined}
          aria-describedby={describedBy('password-hint', passwordError && 'password-error')}
        />
      </div>

      <div>
        <!-- aria-disabled seulement : le refus d'un prêt en cours est appliqué
             par le serveur, et le bouton doit rester atteignable au clavier. -->
        <button
          class="btn btn--danger"
          type="submit"
          aria-busy={submitting || undefined}
          aria-disabled={submitting || data.hasActiveLoan || undefined}
        >
          {submitting ? 'Suppression en cours…' : 'Supprimer définitivement mon compte'}
        </button>
      </div>
    </form>
  </section>
</div>

<style>
  /* Page de lecture suivie d'une seule décision : colonne étroite du comptoir. */
  .account {
    max-width: var(--counter-measure);
  }

  /* Faits du compte : termes en petites capitales, comme les en-têtes de .data. */
  .account__facts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
    gap: 1.5rem 2rem;
    margin: 2rem 0 3rem;
    padding: 0 0 1.5rem;
    border-bottom: 1px solid var(--rule);
  }

  .account__facts > div {
    display: grid;
    gap: 0.25rem;
  }

  .account__facts dt {
    color: var(--ink-2);
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .account__facts dd {
    margin: 0;
    font-size: 1.125rem;
    /* Un nom affiché long ou sans espace ne doit jamais élargir la page. */
    overflow-wrap: anywhere;
  }

  /* Zone irréversible : grammaire de .auth__form, filet cramoisi au lieu du
     laiton. Le sur-titre porte le sens, la couleur ne fait que le redoubler. */
  .danger-zone {
    padding: 2rem 2.25rem;
    border-top: 2px solid var(--danger);
    border-radius: 0 0 var(--radius) var(--radius);
    background: var(--paper);
  }

  .danger-zone__kicker {
    margin: 0 0 0.5rem;
    color: var(--danger);
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  .danger-zone h2 {
    margin-bottom: 0.5rem;
  }

  .danger-zone .notice {
    margin-top: 1.25rem;
  }

  /* Effets de la suppression : losange laiton ornemental, comme .empty::before. */
  .danger-zone__effects {
    display: grid;
    gap: 0.625rem;
    margin: 0 0 1.75rem;
    padding: 0;
    list-style: none;
    color: var(--ink-2);
  }

  .danger-zone__effects li {
    position: relative;
    padding-left: 1.5rem;
  }

  .danger-zone__effects li::before {
    content: '';
    position: absolute;
    top: 0.6em;
    left: 0.125rem;
    width: 0.375rem;
    height: 0.375rem;
    background: var(--brass);
    transform: rotate(45deg);
  }

  .danger-zone__effects strong {
    color: var(--ink);
    font-weight: 600;
  }

  @media (max-width: 25rem) {
    .danger-zone {
      padding: 1.25rem;
    }
  }

  /* Contrastes forcés : le filet et le sur-titre doivent survivre. */
  @media (forced-colors: active) {
    .danger-zone {
      border: 2px solid CanvasText;
    }

    .danger-zone__kicker {
      text-decoration: underline;
    }
  }
</style>
