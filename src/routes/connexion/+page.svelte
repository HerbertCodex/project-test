<script lang="ts">
  import type { SubmitFunction } from '@sveltejs/kit';
  import { enhance } from '$app/forms';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  let password = $state('');
  let submitting = $state(false);

  function focusOnMount(node: HTMLElement) {
    node.focus();
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
  <title>Connexion — Librairie</title>
</svelte:head>

<div class="auth">
  <div>
    <h1>Se connecter</h1>
    <p class="lead">Connectez-vous pour emprunter un livre et suivre vos prêts.</p>
    <p>Pas encore de compte ? <a href="/inscription">Créer un compte</a></p>
  </div>

  <form class="form auth__form" method="POST" use:enhance={submit}>
    {#if form?.message}
      {#key form}
        <div class="notice notice--error" role="alert" tabindex="-1" use:focusOnMount>
          <strong class="notice__title">Connexion impossible.</strong>
          <p>{form.message}</p>
        </div>
      {/key}
    {:else if data.accountCreated}
      <div class="notice notice--success" role="status">
        <strong class="notice__title">Compte créé.</strong>
        <p>Vous pouvez maintenant vous connecter.</p>
      </div>
    {/if}

    <div class="field">
      <label for="email">Adresse e-mail</label>
      <input
        id="email"
        name="email"
        type="email"
        autocomplete="username"
        required
        maxlength="254"
        defaultValue={form?.email ?? ''}
      />
    </div>

    <div class="field">
      <label for="password">Mot de passe</label>
      <input
        id="password"
        name="password"
        type="password"
        autocomplete="current-password"
        required
        maxlength="256"
        bind:value={password}
      />
    </div>

    <div>
      <button
        class="btn btn--primary"
        type="submit"
        aria-busy={submitting || undefined}
        aria-disabled={submitting || undefined}
      >
        {submitting ? 'Connexion…' : 'Se connecter'}
      </button>
    </div>
  </form>
</div>
