# StandardTool &nbsp;[![npm](https://img.shields.io/npm/v/standard-tool)](https://www.npmjs.com/package/standard-tool) [![CI](https://github.com/finom/standard-tool/actions/workflows/ci.yml/badge.svg)](https://github.com/finom/standard-tool/actions/workflows/ci.yml)

> **Status: proposal (RFC).** This is an early proposal for a shared, framework-agnostic way to define LLM tools. It's published to gather feedback and pressure-test the design, not as a finished standard, so the shape may still change. Issues, critiques, and counter-proposals are welcome.

> A common type for defining LLM tools, built on [Standard Schema](https://standardschema.dev) and [Standard JSON Schema](https://standardschema.dev/json-schema).

StandardTool is a common **type** for defining LLM tools, meant to be produced and consumed by any framework, SDK, or app. Define a tool once and use it anywhere — across providers and frameworks — instead of writing a separate, incompatible tool object for each.

It builds on [Standard Schema](https://standardschema.dev) and [Standard JSON Schema](https://standardschema.dev/json-schema): the optional `inputSchema` and `outputSchema` both validate their data and emit JSON Schema for the model. Like Standard Schema — the shared validation interface Zod, Valibot, and ArkType implement — it's an interface, not a library you depend on, so you can conform with a plain object and zero dependencies.

## The type

The convention *is* the type. Any object of this shape is a StandardTool — no base class, no runtime, no package required:

```ts
interface StandardTool<Input = unknown, Output = unknown, FormattedOutput = Output> {
  name: string;
  title?: string;                      // human label; surfaced by MCP-style clients in tool-list UIs
  description: string;
  inputSchema?: CombinedSpec<Input>;   // validates Input + emits JSON Schema
  outputSchema?: CombinedSpec<Output>; // validates Output + emits JSON Schema
  execute(input: Input, meta?: unknown): FormattedOutput | Promise<FormattedOutput>;
}
```

`execute` takes the model's `Input` and returns the tool's result. Both schemas are optional; when present they validate runtime data (a model's arguments are untrusted input) and emit a model-ready JSON Schema synchronously via `inputSchema['~standard'].jsonSchema.input(...)`. `CombinedSpec<T>` is just "a schema that does both" — Zod 4.2+, ArkType 2.1.28+, or Valibot 1.2+ (via `@valibot/to-json-schema`). It's a convention, not a framework: it owns the shape and nothing else — it won't run your agent, call your model, or own your runtime.

A tool is **neutral** when `FormattedOutput = Output`: `execute` returns the raw `Output`. The third parameter lets the same type describe a **formatted** tool too — one whose `execute` returns a consumer-specific shape (an MCP envelope, or `{ error }` on failure). Producing those is the job of the secondary type.

## FormattableStandardTool

`FormattableStandardTool` is a `StandardTool` that knows how to (re-)format itself. From one definition it gives you three kinds of tool: a **neutral** one, a **formatted** one, and a **re-formatted** one — a tool already formatted for one consumer, re-targeted for another.

```ts
interface FormattableStandardTool<Input = unknown, Output = unknown, FormattedOutput = Output>
  extends StandardTool<Input, Output, FormattedOutput> {
  executeUnformatted(input: Input, meta?: unknown): Promise<Output>;  // always the raw, throwing Output
  formatted<F>(format?: (result: Output | Error) => F | Promise<F>): FormattableStandardTool<Input, Output, F>;
}
```

It always carries `executeUnformatted` (the raw `Output`), so formatting never stacks on formatting — each `.formatted()` re-derives from the raw. A tool a framework shipped pre-formatted for itself can still be re-targeted by you, or read raw. Both members are additive, so every `FormattableStandardTool` is also a valid `StandardTool`.

## Reference implementation: `standardTool()`

The standard is the type above — anything that produces a matching object interoperates. As a convenience the package ships a reference implementation: `standardTool()` builds a conforming `FormattableStandardTool` that validates input and output and throws on a violation. It's dependency-free (the Standard Schema interfaces are vendored in), or [copy-paste it](#or-just-copy-paste-it) instead of installing.

```ts
import { standardTool } from 'standard-tool';
import { z } from 'zod';

const getWeather = standardTool({
  name: 'get_weather',
  description: 'Current temperature for a city',
  inputSchema: z.object({ city: z.string() }),
  outputSchema: z.object({ tempC: z.number() }),
  execute: async ({ city }) => ({ tempC: 21 }), // `city` is typed; the return is validated
});

await getWeather.execute({ city: 'Paris' }); // → { tempC: number }; validated in & out, throws on a violation

// opt into a model-facing envelope when you want failures as data, not throws:
await getWeather.formatted().execute({ city: 'Paris' }); // → { tempC: number } | { error: string }
```

## Why

Every LLM framework ships its own tool object: Vercel AI SDK, MCP, oRPC, Effect. Each is a different shape, none portable, most welded to the framework. But the hard part, schema interop, is already solved by Standard Schema for validation and Standard JSON Schema for JSON Schema emission. StandardTool is a neutral wrapper around them, small enough to become a shared convention rather than another framework lock-in.

## Install

```sh
npm i standard-tool
# bring any library that implements BOTH Standard Schema and Standard JSON Schema:
npm i zod          # 4.2+   (or `arktype` 2.1.28+, or `valibot` + `@valibot/to-json-schema`)
```

## Or just copy-paste it

No dependency at all. Paste this and import the spec types from the official, types-only [`@standard-schema/spec`](https://github.com/standard-schema/standard-schema) (`npm i -D @standard-schema/spec`):

```ts
import type { StandardSchemaV1, StandardJSONSchemaV1 } from '@standard-schema/spec';

type CombinedSpec<T> = StandardSchemaV1<T> & StandardJSONSchemaV1<T>;

/** Thrown when a tool's input or output fails validation; carries the side and the Standard Schema issues. */
export class StandardToolValidationError extends Error {
  readonly name = 'StandardToolValidationError';
  constructor(
    readonly target: 'input' | 'output',
    readonly issues: readonly StandardSchemaV1.Issue[]
  ) {
    super(`${target} validation failed: ${issues.map((i) => i.message).join('; ')}`);
  }
}

/** Portable LLM tool. Neutral (`FormattedOutput = Output`): `execute` validates in & out, returns `Output`, and throws. */
export interface StandardTool<Input = unknown, Output = unknown, FormattedOutput = Output> {
  name: string;
  title?: string;
  description: string;
  inputSchema?: CombinedSpec<Input>;
  outputSchema?: CombinedSpec<Output>;
  execute(input: Input, meta?: unknown): FormattedOutput | Promise<FormattedOutput>;
}

/** A `StandardTool` that keeps its raw, throwing `executeUnformatted`, so it can be formatted and re-formatted. */
export interface FormattableStandardTool<Input = unknown, Output = unknown, FormattedOutput = Output>
  extends StandardTool<Input, Output, FormattedOutput> {
  executeUnformatted(input: Input, meta?: unknown): Promise<Output>;
  formatted<F = Output | { error: string }>(
    format?: (result: Output | Error) => F | Promise<F>
  ): FormattableStandardTool<Input, Output, F>;
}

/** Reference implementation: validate input → run the handler → validate output. The result is re-formattable. */
export function standardTool<Input = unknown, Output = unknown>(
  def: StandardTool<Input, Output>
): FormattableStandardTool<Input, Output, Output> {
  const { execute: handler, ...rest } = def;
  const execute = async (input: Input, meta?: unknown): Promise<Output> => {
    const value = def.inputSchema ? await validate('input', def.inputSchema, input) : input;
    const output = await handler(value, meta);
    return def.outputSchema ? await validate('output', def.outputSchema, output) : output;
  };
  // `execute` (the raw, validating, throwing call) doubles as `executeUnformatted`; `.formatted()` wraps it.
  const tool: FormattableStandardTool<Input, Output, Output> = {
    ...rest,
    execute,
    executeUnformatted: execute,
    formatted<F = Output | { error: string }>(
      format?: (result: Output | Error) => F | Promise<F>
    ): FormattableStandardTool<Input, Output, F> {
      // Default formatter: pass a success through, turn a thrown Error into `{ error }`.
      const fmt = (format ?? ((r: Output | Error) => (r instanceof Error ? { error: r.message } : r))) as (
        result: Output | Error
      ) => F | Promise<F>;
      // Re-derive from the raw `execute`, never the previous formatting; `...tool` carries everything else
      // (including this method), so the result stays re-formattable.
      return {
        ...tool,
        async execute(input, meta) {
          try {
            return fmt(await execute(input, meta));
          } catch (error) {
            return fmt(error instanceof Error ? error : new Error(String(error)));
          }
        },
      };
    },
  };
  return tool;
}

async function validate<S extends StandardSchemaV1>(
  target: 'input' | 'output',
  schema: S,
  value: unknown
): Promise<StandardSchemaV1.InferOutput<S>> {
  const result = await schema['~standard'].validate(value);
  if (result.issues) throw new StandardToolValidationError(target, result.issues);
  return result.value;
}
```

## API

The convention is the **`StandardTool`** type (normative, no methods); **`FormattableStandardTool`** extends it with the formatting layer (see [The type](#the-type) and [FormattableStandardTool](#formattablestandardtool) above). `standardTool()` is the reference implementation that builds one.

```ts
import { standardTool, type StandardTool, type FormattableStandardTool } from 'standard-tool';

standardTool(def): FormattableStandardTool<Input, Output>;          // reference impl: validates in & out, throws on a violation
tool.formatted(format?): FormattableStandardTool<Input, Output, F>; // opt into a consumer-specific result (or { error } envelope)
```

`Input` and `Output` are your data types: what your `execute` accepts and returns. The optional schemas describe them. A neutral tool's `execute` validates both, returns the validated `Output`, and throws on a violation. `execute` also takes an optional second `meta` argument — per-call runtime context forwarded verbatim to your handler, never validated and never in the JSON Schema (see [Per-call runtime context](#per-call-runtime-context-meta)).

| field | type | purpose |
| --- | --- | --- |
| `name` | `string` | tool name sent to the model |
| `title?` | `string` | optional human-readable label, surfaced by MCP clients in tool-list UIs; ignored by plain function-calling APIs |
| `description` | `string` | what the tool does |
| `inputSchema?` | `CombinedSpec<Input>` | optional input schema; validates and emits JSON Schema |
| `outputSchema?` | `CombinedSpec<Output>` | optional output schema; validates and emits JSON Schema |
| `execute` (yours) | `(input: Input, meta?: unknown) => Output \| Promise<Output>` | your logic; receives validated input and the optional per-call `meta` (annotate it to type it), returns the output |
| `execute` (tool) | `(input: Input, meta?: unknown) => Promise<Output>` | validate in, run yours (forwarding `meta`), validate out; returns the validated `Output`, throwing a `StandardToolValidationError` on a violation |

`inputSchema` and `outputSchema` are optional. When present they must implement both Standard Schema and Standard JSON Schema (Zod 4.2+, ArkType 2.1.28+, or Valibot 1.2+ via `@valibot/to-json-schema`). `Input` and `Output` are inferred from them, or from `execute` when a schema is omitted.

`StandardTool` — the normative type — stays minimal: `{ name, title?, description, inputSchema?, outputSchema?, execute }`, no methods, so anything can produce or consume one with a plain object and zero dependencies. The reference `standardTool()` returns a `FormattableStandardTool`: that same shape plus two additive members, so a `FormattableStandardTool` is always a valid `StandardTool`.

| member | type | purpose |
| --- | --- | --- |
| `executeUnformatted` | `(input: Input, meta?: unknown) => Promise<Output>` | the validated, throwing, *unformatted* execute. On a neutral tool it is identical to `execute`; formatting keeps it intact, so the raw `Output` stays reachable |
| `formatted` | `(format?) => FormattableStandardTool<Input, Output, F>` | opt into a consumer-specific result; see [Formatting the result](#formatting-the-result) |

The thrown `StandardToolValidationError` carries `target: 'input' \| 'output'` and the Standard Schema `issues`, so a formatter (or a `catch`) can build a rich result.

## Usage

```ts
import { standardTool } from 'standard-tool';
import { z } from 'zod';

const getWeather = standardTool({
  name: 'get_weather',
  description: 'Current temperature for a city',
  inputSchema: z.object({ city: z.string() }),
  outputSchema: z.object({ tempC: z.number() }),
  execute: async ({ city }) => ({ tempC: 21 }),
});

// validated end to end; returns the raw Output and throws on bad input or output:
const out = await getWeather.execute({ city: 'Paris' }); // { tempC: number }

// want failures as data instead of throws? format it (see below):
const safe = await getWeather.formatted().execute({ city: 'Paris' }); // { tempC: number } | { error: string }

// JSON Schema for the model (Standard JSON Schema), synchronous (inputSchema is optional, hence `!`):
const parameters = getWeather.inputSchema!['~standard'].jsonSchema.input({ target: 'draft-2020-12' });
```

## Per-call runtime context (`meta`)

Tools often need per-call data that should not appear in the model-facing `inputSchema`, such as a locale, an auth token, or a request-scoped DB handle. `execute` takes an optional second `meta` argument, forwarded verbatim to your handler. It's never validated and never part of the JSON Schema, so your tools can stay static (defined once at module scope) while you inject context at call time, instead of closing over it in a per-render factory.

`meta` is typed `unknown`. Annotate it on your handler to type it at the call site:

```ts
const greet = standardTool({
  name: 'greet',
  description: 'Greet a person in the caller-supplied locale',
  inputSchema: z.object({ name: z.string() }),
  execute: ({ name }, meta: { locale: string }) => (meta.locale === 'fr' ? `bonjour ${name}` : `hi ${name}`), // annotate meta here
});

await greet.execute({ name: 'Ada' }, { locale: 'fr' }); // → 'bonjour Ada'
```

Tools that don't need it just call `execute(input)`; `meta` is optional.

## Formatting the result

A neutral tool throws on a validation failure or a thrown error, and returns its own `Output` otherwise. That's the right default for typed code, but a model loop usually wants a failure to come back as *data* it can self-correct from, and some consumers (MCP) want a specific result envelope. Formatting is how you opt into that, without changing the tool's `Input` or `Output`:

```ts
const getWeather = standardTool({
  name: 'get_weather',
  description: 'Current temperature for a city',
  inputSchema: z.object({ city: z.string() }),
  outputSchema: z.object({ tempC: z.number() }),
  execute: async ({ city }) => ({ tempC: 21 }),
});

await getWeather.execute({ city: 123 } as never);             // throws StandardToolValidationError
await getWeather.formatted().execute({ city: 123 } as never); // → { error: 'input validation failed: …' }
```

`formatted` takes any `(result: Output | Error) => FormattedOutput`. On success it receives the validated `Output`; on failure an `Error` (a `StandardToolValidationError` for validation failures, carrying `target` and the Standard Schema `issues`). With no formatter, the default `{ error }` envelope is used. The formatter's return type becomes the tool's third generic, `FormattedOutput`:

```ts
// reshape to anything
const asText = getWeather.formatted((r) => (r instanceof Error ? `error: ${r.message}` : `${r.tempC}°C`));
await asText.execute({ city: 'Paris' }); // → '21°C'

// re-throw to keep throwing on failure (the escape hatch back to neutral behavior)
const strict = getWeather.formatted((r) => {
  if (r instanceof Error) throw r;
  return r;
});
```

Formatting swaps only that third generic; `Input` and `Output` are untouched, and the validated, unformatted execute is carried along as `executeUnformatted`. So a formatted tool stays re-formattable, and its raw `Output` stays reachable:

```ts
const enveloped = getWeather.formatted();                     // { error } envelope
await enveloped.executeUnformatted({ city: 'Paris' });        // → { tempC: 21 } (raw; still validates + throws)
await enveloped.formatted(asText).execute({ city: 'Paris' }); // → '21°C', re-derived from the raw Output
```

Re-formatting *replaces*, it doesn't compose: each `formatted()` re-derives from the unformatted result, never from the previous formatting. That's what lets a framework ship a tool pre-formatted for itself while you stay free to re-target it for another consumer — or read the raw `Output`.

## MCP-compatible output

[MCP](https://modelcontextprotocol.io) tools return a structured result envelope, `{ content, structuredContent?, isError? }`, not just raw data. A formatter applied with `.formatted()` maps `execute`'s result onto that shape, so a StandardTool is consumable by an MCP server with no translation. The formatter below is text-only: an object result is JSON-encoded into a text block and also mirrored into `structuredContent` (per MCP's [backwards-compatibility guidance](https://modelcontextprotocol.io/specification/2025-06-18/server/tools#structured-content)), errors come back with `isError: true` (a self-correctable tool error), and image, audio, and resource blocks are out of scope.

```ts
type McpToolResult = {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

// A plain function; pass it to .formatted() (which infers FormattedOutput from the return type).
// `result` is your Output, or an Error (validation/exec failure).
const toMcpResult = (result: unknown): McpToolResult => {
  if (result instanceof Error) {
    return { content: [{ type: 'text', text: result.message }], isError: true }; // tool error the model can self-correct
  }
  if (typeof result === 'string') {
    return { content: [{ type: 'text', text: result }] };
  }
  const text = JSON.stringify(result);
  if (result !== null && typeof result === 'object' && !Array.isArray(result)) {
    return { content: [{ type: 'text', text }], structuredContent: result as Record<string, unknown> };
  }
  return { content: [{ type: 'text', text }] };
};
```

Apply it with `.formatted()`, and `execute` returns a value shaped exactly like an MCP `CallToolResult`:

```ts
const getWeather = standardTool({
  name: 'get_weather',
  title: 'Get weather',
  description: 'Current temperature for a city',
  inputSchema: z.object({ city: z.string() }),
  outputSchema: z.object({ tempC: z.number() }),
  execute: async ({ city }) => ({ tempC: 21 }),
}).formatted(toMcpResult);

await getWeather.execute({ city: 'Paris' });
// → { content: [{ type: 'text', text: '{"tempC":21}' }], structuredContent: { tempC: 21 } }
//
// bad input, a thrown error, or invalid output instead →
// → { content: [{ type: 'text', text: 'input validation failed: ...' }], isError: true }
```

That's the exact shape an MCP server returns from a `tools/call` handler, so a StandardTool drops straight in. Wiring it into a specific MCP SDK is out of scope here.

## With the OpenAI API

Uses the [Responses API](https://developers.openai.com/api/docs/guides/function-calling). Because every tool is the same neutral shape, you keep them in one array, `.map` it into the request's `tools`, then dispatch each function call back to the matching tool by `name`. Adding a fourth tool is one more array entry, with no special-casing and no per-tool wiring. And by formatting each call with the default `{ error }` envelope (`tool.formatted()`), an argument that fails the tool's schema comes back as data for the model to fix rather than throwing — `JSON.parse` runs first, so guard it if the model might emit invalid JSON.

```ts
import OpenAI from 'openai';
import { z } from 'zod';
import { standardTool, type FormattableStandardTool } from 'standard-tool';

const client = new OpenAI();

const tools: FormattableStandardTool[] = [
  standardTool({
    name: 'get_weather',
    description: 'Get the current temperature for a city',
    inputSchema: z.object({ city: z.string() }),
    outputSchema: z.object({ tempC: z.number() }),
    execute: async ({ city }) => ({ tempC: 21 }),
  }),
  standardTool({
    name: 'get_time',
    description: 'Get the current time in an IANA timezone',
    inputSchema: z.object({ timezone: z.string() }),
    outputSchema: z.object({ iso: z.string() }),
    execute: async ({ timezone }) => ({ iso: new Date().toLocaleString('en-US', { timeZone: timezone }) }),
  }),
  standardTool({
    name: 'convert_currency',
    description: 'Convert an amount between two currencies',
    inputSchema: z.object({ amount: z.number(), from: z.string(), to: z.string() }),
    outputSchema: z.object({ amount: z.number() }),
    execute: async ({ amount }) => ({ amount: Math.round(amount * 1.08 * 100) / 100 }),
  }),
];

const input: OpenAI.Responses.ResponseInput = [{ role: 'user', content: 'What is the weather in Paris?' }];

const res = await client.responses.create({
  model: 'gpt-5.5',
  input,
  // ← the payoff: one shape, one mapping for every tool
  tools: tools.map((tool): OpenAI.Responses.Tool => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema ? tool.inputSchema['~standard'].jsonSchema.input({ target: 'draft-2020-12' }) : {},
    strict: false,
  })),
});

input.push(...res.output);

for (const item of res.output) {
  if (item.type !== 'function_call') continue;
  const tool = tools.find((t) => t.name === item.name);
  if (!tool) continue;
  const result = await tool.formatted().execute(JSON.parse(item.arguments)); // schema-invalid args → { error }, so the model self-corrects
  input.push({ type: 'function_call_output', call_id: item.call_id, output: JSON.stringify(result) });
}

const final = await client.responses.create({ model: 'gpt-5.5', input });
console.log(final.output_text);
```

## Links

- [Overview](./OVERVIEW.md) — the problem, the landscape, and the case for a neutral tool type
- [Examples](./EXAMPLES.md) — using a tool with OpenAI, Anthropic, the Vercel AI SDK, and MCP
- [Standard Schema](https://standardschema.dev)
- [Standard JSON Schema](https://standardschema.dev/json-schema)
- [@standard-schema/spec](https://github.com/standard-schema/standard-schema)

## License

MIT © Andrey Gubanov
