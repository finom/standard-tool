# Why Standard Tool

Why this exists: the problem, how the existing tool objects compare, what else the shape is good for, and the argument against it. The interface and examples are in the [README](./README.md).

Each LLM framework defines its own tool object: Vercel AI SDK, MCP, Mastra, Genkit, LangChain. Underneath, each is the same five parts — a name, a description, an input schema, an output schema, and an execute function — plus a little display metadata. A tool written for one framework is not portable to the others.

Most of that list is already standardized. [Standard Schema](https://standardschema.dev) covers validation; [Standard JSON Schema](https://standardschema.dev/json-schema) covers turning a schema into JSON Schema. Once the schemas do both jobs, what remains in a tool is two strings and a function.

Each framework rebuilds the object around those schemas and ties it to its own runtime. Standard Tool proposes a shared one instead: a single interface, with no runtime attached. [The comparison is below.](#how-it-compares)

## How it compares

In detail:

**Every tool is the same six things — the five parts plus display metadata.**

| Concern | What it is | Who consumes it |
| --- | --- | --- |
| name | stable identifier the model emits | the model |
| description | natural-language "what / when to use" | the model |
| input schema | parameter shape, as JSON Schema | the model (to emit args), your code (to validate) |
| output schema | result shape | your code, some clients (MCP) |
| execute | the function that runs | your runtime |
| metadata | title, annotations, hints | clients / UIs |

The two schemas carry all the complexity; everything else is a string or a function.

**The provider APIs all take JSON Schema parameters, but disagree on the field name and the JSON Schema version.** OpenAI uses `parameters` (with a `strict` mode that constrains the schema); Anthropic uses `input_schema`; MCP uses `inputSchema` plus `outputSchema`; Gemini nests them under `functionDeclarations`, taking either an OpenAPI-3.0 `parameters` object or a `parametersJsonSchema` one. Same data, four shapes.

**The framework objects differ more.** Each defines its own object, tied to its own runtime:

| Ecosystem | params key | output schema | execute | schema source | standalone? |
| --- | --- | --- | --- | --- | --- |
| OpenAI / Anthropic / Gemini | `parameters` / `input_schema` | n/a | you wire it | JSON Schema (dialects vary) | wire format only |
| MCP | `inputSchema` | `outputSchema` | server handler | JSON Schema | wire format only |
| Vercel AI SDK | `inputSchema` | `outputSchema` | `execute` | Standard Schema / Zod / JSON Schema | needs `ai` |
| Mastra | `inputSchema` | `outputSchema` | `execute` | Standard (JSON) Schema / Zod / JSON Schema | needs `@mastra/core` |
| Genkit | `inputSchema` | `outputSchema` | fn | Zod / JSON Schema | needs `@genkit-ai/ai` |
| LangChain | `schema` | n/a | fn | Zod / JSON Schema | needs `@langchain/core` |
| Standard Tool | `inputSchema` | `outputSchema` | `execute` | Standard (JSON) Schema | plain object, type-only import |

The columns are nearly the same, but the objects are not interchangeable, and each one comes from its framework's package: no `createTool` without `@mastra/core`, no `tool()` without `ai` or `@langchain/core`, no `defineTool` without `@genkit-ai/ai`. Reusing another framework's tool means installing that framework. Nothing fills the framework-independent slot.

**The schema layer is already standardized.** [Standard Schema](https://standardschema.dev) is a ~60-line interface written by the authors of Zod, Valibot, and ArkType, and already used by tRPC and TanStack. [Standard JSON Schema](https://standardschema.dev/json-schema) adds JSON Schema output, with the version chosen per call through `target`. The AI SDK and Mastra both accept Standard Schema already, so the schema half is shared. The object around the schemas is not.

## Beyond LLM tools

An LLM tool is the obvious use. But a **self-describing function** — a function packaged with a `name`, a `description`, and schemas that both validate and emit JSON Schema — can be read and understood without being run. A model is one reader of that package. Others:

- **prompt construction** — tell a model what it can call
- **documentation** — `name` + `description` + schemas → reference docs
- **UI / forms** — `inputSchema` → a typed form
- **command palettes / CLIs** — a tool is a described command with typed args
- **RPC / endpoints** — `name` + schemas + `execute` is a procedure

A library can also ship tools as ordinary exports:

```ts
// orders-api (a library): each export is a StandardToolV0
export const getOrders: StandardToolV0<{ userId: string }, Order[]> = {
  name: 'get_orders',
  description: "List a user's orders",
  inputSchema: z.object({ userId: z.string() }),
  execute: ({ userId }) => api.get(`/orders/${userId}`),
};
```

```ts
// a consumer
import { getOrders } from 'orders-api';

await getOrders.execute({ userId: 'u_1' }); // run it
getOrders.description; // or hand it to a model, a docs page, a prompt
```

Such a tool is ordinary library code: a value the caller imports and runs. How the tool is built — a class, a factory, a bare export — is up to the library; only the exported shape is fixed.

## From procedures you already have

A tool is a name, an input schema, and a handler — which is also what an RPC procedure is. A framework whose procedures validate with [Standard Schema](https://standardschema.dev) already has the schema and the handler. If those schemas also implement [Standard JSON Schema](https://standardschema.dev/json-schema), reuse them directly and route `execute` through the framework's server-side caller. A tRPC procedure's `.input()` and `.output()` schemas become the tool's `inputSchema` and `outputSchema`. With [tRPC](https://trpc.io), that caller comes from your existing router:

```ts
import type { z } from 'zod';
import type { StandardToolV0 } from 'standard-tool';
import { appRouter, cityInput, weatherOutput } from './trpc'; // your existing router and its schemas

const caller = appRouter.createCaller({}); // {} is the tRPC context

const getWeather: StandardToolV0<z.infer<typeof cityInput>, z.infer<typeof weatherOutput>> = {
  name: 'get_weather',
  description: 'Current temperature for a city',
  inputSchema: cityInput,
  outputSchema: weatherOutput,
  execute: caller.getWeather,
};
```

The generics come from the same schemas, so no shape is restated. The schemas produce the JSON Schema; the caller keeps tRPC's own validation and context. The same applies to any RPC framework built on Standard Schema, [oRPC](https://orpc.dev) included. An API you already have can serve as a source of tools without a rewrite.

## The case against

**Adoption** ([XKCD 927](https://xkcd.com/927/)). Until other projects produce or read this shape, it is one more shape on the pile. Standard Schema shows that a shared interface can catch on, but it launched with the authors of Zod, Valibot, and ArkType behind it. This has no such backing.

---

The moon in the logo is Saturn's Dione: **d**escription, **i**nput schema, **o**utput schema, **n**ame, **e**xecute.
