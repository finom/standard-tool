# standard-tool

[![npm](https://img.shields.io/npm/v/standard-tool)](https://www.npmjs.com/package/standard-tool) [![CI](https://github.com/finom/standard-tool/actions/workflows/ci.yml/badge.svg)](https://github.com/finom/standard-tool/actions/workflows/ci.yml)

> A **standalone**, dependency-free convention for defining LLM tools — built on [Standard Schema](https://standardschema.dev) + [Standard JSON Schema](https://standardschema.dev/json-schema).

`standard-tool` is one tiny function that gives an LLM tool a single, neutral shape: a `name`, a `description`, an `execute` function, and `inputSchema`/`outputSchema` that both **validate** their data (Standard Schema) and **emit JSON Schema** for the model (Standard JSON Schema). No framework, no runtime dependencies — copy-paste it or `npm i standard-tool`.

It's intended as a **community-wide standard** — the same way [Standard Schema](https://standardschema.dev) became a shared validation interface across Zod, Valibot, and ArkType, and the way the [Vercel AI SDK](https://ai-sdk.dev) popularized a common tool definition. The idea is one neutral contract that any library, framework, or app can **produce or consume**, instead of every project reinventing its own incompatible tool object.

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

- **Standalone & dependency-free.** A single, small function. The Standard Schema and Standard JSON Schema interfaces are vendored into the package, so installing it pulls in nothing else — and you can just copy the source into your project instead (see [below](#or-just-copy-paste-it)).
- **A convention, not a framework.** It doesn't run your agent, call your model, or own your runtime. It defines only the shape — `{ name, description, inputSchema?, outputSchema?, execute }` — and the things every tool needs: validation, a JSON Schema, and a model-facing result.
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

type CombinedSchema<T> = StandardSchemaV1<T> & StandardJSONSchemaV1<T>;

export interface StandardTool<Input, Output, FormattedOutput = Output | { error: string }> {
  name: string;
  description: string;
  inputSchema?: CombinedSchema<Input>;
  outputSchema?: CombinedSchema<Output>;
  execute(input: Input): FormattedOutput | Promise<FormattedOutput>;
}

export function standardTool<Input, Output, FormattedOutput = Output | { error: string }>(def: {
  name: string;
  description: string;
  inputSchema?: CombinedSchema<Input>;
  outputSchema?: CombinedSchema<Output>;
  execute: (input: Input) => Output | Promise<Output>;
  formatOutput?: (result: Output | Error) => FormattedOutput | Promise<FormattedOutput>;
}): StandardTool<Input, Output, FormattedOutput> {
  const check = async <T>(where: 'input' | 'output', s: CombinedSchema<T>, v: unknown): Promise<T> => {
    const r = await s['~standard'].validate(v);
    // a validation failure is a plain Error carrying the Standard Schema issues — no dedicated type:
    if (r.issues) throw Object.assign(new Error(`${where} validation failed`), { issues: r.issues });
    return r.value;
  };
  const formatOutput =
    def.formatOutput ??
    ((result: Output | Error) => (result instanceof Error ? { error: result.message } : result) as unknown as FormattedOutput);
  return {
    name: def.name,
    description: def.description,
    inputSchema: def.inputSchema,
    outputSchema: def.outputSchema,
    async execute(input) {
      let result: Output | Error;
      try {
        const validInput = def.inputSchema ? await check('input', def.inputSchema, input) : input;
        const output = await def.execute(validInput);
        result = def.outputSchema ? await check('output', def.outputSchema, output) : output;
      } catch (e) {
        result = e instanceof Error ? e : new Error(String(e));
      }
      return formatOutput(result);
    },
  };
}
```

## API

```ts
import { standardTool, type StandardTool, type FormatOutputFn } from 'standard-tool';

standardTool(def): StandardTool<Input, Output, FormattedOutput>;
```

`Input`/`Output` are your **data types** (what your `execute` accepts and returns); the optional schemas describe them. `FormattedOutput` is what the tool hands the model after formatting — `Output | { error: string }` by default.

| field | type | purpose |
| --- | --- | --- |
| `name` | `string` | tool name sent to the model |
| `description` | `string` | what the tool does |
| `inputSchema?` | `CombinedSchema<Input>` | optional input schema — validates **and** emits JSON Schema |
| `outputSchema?` | `CombinedSchema<Output>` | optional output schema — validates **and** emits JSON Schema |
| `execute` (yours) | `(input: Input) => Output \| Promise<Output>` | your logic — receives validated input, returns the output |
| `execute` (tool) | `(input: Input) => FormattedOutput \| Promise<FormattedOutput>` | validate in → run yours → validate out → format; errors become the output (no throw) **by default** |
| `formatOutput?` | `(result: Output \| Error) => FormattedOutput` | optional; maps the result — or an `Error` carrying `issues` — to the model output. Default `result instanceof Error ? { error: result.message } : result` |

`inputSchema`/`outputSchema` are optional; when present they must implement both Standard Schema and Standard JSON Schema (Zod 4.2+, ArkType 2.1.28+, or Valibot 1.2+ via `@valibot/to-json-schema`) — `Input`/`Output` are inferred from them (or from `execute` when a schema is omitted).

`standardTool` is deliberately a **thin utility**: `name`, `description`, `inputSchema`, and `outputSchema` are returned **exactly as you passed them**. Only `execute` is wrapped — it validates input and output (when schemas are present), then routes the result, or any thrown error (a validation failure is a plain `Error` carrying `issues`), through `formatOutput`. `formatOutput` defaults to the `{ error }` envelope so bad data doesn't throw and a model loop keeps going; supply your own to reshape the output (its return type becomes the tool's `FormattedOutput`) or to throw and surface the error. Note `formatOutput` is a **creation-time argument, not a field** on the returned tool — the shape stays the minimal `{ name, description, inputSchema?, outputSchema?, execute }`. That's the whole job.

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

## With the OpenAI API

Uses the [Responses API](https://developers.openai.com/api/docs/guides/function-calling). Because every tool is the same neutral shape, you keep them in one array: `.map` it into the request's `tools`, then dispatch each function call back to the matching tool by `name`. Adding a fourth tool is one more array entry — no special-casing, no per-tool wiring. And because `execute` returns `{ error }` instead of throwing **by default**, a malformed tool call comes back to the model to self-correct rather than crashing your loop (a custom `formatOutput` can opt back into throwing).

```ts
import OpenAI from 'openai';
import { z } from 'zod';
import { standardTool, type StandardTool } from 'standard-tool';

const client = new OpenAI();

const tools: StandardTool<unknown, unknown>[] = [
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
