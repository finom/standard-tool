# Overview: why `standard-tool`

> **Status: proposal (RFC).** This document is the rationale behind `standard-tool`. It argues a position, names the trade-offs honestly, and tries to survey the whole landscape rather than one happy path. If it's wrong somewhere, that's the feedback worth opening an issue over.

## TL;DR

Every LLM and agent ecosystem defines its own tool object: a name, a description, an input schema, sometimes an output schema, and a function to run. The shapes are all different, none is portable, and most are welded to a framework or a vendor SDK. Yet the genuinely hard part of a tool definition, schema interop, has already been handled. [Standard Schema](https://standardschema.dev) unifies validation, and [Standard JSON Schema](https://standardschema.dev/json-schema) unifies JSON Schema emission. `standard-tool` is the small missing piece on top of those two: a neutral, dependency-free tool shape that any library, framework, or app can produce or consume.

It is deliberately not a framework. It owns the shape, `{ name, title?, description, inputSchema?, outputSchema?, execute }`, and nothing else.

---

## 1. The anatomy of a "tool"

Strip away the branding and every tool definition across every ecosystem is the same six things:

| Concern | What it is | Who consumes it |
| --- | --- | --- |
| name | stable identifier the model emits | the model |
| description | natural-language "what/when to use" | the model |
| input schema | parameter shape, as JSON Schema | the model (to emit args) and your code (to validate them) |
| output schema | result shape | your code, some clients (MCP) |
| execute | the function that runs | your runtime |
| metadata | title, annotations, hints | clients/UIs |

Two of these, the input schema and the output schema, carry all the real complexity, because they serve two masters at once. They have to emit JSON Schema (so a model can be told how to call the tool) and validate runtime data (because the arguments a model emits are untrusted input). Everything else is a string or a function.

The thesis of this document is simple. The industry reinvents the trivial parts (the envelope) over and over, while the hard part (the dual schema role) was solved once by the Standard Schema family. So the envelope is the only thing left worth standardizing, and it's about 30 lines.

---

## 2. The landscape: everyone ships their own envelope

### 2.1 Provider wire formats (what the model API expects)

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

### 2.2 Framework / SDK tool objects (what you author in code)

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
| `standard-tool` | ✅ | ✅ | `inputSchema` | `outputSchema` | `execute` | `title` | Standard (JSON) Schema |

The columns are nearly identical; the objects are mutually incompatible. And here's the part worth dwelling on: none of these tool primitives is obtainable on its own. Each ships inside a framework package and returns a framework-coupled value.

- Mastra's `createTool` lives in `@mastra/core` (about 50 MB installed, around 31 deps for agents, workflows, memory, storage, vector, and an HTTP server); the docs say you "most likely don't want to use it as a standalone package."
- Genkit's `defineTool` is a method on a live `genkit()` instance, so you can't define a tool without first initializing the framework.
- LangChain's `tool()` returns a `StructuredTool` (a Runnable) from `@langchain/core`.
- The Vercel AI SDK's `tool()` needs the `ai` package and yields an SDK-typed `Tool`.

So "just reuse framework X's tool" means adopting framework X. That gap, identical semantics with incompatible envelopes, each weldable only to its own runtime, is the entire problem.

### 2.3 The schema layer (the part that's actually standardized)

- JSON Schema is the lingua franca for describing parameters to a model, but it's a family of dialects (draft-07, draft-2020-12, the OpenAPI-3.0 subset, plus provider-specific "strict" constraints).
- [Standard Schema](https://standardschema.dev) is a roughly 60-line TypeScript interface (`~standard`) co-designed by the authors of Zod, Valibot, and ArkType, all of which implement it. Despite the name, it's a community convention, a shared interface that spread by adoption, not a standards-body standard; the same goes for Standard JSON Schema. It unifies validation: any tool can call `schema['~standard'].validate(value)` without knowing which library produced the schema. It's already consumed by tRPC, TanStack Form/Router, and others. Its pitch, reducing N×M integrations to N+M, is exactly the pitch for tools.
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

  Crucially, `target` already includes `'openapi-3.0'` alongside the JSON Schema drafts, so the dialect problem from §2.1 is, by design, the schema library's responsibility, selectable per call. Its stated goals: preserve inferred type information through conversion, require zero runtime dependencies, and let ecosystem tools accept user-defined types "without needing to write custom logic or adapters for each supported library."

---

## 3. The diagnosis

Put §2.2 and §2.3 next to each other and the picture is stark.

- The schema layer is solved. Validation (Standard Schema) and emission (Standard JSON Schema) are both handled, implemented by the major validators, and dependency-free to consume.
- The envelope is not, and it's the easy part. A tool is `name + description + (input/output schema) + execute`. Once the schemas are Standard (JSON) Schema objects, the rest is a string, a string, and a function.

So the situation is the inverse of where effort is being spent. Frameworks pour energy into re-inventing the trivial wrapper and binding it to their runtime, while the part that could justify a framework (schema interop) is already a shared, neutral interface.

`standard-tool` applies the Standard Schema move one level up: standardize the envelope too, as a neutral interface with no runtime and no dependencies, so a tool authored once can be produced or consumed by anything.

---

## 4. What `standard-tool` proposes

One shape:

```ts
interface StandardTool<Input, Output, FormattedOutput, /* meta is any */> {
  name: string;
  title?: string;                                  // human label; used by MCP-style clients
  description: string;
  inputSchema?:  CombinedSpec<Input>;              // Standard Schema + Standard JSON Schema
  outputSchema?: CombinedSpec<Output>;
  execute(input: Input, meta?: any): FormattedOutput | Promise<FormattedOutput>;
}
```

Here, `CombinedSpec` means "a schema that both validates and emits JSON Schema": Zod 4.2+, ArkType 2.1.28+, or Valibot (with `@valibot/to-json-schema`). The spec interfaces are vendored (copied in), so the package has zero dependencies and can equally be pasted into a project.

The type is the proposal. Like Standard Schema, `standard-tool` is fundamentally this interface: anything that produces or consumes a matching object interoperates, with no dependency. The `standardTool()` function used throughout is a reference implementation, a convenient way to build a conforming tool with validation and output formatting, not a required runtime.

`execute` validates input, runs your logic, validates output, then formats the result. By default, errors become `{ error }` so a model loop keeps running. The schemas are returned untouched, so any consumer can reach JSON Schema synchronously:

```ts
tool.inputSchema!['~standard'].jsonSchema.input({ target: 'draft-2020-12' }); // or 'openapi-3.0', 'draft-07'
```

Note that the shape maps almost 1:1 onto MCP's `Tool` (`name`, `title`, `description`, `inputSchema`, `outputSchema`), which is why a `standard-tool` plugs into an MCP server with no translation, and into provider APIs with a one-line `.map`.

---

## 5. Worked examples: one tool, many consumers

The point of a neutral shape is that the same object flows everywhere. Define once:

```ts
import { standardTool } from 'standard-tool';
import { z } from 'zod';

const getWeather = standardTool({
  name: 'get_weather',
  title: 'Get weather',
  description: 'Current temperature for a city',
  inputSchema: z.object({ city: z.string() }),
  outputSchema: z.object({ tempC: z.number() }),
  execute: async ({ city }) => ({ tempC: 21 }),
});
```

(a) A provider function-calling loop (OpenAI Responses shown; others differ only in the wrapper key):

```ts
tools: [{
  type: 'function',
  name: getWeather.name,
  description: getWeather.description,
  parameters: getWeather.inputSchema!['~standard'].jsonSchema.input({ target: 'draft-2020-12' }),
}]
// on a tool call:
const result = await getWeather.execute(JSON.parse(call.arguments)); // validates args + result
```

(b) An MCP server. Give the tool an MCP `formatOutput` (so `execute` returns a `{ content, structuredContent, isError }` result), then hand the Standard Schema straight to `registerTool`:

```ts
server.registerTool(getWeather.name, {
  title: getWeather.title,
  description: getWeather.description,
  inputSchema: getWeather.inputSchema, // a Standard Schema; the SDK emits JSON Schema from it
}, (args) => getWeather.execute(args)); // → { content, structuredContent, isError } (see the MCP formatter in the README)
```

(c) A Vercel AI SDK adapter. Wrap the neutral shape into `tool()`:

```ts
import { tool, jsonSchema } from 'ai';
const aiTool = tool({
  description: getWeather.description,
  inputSchema: jsonSchema(getWeather.inputSchema!['~standard'].jsonSchema.input({ target: 'draft-2020-12' })),
  execute: (input) => getWeather.execute(input),
});
```

(d) An isolated unit test. No model, no framework, just data in and out:

```ts
expect(await getWeather.execute({ city: 'Paris' })).toEqual({ tempC: 21 });
expect(await getWeather.execute({ city: 123 as any })).toMatchObject({ error: expect.any(String) });
```

(e) Derived from an existing API. A derive-from-API layer can emit `standard-tool`-shaped objects from typed RPC procedures or imported OpenAPI specs, so an existing backend becomes a tool catalog without hand-writing wrappers.

Broaden the lens and the same shape underwrites a shareable tool registry (publish reusable tools as plain objects, not framework plugins), cross-runtime use (zero deps, so it runs in the browser, on the edge, in workers), and multi-target apps that must speak to several providers and an MCP endpoint from one definition.

---

## 6. The case against

The objections worth taking seriously:

Adoption ([XKCD 927](https://xkcd.com/927/)). A shape that nobody else produces or consumes is just a tidy wrapper for its author, and today that's roughly where `standard-tool` sits. The bet is that the shape is obvious enough to make adapters trivial, and that Standard Schema shows a neutral interface can spread by adoption rather than mandate. Worth noting that "Standard Schema" and "Standard JSON Schema" aren't ratified standards either; they're conventions that won by adoption (Zod, Valibot, and ArkType implement Standard Schema; tRPC and TanStack consume it), which is the same path this would have to walk. There's no runtime and no lock-in, so the surface area to "win" is small, but it's still one more shape on the pile until others pick it up. This is the honest weak point.

Why not just extend an existing tool primitive? Mastra's `createTool` and the AI SDK's `tool()` are the closest prior art. The catch (§2.2) is that each is bundled inside a framework and returns a framework-coupled value: there's no `createTool` without `@mastra/core` (about 50 MB), no `defineTool` without a live `genkit()` instance, no `tool()` without `@langchain/core` or `ai`. The neutral, zero-dependency slot is empty. The nearest neutral thing is MCP's `Tool`, but that's a wire format with no in-process validation or `execute`. If the ecosystem would rather extend one framework's primitive instead, that's a fine outcome; this exists mainly to make the neutral option concrete enough to argue about.

`meta` is typed `any`. Per-call context (`execute(input, meta)`) is `any` rather than a typed generic, because tools are invoked by a model or runtime, not hand-called in typed code, so a stricter type bought friction without real safety. It's still a hole in an otherwise type-safe surface, and plenty of people will prefer `unknown`.

`outputSchema` is rarely consumed. Most provider APIs ignore output schemas; only MCP-style clients validate them. So today it earns its place through your own runtime safety and documentation, not the model.

---

## 7. Scope: what this is not

- Not an agent runtime. It doesn't loop, plan, or call a model.
- Not a model client. No HTTP, no provider SDKs.
- Not a transport or protocol. MCP defines how tools are served over a wire; `standard-tool` defines how a tool is shaped in memory. They're complementary, and a `standard-tool` is trivially served via MCP.
- Not a schema library. It consumes Standard Schema; it doesn't validate or emit JSON Schema itself.
- Not an orchestration framework. No registries, retries, or routing; bring your own.

## 8. Open questions

- Should `meta` be `unknown` (safer) or `any` (frictionless)? Currently `any`, since tools are invoked by a model or runtime, not hand-called in typed code.
- Should result-formatting live in the tool at all, or always be a separate step?

---

## Sources

- Standard Schema: <https://standardschema.dev>
- Standard JSON Schema: <https://standardschema.dev/json-schema>
- MCP tools specification (2025-06-18): <https://modelcontextprotocol.io/specification/2025-06-18/server/tools>
- OpenAI function calling: <https://developers.openai.com/api/docs/guides/function-calling>
- OpenAI Structured Outputs: <https://openai.com/index/introducing-structured-outputs-in-the-api/>
- Google Gemini function calling: <https://ai.google.dev/gemini-api/docs/function-calling>
- Vercel AI SDK `tool()`: <https://ai-sdk.dev/docs/reference/ai-sdk-core/tool>
- Mastra `createTool`: <https://mastra.ai/reference/tools/create-tool>
- `@mastra/core` size and deps: <https://www.npmjs.com/package/@mastra/core>
- Genkit tool calling: <https://genkit.dev/docs/tool-calling/>
- LangChain `@langchain/core` tools: <https://www.npmjs.com/package/@langchain/core>
- XKCD 927, "Standards": <https://xkcd.com/927/>
