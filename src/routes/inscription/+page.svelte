<script lang="ts">
  import type { SubmitFunction } from '@sveltejs/kit';
  import { enhance } from '$app/forms';
  import type { PageProps } from './$types';

  let { form }: PageProps = $props();

  let password = $state('');
  let submitting = $state(false);

  type Field = 'email' | 'displayName' | 'password';
  const errors: Partial<Record<Field, string>> = $derived(form?.errors ?? {});
  const hasErrors = $derived(Object.keys(errors).length > 0);

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
  <title>Créer un compte — Librairie</title>
</svelte:head>

<div class="auth">
  <div>
    <h1>Créer un compte</h1>
    <p class="lead">
      Un compte emprunteur permet d’emprunter un livre du catalogue pendant 30 jours et de suivre
      vos prêts.
    </p>
    <p>Déjà inscrit ? <a href="/connexion">Se connecter</a></p>
  </div>

  <form class="form auth__form" method="POST" use:enhance={submit}>
    {#if hasErrors}
      {#key form}
        <div class="notice notice--error" role="alert" tabindex="-1" use:focusOnMount>
          <strong class="notice__title">Le compte n’a pas été créé.</strong>
          <ul>
            {#if errors.email}<li><a href="#email">{errors.email}</a></li>{/if}
            {#if errors.displayName}<li><a href="#displayName">{errors.displayName}</a></li>{/if}
            {#if errors.password}<li><a href="#password">{errors.password}</a></li>{/if}
          </ul>
        </div>
      {/key}
    {/if}

    <div class="field">
      <label for="email">Adresse e-mail</label>
      {#if errors.email}
        <p class="field-error" id="email-error">
          {errors.email}
          {#if form?.emailTaken}<a href="/connexion">Se connecter</a>{/if}
        </p>
      {/if}
      <input
        id="email"
        name="email"
        type="email"
        autocomplete="email"
        required
        maxlength="254"
        defaultValue={form?.email ?? ''}
        aria-invalid={errors.email ? 'true' : undefined}
        aria-describedby={describedBy(errors.email && 'email-error')}
      />
    </div>

    <div class="field">
      <label for="displayName">Nom affiché</label>
      <p class="hint" id="displayName-hint">Visible par le libraire lors de vos prêts.</p>
      {#if errors.displayName}
        <p class="field-error" id="displayName-error">{errors.displayName}</p>
      {/if}
      <input
        id="displayName"
        name="displayName"
        type="text"
        autocomplete="name"
        required
        maxlength="80"
        defaultValue={form?.displayName ?? ''}
        aria-invalid={errors.displayName ? 'true' : undefined}
        aria-describedby={describedBy('displayName-hint', errors.displayName && 'displayName-error')}
      />
    </div>

    <div class="field">
      <label for="password">Mot de passe</label>
      <p class="hint" id="password-hint">Entre 12 et 256 caractères.</p>
      {#if errors.password}
        <p class="field-error" id="password-error">{errors.password}</p>
      {/if}
      <input
        id="password"
        name="password"
        type="password"
        autocomplete="new-password"
        required
        minlength="12"
        maxlength="256"
        bind:value={password}
        aria-invalid={errors.password ? 'true' : undefined}
        aria-describedby={describedBy('password-hint', errors.password && 'password-error')}
      />
    </div>

    <div>
      <button
        class="btn btn--primary"
        type="submit"
        aria-busy={submitting || undefined}
        aria-disabled={submitting || undefined}
      >
        {submitting ? 'Création du compte…' : 'Créer mon compte'}
      </button>
    </div>
  </form>
</div>
