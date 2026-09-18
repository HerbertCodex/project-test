<!--
  Confirmation publique de la suppression d'un compte.

  La session vient d'être fermée : la page est atteinte par un visiteur anonyme
  et ne peut donc rien afficher du compte disparu. Elle est volontairement
  statique — ni module serveur, ni action, ni lecture de l'URL — pour qu'aucun
  paramètre venu du navigateur n'influence ce qui est confirmé.
-->
<svelte:head>
  <title>Compte supprimé — Librairie</title>
</svelte:head>

<div class="page-head">
  <h1>Votre compte est supprimé.</h1>
</div>

<div class="farewell">
  <p class="lead">
    Votre session a été fermée sur tous vos appareils. Merci d’avoir emprunté à la librairie.
  </p>

  <div class="ledger">
    <section aria-labelledby="efface">
      <h2 id="efface">Ce qui a été effacé</h2>
      <ul>
        <li>Votre adresse e-mail.</li>
        <li>Votre nom affiché.</li>
        <li>Votre mot de passe.</li>
        <li>Toutes vos sessions ouvertes.</li>
      </ul>
    </section>

    <section aria-labelledby="reste">
      <h2 id="reste">Ce qui reste, sans votre nom</h2>
      <ul>
        <li>L’historique des prêts rendus, conservé un an dans les registres de la librairie.</li>
        <li>Les ventes enregistrées, conservées au registre.</li>
        <li>Aucun de ces enregistrements ne porte plus votre nom ni votre adresse.</li>
      </ul>
    </section>
  </div>

  <div class="empty">
    <p>Votre adresse e-mail est de nouveau libre.</p>
    <p>
      Vous pourrez la réutiliser si vous créez un jour un nouveau compte : ce sera un compte
      entièrement distinct, sans lien avec l’ancien.
    </p>
  </div>

  <p class="farewell__actions">
    <a class="btn btn--primary" href="/">Parcourir le catalogue</a>
    <a class="btn" href="/inscription">Créer un nouveau compte</a>
  </p>
</div>

<style>
  /* Page de lecture sans table ni filtre : colonne étroite du comptoir. */
  .farewell {
    max-width: var(--counter-measure);
  }

  /* Registre d'adieu : ce qui est parti, ce qui reste, côte à côte. */
  .ledger {
    display: grid;
    gap: 2rem;
    margin: 2rem 0 2.5rem;
    padding: 1.75rem 0 0;
    border-top: 1px solid var(--rule);
  }

  .ledger h2 {
    margin-bottom: 0.5rem;
    font-size: 1.375rem;
  }

  .ledger ul {
    margin: 0;
    padding-left: 1.25rem;
    color: var(--ink-2);
  }

  .ledger li + li {
    margin-top: 0.375rem;
  }

  .farewell__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
  }

  @media (min-width: 40rem) {
    .ledger {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 40rem) {
    .farewell__actions .btn {
      width: 100%;
    }
  }
</style>
