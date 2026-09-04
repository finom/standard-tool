<!-- hero-start -->
<p align="center"><img src="docs/logo.svg" width="84" height="84" alt="Standard Tool logo"></p>
<h1 align="center">Standard Tool</h1>
<p align="center">One type for an LLM tool.<br>One interface shared across providers, SDKs, and frameworks.</p>
<p align="center"><a href="https://standard-tool.js.org">standard-tool.js.org</a></p>
<p align="center"><a href="https://github.com/finom/standard-tool/actions/workflows/ci.yml"><img src="https://github.com/finom/standard-tool/actions/workflows/ci.yml/badge.svg" alt="CI"></a> <a href="https://scorecard.dev/viewer/?uri=github.com/finom/standard-tool"><img src="https://api.scorecard.dev/projects/github.com/finom/standard-tool/badge" alt="OpenSSF Scorecard"></a></p>
<!-- hero-end -->

```ts
import type { StandardSchemaV1, StandardJSONSchemaV1 } from '@standard-schema/spec';

interface StandardToolV0<
  Input = unknown, Output = unknown, FormattedOutput = Output, Context = unknown,
> {
  name: string;
  title?: string; // human label; shown by MCP-style clients in tool lists
  description: string;
  inputSchema?: StandardSchemaV1<Input, unknown> & StandardJSONSchemaV1<Input, unknown>;
  outputSchema?: StandardSchemaV1<unknown, Output> & StandardJSONSchemaV1<unknown, Output>;
  meta?: Record<string, unknown>; // static data about the tool, for consumers to read
  execute(input: Input, context?: Context): FormattedOutput | Promise<FormattedOutput>;
}
```

`StandardToolV0` is the shape of a **self-describing function**: a callable together with its name, description, and schemas. Any object of this shape conforms; nothing is required beyond a schema library implementing [Standard Schema](https://standardschema.dev) and [Standard JSON Schema](https://standardschema.dev/json-schema) (Zod 4.2+, ArkType 2.1.28+, Valibot via `@valibot/to-json-schema`). The schemas provide static types, runtime validation, and JSON Schema emission via `inputSchema['~standard'].jsonSchema.input({ target })`. The npm package is a reference implementation.

> **Status: RFC.** The `V0` shape is frozen — a breaking change would be `StandardToolV1`; the reference package follows its own `0.x` semver. [Critiques and counter-proposals welcome.](https://github.com/finom/standard-tool/issues)

Why one type, how existing tool objects compare, and the case against: **[WHY.md](./WHY.md)**.

## Defining a tool

```ts
import { z } from 'zod'; // or arktype, or valibot
import type { StandardToolV0 } from 'standard-tool'; // types only — or paste the interface above

const getWeather: StandardToolV0<{ city: string }, { tempC: number }> = {
  name: 'get_weather',
  description: 'Current temperature for a city',
  inputSchema: z.object({ city: z.string() }),
  outputSchema: z.object({ tempC: z.number() }),
  execute: async ({ city }) => ({ tempC: 21 }),
};
```

Three ways to use it:

<table>
<tr>
<th>Call it directly</th>
<th>Use it as an AI tool</th>
<th>Render docs or a prompt</th>
</tr>
<tr>
<td>
<pre>
await getWeather
  .execute({ city: 'Paris' });
// { tempC: 21 }
</pre>
</td>
<td>
<pre>
getWeather.inputSchema
  ?.['~standard'].jsonSchema
  .input({ target });
// → the provider's schema field
&#8203;
await getWeather.execute(args);
// → result for the model
</pre>
</td>
<td>
<pre>
getDocs([getWeather]);
// your renderer ↓
&#35; Available functions
&#8203;
&#45; get_weather({ city: string })
  => { tempC: number }:
  Current temperature for a city
</pre>
</td>
</tr>
</table>

Provider field names and dialects: [wiring table](#wiring-a-provider). The same fields also serve UIs, forms, and CLIs: [Beyond LLM tools](./WHY.md#beyond-llm-tools). Tools can be derived from RPC procedures you already have: [tRPC, oRPC](./WHY.md#from-procedures-you-already-have).

## Per-call `context`

`context` is `execute`'s optional second argument — per-call data like a locale, an auth token, a request-scoped handle. Never validated, never in the JSON Schema. Annotate it on the handler (`execute: (input, context: { locale: string }) => …`) and it types every caller.

## Tool-level `meta`

`meta` is per-tool data consumers read and `execute` never sees: `{ destructive: true, tags: ['fs'] }` — confirmation hints, tool selection, ownership. Untyped by design (a generic erases to `unknown` in `StandardToolV0[]`); narrow with `& { meta: { budget: number } }` when you want types. The spec fixes no keys — agree within your system, or follow MCP's tool annotations.

## The interface

| field | type | purpose |
| --- | --- | --- |
| `name` | `string` | identifier the model emits |
| `description` | `string` | what the tool does |
| `title?` | `string` | human label for MCP-style tool lists; ignored by plain function-calling APIs |
| `inputSchema?` | `StandardSchemaV1<Input, unknown> & StandardJSONSchemaV1<Input, unknown>` | validates and emits JSON Schema; `Input` is its input side |
| `outputSchema?` | `StandardSchemaV1<unknown, Output> & StandardJSONSchemaV1<unknown, Output>` | validates and emits JSON Schema; `Output` is its output side |
| `meta?` | `Record<string, unknown>` | static data about the tool; read by consumers, never passed to `execute` |
| `execute` | `(input: Input, context?: Context) => FormattedOutput \| Promise<FormattedOutput>` | runs the tool; input untrusted until checked against `inputSchema`; may throw |

## The reference implementation

Copy [`src/index.ts`](https://github.com/finom/standard-tool/blob/main/src/index.ts) into your project — ~90 lines — replacing its first import with the types-only [`@standard-schema/spec`](https://github.com/standard-schema/standard-schema). Or install the package:

```sh
npm i standard-tool
```

- `standardTool(def)` returns the definition with validation wired into `execute`: input checked before the handler runs, output after. The handler receives the validated input (the input schema's *output* side) and returns the raw result the output schema validates. Violations throw `StandardToolValidationError`, carrying `target: 'input' | 'output'` and the Standard Schema `issues`.
- `withFormattedOutput(tool, format?)` is the bare-`catch` recipe written once, with types: a throw inside `execute` reaches the caller as data.

```ts
import { standardTool, withFormattedOutput } from 'standard-tool';
import { z } from 'zod';

const getWeather = standardTool({
  name: 'get_weather',
  description: 'Current temperature for a city',
  inputSchema: z.object({ city: z.string() }),
  outputSchema: z.object({ tempC: z.number() }),
  execute: async ({ city }) => ({ tempC: 21 }),
}); // execute validates input and output

await getWeather.execute({ city: 123 } as never); // throws StandardToolValidationError

await withFormattedOutput(getWeather).execute({ city: 123 } as never);
// { error: 'input validation failed: city: …' }

const asText = withFormattedOutput(getWeather, (r) =>
  r instanceof Error ? `error: ${r.message}` : `${r.tempC}°C`);
await asText.execute({ city: 'Paris' }); // '21°C'
```

The formatter receives the validated `Output` or an `Error`, runs once per call, and its own throws propagate unformatted. It accepts only tools whose `execute` still returns the plain `Output`, so wrapping an already-wrapped tool is a compile error. Frameworks with their own formatting hook (`toModelOutput` in the AI SDK, Mastra) don't need it — hand them the tool unwrapped.

## Wiring a provider

Every integration hands the provider the same descriptor — `name`, `description`, and the emitted JSON Schema — then runs `execute` on the model's call. Typed here for Anthropic; the table maps the rest:

```ts
import type Anthropic from '@anthropic-ai/sdk';

const descriptor: Anthropic.Tool = {
  name: tool.name,
  description: tool.description,
  input_schema: (tool.inputSchema?.['~standard'].jsonSchema
    .input({ target: 'draft-2020-12' }) ??
    { type: 'object', properties: {} }) as Anthropic.Tool.InputSchema,
};

// execute throws on failure; catch to hand the model something to correct from
let result: unknown;
try { result = await tool.execute(args); }
catch (e) { result = { error: e instanceof Error ? e.message : String(e) }; }
```

What varies is where the schema goes and which dialect:

| Consumer | schema field | `target` | result goes back as |
| --- | --- | --- | --- |
| OpenAI | `parameters` | `draft-2020-12` | `function_call_output` item |
| Anthropic | `input_schema` | `draft-2020-12` | `tool_result` block |
| Gemini | `parameters` (or `parametersJsonSchema`) | `openapi-3.0` | `functionResponse` part |
| Vercel AI SDK | `inputSchema` — takes the Standard Schema as-is | — | SDK runs the loop |
| MCP | `inputSchema` in the descriptor | `draft-2020-12` | `{ content, structuredContent?, isError? }` — map the result and errors onto it |

## Links

- [Standard Schema](https://standardschema.dev) · [Standard JSON Schema](https://standardschema.dev/json-schema) · [`@standard-schema/spec`](https://github.com/standard-schema/standard-schema)
- [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling) · [Anthropic tool use](https://platform.claude.com/docs/en/build-with-claude/tool-use) · [Gemini function calling](https://ai.google.dev/gemini-api/docs/function-calling) · [MCP tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
- [Vercel AI SDK `tool()`](https://ai-sdk.dev/docs/reference/ai-sdk-core/tool) · [Mastra `createTool`](https://mastra.ai/reference/tools/create-tool) · [Genkit](https://genkit.dev/docs/tool-calling/) · [LangChain](https://www.npmjs.com/package/@langchain/core)

## License

MIT © Andrey Gubanov
