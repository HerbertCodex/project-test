Every bullet below names the gate that makes it fail. A bullet whose answer to
« which gate refuses this? » is « none » does not belong here: a rule no command
can refuse never applies, and this framework's most expensive lesson is that it
gets relearned in every project.

- **No `any`, explicit or implied.** `strict` is on and `noImplicitAny` comes
  with it, so an untyped parameter is already refused — an explicit `any` is a
  hole opened on purpose. Refused by `check`.
- **No non-null assertion (`!`) to silence the compiler.** It asserts what the
  type system just said it could not verify. Narrow the type or handle the
  absence. Refused by `check`.
- **No `@ts-ignore` and no `@ts-expect-error` outside a test proving a type
  fails.** Refused by `check` (the directive is reported as unused when the
  error it claims does not exist).
- **Relative imports carry the `.js` extension, in `.ts` sources.**
  `module: nodenext` requires it, and omitting it produces code that compiles
  and crashes at run time. Refused by `check`.
- **No unused variable, and no `debugger`.** Refused by `lint`, which runs with
  `--deny-warnings` so that a warning stops the work instead of scrolling past.
- **No floating promise.** An unawaited promise in a NestJS provider swallows
  its rejection, and the request answers 200 on work that failed. Refused by
  `lint`, which runs `--type-aware`: the rule needs type information, and
  without that flag oxlint reads it and enforces nothing. That silence was
  measured here before the flag was added, not assumed.
- **A layer never imports against the arrow.** `adapters → application →
  domain`, and `domain` imports nothing of this repository. Refused by
  `architecture`.
- **Every file under `src/` belongs to a declared layer.** A file in none is
  outside the architecture, so no direction applies to it. Refused by
  `architecture` (the composition root, and the pre-decision scaffold, are
  exempted by name in `pipeline.config.json`).
- **No function beyond 60 lines, 4 parameters, depth 3 or complexity 10.**
  These are measurable approximations of single responsibility and KISS, not
  proofs of them. Refused by `design_limits`. Test blocks are exempt from the
  length bound: a long scenario describes a journey, it is not debt.
- **No method of a derived class whose body is a bare `throw`.** A caller
  holding the base type breaks on the subclass, so the inheritance is a lie.
  Refused by `design_limits`.
- **No chain of two `instanceof` or more deciding behaviour.** Adding a case
  forces reopening that function. Refused by `design_limits`.
- **No comment restating the code, and no commented-out code.** A contract in a
  `/** */` block on an export is the form that is always accepted. Refused by
  `comment_policy`.
- **No secret written into the source**, including a connection string carrying
  its password. Read it from the environment. Refused by `secrets_scan`.
- **No exported symbol nobody imports.** Refused by `dead_code`.
- **No block of six significant lines or more repeated across the codebase.**
  Refused by `duplication`.
- **No new export absent from the project map.** The reuse note owed by every
  addition is judged against that map. Refused by `project_map`, and its
  emptiness by `map_coverage`.
- **The built application answers a real request.** Refused by `smoke`.

## What these gates do NOT cover, and must not be believed to

- **Liskov through a narrowed precondition**, or through a return that no
  longer honours the contract, is invisible to any syntax query. Only the two
  forms written down plainly are caught. The rest stays in human review, and
  saying so here is the point: a gate believed wider than it is, is worse than
  no gate.
- **Two modules applying the same business rule with different code.** An
  import graph does not see meaning, and `duplication` compares lines. That one
  is found by reading.
- **Whether a business refusal is the RIGHT refusal.** `check` proves the types
  line up; nothing here proves the domain is correct.
