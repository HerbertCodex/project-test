<script lang="ts">
  import type { SubmitFunction } from '@sveltejs/kit';
  import { enhance } from '$app/forms';
  import type { PageProps } from './$types';

  let { form }: PageProps = $props();

  let submitting = $state(false);
  let titleInput: HTMLInputElement | undefined = $state();

  type Field = 'title' | 'author';
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
      await update();
      submitting = false;
      // Saisie enchaînable : le formulaire est vidé et le focus revient sur Titre.
      if (result.type === 'success') titleInput?.focus();
    };
  };
</script>

<svelte:head>
  <title>Ajouter un livre — Librairie</title>
</svelte:head>

<div class="counter">
  <h1>Ajouter un livre</h1>
  <p class="lead">Un exemplaire par titre. Le livre apparaît « Disponible » au catalogue.</p>

  <form class="form" method="POST" use:enhance={submit}>
    {#if hasErrors}
      {#key form}
        <div class="notice notice--error" role="alert" tabindex="-1" use:focusOnMount>
          <strong class="notice__title">Le livre n’a pas été ajouté.</strong>
          <ul>
            {#if errors.title}<li><a href="#title">{errors.title}</a></li>{/if}
            {#if errors.author}<li><a href="#author">{errors.author}</a></li>{/if}
          </ul>
        </div>
      {/key}
    {:else if form?.added}
      <div class="notice notice--success" role="status">
        <strong class="notice__title">Livre ajouté.</strong>
        <p>« {form.added.title} » de {form.added.author} est disponible au catalogue.</p>
      </div>
    {/if}

    <div class="field">
      <label for="title">Titre</label>
      <p class="hint" id="title-hint">Entre 1 et 200 caractères.</p>
      {#if errors.title}
        <p class="field-error" id="title-error">{errors.title}</p>
      {/if}
      <input
        id="title"
        name="title"
        type="text"
        required
        maxlength="200"
        autocomplete="off"
        bind:this={titleInput}
        value={form?.title ?? ''}
        aria-invalid={errors.title ? 'true' : undefined}
        aria-describedby={describedBy('title-hint', errors.title && 'title-error')}
      />
    </div>

    <div class="field">
      <label for="author">Auteur</label>
      <p class="hint" id="author-hint">Entre 1 et 200 caractères.</p>
      {#if errors.author}
        <p class="field-error" id="author-error">{errors.author}</p>
      {/if}
      <input
        id="author"
        name="author"
        type="text"
        required
        maxlength="200"
        autocomplete="off"
        value={form?.author ?? ''}
        aria-invalid={errors.author ? 'true' : undefined}
        aria-describedby={describedBy('author-hint', errors.author && 'author-error')}
      />
    </div>

    <button
      class="btn btn--primary btn--counter btn--block"
      type="submit"
      aria-busy={submitting || undefined}
      aria-disabled={submitting || undefined}
    >
      {submitting ? 'Ajout en cours…' : 'Ajouter au catalogue'}
    </button>
  </form>
</div>
