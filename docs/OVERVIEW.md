# Overview — why `standard-tool`

> **Status: Proposal (RFC).** This document is the rationale behind `standard-tool`. It argues a position, names the trade-offs honestly, and tries to survey the whole landscape rather than one happy path. If it's wrong somewhere, that's exactly the feedback worth opening an issue over.

## TL;DR

Every LLM/agent ecosystem defines its own *tool object* — a name, a description, an input schema, sometimes an output schema, and a function to run. The shapes are all different, none is portable, and most are welded to a framework or a vendor SDK. Yet the genuinely hard part of a tool definition — **schema interop** — has *already* been standardized: [Standard Schema](https://standardschema.dev) unifies validation, and [Standard JSON Schema](https://standardschema.dev/json-schema) unifies JSON-Schema emission. `standard-tool` is the small missing piece that sits on top of those two: a neutral, dependency-free tool shape any library, framework, or app can **produce or consume**.

It is deliberately *not* a framework. It owns the shape — `{ name, title?, description, inputSchema?, outputSchema?, execute }` — and nothing else.

---

## 1. The anatomy of a "tool"

Strip away the branding and every tool definition across every ecosystem is the same six things:

| Concern | What it is | Who consumes it |
| --- | --- | --- |
| **name** | stable identifier the model emits | the model |
| **description** | natural-language "what/when to use" | the model |
| **input schema** | parameter shape, as JSON Schema | the model (to emit args) **and** your code (to validate them) |
| **output schema** | result shape | your code, some clients (MCP) |
| **execute** | the function that runs | your runtime |
| **metadata** | title, annotations, hints | clients/UIs |

Two of these — the **input schema** and **output schema** — carry all the real complexity, because they must serve *two masters at once*: they have to **emit JSON Schema** (so a model can be told how to call the tool) **and validate runtime data** (because the arguments a model emits are untrusted input). Everything else is a string or a function.

The thesis of this document: the industry reinvents the trivial parts (the envelope) over and over, while the hard part (the dual schema role) was solved once and for all by the Standard Schema family — so the envelope is the only thing left worth standardizing, and it's ~30 lines.

---

## 2. The landscape — everyone ships their own envelope

### 2.1 Provider wire formats (what the model API expects)

These are the formats you serialize a tool *into* when you call a model. They have largely converged on "JSON Schema for the parameters" — but disagree on the wrapper and on the JSON Schema dialect.

**OpenAI — Chat Completions**

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

**OpenAI — Responses API** (flatter; `function` wrapper removed)

```jsonc
{ "type": "function", "name": "get_weather", "description": "…", "parameters": { /* JSON Schema */ }, "strict": true }
```

`strict: true` is built on Structured Outputs and imposes extra rules on the JSON Schema: every object needs `additionalProperties: false`, and *every* property must be listed in `required` (optionals are expressed as `"type": ["string", "null"]`). So the same logical schema must be **emitted differently** depending on whether strict mode is on. ([function calling guide](https://developers.openai.com/api/docs/guides/function-calling), [structured outputs](https://openai.com/index/introducing-structured-outputs-in-the-api/))

**A second major provider — Messages API** uses an `input_schema` key instead of `parameters`:

```jsonc
{ "name": "get_weather", "description": "…", "input_schema": { "type": "object", "properties": { "city": { "type": "string" } }, "required": ["city"] } }
```

**Google Gemini — `functionDeclarations`** wraps the same idea but accepts only an **OpenAPI 3.0 subset**, not full JSON Schema:

```jsonc
{ "functionDeclarations": [ { "name": "get_weather", "description": "…", "parameters": { "type": "object", "properties": { "city": { "type": "string" } }, "required": ["city"] } } ] }
```

Supported keywords are limited (`type`, `properties`, `items`, `enum`, `required`, …); `default`, `oneOf`, and others are **not** supported. ([Gemini function calling](https://ai.google.dev/gemini-api/docs/function-calling))

**Model Context Protocol (MCP)** is the closest thing to a cross-vendor *standard* for tools. Its `Tool` is:

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

MCP also defines structured results (`structuredContent`) and says that when an `outputSchema` is present, "servers **MUST** provide structured results that conform to this schema" and "clients **SHOULD** validate" them. ([MCP tools spec, 2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18/server/tools))

**The OpenAI-compatible crowd** (Mistral, Groq, Together, Fireworks, many local servers via LM Studio / Ollama) re-use the OpenAI `tools` shape, which is why it has become a de-facto baseline — but "compatible" still varies in JSON Schema support and strict-mode behavior.

> **Takeaway:** the *parameters* are JSON Schema almost everywhere, but the **wrapper key** (`parameters` vs `input_schema` vs `inputSchema` vs `functionDeclarations`), the **dialect** (full draft-2020-12 vs OpenAPI-3.0 subset vs strict-mode-constrained), and the **result shape** all differ.

### 2.2 Framework / SDK tool objects (what you author in code)

These wrap the wire format *and* the execution. This is where fragmentation is worst, because each one invents its own object and binds it to its own runtime.

**Vercel AI SDK** — `tool()`, from the `ai` package:

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

The `tool()` helper exists *specifically* so TypeScript can connect `inputSchema` to `execute`'s argument types. Tools are keyed by name in a record passed to `generateText`/`streamText`, and the value is coupled to the SDK's own `Tool`/`ToolSet` types. ([AI SDK `tool` reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/tool))

**MCP TypeScript SDK** — `registerTool`:

```ts
server.registerTool(
  'get_weather',
  { title: 'Weather', description: '…', inputSchema: { city: z.string() } },  // raw Zod shape
  async ({ city }) => ({ content: [{ type: 'text', text: '…' }] }),
);
```

**Mastra** — `createTool` (already leans on the Standard family!):

```ts
createTool({
  id: 'get-weather',
  description: '…',
  inputSchema: z.object({ city: z.string() }),
  outputSchema: z.object({ tempC: z.number() }),
  execute: async ({ context }) => ({ tempC: 21 }),
});
```

Mastra's docs state input/output schemas "can be defined using any library that supports Standard JSON Schema, including Zod, Valibot, and ArkType." ([Mastra `createTool`](https://mastra.ai/reference/tools/create-tool)) — i.e. one major framework already builds its tool **schemas** on the same foundation as this proposal. The tool *object*, though, stays bound to `@mastra/core` (see below).

**Genkit** — `ai.defineTool({ name, description, inputSchema, outputSchema }, fn)`. **LangChain** — `tool(fn, { name, description, schema })`, or infers the schema from the function signature. **LlamaIndex** — `FunctionTool.from_defaults(fn, name, description, fn_schema)`. **Pydantic AI / smolagents / OpenAI Agents SDK / Semantic Kernel / CrewAI / AutoGen** each have their own decorator or class. **oRPC** and **Effect** expose tool/`AiTool` builders.

A compact cross-section:

| Ecosystem | name | desc | params key | output schema | execute | title/meta | schema source |
| --- | --- | --- | --- | --- | --- | --- | --- |
| OpenAI (Responses) | ✅ | ✅ | `parameters` | — | (you wire it) | — | JSON Schema (+ strict) |
| Messages API (2nd provider) | ✅ | ✅ | `input_schema` | — | (you wire it) | — | JSON Schema |
| Gemini | ✅ | ✅ | `parameters` | — | (you wire it) | — | OpenAPI 3.0 subset |
| MCP | ✅ | ✅ | `inputSchema` | `outputSchema` | server handler | `title`, `annotations` | JSON Schema |
| Vercel AI SDK | (key) | ✅ | `inputSchema` | `outputSchema` | `execute` | — | Zod / JSON Schema |
| Mastra | `id` | ✅ | `inputSchema` | `outputSchema` | `execute` | — | Standard JSON Schema |
| Genkit | ✅ | ✅ | `inputSchema` | `outputSchema` | fn | — | Zod |
| LangChain | ✅ | ✅ | `schema` | — | fn | — | Zod / inferred |
| **`standard-tool`** | ✅ | ✅ | `inputSchema` | `outputSchema` | `execute` | `title` | **Standard (JSON) Schema** |

The columns are nearly identical; the objects are mutually incompatible. And — the part worth dwelling on — **none of these tool primitives is obtainable on its own.** Each ships *inside* a framework package and returns a *framework-coupled* value:

- **Mastra** `createTool` lives in `@mastra/core` (~50 MB installed, ~31 deps — agents, workflows, memory, storage, vector, an HTTP server); the docs say you "most likely don't want to use it as a standalone package."
- **Genkit** `defineTool` is a method on a live `genkit()` instance — you can't define a tool without first initializing the framework.
- **LangChain** `tool()` returns a `StructuredTool` (a Runnable) from `@langchain/core`.
- **Vercel AI SDK** `tool()` needs the `ai` package and yields an SDK-typed `Tool`.

So "just reuse framework X's tool" means adopting framework X. That gap — identical semantics, incompatible envelopes, each weldable only to its own runtime — is the entire problem.

### 2.3 The schema layer (the part that's actually standardized)

- **JSON Schema** is the lingua franca for *describing* parameters to a model — but it's a family of dialects (draft-07, draft-2020-12, the OpenAPI-3.0 subset, plus provider-specific "strict" constraints).
- **[Standard Schema](https://standardschema.dev)** — a ~60-line TypeScript interface (`~standard`) co-designed by the authors of **Zod, Valibot, and ArkType**, all of which implement it. (Despite the name, it's a community *convention* — a shared interface that spread by adoption — not a standards-body standard; the same goes for Standard JSON Schema.) It unifies *validation*: any tool can call `schema['~standard'].validate(value)` without knowing which library produced the schema. It's already consumed by tRPC, TanStack Form/Router, and others. Its pitch — reducing N×M integrations to N+M — is exactly the pitch for tools.
- **[Standard JSON Schema](https://standardschema.dev/json-schema)** — the newer companion that unifies *JSON-Schema emission*. A single interface:

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

  Crucially, `target` already includes `'openapi-3.0'` alongside the JSON Schema drafts — i.e. the dialect problem from §2.1 is, by design, *the schema library's* responsibility, selectable per call. Its stated goals: preserve inferred type information through conversion, require **zero runtime dependencies**, and let ecosystem tools accept user-defined types "without needing to write custom logic or adapters for each supported library."

---

## 3. The diagnosis

Put §2.2 and §2.3 next to each other and the picture is stark:

- The **schema layer is solved** — validation (Standard Schema) and emission (Standard JSON Schema) are both standardized, implemented by the major validators, and dependency-free to consume.
- The **envelope is not** — and it's the easy part. A tool is `name + description + (input/output schema) + execute`. Once the schemas are Standard (JSON) Schema objects, the rest is a string, a string, and a function.

So the situation is the inverse of where effort is being spent. Frameworks pour energy into re-inventing the trivial wrapper and binding it to their runtime, while the part that *could* justify a framework (schema interop) is already a shared, neutral interface.

`standard-tool` applies the Standard-Schema move one level up: standardize the envelope too, as a neutral interface with no runtime and no dependencies, so a tool authored once can be **produced or consumed** by anything.

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

…where `CombinedSpec` is "a schema that both validates **and** emits JSON Schema" — i.e. Zod 4.2+, ArkType 2.1.28+, or Valibot (+ `@valibot/to-json-schema`). The spec interfaces are *vendored* (copied in), so the package has **zero dependencies** and can equally be pasted into a project.

**The type is the proposal.** Like Standard Schema, `standard-tool` is fundamentally this *interface*: anything that produces or consumes a matching object interoperates, with no dependency. The `standardTool()` function used throughout is a *reference implementation* — a convenient way to build a conforming tool (validation, output formatting) — not a required runtime.

`execute` validates input → runs your logic → validates output → formats the result (by default, errors become `{ error }` so a model loop keeps running). The schemas are returned untouched, so any consumer can reach JSON Schema synchronously:

```ts
tool.inputSchema!['~standard'].jsonSchema.input({ target: 'draft-2020-12' }); // or 'openapi-3.0', 'draft-07'
```

Note the shape maps almost 1:1 onto MCP's `Tool` (`name`, `title`, `description`, `inputSchema`, `outputSchema`) — which is why a `standard-tool` plugs into an MCP server with no translation, and into provider APIs with a one-line `.map`.

---

## 5. Worked examples — one tool, many consumers

The point of a neutral shape is that the *same* object flows everywhere. Define once:

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

**(a) A provider function-calling loop** (OpenAI Responses shown; others differ only in the wrapper key):

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

**(b) An MCP server** — give the tool an MCP `formatOutput` (so `execute` returns a `{ content, structuredContent, isError }` result), then hand the Standard Schema straight to `registerTool`:

```ts
server.registerTool(getWeather.name, {
  title: getWeather.title,
  description: getWeather.description,
  inputSchema: getWeather.inputSchema, // a Standard Schema — the SDK emits JSON Schema from it
}, (args) => getWeather.execute(args)); // → { content, structuredContent, isError } (see the MCP formatter in the README)
```

**(c) A Vercel AI SDK adapter** — wrap the neutral shape into `tool()`:

```ts
import { tool, jsonSchema } from 'ai';
const aiTool = tool({
  description: getWeather.description,
  inputSchema: jsonSchema(getWeather.inputSchema!['~standard'].jsonSchema.input({ target: 'draft-2020-12' })),
  execute: (input) => getWeather.execute(input),
});
```

**(d) An isolated unit test** — no model, no framework, just data in/out:

```ts
expect(await getWeather.execute({ city: 'Paris' })).toEqual({ tempC: 21 });
expect(await getWeather.execute({ city: 123 as any })).toMatchObject({ error: expect.any(String) });
```

**(e) Derived from an existing API** — a derive-from-API layer can emit `standard-tool`-shaped objects from typed RPC procedures or imported OpenAPI specs, so an existing backend becomes a tool catalog without hand-writing wrappers.

Broaden the lens and the same shape underwrites: a **shareable tool registry** (publish reusable tools as plain objects, not framework plugins), **cross-runtime** use (zero deps → browser, edge, workers), and **multi-target** apps that must speak to several providers and an MCP endpoint from one definition.

---

## 6. Critical analysis — the case against (steelmanned)

A proposal that only lists its strengths isn't worth reading. The strongest objections:

**"Yet another standard" ([XKCD 927](https://xkcd.com/927/)).** The most serious one — though note that "Standard Schema" and "Standard JSON Schema" aren't ratified standards either; they're *conventions* that won by adoption (Zod/Valibot/ArkType implement Standard Schema; tRPC/TanStack consume it). That's exactly the bet here: `standard-tool` is *not* a competing framework — it has no runtime to adopt and no lock-in; it just rides those same conventions one level up. The surface area to "win" is tiny: it's a type, not a platform. Honest concession: it still adds *one more* shape to the pile, and that only pays off with adoption it does not yet have.

**Standard JSON Schema is new.** Standard Schema is broadly adopted; Standard JSON Schema (the emission half) is more recent and less proven. Building on it is a bet. Mitigant: it's a vendored interface, not a dependency — if it stalls, consumers aren't broken, and the validators already ship the implementations. But "the foundation is young" is a fair criticism.

**One emitted schema may not fit all providers.** §2.1 showed strict mode and the OpenAPI-3.0 subset diverging. `standard-tool` doesn't *solve* dialects — it *delegates* them to the schema library via the `target` option (`'openapi-3.0'`, `'draft-07'`, …). That's the right layer, but it means correct output still depends on the validator's emitter quality and on the caller picking the right target. It is not a magic "write once, runs on every provider" guarantee.

**`execute` returning a *formatted* output couples authoring with presentation.** Folding result-formatting (`{ error }` envelopes, MCP content blocks) into the tool object is convenient but opinionated; purists may want `execute` to return raw data and format elsewhere. The design answers this with a pluggable `formatOutput`, but the coupling is a deliberate, debatable choice.

**`outputSchema` is rarely consumed.** Most provider APIs ignore output schemas today; only MCP-style clients validate them. So `outputSchema` is mostly for *your* runtime safety and documentation, not the model — arguably making it feel premature. (Counter: runtime output validation is valuable on its own, and MCP adoption is rising.)

**`meta` is typed `any`.** Per-call context (`execute(input, meta)`) is intentionally `any` rather than a typed generic, because tools are invoked by a model/runtime, not hand-called in typed code — so narrowing bought friction without real safety. Defensible, but it is a hole in an otherwise type-safe surface, and reasonable people will prefer `unknown`.

**Adoption is the whole game.** A "convention" that nobody else produces or consumes is just a tidy wrapper for its author. Today `standard-tool` is closer to the latter. Its bet is that (a) the shape is obvious enough that adapters are trivial, and (b) the Standard Schema precedent shows neutral interfaces *can* spread. Unproven.

**Why not just extend Mastra's `createTool` or the AI SDK's `tool()`?** They're the closest prior art — but every one is **bundled inside a framework** and returns a **framework-coupled object** (§2.2): you can't get Mastra's `createTool` without `@mastra/core` (~50 MB), Genkit's `defineTool` without a live `genkit()` instance, LangChain's `tool()` without `@langchain/core`, or the AI SDK's `tool()` without `ai`. The "neutral, zero-dep tool *definition*" slot is, as far as this survey found, **empty** — the framework-agnostic libraries that exist are LLM *clients* (unified call APIs) that bundle tool support, not portable tool *definitions*. Honest caveat: the closest thing to a neutral standard is **MCP's** `Tool` JSON shape — but that's a wire format, with no in-process authoring, validation, or `execute`. If the ecosystem would rather converge on extending one of the framework primitives, that's a legitimate outcome; this proposal exists to make the neutral, dependency-free option concrete enough to argue about.

---

## 7. Scope — what this is *not*

- **Not an agent runtime.** It doesn't loop, plan, or call a model.
- **Not a model client.** No HTTP, no provider SDKs.
- **Not a transport/protocol.** MCP defines *how tools are served over a wire*; `standard-tool` defines *how a tool is shaped in memory*. They're complementary — a `standard-tool` is trivially served via MCP.
- **Not a schema library.** It consumes Standard Schema; it doesn't validate or emit JSON Schema itself.
- **Not an orchestration framework.** No registries, retries, or routing — bring your own.

## 8. When you do *not* need it

- You're committed to a single framework end-to-end and never leave it → use that framework's tool primitive.
- You target exactly one provider and don't want validation → hand-write the JSON Schema; it's a few lines.
- Your tools aren't reused across apps/runtimes → the portability payoff is small.

## 9. Open questions

- Should `meta` be `unknown` (safer) or `any` (frictionless)? Currently `any`, since tools are invoked by a model/runtime, not hand-called in typed code.
- Should result-formatting live in the tool at all, or always be a separate step?
- What's the minimal *adapter* set (provider loop, MCP, AI SDK, LangChain) that would make adoption real — and should those ship as separate tiny packages or be left to consumers?

---

## Sources

- Standard Schema — <https://standardschema.dev>
- Standard JSON Schema — <https://standardschema.dev/json-schema>
- MCP tools specification (2025-06-18) — <https://modelcontextprotocol.io/specification/2025-06-18/server/tools>
- OpenAI function calling — <https://developers.openai.com/api/docs/guides/function-calling> · Structured Outputs — <https://openai.com/index/introducing-structured-outputs-in-the-api/>
- Google Gemini function calling — <https://ai.google.dev/gemini-api/docs/function-calling>
- Vercel AI SDK `tool()` — <https://ai-sdk.dev/docs/reference/ai-sdk-core/tool>
- Mastra `createTool` — <https://mastra.ai/reference/tools/create-tool> · `@mastra/core` size/deps — <https://www.npmjs.com/package/@mastra/core>
- Genkit tool calling — <https://genkit.dev/docs/tool-calling/> · LangChain `@langchain/core` tools — <https://www.npmjs.com/package/@langchain/core>
- XKCD 927, "Standards" — <https://xkcd.com/927/>
