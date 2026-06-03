# StandardTool &nbsp;[![npm](https://img.shields.io/npm/v/standard-tool)](https://www.npmjs.com/package/standard-tool) [![CI](https://github.com/finom/standard-tool/actions/workflows/ci.yml/badge.svg)](https://github.com/finom/standard-tool/actions/workflows/ci.yml)

> 🚧 **Work in progress — not ready to present.** The core API (how tools validate and format their I/O) is being actively redesigned and will change. Don't build on the current shape yet.

> **Status: proposal (RFC).** This is an early proposal for a shared, framework-agnostic way to define LLM tools. It's published to gather feedback and pressure-test the design, not as a finished standard, so the shape may still change. Issues, critiques, and counter-proposals are welcome.

> A common type for defining LLM tools, built on [Standard Schema](https://standardschema.dev) and [Standard JSON Schema](https://standardschema.dev/json-schema).

StandardTool is a common type for defining LLM tools, meant to be produced and consumed by any framework, SDK, or app.

The goal is to define a tool once and use it anywhere, across providers and frameworks, instead of writing a separate, incompatible tool object for each one. It builds on [Standard Schema](https://standardschema.dev) and [Standard JSON Schema](https://standardschema.dev/json-schema): the optional `inputSchema` and `outputSchema` both validate their data and emit JSON Schema for the model.

Standard Schema is the shared validation interface that Zod, Valibot, and ArkType implement, and this proposal follows the same idea. It's an interface, not a library you depend on, so you can conform to it with a plain object and zero dependencies. The package also ships a small reference implementation, the `standardTool()` function, which builds a conforming tool that validates its input and output, plus an opt-in formatting layer (`.formatted()`) for handing the model a consumer-specific result.

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

## What it is

- Standalone and dependency-free: a type, plus a small reference implementation of it. The Standard Schema and Standard JSON Schema interfaces are vendored into the package, so installing it pulls in nothing else. You can also copy the source into your project instead (see [below](#or-just-copy-paste-it)).
- A convention, not a framework: it doesn't run your agent, call your model, or own your runtime. It defines only the shape, `{ name, title?, description, inputSchema?, outputSchema?, execute }`, plus the two things every tool needs from its schemas: validation and a JSON Schema.
- Validates input and output, and throws by default: `execute` accepts untrusted input, such as JSON arguments from a model, and validates it via Standard Schema when you provide a schema (both are optional). It runs your logic, validates the result, and returns the validated `Output` — throwing on a violation, like a parser would.
- Emits JSON Schema for any model: because the schemas implement Standard JSON Schema, you get an OpenAI- or MCP-ready JSON Schema synchronously via `inputSchema['~standard'].jsonSchema.input(...)`.
- Formatting lives outside the standard shape: reshaping the result for a specific consumer (a failure as `{ error }`, an MCP envelope) is what *binds* a tool to that consumer, so it's an explicit, opt-in [`.formatted()`](#formatting-the-result) step rather than baked in. And because the unformatted execute is carried along, a tool a framework formatted for itself can still be re-formatted by you, or read raw.

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

/** The default formatter's envelope: the raw `Output`, or `{ error }` on a validation/exec failure. */
export type DefaultFormattedOutput<Output> = Output | { error: string };

/**
 * Thrown by a neutral tool's `execute`/`executeUnformatted` when input or output validation fails.
 * Carries the failing side and the Standard Schema issues, so a formatter can build a rich result.
 */
export class StandardToolValidationError extends Error {
  constructor(
    readonly target: 'input' | 'output',
    readonly issues: readonly StandardSchemaV1.Issue[]
  ) {
    super(`${target} validation failed: ${issues.map((i) => i.message).join('; ')}`);
    this.name = 'StandardToolValidationError';
  }
}

/** A portable LLM tool definition — the standard interchange shape. Neutral form: validates in & out, throws. */
export interface StandardTool<Input = unknown, Output = unknown, FormattedOutput = Output> {
  name: string;
  title?: string;
  description: string;
  inputSchema?: CombinedSpec<Input>;
  outputSchema?: CombinedSpec<Output>;
  // biome-ignore lint/suspicious/noExplicitAny: per-call context, typed by the handler
  execute(input: Input, meta?: any): FormattedOutput | Promise<FormattedOutput>;
}

/** What `standardTool`/`formatted` return: a `StandardTool` carrying the unformatted execute + `formatted()`. */
export interface FormattableTool<Input = unknown, Output = unknown, FormattedOutput = Output>
  extends StandardTool<Input, Output, FormattedOutput> {
  /** Validate input → run → validate output, returning the raw `Output`. Throws on a violation. */
  // biome-ignore lint/suspicious/noExplicitAny: per-call context, typed by the handler
  executeUnformatted(input: Input, meta?: any): Promise<Output>;
  /** Re-format from the unformatted result. No formatter → the default `{ error }` envelope. */
  formatted(): FormattableTool<Input, Output, DefaultFormattedOutput<Output>>;
  formatted<NewFormattedOutput>(
    format: (result: Output | Error) => NewFormattedOutput | Promise<NewFormattedOutput>
  ): FormattableTool<Input, Output, NewFormattedOutput>;
}

type ToolMeta<Input, Output> = Pick<
  StandardTool<Input, Output>,
  'name' | 'title' | 'description' | 'inputSchema' | 'outputSchema'
>;

type Raw<Input, Output> = (input: Input, meta?: unknown) => Output | Promise<Output>;
type Format<Output, FormattedOutput> = (result: Output | Error) => FormattedOutput | Promise<FormattedOutput>;

const defaultFormat = <Output>(result: Output | Error): DefaultFormattedOutput<Output> =>
  result instanceof Error ? { error: result.message } : result;

function makeFormattable<Input, Output, FormattedOutput>(
  base: ToolMeta<Input, Output>,
  raw: Raw<Input, Output>,
  format?: Format<Output, FormattedOutput>
): FormattableTool<Input, Output, FormattedOutput> {
  const executeUnformatted = async (input: Input, meta?: unknown): Promise<Output> => raw(input, meta);
  const execute: (input: Input, meta?: unknown) => Promise<FormattedOutput> = format
    ? async (input, meta) => {
        let result: Output | Error;
        try {
          result = await executeUnformatted(input, meta);
        } catch (error) {
          result = error instanceof Error ? error : new Error(String(error));
        }
        return format(result);
      }
    : (executeUnformatted as unknown as (input: Input, meta?: unknown) => Promise<FormattedOutput>);
  const tool = {
    name: base.name,
    title: base.title,
    description: base.description,
    inputSchema: base.inputSchema,
    outputSchema: base.outputSchema,
    execute,
    executeUnformatted,
    formatted: (next?: Format<Output, unknown>) => makeFormattable(base, raw, next ?? defaultFormat),
  };
  return tool as unknown as FormattableTool<Input, Output, FormattedOutput>;
}

/** Reference implementation of `StandardTool`. Validates input and output, throwing on a violation. */
export function standardTool<Input = unknown, Output = unknown>(def: {
  name: string;
  title?: string;
  description: string;
  inputSchema?: CombinedSpec<Input>;
  outputSchema?: CombinedSpec<Output>;
  // biome-ignore lint/suspicious/noExplicitAny: per-call context, typed by the handler
  execute: (input: Input, meta: any) => Output | Promise<Output>;
}): FormattableTool<Input, Output, Output> {
  const raw: Raw<Input, Output> = async (input, meta) => {
    const validInput = def.inputSchema ? await validate('input', def.inputSchema, input) : input;
    const output = await def.execute(validInput, meta);
    return def.outputSchema ? await validate('output', def.outputSchema, output) : output;
  };
  const { name, title, description, inputSchema, outputSchema } = def;
  return makeFormattable<Input, Output, Output>({ name, title, description, inputSchema, outputSchema }, raw);
}

/** Wrap a neutral `StandardTool` so `execute` returns a consumer-specific shape (or the `{ error }` envelope). */
export function formatted<Input, Output>(
  tool: StandardTool<Input, Output, Output>
): FormattableTool<Input, Output, DefaultFormattedOutput<Output>>;
export function formatted<Input, Output, FormattedOutput>(
  tool: StandardTool<Input, Output, Output>,
  format: Format<Output, FormattedOutput>
): FormattableTool<Input, Output, FormattedOutput>;
export function formatted<Input, Output, FormattedOutput>(
  tool: StandardTool<Input, Output, Output>,
  format?: Format<Output, FormattedOutput>
): FormattableTool<Input, Output, FormattedOutput | DefaultFormattedOutput<Output>> {
  const carried = (tool as Partial<FormattableTool<Input, Output, Output>>).executeUnformatted;
  const raw: Raw<Input, Output> = carried ?? ((input, meta) => tool.execute(input, meta));
  const { name, title, description, inputSchema, outputSchema } = tool;
  const fmt = (format ?? defaultFormat) as Format<Output, FormattedOutput | DefaultFormattedOutput<Output>>;
  return makeFormattable({ name, title, description, inputSchema, outputSchema }, raw, fmt);
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

```ts
import { standardTool, formatted, type StandardTool, type FormattableTool } from 'standard-tool';

standardTool(def): FormattableTool<Input, Output>;            // neutral: validates in & out, throws on a violation
tool.formatted(format?): FormattableTool<Input, Output, F>;   // opt into a consumer-specific result (or { error } envelope)
formatted(tool, format?): FormattableTool<Input, Output, F>;  // the same, as a free function for a tool you didn't make
```

`Input` and `Output` are your data types: what your `execute` accepts and returns. The optional schemas describe them. A neutral tool's `execute` validates both, returns the validated `Output`, and throws on a violation. `execute` also takes an optional second `meta` argument — per-call runtime context forwarded verbatim to your handler, never validated and never in the JSON Schema (see [Per-call runtime context](#per-call-runtime-context-meta)).

| field | type | purpose |
| --- | --- | --- |
| `name` | `string` | tool name sent to the model |
| `title?` | `string` | optional human-readable label, surfaced by MCP clients in tool-list UIs; ignored by plain function-calling APIs |
| `description` | `string` | what the tool does |
| `inputSchema?` | `CombinedSpec<Input>` | optional input schema; validates and emits JSON Schema |
| `outputSchema?` | `CombinedSpec<Output>` | optional output schema; validates and emits JSON Schema |
| `execute` (yours) | `(input: Input, meta: any) => Output \| Promise<Output>` | your logic; receives validated input and the optional per-call `meta`, returns the output |
| `execute` (tool) | `(input: Input, meta?: any) => Promise<Output>` | validate in, run yours (forwarding `meta`), validate out; returns the validated `Output`, throwing a `StandardToolValidationError` on a violation |

`inputSchema` and `outputSchema` are optional. When present they must implement both Standard Schema and Standard JSON Schema (Zod 4.2+, ArkType 2.1.28+, or Valibot 1.2+ via `@valibot/to-json-schema`). `Input` and `Output` are inferred from them, or from `execute` when a schema is omitted.

`StandardTool` — the normative type — stays minimal: `{ name, title?, description, inputSchema?, outputSchema?, execute }`, no methods, so anything can produce or consume one with a plain object and zero dependencies. The reference `standardTool()` returns a `FormattableTool`: that same shape plus two additive members, so a `FormattableTool` is always a valid `StandardTool`.

| member | type | purpose |
| --- | --- | --- |
| `executeUnformatted` | `(input: Input, meta?: any) => Promise<Output>` | the validated, throwing, *unformatted* execute. On a neutral tool it is identical to `execute`; formatting keeps it intact, so the raw `Output` stays reachable |
| `formatted` | `(format?) => FormattableTool<Input, Output, F>` | opt into a consumer-specific result; see [Formatting the result](#formatting-the-result) |

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

Tools often need per-call data that should not appear in the model-facing `inputSchema`, such as an auth token, a resolver, or a request-scoped DB handle. `execute` takes an optional second `meta` argument, forwarded verbatim to your handler. It's never validated and never part of the JSON Schema, so your tools can stay static (defined once at module scope) while you inject context at call time, instead of closing over it in a per-render factory.

`meta` is typed `any`. Annotate it on your handler to type it at the call site:

```ts
const greet = standardTool({
  name: 'greet',
  description: 'Greet a person with per-call punctuation',
  inputSchema: z.object({ name: z.string() }),
  execute: ({ name }, meta: { punct: string }) => `hi ${name}${meta.punct}`, // annotate meta here
});

await greet.execute({ name: 'Ada' }, { punct: '!' }); // → 'hi Ada!'
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

Re-formatting *replaces*, it doesn't compose: each `formatted()` re-derives from the unformatted result, never from the previous formatting. That's what lets a framework ship a tool pre-formatted for itself while you stay free to re-target it for another consumer — or read the raw `Output`. The free `formatted(tool, format)` does the same for a neutral tool you didn't make.

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

Uses the [Responses API](https://developers.openai.com/api/docs/guides/function-calling). Because every tool is the same neutral shape, you keep them in one array, `.map` it into the request's `tools`, then dispatch each function call back to the matching tool by `name`. Adding a fourth tool is one more array entry, with no special-casing and no per-tool wiring. And by formatting each tool with the default `{ error }` envelope (`formatted(tool)`), a malformed tool call comes back as data and goes to the model to self-correct rather than crashing your loop.

```ts
import OpenAI from 'openai';
import { z } from 'zod';
import { standardTool, formatted, type StandardTool } from 'standard-tool';

const client = new OpenAI();

const tools: StandardTool[] = [
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
  model: 'gpt-5',
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
  const result = await formatted(tool).execute(JSON.parse(item.arguments)); // bad args → { error }, so the model self-corrects
  input.push({ type: 'function_call_output', call_id: item.call_id, output: JSON.stringify(result) });
}

const final = await client.responses.create({ model: 'gpt-5', input });
console.log(final.output_text);
```

## Links

- [Standard Schema](https://standardschema.dev)
- [Standard JSON Schema](https://standardschema.dev/json-schema)
- [@standard-schema/spec](https://github.com/standard-schema/standard-schema)

## License

MIT © Andrey Gubanov
