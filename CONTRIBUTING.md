# Contributing to SIFT

Thanks for considering a contribution. SIFT is built deliberately, one
milestone at a time — see the [Roadmap](README.md#roadmap) for where things
stand.

## Getting started

```bash
git clone https://github.com/your-username/sift.git
cd sift
npm install
npm run dev -- npm test   # run the CLI from source, no build step
npm test                  # run the full test suite
```

## Before opening a PR

- **Add tests.** Every analyzer, module, and CLI flag in this project has
  test coverage — fixture-driven where practical (see `tests/fixtures/`),
  unit-level otherwise. New behavior should follow the same pattern.
- **Keep changes small and reviewable.** Prefer one focused change per PR
  over a broad refactor. If you're adding a new deterministic analyzer,
  that's usually a self-contained PR: the analyzer, its test file, and a
  fixture if it needs one.
- **Run the full suite.** `npm test` should pass, and `npm run build`
  should compile cleanly with no new TypeScript errors.
- **Preserve existing behavior.** Avoid speculative abstractions or
  unrelated formatting changes mixed into a functional PR.

## Adding a new deterministic analyzer

Analyzers live under `src/analyzers/<category>/` and implement the
`Analyzer` interface (`src/analyzers/types.ts`): a cheap `canAnalyze()`
pre-filter and an `analyze()` that returns evidence-backed `Finding`s. Look
at `src/analyzers/jest/pathAliasMismatch.ts` for a fully worked example,
then:

1. Add the analyzer file.
2. Register it in `src/analyzers/orchestrator.ts`'s `DEFAULT_ANALYZERS`.
3. Add a fixture under `tests/fixtures/` if it needs real files to detect
   against, and a test file under `tests/unit/analyzers/`.

## Reporting issues

Please include: the command you ran, what SIFT printed, what you expected,
and your OS/Node version. A minimal reproduction (even a two-file fixture)
is the single most useful thing you can attach.

## Code of conduct

Be respectful and constructive. This is a small project maintained by
people doing this in their spare time.
