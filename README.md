# StandardTool &nbsp;[![npm](https://img.shields.io/npm/v/standard-tool)](https://www.npmjs.com/package/standard-tool) [![CI](https://github.com/finom/standard-tool/actions/workflows/ci.yml/badge.svg)](https://github.com/finom/standard-tool/actions/workflows/ci.yml)

> **Status: proposal (RFC).** This is an early proposal for a shared, framework-agnostic way to define LLM tools. It's published to gather feedback and pressure-test the design, not as a finished standard, so the shape may still change. Issues, critiques, and counter-proposals are welcome.

> A common type for defining LLM tools, built on [Standard Schema](https://standardschema.dev) and [Standard JSON Schema](https://standardschema.dev/json-schema).

StandardTool is a common **type** for defining LLM tools, meant to be produced and consumed by any framework, SDK, or app. Define a tool once and use it anywhere — across providers and frameworks — instead of writing a separate, incompatible tool object for each.

It builds on [Standard Schema](https://standardschema.dev) and [Standard JSON Schema](https://standardschema.dev/json-schema): the optional `inputSchema` and `outputSchema` both validate their data and emit JSON Schema for the model. Like Standard Schema — the shared validation interface Zod, Valibot, and ArkType implement — it's an interface, not a library you depend on, so you can conform with a plain object and zero dependencies.

## Why

Every LLM and agent ecosystem ships its own tool object — Vercel AI SDK, MCP, oRPC, Effect, Mastra, Genkit, LangChain. The shapes are all different, none is portable, and most are welded to a framework or a vendor SDK. Yet they describe the same handful of things: a name, a description, an input schema, an optional output schema, an `execute` function, and a little metadata.

The genuinely hard part of that list — schema interop — is already solved. [Standard Schema](https://standardschema.dev) unifies validation, and [Standard JSON Schema](https://standardschema.dev/json-schema) unifies JSON Schema emission; together they handle the two jobs a tool's schemas must do at once: tell a model how to call the tool, and validate the untrusted arguments it sends back. Once the schemas are Standard (JSON) Schema objects, everything left in a tool is a string, a string, and a function.

So the effort is inverted. Frameworks pour energy into re-inventing the trivial envelope and binding it to their runtime, while the part that could justify a framework is already a shared, neutral interface. StandardTool applies the Standard Schema move one level up — it standardizes the envelope too, as a neutral, dependency-free interface with no runtime, so a tool authored once can be produced or consumed by anything. It's about 30 lines, small enough to be a shared convention rather than another lock-in. ([The landscape](#the-landscape) backs this up in detail.)

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

`execute` takes the model's `Input` and returns the tool's result. Both schemas are optional; when present they validate runtime data (a model's arguments are untrusted input) and emit a model-ready JSON Schema synchronously via `inputSchema['~standard'].jsonSchema.input(...)`. `CombinedSpec<T>` is just "a schema that does both" — implemented by Zod 4.2+, ArkType 2.1.28+, or Valibot 1.2+ (via `@valibot/to-json-schema`). It's a convention, not a framework: it owns the shape and nothing else — it won't run your agent, call your model, or own your runtime.

The shape maps almost 1:1 onto MCP's `Tool` (`name`, `title`, `description`, `inputSchema`, `outputSchema`), which is why a StandardTool plugs into an MCP server with no translation and into provider APIs with a one-line `.map`.

A tool is **neutral** when `FormattedOutput = Output`: `execute` returns the raw `Output`. The third parameter lets the same type describe a **formatted** tool too — one whose `execute` returns a consumer-specific shape (an MCP envelope, or `{ error }` on failure). Producing those is the job of [`FormattableStandardTool`](#the-formatting-layer). `StandardTool` is the normative surface; the `standardTool()` function below is only a reference implementation — anything that produces a matching object interoperates.

## Quick start

Install with `npm i standard-tool` and a schema library (options [below](#install)), or [copy-paste the source](#zero-dependency-copy-paste) for zero dependencies.

The package ships a reference implementation, `standardTool()`, that builds a conforming tool which validates input and output and throws on a violation:

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

// validated end to end; returns the raw Output and throws on bad input or output:
await getWeather.execute({ city: 'Paris' }); // → { tempC: number }

// want failures as data instead of throws? format it (see below):
await getWeather.formatted().execute({ city: 'Paris' }); // → { tempC: number } | { error: string }

// JSON Schema for the model (Standard JSON Schema), synchronous (inputSchema is optional, hence `!`):
const parameters = getWeather.inputSchema!['~standard'].jsonSchema.input({ target: 'draft-2020-12' });
```

`standardTool()` is dependency-free — the Standard Schema interfaces are vendored in.

## Install

```sh
npm i standard-tool
# bring any library that implements BOTH Standard Schema and Standard JSON Schema:
npm i zod          # 4.2+   (or `arktype` 2.1.28+, or `valibot` + `@valibot/to-json-schema`)
```

Prefer no dependency at all? [Copy-paste the ~70-line source](#zero-dependency-copy-paste) instead of installing.

## The formatting layer

`StandardTool` stays minimal — `{ name, title?, description, inputSchema?, outputSchema?, execute }`, no methods — so anything can produce or consume one with a plain object and zero dependencies. The reference `standardTool()` returns a **`FormattableStandardTool`**: that same shape plus two additive members, so a `FormattableStandardTool` is always a valid `StandardTool`.

```ts
interface FormattableStandardTool<Input = unknown, Output = unknown, FormattedOutput = Output>
  extends StandardTool<Input, Output, FormattedOutput> {
  executeRaw(input: Input, meta?: unknown): Output | Promise<Output>;  // the bare handler — no validation
  formatted<F>(format?: (result: Output | Error) => F | Promise<F>): FormattableStandardTool<Input, Output, F>;
}
```

From one definition it yields three kinds of tool: a **neutral** one (`execute` returns the validated `Output`, throwing on a violation), a **formatted** one (`execute` returns a consumer-specific shape), and a **re-formatted** one (a tool already formatted for one consumer, re-targeted for another).

- `executeRaw` is the bare handler — your logic with **no** validation or formatting. Hand it to a framework that validates its own way (alongside `inputSchema`); formatting keeps it intact.
- `formatted()` re-derives from the validated `execute`, so formatting never stacks on formatting. A tool a framework shipped pre-formatted for itself can still be re-targeted by you, or run raw.

### Formatting the result

A neutral tool like the `getWeather` above throws on a validation failure or a thrown error, and returns its own `Output` otherwise. That's the right default for typed code, but a model loop usually wants a failure to come back as *data* it can self-correct from, and some consumers (MCP) want a specific result envelope. `formatted()` is how you opt into that, without changing the tool's `Input` or `Output`:

```ts
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

Formatting swaps only that third generic; `Input` and `Output` are untouched, and the bare handler is carried along as `executeRaw`. So a formatted tool stays re-formattable, and the unvalidated handler stays reachable:

```ts
const enveloped = getWeather.formatted();                     // { error } envelope
await enveloped.executeRaw({ city: 'Paris' });                // → { tempC: 21 } (the bare handler; no validation)
await enveloped.formatted(asText).execute({ city: 'Paris' }); // → '21°C', re-derived from the validated Output
```

Re-formatting *replaces*, it doesn't compose: each `formatted()` re-derives from the validated `execute`, never from the previous formatting. That's what lets a framework ship a tool pre-formatted for itself while you stay free to re-target it for another consumer — or run the bare `executeRaw`.

## Per-call context (`meta`)

Tools often need per-call data that should not appear in the model-facing `inputSchema` — a locale, an auth token, a request-scoped DB handle. `execute` takes an optional second `meta` argument, forwarded verbatim to your handler. It's never validated and never part of the JSON Schema, so your tools can stay static (defined once at module scope) while you inject context at call time, instead of closing over it in a per-render factory.

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

## One tool, many consumers

This is the payoff of a neutral shape: the same object flows everywhere. Below, one array of tools is wired into [OpenAI](#openai), [Anthropic](#anthropic), the [Vercel AI SDK](#vercel-ai-sdk), and [MCP](#mcp) — the SDKs that accept a JSON Schema object or a Standard Schema directly. Each example keeps the tools in one array, maps it into the provider's request, and dispatches each tool call back by `name`, all inline. (An SDK that takes only a library-specific schema, such as a Zod raw shape, would need a per-library shim, so it's out of scope here.) In real code you'd factor these into your own abstractions; here they're spelled out.

Two parts of a tool do the work in every integration:

- `inputSchema['~standard'].jsonSchema.input({ target })` — the JSON Schema you hand the model so it knows how to call the tool.
- `execute(args)` — runs the tool, validating the model's arguments and the result and throwing on a violation. `formatted().execute(args)` returns `{ error }` instead of throwing, which is usually what you want inside a model loop.

> The examples assume you've installed the provider SDK you're using (`openai`, `@anthropic-ai/sdk`, or `ai` with `@ai-sdk/*`) plus `standard-tool` and `zod`. They use Zod, but the model only ever sees the JSON Schema a tool emits, so Valibot or ArkType work the same way.

### The shared tools

Define the tools once; every example below imports this array. Adding a fourth tool is one more array entry — no special-casing, no per-tool wiring.

```ts
// tools.ts
import { standardTool, type FormattableStandardTool } from 'standard-tool';
import { z } from 'zod';

export const tools: FormattableStandardTool[] = [
  standardTool({
    name: 'get_weather',
    description: 'Get the current temperature for a city.',
    inputSchema: z.object({ city: z.string() }),
    outputSchema: z.object({ tempC: z.number() }),
    execute: async ({ city }) => ({ tempC: 21 }),
  }),
  standardTool({
    name: 'get_time',
    description: 'Get the current time in an IANA timezone.',
    inputSchema: z.object({ timezone: z.string() }),
    outputSchema: z.object({ iso: z.string() }),
    execute: async ({ timezone }) => ({ iso: new Date().toLocaleString('en-US', { timeZone: timezone }) }),
  }),
  standardTool({
    name: 'convert_currency',
    description: 'Convert an amount between two currencies.',
    inputSchema: z.object({ amount: z.number(), from: z.string(), to: z.string() }),
    outputSchema: z.object({ amount: z.number() }),
    execute: async ({ amount }) => ({ amount: Math.round(amount * 1.08 * 100) / 100 }),
  }),
];
```

### OpenAI

#### Chat Completions

Tools go in under a `function` key; calls come back on `message.tool_calls`; each result is a `role: 'tool'` message.

```ts
import OpenAI from 'openai';
import { tools } from './tools';

const client = new OpenAI();

const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
  { role: 'user', content: 'What is the weather in Paris?' },
];

const res = await client.chat.completions.create({
  model: 'gpt-5.5',
  messages,
  tools: tools.map((tool): OpenAI.Chat.ChatCompletionTool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema!['~standard'].jsonSchema.input({ target: 'draft-2020-12' }),
    },
  })),
});

messages.push(res.choices[0].message);
for (const call of res.choices[0].message.tool_calls ?? []) {
  if (call.type !== 'function') continue;
  const tool = tools.find((t) => t.name === call.function.name);
  if (!tool) continue;
  const result = await tool.formatted().execute(JSON.parse(call.function.arguments));
  messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
}

const final = await client.chat.completions.create({ model: 'gpt-5.5', messages });
console.log(final.choices[0].message.content);
```

#### Responses API

The Responses API is flatter — it drops the `function` wrapper and adds an optional `strict`. Tool calls arrive as `function_call` items in `res.output`, and results go back as `function_call_output`:

```ts
import OpenAI from 'openai';
import { tools } from './tools';

const client = new OpenAI();

const input: OpenAI.Responses.ResponseInput = [{ role: 'user', content: 'What is the weather in Paris?' }];

const res = await client.responses.create({
  model: 'gpt-5.5',
  input,
  tools: tools.map((tool): OpenAI.Responses.Tool => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema!['~standard'].jsonSchema.input({ target: 'draft-2020-12' }),
    strict: false,
  })),
});

input.push(...res.output);
for (const item of res.output) {
  if (item.type !== 'function_call') continue;
  const tool = tools.find((t) => t.name === item.name);
  if (!tool) continue;
  const result = await tool.formatted().execute(JSON.parse(item.arguments));
  input.push({ type: 'function_call_output', call_id: item.call_id, output: JSON.stringify(result) });
}

const final = await client.responses.create({ model: 'gpt-5.5', input });
console.log(final.output_text);
```

### Anthropic

The Messages API uses `input_schema` instead of `parameters`, returns `tool_use` blocks in the assistant's `content`, and expects `tool_result` blocks in a following `user` message.

```ts
import Anthropic from '@anthropic-ai/sdk';
import { tools } from './tools';

const client = new Anthropic();

const messages: Anthropic.MessageParam[] = [{ role: 'user', content: 'What is the weather in Paris?' }];

const res = await client.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 1024,
  messages,
  tools: tools.map((tool): Anthropic.Tool => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema!['~standard'].jsonSchema.input({ target: 'draft-2020-12' }) as Anthropic.Tool.InputSchema,
  })),
});

messages.push({ role: 'assistant', content: res.content });
const results: Anthropic.ToolResultBlockParam[] = [];
for (const block of res.content) {
  if (block.type !== 'tool_use') continue;
  const tool = tools.find((t) => t.name === block.name);
  if (!tool) continue;
  const result = await tool.formatted().execute(block.input);
  results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
}
messages.push({ role: 'user', content: results });

const final = await client.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 1024, messages });
console.log(final.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join(''));
```

### Vercel AI SDK

The AI SDK (version 6) runs the tool loop itself: give `generateText` a set of tools and a `stopWhen` condition and it calls them and feeds results back until the model answers.

A tool's `inputSchema` is already a Standard Schema, and the SDK accepts one directly — it derives the model-facing JSON Schema and validates the model's arguments from it. So pass `inputSchema` as-is and give `execute` the tool's `executeRaw` — the bare handler. The SDK has already validated the arguments, so `executeRaw` skips a second check and just runs (the SDK doesn't validate the output either way).

```ts
import { generateText, tool, stepCountIs } from 'ai';
import { openai } from '@ai-sdk/openai';
import { tools } from './tools';

const { text } = await generateText({
  model: openai('gpt-5.5'), // or anthropic('claude-sonnet-4-6')
  prompt: 'What is the weather in Paris?',
  stopWhen: stepCountIs(5),
  tools: Object.fromEntries(
    tools.map(({ name, description, inputSchema, executeRaw }) => [
      name,
      tool({ description, inputSchema, execute: executeRaw }),
    ]),
  ),
});

console.log(text);
```

### MCP

[MCP](https://modelcontextprotocol.io) tools return a structured result envelope, `{ content, structuredContent?, isError? }`, not just raw data, and a descriptor whose `inputSchema`/`outputSchema` are JSON Schema. A StandardTool maps onto both with the same two parts:

- **`tools/list`** — `inputSchema['~standard'].jsonSchema.input({ target })` (and `.output({ target })`) give the JSON Schema for the descriptor (`name`, `title`, `description`).
- **`tools/call`** — a `.formatted(toMcpResult)` formatter maps `execute`'s result onto the envelope, so `execute` returns a value shaped exactly like an MCP `CallToolResult`.

The formatter below is text-only: an object result is JSON-encoded into a text block and also mirrored into `structuredContent` (per MCP's [backwards-compatibility guidance](https://modelcontextprotocol.io/specification/2025-06-18/server/tools#structured-content)), errors come back with `isError: true` (a self-correctable tool error), and image, audio, and resource blocks are out of scope.

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

Apply it and wire the two methods. `execute` validates once, so don't also register a validating schema for the same call:

```ts
import { tools } from './tools';

const mcpTools = tools.map((t) => t.formatted(toMcpResult));

// tools/list — MCP's Tool is a JSON Schema object, so emit it directly. (The high-level registerTool helper
// instead wants a Zod raw shape and would validate a second time; going through JSON Schema stays
// library-agnostic and leaves execute the single validator.)
const descriptors = mcpTools.map((t) => ({
  name: t.name,
  title: t.title,
  description: t.description,
  inputSchema: t.inputSchema!['~standard'].jsonSchema.input({ target: 'draft-2020-12' }),
}));

// tools/call — execute validates once, then returns the MCP result shape
async function call(name: string, args: unknown) {
  const tool = mcpTools.find((t) => t.name === name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  return tool.execute(args); // → { content: [{ type: 'text', text: '{"tempC":21}' }], structuredContent: { tempC: 21 } }
}
```

That's the exact shape an MCP server returns from a `tools/call` handler, so a StandardTool drops straight in. Wiring it into a specific MCP SDK is out of scope here.

### Testing

No model, no framework — just data in and out:

```ts
import { tools } from './tools';

const getWeather = tools.find((t) => t.name === 'get_weather')!;

expect(await getWeather.execute({ city: 'Paris' })).toEqual({ tempC: 21 });
await expect(getWeather.execute({ city: 123 as never })).rejects.toThrow();                       // a neutral tool throws on bad input
expect(await getWeather.formatted().execute({ city: 123 as never })).toMatchObject({ error: expect.any(String) }); // or, as data
```

### Derived from an existing API

A derive-from-API layer can emit StandardTool-shaped objects from typed RPC procedures or imported OpenAPI specs, so an existing backend becomes a tool catalog without hand-writing wrappers. Broaden the lens and the same shape also underwrites a shareable tool registry (publish reusable tools as plain objects, not framework plugins), cross-runtime use (zero deps, so it runs in the browser, on the edge, in workers), and multi-target apps that must speak to several providers and an MCP endpoint from one definition.

### Notes

- **Who validates.** OpenAI and Anthropic don't check tool arguments against your schema, so `formatted().execute` is the only validation — that's why those examples call it on the model's raw args. The AI SDK validates **input** from the schema you give it (it doesn't enforce output), so you hand it `inputSchema` to describe and validate the call, plus `executeRaw` — the bare handler — to avoid validating the same input twice.
- **Errors as data.** `execute` throws on a schema-invalid argument or result; `formatted().execute` returns `{ error }` instead, so an invalid argument goes back to the model to fix. `JSON.parse` runs before `execute`, so guard it if the model might emit invalid JSON syntax — that throws before `execute` can turn it into `{ error }`.
- **JSON Schema targets.** `{ target: 'draft-2020-12' }` fits OpenAI and Anthropic; use `'openapi-3.0'` for consumers that want the OpenAPI subset (such as Gemini), or `'draft-07'`.
- **Per-call context.** Pass data the model shouldn't see (an auth token, tenant, locale) as the second argument to `execute(input, meta)`. It's never validated and never in the JSON Schema (see [Per-call context](#per-call-context-meta)).

## API

```ts
import { standardTool, type StandardTool, type FormattableStandardTool } from 'standard-tool';

standardTool(def): FormattableStandardTool<Input, Output>;          // reference impl: validates in & out, throws on a violation
tool.formatted(format?): FormattableStandardTool<Input, Output, F>; // opt into a consumer-specific result (or { error } envelope)
```

`Input` and `Output` are your data types: what your `execute` accepts and returns. The optional schemas describe them. A neutral tool's `execute` validates both, returns the validated `Output`, and throws on a violation. It also takes an optional second `meta` argument — per-call runtime context forwarded verbatim to your handler, never validated and never in the JSON Schema (see [Per-call context](#per-call-context-meta)).

| field | type | purpose |
| --- | --- | --- |
| `name` | `string` | tool name sent to the model |
| `title?` | `string` | optional human-readable label, surfaced by MCP clients in tool-list UIs; ignored by plain function-calling APIs |
| `inputSchema?` | `CombinedSpec<Input>` | optional input schema; validates and emits JSON Schema |
| `outputSchema?` | `CombinedSpec<Output>` | optional output schema; validates and emits JSON Schema |
| `description` | `string` | what the tool does |
| `execute` (yours) | `(input: Input, meta?: unknown) => Output \| Promise<Output>` | your logic; receives validated input and the optional per-call `meta` (annotate it to type it), returns the output |
| `execute` (tool) | `(input: Input, meta?: unknown) => Promise<Output>` | validate in, run yours (forwarding `meta`), validate out; returns the validated `Output`, throwing a `StandardToolValidationError` on a violation |

`inputSchema` and `outputSchema` are optional. When present they must implement both Standard Schema and Standard JSON Schema (Zod 4.2+, ArkType 2.1.28+, or Valibot 1.2+ via `@valibot/to-json-schema`). `Input` and `Output` are inferred from them, or from `execute` when a schema is omitted.

The reference `standardTool()` returns a `FormattableStandardTool` — the normative shape plus two additive members:

| member | type | purpose |
| --- | --- | --- |
| `executeRaw` | `(input: Input, meta?: unknown) => Output \| Promise<Output>` | the bare handler — runs your logic with **no** validation or formatting. Hand it to a framework that validates its own way (alongside `inputSchema`); formatting keeps it intact |
| `formatted` | `(format?) => FormattableStandardTool<Input, Output, F>` | opt into a consumer-specific result; see [Formatting the result](#formatting-the-result) |

The thrown `StandardToolValidationError` carries `target: 'input' \| 'output'` and the Standard Schema `issues`, so a formatter (or a `catch`) can build a rich result.

## Zero-dependency copy-paste

No dependency at all. Paste this and import the spec types from the official, types-only [`@standard-schema/spec`](https://github.com/standard-schema/standard-schema) (`npm i -D @standard-schema/spec`). It's the same logic as the published package, with the vendored interfaces swapped for that import:

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
    super(
      `${target} validation failed: ${issues
        .map((i) => {
          const at = (i.path ?? []).map((s) => String(typeof s === 'object' ? s.key : s)).join('.');
          return at ? `${at}: ${i.message}` : i.message;
        })
        .join('; ')}`
    );
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

/** A `StandardTool` that exposes the unvalidated `executeRaw` and can (re-)format its validated result. */
export interface FormattableStandardTool<Input = unknown, Output = unknown, FormattedOutput = Output>
  extends StandardTool<Input, Output, FormattedOutput> {
  executeRaw(input: Input, meta?: unknown): Output | Promise<Output>;
  formatted<F = Output | { error: string }>(
    format?: (result: Output | Error) => F | Promise<F>
  ): FormattableStandardTool<Input, Output, F>;
}

/** Reference implementation: validate input → run the handler → validate output. The result is re-formattable. */
export function standardTool<Input = unknown, Output = unknown>(
  def: StandardTool<Input, Output>
): FormattableStandardTool<Input, Output, Output> {
  const { execute: executeRaw, ...rest } = def;
  // `executeRaw` is the bare handler (no validation); `execute` wraps it with input/output validation and throws.
  const execute = async (input: Input, meta?: unknown): Promise<Output> => {
    const value = def.inputSchema ? await validate('input', def.inputSchema, input) : input;
    const output = await executeRaw(value, meta);
    return def.outputSchema ? await validate('output', def.outputSchema, output) : output;
  };
  const tool: FormattableStandardTool<Input, Output, Output> = {
    ...rest,
    execute,
    executeRaw,
    formatted<F = Output | { error: string }>(
      format?: (result: Output | Error) => F | Promise<F>
    ): FormattableStandardTool<Input, Output, F> {
      // Default formatter: pass a success through, turn a thrown Error into `{ error }`.
      const fmt = (format ?? ((r: Output | Error) => (r instanceof Error ? { error: r.message } : r))) as (
        result: Output | Error
      ) => F | Promise<F>;
      // Wrap the validated `execute`, never the previous formatting; `...tool` carries everything else
      // (including this method and `executeRaw`), so the result stays re-formattable.
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

## The landscape

The argument in [Why](#why) rests on a claim worth backing up: every ecosystem ships its own envelope, while the schema layer underneath is already standardized. Here's the survey.

### The anatomy of a tool

Strip away the branding and every tool definition across every ecosystem is the same six things:

| Concern | What it is | Who consumes it |
| --- | --- | --- |
| name | stable identifier the model emits | the model |
| description | natural-language "what/when to use" | the model |
| input schema | parameter shape, as JSON Schema | the model (to emit args) and your code (to validate them) |
| output schema | result shape | your code, some clients (MCP) |
| execute | the function that runs | your runtime |
| metadata | title, annotations, hints | clients/UIs |

Two of these — the input schema and the output schema — carry all the real complexity, because they serve two masters at once. They have to emit JSON Schema (so a model can be told how to call the tool) and validate runtime data (because the arguments a model emits are untrusted input). Everything else is a string or a function. The industry reinvents the trivial parts (the envelope) over and over, while the hard part (the dual schema role) was solved once by the Standard Schema family.

### Provider wire formats

These are the formats you serialize a tool into when you call a model. They have largely converged on "JSON Schema for the parameters," but they disagree on the wrapper and on the JSON Schema dialect.

OpenAI's Chat Completions format:

```jsonc
{
  "type": "function",
  "function": {
    "name": "get_weather",
    "description": "Current temperature for a city",
    "parameters": { "type": "object", "properties": { "city": { "type": "string" } }, "required": ["city"], "additionalProperties": false },
    "strict": true
  }
}
```

OpenAI's Responses API is flatter and drops the `function` wrapper:

```jsonc
{ "type": "function", "name": "get_weather", "description": "…", "parameters": { /* JSON Schema */ }, "strict": true }
```

`strict: true` is built on Structured Outputs and imposes extra rules on the JSON Schema: every object needs `additionalProperties: false`, and every property must be listed in `required` (optionals are expressed as `"type": ["string", "null"]`). So the same logical schema must be emitted differently depending on whether strict mode is on. ([function calling guide](https://developers.openai.com/api/docs/guides/function-calling), [structured outputs](https://openai.com/index/introducing-structured-outputs-in-the-api/))

Anthropic's Messages API uses an `input_schema` key instead of `parameters`:

```jsonc
{ "name": "get_weather", "description": "…", "input_schema": { "type": "object", "properties": { "city": { "type": "string" } }, "required": ["city"] } }
```

Google Gemini's `functionDeclarations` wrap the same idea but accept only an OpenAPI 3.0 subset, not full JSON Schema:

```jsonc
{ "functionDeclarations": [ { "name": "get_weather", "description": "…", "parameters": { "type": "object", "properties": { "city": { "type": "string" } }, "required": ["city"] } } ] }
```

Supported keywords are limited (`type`, `properties`, `items`, `enum`, `required`, and a few more); `default`, `oneOf`, and others are not supported. ([Gemini function calling](https://ai.google.dev/gemini-api/docs/function-calling))

The Model Context Protocol (MCP), introduced by Anthropic, is the closest thing to a cross-vendor standard for tools. Its `Tool` is:

```jsonc
{
  "name": "get_weather",
  "title": "Weather Information Provider",
  "description": "…",
  "inputSchema":  { "type": "object", "properties": { /* … */ }, "required": ["city"] },
  "outputSchema": { "type": "object", "properties": { /* … */ } },
  "annotations":  { /* behavior hints */ }
}
```

MCP also defines structured results (`structuredContent`) and says that when an `outputSchema` is present, "servers MUST provide structured results that conform to this schema" and "clients SHOULD validate" them. ([MCP tools spec, 2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18/server/tools))

The OpenAI-compatible crowd (Mistral, Groq, Together, Fireworks, and many local servers via LM Studio or Ollama) reuses the OpenAI `tools` shape, which is why it has become a de-facto baseline. But "compatible" still varies in JSON Schema support and strict-mode behavior.

> Takeaway: the parameters are JSON Schema almost everywhere, but the wrapper key (`parameters` vs `input_schema` vs `inputSchema` vs `functionDeclarations`), the dialect (full draft-2020-12 vs OpenAPI-3.0 subset vs strict-mode-constrained), and the result shape all differ.

### Framework and SDK tool objects

These wrap the wire format and the execution. This is where fragmentation is worst, because each one invents its own object and binds it to its own runtime.

The Vercel AI SDK uses `tool()` from the `ai` package:

```ts
import { tool } from 'ai';
import { z } from 'zod';

const getWeather = tool({
  description: 'Current temperature for a city',
  inputSchema: z.object({ city: z.string() }),         // Zod or jsonSchema()
  execute: async ({ city }) => ({ tempC: 21 }),
  // outputSchema?, toModelOutput?
});
```

The `tool()` helper exists so TypeScript can connect `inputSchema` to `execute`'s argument types. Tools are keyed by name in a record passed to `generateText`/`streamText`, and the value is coupled to the SDK's own `Tool`/`ToolSet` types. ([AI SDK `tool` reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/tool))

The MCP TypeScript SDK uses `registerTool`:

```ts
server.registerTool(
  'get_weather',
  { title: 'Weather', description: '…', inputSchema: { city: z.string() } },  // raw Zod shape
  async ({ city }) => ({ content: [{ type: 'text', text: '…' }] }),
);
```

Mastra's `createTool` already leans on the Standard family:

```ts
createTool({
  id: 'get-weather',
  description: '…',
  inputSchema: z.object({ city: z.string() }),
  outputSchema: z.object({ tempC: z.number() }),
  execute: async ({ context }) => ({ tempC: 21 }),
});
```

Mastra's docs state that input and output schemas "can be defined using any library that supports Standard JSON Schema, including Zod, Valibot, and ArkType." ([Mastra `createTool`](https://mastra.ai/reference/tools/create-tool)) So one major framework already builds its tool schemas on the same foundation as this proposal. The tool object, though, stays bound to `@mastra/core` (see below).

The rest follow the same pattern. Genkit exposes `ai.defineTool({ name, description, inputSchema, outputSchema }, fn)`. LangChain has `tool(fn, { name, description, schema })`, or it infers the schema from the function signature. LlamaIndex has `FunctionTool.from_defaults(fn, name, description, fn_schema)`. Pydantic AI, smolagents, the OpenAI Agents SDK, Semantic Kernel, CrewAI, and AutoGen each have their own decorator or class. oRPC and Effect expose tool and `AiTool` builders.

A compact cross-section:

| Ecosystem | name | desc | params key | output schema | execute | title/meta | schema source |
| --- | --- | --- | --- | --- | --- | --- | --- |
| OpenAI (Responses) | ✅ | ✅ | `parameters` | n/a | (you wire it) | n/a | JSON Schema (+ strict) |
| Anthropic (Messages API) | ✅ | ✅ | `input_schema` | n/a | (you wire it) | n/a | JSON Schema |
| Gemini | ✅ | ✅ | `parameters` | n/a | (you wire it) | n/a | OpenAPI 3.0 subset |
| MCP | ✅ | ✅ | `inputSchema` | `outputSchema` | server handler | `title`, `annotations` | JSON Schema |
| Vercel AI SDK | (key) | ✅ | `inputSchema` | `outputSchema` | `execute` | n/a | Zod / JSON Schema |
| Mastra | `id` | ✅ | `inputSchema` | `outputSchema` | `execute` | n/a | Standard JSON Schema |
| Genkit | ✅ | ✅ | `inputSchema` | `outputSchema` | fn | n/a | Zod |
| LangChain | ✅ | ✅ | `schema` | n/a | fn | n/a | Zod / inferred |
| StandardTool | ✅ | ✅ | `inputSchema` | `outputSchema` | `execute` | `title` | Standard (JSON) Schema |

The columns are nearly identical; the objects are mutually incompatible. And here's the part worth dwelling on: none of these tool primitives is obtainable on its own. Each ships inside a framework package and returns a framework-coupled value.

- Mastra's `createTool` lives in `@mastra/core` (about 50 MB installed, around 31 deps for agents, workflows, memory, storage, vector, and an HTTP server); the docs say you "most likely don't want to use it as a standalone package."
- Genkit's `defineTool` is a method on a live `genkit()` instance, so you can't define a tool without first initializing the framework.
- LangChain's `tool()` returns a `StructuredTool` (a Runnable) from `@langchain/core`.
- The Vercel AI SDK's `tool()` needs the `ai` package and yields an SDK-typed `Tool`.

So "just reuse framework X's tool" means adopting framework X. That gap — identical semantics with incompatible envelopes, each weldable only to its own runtime — is the entire problem.

### The schema layer

The part that's actually standardized:

- JSON Schema is the lingua franca for describing parameters to a model, but it's a family of dialects (draft-07, draft-2020-12, the OpenAPI-3.0 subset, plus provider-specific "strict" constraints).
- [Standard Schema](https://standardschema.dev) is a roughly 60-line TypeScript interface (`~standard`) co-designed by the authors of Zod, Valibot, and ArkType, all of which implement it. Despite the name, it's a community convention — a shared interface that spread by adoption, not a standards-body standard; the same goes for Standard JSON Schema. It unifies validation: any tool can call `schema['~standard'].validate(value)` without knowing which library produced the schema. It's already consumed by tRPC, TanStack Form/Router, and others. Its pitch, reducing N×M integrations to N+M, is exactly the pitch for tools.
- [Standard JSON Schema](https://standardschema.dev/json-schema) is the newer companion that unifies JSON Schema emission. A single interface:

  ```ts
  interface StandardJSONSchemaV1<Input = unknown, Output = Input> {
    readonly '~standard': {
      readonly jsonSchema: {
        readonly input:  (options: { target: Target; libraryOptions?: Record<string, unknown> }) => Record<string, unknown>;
        readonly output: (options: { target: Target; libraryOptions?: Record<string, unknown> }) => Record<string, unknown>;
      };
      // …Standard Schema validate props…
    };
  }
  type Target = 'draft-2020-12' | 'draft-07' | 'openapi-3.0' | (string & {});
  ```

  Crucially, `target` already includes `'openapi-3.0'` alongside the JSON Schema drafts, so the dialect problem above is, by design, the schema library's responsibility, selectable per call. Its stated goals: preserve inferred type information through conversion, require zero runtime dependencies, and let ecosystem tools accept user-defined types "without needing to write custom logic or adapters for each supported library."

Put the schema layer and the framework objects next to each other and the picture is stark. The schema layer is solved — validation (Standard Schema) and emission (Standard JSON Schema) are both handled, implemented by the major validators, and dependency-free to consume. The envelope is not, and it's the easy part. That inversion is what StandardTool is a response to.

## The case against

The objections worth taking seriously:

**Adoption** ([XKCD 927](https://xkcd.com/927/)). A shape that nobody else produces or consumes is just a tidy wrapper for its author, and today that's roughly where StandardTool sits. The bet is that the shape is obvious enough to make adapters trivial, and that Standard Schema shows a neutral interface can spread by adoption rather than mandate. Worth noting that "Standard Schema" and "Standard JSON Schema" aren't ratified standards either; they're conventions that won by adoption (Zod, Valibot, and ArkType implement Standard Schema; tRPC and TanStack consume it), which is the same path this would have to walk. There's no runtime and no lock-in, so the surface area to "win" is small, but it's still one more shape on the pile until others pick it up. This is the honest weak point.

**Why not just extend an existing tool primitive?** Mastra's `createTool` and the AI SDK's `tool()` are the closest prior art. The catch ([above](#framework-and-sdk-tool-objects)) is that each is bundled inside a framework and returns a framework-coupled value: there's no `createTool` without `@mastra/core` (about 50 MB), no `defineTool` without a live `genkit()` instance, no `tool()` without `@langchain/core` or `ai`. The neutral, zero-dependency slot is empty. The nearest neutral thing is MCP's `Tool`, but that's a wire format with no in-process validation or `execute`. If the ecosystem would rather extend one framework's primitive instead, that's a fine outcome; this exists mainly to make the neutral option concrete enough to argue about.

**`meta` is unparameterized.** Per-call context (`execute(input, meta)`) is `unknown`, not a typed generic, because tools are invoked by a model or runtime, not hand-called in typed code, so threading a `Meta` type param bought friction without much payoff. You annotate it on your handler where you read it; it's the one unparameterized corner of an otherwise typed surface.

**`outputSchema` is rarely consumed.** Most provider APIs ignore output schemas; only MCP-style clients validate them. So today it earns its place through your own runtime safety and documentation, not the model.

## Scope: what this is not

- Not an agent runtime. It doesn't loop, plan, or call a model.
- Not a model client. No HTTP, no provider SDKs.
- Not a transport or protocol. MCP defines how tools are served over a wire; StandardTool defines how a tool is shaped in memory. They're complementary, and a StandardTool is trivially served via MCP.
- Not a schema library. It consumes Standard Schema; it doesn't validate or emit JSON Schema itself.
- Not an orchestration framework. No registries, retries, or routing; bring your own.

## Open questions

- Should `meta` be a typed `Meta` generic rather than `unknown`? Currently `unknown` — you annotate it on the handler — to keep the inference surface small.
- Should the formatting layer live on the tool type at all? The normative `StandardTool` stays formatting-free; the separate `FormattableStandardTool` type adds `.formatted()` plus the carried `executeRaw`, so a neutral tool is a plain object and a formatted one can still be re-targeted. Whether that belongs on a tool type or in a fully separate utility is a judgment call.

## Links

**Standards this builds on**

- [Standard Schema](https://standardschema.dev) — the shared validation interface
- [Standard JSON Schema](https://standardschema.dev/json-schema) — the companion for JSON Schema emission
- [`@standard-schema/spec`](https://github.com/standard-schema/standard-schema) — the official, types-only package

**Provider & protocol tool formats**

- [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling) · [Structured Outputs](https://openai.com/index/introducing-structured-outputs-in-the-api/)
- [Anthropic tool use](https://platform.claude.com/docs/en/build-with-claude/tool-use)
- [Google Gemini function calling](https://ai.google.dev/gemini-api/docs/function-calling)
- [MCP tools specification (2025-06-18)](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)

**Framework tool objects**

- [Vercel AI SDK `tool()`](https://ai-sdk.dev/docs/reference/ai-sdk-core/tool) · [tools & tool calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)
- [Mastra `createTool`](https://mastra.ai/reference/tools/create-tool) · [`@mastra/core`](https://www.npmjs.com/package/@mastra/core)
- [Genkit tool calling](https://genkit.dev/docs/tool-calling/)
- [LangChain `@langchain/core`](https://www.npmjs.com/package/@langchain/core)
- [XKCD 927, "Standards"](https://xkcd.com/927/)

## License

MIT © Andrey Gubanov
