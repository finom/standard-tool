# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- The published package no longer contains `src`; types and source maps come from `dist` (sources are inlined into the maps). The `./package.json` export subpath was removed.
- Transforming schemas are supported: `inputSchema` is `StandardSchemaV1<Input, unknown>` (`Input` is its input side — what `execute` accepts and what the emitted JSON Schema describes), `outputSchema` is `StandardSchemaV1<unknown, Output>` (`Output` is its output side, the validated result). `standardTool()` hands the handler the validated input and validates the raw result; its type parameters changed accordingly.

## [0.1.0] - 2026-08-13

### Added

- `meta?: Record<string, unknown>` on `StandardToolV0` — static data about the tool itself. Consumers read it; it never reaches `execute` and never enters the emitted JSON Schema. Narrow it with an intersection when you want it typed.
- Documented Gemini function calling, and deriving tools from RPC procedures you already have (tRPC, oRPC).

### Changed

- `execute`'s optional second argument is now named `context` (was `meta`), and the fourth generic is `Context` (was `Meta`). Structurally compatible: parameter and type-parameter names are not part of a type's identity.
- `standardTool()` defaults its `Input` generic to `void`, so a tool with no `inputSchema` and a parameterless handler is callable as `execute()`. The `StandardToolV0` interface keeps `unknown`, so `StandardToolV0[]` consumers are unaffected.
- `engines.node` is now `>=22`.

## [0.0.6] - 2026-07-09

Final release of the `0.0` line. `0.0.1`–`0.0.5` were experimental iterations and are not documented separately.

### Added

- `withFormattedOutput(tool, format?)` — wraps a tool so failures come back as data instead of throws. Applied once, at the consumer boundary; with no `format` it applies the default `{ error: string }` envelope.

### Changed

- `standardTool()` takes and returns a `StandardToolV0` — the definition is the tool shape, with your raw handler as its `execute`.
- `execute` has one fixed signature with an optional second argument; `input` is always present.
- Schemas must be non-transforming: the single `Input` generic is both the wire type and the validated type, so `.transform()`, `.pipe()` and `z.coerce` do not fit.

### Removed

- `formatted()` as a member of `StandardToolV0`, replaced by `withFormattedOutput()`.
- The `StandardToolV0Definition` export.

[Unreleased]: https://github.com/finom/standard-tool/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/finom/standard-tool/compare/v0.0.6...v0.1.0
[0.0.6]: https://github.com/finom/standard-tool/releases/tag/v0.0.6
