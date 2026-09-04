# Contributing

This is a proposal for a standard. The interface in [README.md](./README.md) is the specification; the package is a reference implementation of it.

## Requirements for a change

- `npm test` must pass. It builds, type-checks the tests, lints with Biome, and runs the suite.
- Formatting and lint rules come from [biome.json](./biome.json). Run `npm run lint:fix` before opening a pull request.
- TypeScript runs in `strict` mode. New code type-checks without suppressions, and the source carries no ignore comments.
- Every change to the interface or to `standardTool` ships with tests in `test/`. New behaviour is not merged without a test covering it.
- Changes that affect users are recorded in [CHANGELOG.md](./CHANGELOG.md).
- Commit messages follow the existing history: a type prefix (`feat:`, `fix:`, `docs:`, `chore:`, `test:`) and a present-tense summary.

## Reporting

Bugs and proposals go to [GitHub issues](https://github.com/finom/standard-tool/issues).

Security reports follow [SECURITY.md](./SECURITY.md) — report privately, not as a public issue.
