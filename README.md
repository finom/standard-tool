# standard-tool &nbsp;[![npm](https://img.shields.io/npm/v/standard-tool)](https://www.npmjs.com/package/standard-tool) [![CI](https://github.com/finom/standard-tool/actions/workflows/ci.yml/badge.svg)](https://github.com/finom/standard-tool/actions/workflows/ci.yml)

> **Status — Proposal (RFC).** `standard-tool` is an early proposal for a shared, framework-agnostic way to define LLM tools, published to gather feedback and pressure-test the design — **not** a finalized standard, and the shape may still change. Issues, critiques, and counter-proposals are very welcome.

> A common **type** for defining LLM tools — built on [Standard Schema](https://standardschema.dev) + [Standard JSON Schema](https://standardschema.dev/json-schema).

`standard-tool` is a common **type** for defining LLM tools, designed to be produced and consumed by any framework, SDK, or app.

The goal is to let a tool be defined once and used anywhere — across providers and frameworks — instead of writing a separate, incompatible tool object for each one. It builds on [Standard Schema](https://standardschema.dev) and [Standard JSON Schema](https://standardschema.dev/json-schema): the optional `inputSchema`/`outputSchema` both **validate** their data and **emit JSON Schema** for the model.

Like Standard Schema — the shared validation interface implemented by Zod, Valibot, and ArkType — the proposal is an **interface**, not a library you depend on; you can conform to it with a plain object and zero dependencies. The package also ships a small **reference implementation**, the `standardTool()` function, which builds a conforming tool with input/output validation and error-handling included.

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

await getWeather.execute({ city: 'Paris' }); // → { tempC: number } | { error: string }; validated in & out (errors → { error } by default)
```

## What it is

- **Standalone & dependency-free.** A type, plus a small reference implementation of it. The Standard Schema and Standard JSON Schema interfaces are vendored into the package, so installing it pulls in nothing else — and you can just copy the source into your project instead (see [below](#or-just-copy-paste-it)).
- **A convention, not a framework.** It doesn't run your agent, call your model, or own your runtime. It defines only the shape — `{ name, title?, description, inputSchema?, outputSchema?, execute }` — and the things every tool needs: validation, a JSON Schema, and a model-facing result.
- **Validates input _and_ output.** `execute` accepts untrusted input (e.g. JSON arguments from a model), validates it via Standard Schema (when you provide a schema — both are optional), runs your logic, then validates the result. **By default** a validation failure or a thrown error doesn't propagate — it comes back as `{ error: string }`, so a model loop keeps running; pass a `formatOutput` to reshape that (or to re-throw).
- **Emits JSON Schema for any model.** Because the schemas implement Standard JSON Schema, you get an OpenAI- or MCP-ready JSON Schema (any function-calling model) synchronously via `inputSchema['~standard'].jsonSchema.input(...)`.

## Why

Every LLM framework ships its own tool object — Vercel AI SDK, MCP, oRPC, Effect — each a different shape, none portable, most welded to the framework. But the hard part — schema interop — is **already** standardized: Standard Schema for validation and Standard JSON Schema for JSON Schema emission. `standard-tool` is the missing, neutral wrapper around them: small enough to become a shared convention rather than another framework lock-in.

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

/** The default formatted output: your `Output`, or an `{ error }` envelope when execution or validation failed. */
export type DefaultFormattedOutput<Output> = Output | { error: string };

/**
 * A standard, DRY LLM tool over its **data** types `Input`/`Output`: `name` + `description` +
 * optional Standard-Schema/JSON-Schema `inputSchema`/`outputSchema` + `execute(input: Input)`.
 * `FormattedOutput` is what `execute` returns to the model after formatting — by default
 * {@link DefaultFormattedOutput}, i.e. the data or an `{ error }` envelope.
 */
export interface StandardTool<Input = unknown, Output = unknown, FormattedOutput = DefaultFormattedOutput<Output>> {
  name: string;
  /** Optional human-readable label for the tool, surfaced by MCP clients in tool-list UIs. Ignored by plain function-calling APIs. */
  title?: string;
  description: string;
  /** Optional Standard Schema + Standard JSON Schema describing the input data. */
  inputSchema?: CombinedSpec<Input>;
  /** Optional Standard Schema + Standard JSON Schema describing the output data. */
  outputSchema?: CombinedSpec<Output>;
  /**
   * Validate input (when `inputSchema`) → run your logic → validate output (when `outputSchema`) →
   * format. **By default it doesn't throw**: a validation failure or a thrown error becomes the
   * formatted output (`{ error: string }`) — unless your `formatOutput` throws — so a model loop
   * keeps running. `meta` is optional per-call runtime context (auth tokens, resolvers, request-scoped
   * data) forwarded verbatim to your handler — never validated, never in the JSON Schema.
   */
  // biome-ignore lint/suspicious/noExplicitAny: per-call runtime context, typed by the consumer's handler
  execute(input: Input, meta?: any): FormattedOutput | Promise<FormattedOutput>;
}

/**
 * Create a standard tool. `inputSchema`/`outputSchema` are optional; when present they must implement
 * both Standard Schema (validation) and Standard JSON Schema (JSON Schema emission) — e.g. Zod 4.2+,
 * ArkType 2.1.28+, or Valibot 1.2+ via `@valibot/to-json-schema`.
 *
 * Your `execute` receives the (validated) input and returns the output. The returned tool's `execute`
 * validates input, runs yours, validates the result, then formats it via `formatOutput` — which by
 * default turns any error into `{ error: message }` instead of throwing, so a model loop keeps going.
 * Pass your own `formatOutput` to reshape the output (its return type becomes the tool's `FormattedOutput`)
 * or to throw and surface the error. Validation failures are plain `Error`s carrying an `issues` array.
 */
export function standardTool<Input = unknown, Output = unknown, FormattedOutput = DefaultFormattedOutput<Output>>(def: {
  name: string;
  title?: string;
  description: string;
  inputSchema?: CombinedSpec<Input>;
  outputSchema?: CombinedSpec<Output>;
  // biome-ignore lint/suspicious/noExplicitAny: per-call runtime context, typed by the consumer's handler
  execute: (input: Input, meta: any) => Output | Promise<Output>;
  formatOutput?: (result: Output | Error) => FormattedOutput | Promise<FormattedOutput>;
}): StandardTool<Input, Output, FormattedOutput> {
  const formatOutput: (result: Output | Error) => FormattedOutput | Promise<FormattedOutput> =
    def.formatOutput ??
    ((result) => (result instanceof Error ? { error: result.message } : result) as unknown as FormattedOutput);
  return {
    name: def.name,
    title: def.title,
    description: def.description,
    inputSchema: def.inputSchema,
    outputSchema: def.outputSchema,
    async execute(input, meta) {
      let result: Output | Error;
      try {
        const validInput = def.inputSchema ? await validate('input', def.inputSchema, input) : input;
        const output = await def.execute(validInput, meta);
        result = def.outputSchema ? await validate('output', def.outputSchema, output) : output;
      } catch (error) {
        result = error instanceof Error ? error : new Error(String(error));
      }
      return formatOutput(result);
    },
  };
}

async function validate<S extends StandardSchemaV1>(
  target: 'input' | 'output',
  schema: S,
  value: unknown
): Promise<StandardSchemaV1.InferOutput<S>> {
  const result = await schema['~standard'].validate(value); // await covers sync + async
  if (result.issues) {
    // A plain Error carrying the Standard Schema issues — no dedicated error type needed.
    throw Object.assign(new Error(`${target} validation failed: ${result.issues.map((i) => i.message).join('; ')}`), {
      issues: result.issues,
    });
  }
  return result.value;
}
```

## API

```ts
import { standardTool, type StandardTool } from 'standard-tool';

standardTool(def): StandardTool<Input, Output, FormattedOutput>;
```

`Input`/`Output` are your **data types** (what your `execute` accepts and returns); the optional schemas describe them. `FormattedOutput` is what the tool hands the model after formatting — `Output | { error: string }` by default. `execute` also takes an optional second `meta` argument — per-call runtime context forwarded verbatim to your handler, never validated and never in the JSON Schema (see [Per-call runtime context](#per-call-runtime-context-meta)).

| field | type | purpose |
| --- | --- | --- |
| `name` | `string` | tool name sent to the model |
| `title?` | `string` | optional human-readable label — surfaced by MCP clients in tool-list UIs; ignored by plain function-calling APIs |
| `description` | `string` | what the tool does |
| `inputSchema?` | `CombinedSpec<Input>` | optional input schema — validates **and** emits JSON Schema |
| `outputSchema?` | `CombinedSpec<Output>` | optional output schema — validates **and** emits JSON Schema |
| `execute` (yours) | `(input: Input, meta: any) => Output \| Promise<Output>` | your logic — receives validated input and the optional per-call `meta`, returns the output |
| `execute` (tool) | `(input: Input, meta?: any) => FormattedOutput \| Promise<FormattedOutput>` | validate in → run yours (forwarding `meta`) → validate out → format; errors become the output (no throw) **by default** |
| `formatOutput?` | `(result: Output \| Error) => FormattedOutput` | optional; maps the result — or an `Error` carrying `issues` — to the model output. Default `result instanceof Error ? { error: result.message } : result` |

`inputSchema`/`outputSchema` are optional; when present they must implement both Standard Schema and Standard JSON Schema (Zod 4.2+, ArkType 2.1.28+, or Valibot 1.2+ via `@valibot/to-json-schema`) — `Input`/`Output` are inferred from them (or from `execute` when a schema is omitted).

`standardTool` is deliberately a **thin utility**: `name`, `description`, `inputSchema`, and `outputSchema` are returned **exactly as you passed them**. Only `execute` is wrapped — it validates input and output (when schemas are present), then routes the result, or any thrown error (a validation failure is a plain `Error` carrying `issues`), through `formatOutput`. `formatOutput` defaults to the `{ error }` envelope so bad data doesn't throw and a model loop keeps going; supply your own to reshape the output (its return type becomes the tool's `FormattedOutput`) or to throw and surface the error. Note `formatOutput` is a **creation-time argument, not a field** on the returned tool — the shape stays the minimal `{ name, title?, description, inputSchema?, outputSchema?, execute }`. That's the whole job.

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

// validated end to end — by default, bad input or output comes back as { error: string } (override via formatOutput):
const out = await getWeather.execute({ city: 'Paris' }); // { tempC: number } | { error: string }

// JSON Schema for the model (Standard JSON Schema), synchronous (inputSchema is optional, hence `!`):
const parameters = getWeather.inputSchema!['~standard'].jsonSchema.input({ target: 'draft-2020-12' });
```

## Per-call runtime context (`meta`)

Tools often need per-call data that must **not** appear in the model-facing `inputSchema` — an auth token, a resolver, a request-scoped DB handle. `execute` takes an optional **second `meta` argument**, forwarded verbatim to your handler. It's never validated and never part of the JSON Schema, so your tools can stay **static** (defined once at module scope) while you inject context at call time — instead of closing over it in a per-render factory.

`meta` is typed `any`; **annotate it on your handler** to type it at the call site:

```ts
const greet = standardTool({
  name: 'greet',
  description: 'Greet a person with per-call punctuation',
  inputSchema: z.object({ name: z.string() }),
  execute: ({ name }, meta: { punct: string }) => `hi ${name}${meta.punct}`, // annotate meta here
});

await greet.execute({ name: 'Ada' }, { punct: '!' }); // → 'hi Ada!'
```

Tools that don't need it just call `execute(input)` — `meta` is optional.

## Throwing instead of the `{ error }` envelope

By default a validation failure or a thrown error comes back as `{ error: string }`, so a model loop can keep running. When you'd rather have `execute` **throw** — e.g. to let a caller's `try/catch` handle failures — re-throw the `Error` from `formatOutput`:

```ts
const getWeather = standardTool({
  name: 'get_weather',
  description: 'Current temperature for a city',
  inputSchema: z.object({ city: z.string() }),
  outputSchema: z.object({ tempC: z.number() }),
  execute: async ({ city }) => ({ tempC: 21 }),
  formatOutput: (result) => {
    if (result instanceof Error) throw result; // validation/exec failures now reject
    return result;
  },
});

await getWeather.execute({ city: 'Paris' }); // { tempC: number } — rejects on bad input/output
```

## MCP-compatible output

[MCP](https://modelcontextprotocol.io) tools return a structured **result envelope** — `{ content, structuredContent?, isError? }` — not just raw data. A `formatOutput` can map `execute`'s result onto exactly that shape, so a `standard-tool` is consumable by an MCP server with no translation. This one is **text-only**: an object result is JSON-encoded into a text block _and_ mirrored into `structuredContent` (per MCP's [backwards-compatibility guidance](https://modelcontextprotocol.io/specification/2025-06-18/server/tools#structured-content)), errors come back with `isError: true` (a self-correctable tool error), and image/audio/resource blocks are out of scope.

```ts
type McpToolResult = {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

// A plain function — standardTool adapts it (infers FormattedOutput from the return type).
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

Wire it in as `formatOutput`, and `execute` returns a value shaped exactly like an MCP `CallToolResult`:

```ts
const getWeather = standardTool({
  name: 'get_weather',
  title: 'Get weather',
  description: 'Current temperature for a city',
  inputSchema: z.object({ city: z.string() }),
  outputSchema: z.object({ tempC: z.number() }),
  execute: async ({ city }) => ({ tempC: 21 }),
  formatOutput: toMcpResult,
});

await getWeather.execute({ city: 'Paris' });
// → { content: [{ type: 'text', text: '{"tempC":21}' }], structuredContent: { tempC: 21 } }
//
// bad input, a thrown error, or invalid output instead →
// → { content: [{ type: 'text', text: 'input validation failed: …' }], isError: true }
```

That's the exact shape an MCP server returns from a `tools/call` handler — so a `standard-tool` drops straight in. Wiring it into a specific MCP SDK is out of scope here.

## With the OpenAI API

Uses the [Responses API](https://developers.openai.com/api/docs/guides/function-calling). Because every tool is the same neutral shape, you keep them in one array: `.map` it into the request's `tools`, then dispatch each function call back to the matching tool by `name`. Adding a fourth tool is one more array entry — no special-casing, no per-tool wiring. And because `execute` returns `{ error }` instead of throwing **by default**, a malformed tool call comes back to the model to self-correct rather than crashing your loop (a custom `formatOutput` can opt back into throwing).

```ts
import OpenAI from 'openai';
import { z } from 'zod';
import { standardTool, type StandardTool } from 'standard-tool';

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
  const result = await tool.execute(JSON.parse(item.arguments)); // validates args + result; bad args → { error } by default
  input.push({ type: 'function_call_output', call_id: item.call_id, output: JSON.stringify(result) });
}

const final = await client.responses.create({ model: 'gpt-5', input });
console.log(final.output_text);
```

## Links

- **Standard Schema** — https://standardschema.dev
- **Standard JSON Schema** — https://standardschema.dev/json-schema
- **@standard-schema/spec** — https://github.com/standard-schema/standard-schema

## License

MIT © Andrey Gubanov
