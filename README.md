# standard-tool

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

await getWeather.execute({ city: 'Paris' }); // → { tempC: number }, validated in & out
```

## What it is

- **Standalone & dependency-free.** A single ~30-line function. The Standard Schema and Standard JSON Schema interfaces are vendored into the package, so installing it pulls in nothing else — and you can just copy the source into your project instead (see [below](#or-just-copy-paste-it)).
- **A convention, not a framework.** It doesn't run your agent, call your model, or own your runtime. It defines only the shape — `{ name, description, inputSchema, outputSchema, execute }` — and the two things every tool needs: validation and a JSON Schema.
- **Validates input _and_ output.** `execute` accepts untrusted input (e.g. JSON arguments from a model), validates it via Standard Schema, runs your logic, then validates the result. Bad data throws a `ToolValidationError`.
- **Emits JSON Schema for any model.** Because the schemas implement Standard JSON Schema, you get an OpenAI- or MCP-ready JSON Schema (any function-calling model) synchronously via `inputSchema['~standard'].jsonSchema.input(...)`.

## Why

Every LLM framework ships its own tool object — Vercel AI SDK, MCP, oRPC, Effect — each a different shape, none portable, most welded to the framework. But the hard part — schema interop — is **already** standardized: Standard Schema for validation and Standard JSON Schema for JSON Schema emission. `standard-tool` is the missing, neutral wrapper around them: small enough to become a shared convention rather than another framework lock-in.

## Install

```sh
npm i standard-tool
# bring any library that implements BOTH Standard Schema and Standard JSON Schema:
npm i zod          # 4.2+   (or `arktype` 2.1.28+, or `valibot` + `@valibot/to-json-schema`)
```

## API

```ts
import { standardTool, type StandardTool, ToolValidationError } from 'standard-tool';

standardTool(def): StandardTool<Input, Output>;
```

`def` and the returned `StandardTool` share these fields — nothing more:

| field | type | purpose |
| --- | --- | --- |
| `name` | `string` | tool name sent to the model |
| `description` | `string` | what the tool does |
| `inputSchema` | `Input` | input schema — validates **and** emits JSON Schema |
| `outputSchema` | `Output` | output schema — validates **and** emits JSON Schema |
| `execute` | `(input: InferInput<Input>) => InferOutput<Output>` | validate input → run your `execute` → validate output (returns a value or a `Promise`) |

`Input`/`Output` must implement both Standard Schema and Standard JSON Schema (Zod 4.2+, ArkType 2.1.28+, or Valibot 1.2+ via `@valibot/to-json-schema`). Your `execute` receives the **validated** input and returns the output; the returned tool's `execute` is typed `(input: InferInput<Input>) => InferOutput<Output>` and validates both at runtime (throwing `ToolValidationError` on a mismatch).

## Usage

```ts
import { standardTool, ToolValidationError } from 'standard-tool';
import { z } from 'zod';

const getWeather = standardTool({
  name: 'get_weather',
  description: 'Current temperature for a city',
  inputSchema: z.object({ city: z.string() }),
  outputSchema: z.object({ tempC: z.number() }),
  execute: async ({ city }) => ({ tempC: 21 }),
});

// validated end to end — throws ToolValidationError on bad input or output:
const out = await getWeather.execute({ city: 'Paris' }); // { tempC: number }

// JSON Schema for the model (Standard JSON Schema), synchronous:
const parameters = getWeather.inputSchema['~standard'].jsonSchema.input({ target: 'draft-2020-12' });
```

## With the OpenAI API

Uses the [Responses API](https://developers.openai.com/api/docs/guides/function-calling). The tool's `parameters` come straight from Standard JSON Schema, and `execute` validates both the model's arguments and your result.

```ts
import OpenAI from 'openai';
import { z } from 'zod';
import { standardTool } from 'standard-tool';

const client = new OpenAI();

const getWeather = standardTool({
  name: 'get_weather',
  description: 'Get the current temperature for a city',
  inputSchema: z.object({ city: z.string() }),
  outputSchema: z.object({ tempC: z.number() }),
  execute: async ({ city }) => ({ tempC: 21 }),
});

const input: any[] = [{ role: 'user', content: 'What is the weather in Paris?' }];

const res = await client.responses.create({
  model: 'gpt-5',
  input,
  tools: [
    {
      type: 'function',
      name: getWeather.name,
      description: getWeather.description,
      parameters: getWeather.inputSchema['~standard'].jsonSchema.input({ target: 'draft-2020-12' }),
    },
  ],
});

input.push(...res.output);

for (const item of res.output) {
  if (item.type === 'function_call' && item.name === getWeather.name) {
    const result = await getWeather.execute(JSON.parse(item.arguments)); // validates args + result
    input.push({ type: 'function_call_output', call_id: item.call_id, output: JSON.stringify(result) });
  }
}

const final = await client.responses.create({ model: 'gpt-5', input });
console.log(final.output_text);
```

## Or just copy-paste it

No dependency at all. Paste this and import the spec types from the official, types-only [`@standard-schema/spec`](https://github.com/standard-schema/standard-schema) (`npm i -D @standard-schema/spec`):

```ts
import type { StandardSchemaV1, StandardJSONSchemaV1 } from '@standard-schema/spec';

type CombinedSchema = StandardSchemaV1 & StandardJSONSchemaV1;

export class ToolValidationError extends Error {
  constructor(readonly target: 'input' | 'output', readonly issues: readonly StandardSchemaV1.Issue[]) {
    super(`${target} validation failed: ${issues.map((i) => i.message).join('; ')}`);
    this.name = 'ToolValidationError';
  }
}

export function standardTool<Input extends CombinedSchema, Output extends CombinedSchema>(def: {
  name: string;
  description: string;
  inputSchema: Input;
  outputSchema: Output;
  execute: (
    input: StandardSchemaV1.InferOutput<Input>
  ) => StandardSchemaV1.InferOutput<Output> | Promise<StandardSchemaV1.InferOutput<Output>>;
}) {
  const check = async <S extends StandardSchemaV1>(t: 'input' | 'output', s: S, v: unknown) => {
    const r = await s['~standard'].validate(v);
    if (r.issues) throw new ToolValidationError(t, r.issues);
    return r.value as StandardSchemaV1.InferOutput<S>;
  };
  return {
    name: def.name,
    description: def.description,
    inputSchema: def.inputSchema,
    outputSchema: def.outputSchema,
    async execute(input: StandardSchemaV1.InferInput<Input>): Promise<StandardSchemaV1.InferOutput<Output>> {
      return check('output', def.outputSchema, await def.execute(await check('input', def.inputSchema, input)));
    },
  };
}
```

## Links

- **Standard Schema** — https://standardschema.dev
- **Standard JSON Schema** — https://standardschema.dev/json-schema
- **@standard-schema/spec** — https://github.com/standard-schema/standard-schema

## License

MIT © Andrey Gubanov
